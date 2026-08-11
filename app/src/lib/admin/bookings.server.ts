/**
 * Bookings management — reads and writes for /admin/bookings. Service role, RLS
 * bypassed: import ONLY from server functions that have already called
 * requireAdmin() (src/lib/api/admin.functions.ts).
 *
 * WHAT THIS MODULE IS RESPONSIBLE FOR
 *   the timeline   every booking touching one month, as bars per car
 *   the list       the same bookings, filtered, for when a grid is the slow way
 *   the detail     one booking in full, including internal notes
 *   the writes     prep_status moves and admin_notes edits
 *
 * THREE THINGS THAT ARE EASY TO GET WRONG HERE
 *
 * 1. DATE COLUMNS vs TIMESTAMP COLUMNS. `pickup_date` / `return_date` are `date`
 *    columns and take bare 'YYYY-MM-DD' strings, which compare correctly because
 *    that format sorts lexicographically. `pickup_at` / `return_at` are
 *    generated wall-clock `timestamp` columns and take 'YYYY-MM-DDTHH:MM:SS'
 *    with NO zone suffix — adding a 'Z' makes PostgREST coerce through UTC and
 *    shifts every comparison by four hours. This file orders on the timestamps
 *    (so two rentals on one day sort by the hour) and filters on the dates (so
 *    the windows line up with the calendar's columns).
 *
 * 2. OVERLAP, NOT CONTAINMENT. "Bookings in July" means every rental that is
 *    RUNNING in July, including one that started in June — that is the row an
 *    operator is looking for when a guest calls on the 2nd. So the filter is
 *    `pickup_date < end AND return_date >= start`, never `pickup_date` between
 *    two bounds. The timeline and the list use the same rule so that switching
 *    views cannot change which bookings exist.
 *
 * 3. updated_at IS THE DATABASE'S JOB. `trg_bookings_updated_at` fires
 *    `set_updated_at()` before every UPDATE on bookings, so both writes below
 *    stamp it without naming it. Setting it in the payload here would be
 *    overwritten by the trigger anyway, and would go stale the moment someone
 *    edits a row from SQL or a future phase adds another write path.
 */
import { supabaseAdmin } from "../supabase/admin.server";
import { rentalDays } from "../booking/rental";
import type {
  BookingStatus,
  CarStatus,
  PaymentStatus,
  PrepStatus,
  RentalTypeValue,
  Transmission,
} from "../supabase/types";
import { PREP_FLOW } from "./prep";
import { addDays, curacaoNow, isMonthKey, monthKeyOf } from "./clock";
import { monthGrid, packLanes, toBars, type RentalForBar } from "./timeline";
import type {
  BookingDetail,
  BookingFilters,
  BookingRow,
  BookingsBoardData,
  BookingsListData,
  BookingWriteResult,
  TimelineBar,
  TimelineRow,
} from "./types";

/** How many rows the list view fetches. The exact match count comes from
 *  PostgREST's `count: 'exact'`, so the headline number stays right even when
 *  the table is capped — five cars cannot produce 500 concurrent rentals, but
 *  the count and the rows must not be able to disagree by construction. */
const LIST_LIMIT = 500;

/** Longest rental the timeline expects, in days. The month query has to reach
 *  back far enough to catch a rental that STARTED before the month and is still
 *  running inside it; `return_date >= firstDay` does that on its own, and this
 *  bound only exists to keep the index scan on `pickup_date` narrow. A rental
 *  longer than this would be missed on the months in its middle, which is why
 *  it is generous rather than tight. */
const MAX_RENTAL_DAYS = 400;

const BOARD_SELECT = `
  id, car_id, pickup_date, pickup_time, return_date, return_time,
  total_price, booking_status, payment_status, prep_status,
  clients ( full_name )
`;

const LIST_SELECT = `
  id, car_id, pickup_date, pickup_time, return_date, return_time,
  pickup_location, return_location, total_price,
  booking_status, payment_status, prep_status, created_at,
  cars ( id, model, color ),
  clients ( full_name, email, phone )
`;

const DETAIL_SELECT = `
  *,
  cars ( * ),
  clients ( * )
`;

/** "Hyundai Venue · Red" — the fleet has two Versas, so the colour is not
 *  decoration, it is how an admin tells the cars apart. Same label as the
 *  dashboard builds; both read from `cars`, so they always agree. */
function carLabel(car: { model: string; color: string } | null): string {
  if (!car) return "Unknown car";
  return `${car.model} · ${car.color}`;
}

function zeroPrepCounts(): Record<PrepStatus, number> {
  return Object.fromEntries(PREP_FLOW.map((s) => [s, 0])) as Record<PrepStatus, number>;
}

/** PostgREST's join output, cast rather than fighting the generated
 *  relationship types — the same approach dashboard.server.ts takes. */
interface RawListRow {
  id: string;
  car_id: string;
  pickup_date: string;
  pickup_time: string;
  return_date: string;
  return_time: string;
  pickup_location: string;
  return_location: string;
  total_price: number;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  prep_status: PrepStatus;
  created_at: string;
  cars: { id: string; model: string; color: string } | null;
  clients: { full_name: string; email: string; phone: string } | null;
}

function toBookingRow(raw: RawListRow): BookingRow {
  return {
    id: raw.id,
    ref: raw.id.slice(0, 8),
    clientName: raw.clients?.full_name ?? "Unknown guest",
    clientEmail: raw.clients?.email ?? "",
    clientPhone: raw.clients?.phone ?? "",
    carId: raw.car_id,
    carLabel: carLabel(raw.cars),
    pickupDate: raw.pickup_date,
    pickupTime: raw.pickup_time,
    returnDate: raw.return_date,
    returnTime: raw.return_time,
    pickupLocation: raw.pickup_location,
    returnLocation: raw.return_location,
    days: rentalDays(raw.pickup_date, raw.return_date),
    totalCents: raw.total_price,
    bookingStatus: raw.booking_status,
    paymentStatus: raw.payment_status,
    prepStatus: raw.prep_status,
    createdAt: raw.created_at,
  };
}

/** The board query's join result. */
interface RawBoardRow {
  id: string;
  car_id: string;
  pickup_date: string;
  pickup_time: string;
  return_date: string;
  return_time: string;
  total_price: number;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  prep_status: PrepStatus;
  clients: { full_name: string } | null;
}

/** A booking row in the shape src/lib/admin/timeline.ts draws bars from. */
function toRentalForBar(raw: RawBoardRow): RentalForBar {
  return {
    id: raw.id,
    carId: raw.car_id,
    clientName: raw.clients?.full_name ?? "Unknown guest",
    pickupDate: raw.pickup_date,
    returnDate: raw.return_date,
    pickupTime: raw.pickup_time,
    returnTime: raw.return_time,
    totalCents: raw.total_price,
    bookingStatus: raw.booking_status,
    paymentStatus: raw.payment_status,
    prepStatus: raw.prep_status,
  };
}

/* ── the timeline ──────────────────────────────────────────────────────────── */

/**
 * Every booking touching `month`, as bars in one row per car.
 *
 * CANCELLED BOOKINGS ARE DRAWN, not filtered out. The car is free — a cancelled
 * row sits outside the exclusion constraint's partial WHERE — but "there was a
 * booking here and it fell through" is information an operator wants when they
 * look at a quiet week. They are the reason lanes exist: a cancellation and its
 * replacement legitimately cover the same dates, and the packer stacks them
 * instead of drawing one on top of the other.
 *
 * An unparseable month key falls back to the current Curaçao month rather than
 * throwing: the value comes out of the URL, and a bad one should show the
 * calendar, not an error page.
 */
export async function getBookingsBoard(month?: string | null): Promise<BookingsBoardData> {
  const now = curacaoNow();
  const currentMonth = monthKeyOf(now.today);
  const grid = monthGrid(isMonthKey(month) ? month : currentMonth);

  const db = supabaseAdmin();
  const [carsRes, bookingsRes] = await Promise.all([
    db.from("cars").select("id, model, color, status").order("daily_rate", { ascending: false }),
    db
      .from("bookings")
      .select(BOARD_SELECT)
      // Overlap, both ends bounded. See note 2 in the file header for why the
      // lower bound is on return_date and not on pickup_date.
      .lt("pickup_date", grid.nextMonthFirstDay)
      .gte("return_date", grid.firstDay)
      .gte("pickup_date", addDays(grid.firstDay, -MAX_RENTAL_DAYS))
      .order("pickup_at", { ascending: true }),
  ]);

  if (carsRes.error)
    throw new Error(`Bookings board: failed to load cars: ${carsRes.error.message}`);
  if (bookingsRes.error) {
    throw new Error(`Bookings board: failed to load bookings: ${bookingsRes.error.message}`);
  }

  const cars = (carsRes.data ?? []) as {
    id: string;
    model: string;
    color: string;
    status: CarStatus;
  }[];

  const raw = (bookingsRes.data ?? []) as unknown as RawBoardRow[];

  // toBars applies the exact column rule and drops whatever the wider SQL
  // window over-fetched; the fleet page builds its own timeline through the same
  // function, which is what keeps one bar from being drawn two ways.
  const bars = toBars(raw.map(toRentalForBar), grid);

  const barsByCar = new Map<string, TimelineBar[]>();
  const prepCounts = zeroPrepCounts();

  for (const bar of bars) {
    prepCounts[bar.prepStatus]++;
    const list = barsByCar.get(bar.carId);
    if (list) list.push(bar);
    else barsByCar.set(bar.carId, [bar]);
  }
  const visibleCount = bars.length;

  const rows: TimelineRow[] = cars.map((car) => {
    const { bars, lanes } = packLanes(barsByCar.get(car.id) ?? []);
    return { carId: car.id, carLabel: carLabel(car), carStatus: car.status, lanes, bars };
  });

  // A booking against a car that is no longer in `cars` cannot happen — car_id
  // is a foreign key with ON DELETE RESTRICT — so there is deliberately no
  // "orphaned bars" row to render here.

  return {
    month: grid.month,
    monthLabel: grid.label,
    days: grid.days,
    prevMonth: grid.prevMonth,
    nextMonth: grid.nextMonth,
    today: now.today,
    currentMonth,
    rows,
    visibleCount,
    prepCounts,
  };
}

/* ── the list ──────────────────────────────────────────────────────────────── */

/**
 * The same bookings as a filtered table. Sorted by pickup, soonest first, which
 * is the order the work happens in — a prep queue read top to bottom is the
 * morning's job list.
 *
 * `prepCounts` is computed across EVERY booking, not the filtered set: those
 * numbers label the filter chips, and a count that moves when you click it is
 * useless for deciding whether to click it.
 */
export async function getBookingsList(filters: BookingFilters): Promise<BookingsListData> {
  const db = supabaseAdmin();

  let query = db.from("bookings").select(LIST_SELECT, { count: "exact" });

  if (filters.prep.length > 0) query = query.in("prep_status", filters.prep);
  if (filters.carId) query = query.eq("car_id", filters.carId);
  // Overlap again, so the list and the calendar always contain the same set for
  // the same window. `to` is inclusive: a rental picked up ON the last day of
  // the range is in the range.
  if (filters.to) query = query.lte("pickup_date", filters.to);
  if (filters.from) query = query.gte("return_date", filters.from);

  const [listRes, prepRes, carsRes] = await Promise.all([
    query.order("pickup_at", { ascending: true }).limit(LIST_LIMIT),
    db.from("bookings").select("prep_status"),
    db.from("cars").select("id, model, color").order("daily_rate", { ascending: false }),
  ]);

  if (listRes.error) throw new Error(`Bookings list: failed to load: ${listRes.error.message}`);
  if (prepRes.error) {
    throw new Error(`Bookings list: failed to count the pipeline: ${prepRes.error.message}`);
  }
  if (carsRes.error)
    throw new Error(`Bookings list: failed to load cars: ${carsRes.error.message}`);

  const prepCounts = zeroPrepCounts();
  for (const row of (prepRes.data ?? []) as { prep_status: PrepStatus }[]) {
    prepCounts[row.prep_status]++;
  }

  const rows = ((listRes.data ?? []) as unknown as RawListRow[]).map(toBookingRow);

  return {
    filters,
    rows,
    total: listRes.count ?? rows.length,
    truncated: rows.length >= LIST_LIMIT,
    prepCounts,
    cars: ((carsRes.data ?? []) as { id: string; model: string; color: string }[]).map((c) => ({
      id: c.id,
      label: carLabel(c),
    })),
  };
}

/* ── one booking ───────────────────────────────────────────────────────────── */

interface RawDetailRow {
  id: string;
  client_id: string;
  car_id: string;
  pickup_date: string;
  pickup_time: string;
  return_date: string;
  return_time: string;
  pickup_location: string;
  return_location: string;
  flight_number: string | null;
  total_price: number;
  rental_type: RentalTypeValue;
  discount_pct: number;
  discount_cents: number;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  prep_status: PrepStatus;
  special_requests: string | null;
  admin_notes: string | null;
  handled_by: string | null;
  created_at: string;
  updated_at: string;
  cars: {
    id: string;
    model: string;
    color: string;
    category: string;
    transmission: Transmission;
    seats: number;
    status: CarStatus;
    daily_rate: number;
    monthly_rate: number;
  } | null;
  clients: {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    license_number: string | null;
    license_expiry: string | null;
    date_of_birth: string | null;
    country_of_residence: string | null;
  } | null;
}

function toBookingDetail(raw: RawDetailRow): BookingDetail {
  const days = rentalDays(raw.pickup_date, raw.return_date);
  const car = raw.cars;
  const client = raw.clients;

  return {
    id: raw.id,
    ref: raw.id.slice(0, 8),
    client: {
      id: client?.id ?? raw.client_id,
      fullName: client?.full_name ?? "Unknown guest",
      email: client?.email ?? "",
      phone: client?.phone ?? "",
      licenseNumber: client?.license_number ?? null,
      licenseExpiry: client?.license_expiry ?? null,
      dateOfBirth: client?.date_of_birth ?? null,
      countryOfResidence: client?.country_of_residence ?? null,
    },
    car: {
      id: car?.id ?? raw.car_id,
      label: carLabel(car),
      model: car?.model ?? "Unknown",
      color: car?.color ?? "—",
      category: car?.category ?? "—",
      transmission: car?.transmission ?? "Automatic",
      seats: car?.seats ?? 0,
      status: car?.status ?? "available",
      dailyRateCents: car?.daily_rate ?? 0,
      monthlyRateCents: car?.monthly_rate ?? 0,
    },
    pickupDate: raw.pickup_date,
    pickupTime: raw.pickup_time,
    pickupLocation: raw.pickup_location,
    returnDate: raw.return_date,
    returnTime: raw.return_time,
    returnLocation: raw.return_location,
    flightNumber: raw.flight_number,
    days,
    rentalType: raw.rental_type,
    discountPct: raw.discount_pct,
    discountCents: raw.discount_cents,
    // The pre-discount figure, reconstructed from what was STORED rather than
    // re-multiplied from a rate: total_price is already net of the discount, so
    // total + discount is the subtotal exactly, with no rounding to argue about.
    subtotalCents: raw.total_price + raw.discount_cents,
    // What this rental was charged per day at list, before the discount.
    // total_price is the quote that was struck at booking time and is
    // authoritative; the car's current daily_rate may since have changed, and
    // the detail view says so rather than recomputing a total nobody agreed to.
    quotedPerDayCents: Math.round((raw.total_price + raw.discount_cents) / days),
    totalCents: raw.total_price,
    bookingStatus: raw.booking_status,
    paymentStatus: raw.payment_status,
    prepStatus: raw.prep_status,
    specialRequests: raw.special_requests,
    adminNotes: raw.admin_notes,
    handledBy: raw.handled_by,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/** Postgres would reject a non-uuid against a uuid column with 22P02, which
 *  would reach the browser as a 500 for what is really just a bad link. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One booking, or null.
 *
 * A malformed id is a MISS, not an error: this is reached from whatever is in the
 * address bar, and a mistyped or truncated link should land on the "not found"
 * page like any other id that does not resolve. The write paths keep a strict
 * uuid validator instead, because a bad id there comes from our own UI and is a
 * bug worth surfacing.
 */
export async function getBookingDetail(bookingId: string): Promise<BookingDetail | null> {
  if (!UUID_RE.test(bookingId)) return null;

  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .select(DETAIL_SELECT)
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw new Error(`Booking detail: failed to load: ${error.message}`);
  if (!data) return null;
  return toBookingDetail(data as unknown as RawDetailRow);
}

/* ── writes ────────────────────────────────────────────────────────────────── */

const NOT_FOUND = {
  ok: false as const,
  reason: "not_found" as const,
  message: "That booking no longer exists.",
};

/**
 * Move a booking's prep_status.
 *
 * `expectedFrom` is the status the admin was looking at when they pressed the
 * button, and it is written into the WHERE clause. That single `eq` is what
 * makes "advance one step" safe with two tabs open: the update either applies to
 * the row the admin saw, or it applies to nothing and comes back as `stale` with
 * the current row attached. Without it, two clicks on a stale "Mark ready"
 * button could walk a car that is already out back to ready.
 *
 * Any transition is allowed, including backwards — see the note on isPrepStatus
 * in ./prep for why a forward-only pipeline would be corrected with SQL at the
 * counter, which is worse.
 */
export async function setBookingPrepStatus(input: {
  bookingId: string;
  to: PrepStatus;
  expectedFrom: PrepStatus;
}): Promise<BookingWriteResult> {
  const db = supabaseAdmin();

  // Setting a status to the value it already holds is a no-op, not a conflict:
  // the guard below would report it as `stale` (nothing matched `expectedFrom`
  // → we re-read → it equals `to`), which would be a confusing thing to tell an
  // admin who just double-clicked. Short-circuit it as success.
  if (input.to === input.expectedFrom) {
    const current = await getBookingDetail(input.bookingId);
    if (!current) return NOT_FOUND;
    return { ok: true, booking: current };
  }

  const { data, error } = await db
    .from("bookings")
    .update({ prep_status: input.to })
    .eq("id", input.bookingId)
    .eq("prep_status", input.expectedFrom)
    .select(DETAIL_SELECT)
    .maybeSingle();

  if (error) throw new Error(`Booking prep status: failed to update: ${error.message}`);

  if (!data) {
    // Nothing matched: either the booking is gone, or its status moved.
    const current = await getBookingDetail(input.bookingId);
    if (!current) return NOT_FOUND;
    return {
      ok: false,
      reason: "stale",
      message: `This booking is already "${current.prepStatus.replace(/_/g, " ")}" — someone changed it while this page was open.`,
      booking: current,
    };
  }

  return { ok: true, booking: toBookingDetail(data as unknown as RawDetailRow) };
}

/**
 * Replace a booking's internal notes.
 *
 * Last write wins, deliberately: CW runs one admin account, and the failure this
 * would guard against (two people typing different notes into the same box at
 * the same minute) cannot happen yet. When there are several admins, add the
 * same `expectedUpdatedAt` guard the prep write uses — the shape is already here.
 *
 * An empty box stores NULL rather than '', so "no notes" has one representation
 * in the database and `admin_notes is null` keeps meaning what it says.
 */
export async function setBookingAdminNotes(input: {
  bookingId: string;
  notes: string;
}): Promise<BookingWriteResult> {
  const trimmed = input.notes.trim();

  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .update({ admin_notes: trimmed.length > 0 ? trimmed : null })
    .eq("id", input.bookingId)
    .select(DETAIL_SELECT)
    .maybeSingle();

  if (error) throw new Error(`Booking notes: failed to save: ${error.message}`);
  if (!data) return NOT_FOUND;

  return { ok: true, booking: toBookingDetail(data as unknown as RawDetailRow) };
}
