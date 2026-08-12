/**
 * Bookings management — reads and writes for /admin/bookings. Service role, RLS
 * bypassed: import ONLY from server functions that have already called
 * requireAdmin() (src/lib/api/admin.functions.ts).
 *
 * WHAT THIS MODULE IS RESPONSIBLE FOR
 *   the timeline   every booking touching one month, as bars per VEHICLE
 *   the list       the same bookings, filtered, for when a grid is the slow way
 *   the detail     one booking in full, including internal notes
 *   the writes     prep_status moves, admin_notes edits, and bookings taken by
 *                  hand at the counter or over the phone
 *
 * A BOOKING NOW NAMES TWO CARS, and the difference matters on every screen
 * below: `car_id` is the LISTING that was sold and priced, `vehicle_id` is the
 * physical car whose keys the guest gets. Filters and grouping that answer
 * "what did we sell" work on the listing; anything an operator acts on in the
 * yard works on the vehicle. The timeline draws one row per VEHICLE, because a
 * listing backed by two cars can have two rentals running at once and stacking
 * them in one row would look exactly like a double booking.
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
import {
  PICKUP_TIME,
  RETURN_TIME,
  quoteRental,
  rentalDays,
  resolveWindow,
  type RentalType,
} from "../booking/rental";
import type {
  BookingStatus,
  PaymentStatus,
  PrepStatus,
  RentalTypeValue,
  Transmission,
  VehicleStatus,
} from "../supabase/types";
import { PREP_FLOW } from "./prep";
import { vehicleLabel } from "./fleet";
import { addDays, curacaoNow, isMonthKey, monthKeyOf } from "./clock";
import { monthGrid, packLanes, toBars, type RentalForBar } from "./timeline";
import type {
  BookingDetail,
  BookingFilters,
  BookingRow,
  BookingsBoardData,
  BookingsListData,
  BookingWriteResult,
  ManualBookingListing,
  ManualBookingOptions,
  ManualBookingResult,
  TimelineBar,
  TimelineRow,
} from "./types";

/** Cancelled rentals hold nothing: the exclusion constraint's partial WHERE, in
 *  the one word this file uses for it. */
const CANCELLED = "cancelled";

/** Postgres exclusion_violation — the double-booking guard firing, now on
 *  vehicle_id. */
const EXCLUSION_VIOLATION = "23P01";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How many guests the manual booking picker offers. CW's directory is in the
 *  hundreds; the form also takes a new guest, so this is a convenience list and
 *  not a paging problem to solve. */
const CLIENT_PICKER_LIMIT = 500;

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
  id, car_id, vehicle_id, pickup_date, pickup_time, return_date, return_time,
  total_price, booking_status, payment_status, prep_status,
  clients ( full_name )
`;

const LIST_SELECT = `
  id, car_id, vehicle_id, pickup_date, pickup_time, return_date, return_time,
  pickup_location, return_location, total_price,
  booking_status, payment_status, prep_status, created_at,
  cars ( id, model, color ),
  vehicles ( id, color, plate_number, is_publicly_visible ),
  clients ( full_name, email, phone )
`;

const DETAIL_SELECT = `
  *,
  cars ( * ),
  vehicles ( * ),
  clients ( * )
`;

/** "Hyundai Venue · Red" — the LISTING. The fleet has two Versas, so the colour
 *  is not decoration, it is how an admin tells the listings apart. Same label as
 *  the dashboard and the fleet page build; all three read from `cars`, so they
 *  always agree. */
function carLabel(car: { model: string; color: string } | null): string {
  if (!car) return "Unknown car";
  return `${car.model} · ${car.color}`;
}

/** "Grey · P-4821" — the PHYSICAL car. Falls back rather than throwing: a join
 *  that came back empty is a display problem, not a reason to fail the page. */
function unitLabel(vehicle: { color: string; plate_number: string | null } | null): string {
  if (!vehicle) return "Unassigned";
  return vehicleLabel(vehicle);
}

function zeroPrepCounts(): Record<PrepStatus, number> {
  return Object.fromEntries(PREP_FLOW.map((s) => [s, 0])) as Record<PrepStatus, number>;
}

/** PostgREST's join output, cast rather than fighting the generated
 *  relationship types — the same approach dashboard.server.ts takes. */
interface RawListRow {
  id: string;
  car_id: string;
  vehicle_id: string;
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
  vehicles: {
    id: string;
    color: string;
    plate_number: string | null;
    is_publicly_visible: boolean;
  } | null;
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
    vehicleId: raw.vehicle_id,
    vehicleLabel: unitLabel(raw.vehicles),
    vehicleIsPubliclyVisible: raw.vehicles?.is_publicly_visible ?? true,
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
  vehicle_id: string;
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
    vehicleId: raw.vehicle_id,
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
 * Every booking touching `month`, as bars in one row per PHYSICAL CAR.
 *
 * ONE ROW PER VEHICLE, NOT PER LISTING. Two Sparks rented over the same week is
 * a good week, not a conflict, and a single Spark row would draw it as two
 * stacked lanes — the same shape this calendar uses to signal a cancellation
 * overlapping its replacement. Rows are labelled with the listing and the unit
 * so the pair reads as two cars of one model rather than as two models.
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
  const [carsRes, vehiclesRes, bookingsRes] = await Promise.all([
    db
      .from("cars")
      .select("id, model, color, daily_rate")
      .order("daily_rate", { ascending: false }),
    db
      .from("vehicles")
      .select("id, listing_id, color, plate_number, status, is_publicly_visible, created_at"),
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
    throw new Error(`Bookings board: failed to load listings: ${carsRes.error.message}`);
  if (vehiclesRes.error)
    throw new Error(`Bookings board: failed to load vehicles: ${vehiclesRes.error.message}`);
  if (bookingsRes.error) {
    throw new Error(`Bookings board: failed to load bookings: ${bookingsRes.error.message}`);
  }

  const cars = (carsRes.data ?? []) as {
    id: string;
    model: string;
    color: string;
    daily_rate: number;
  }[];

  const vehicles = (vehiclesRes.data ?? []) as {
    id: string;
    listing_id: string;
    color: string;
    plate_number: string | null;
    status: VehicleStatus;
    is_publicly_visible: boolean;
    created_at: string;
  }[];

  const raw = (bookingsRes.data ?? []) as unknown as RawBoardRow[];

  // toBars applies the exact column rule and drops whatever the wider SQL
  // window over-fetched; the fleet page builds its own timeline through the same
  // function, which is what keeps one bar from being drawn two ways.
  const bars = toBars(raw.map(toRentalForBar), grid);

  const barsByVehicle = new Map<string, TimelineBar[]>();
  const prepCounts = zeroPrepCounts();

  for (const bar of bars) {
    prepCounts[bar.prepStatus]++;
    const list = barsByVehicle.get(bar.vehicleId);
    if (list) list.push(bar);
    else barsByVehicle.set(bar.vehicleId, [bar]);
  }
  const visibleCount = bars.length;

  // Rows follow the listing order (rate, high to low) and then assignment order
  // within a listing, so the visible unit sits directly above its backup and the
  // pair reads as one product.
  const listingRank = new Map(cars.map((c, i) => [c.id, i]));
  const listingById = new Map(cars.map((c) => [c.id, c]));

  const rows: TimelineRow[] = [...vehicles]
    .sort((a, b) => {
      const rank = (listingRank.get(a.listing_id) ?? 0) - (listingRank.get(b.listing_id) ?? 0);
      if (rank !== 0) return rank;
      if (a.is_publicly_visible !== b.is_publicly_visible) return a.is_publicly_visible ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    })
    .map((vehicle) => {
      const { bars, lanes } = packLanes(barsByVehicle.get(vehicle.id) ?? []);
      const listing = listingById.get(vehicle.listing_id) ?? null;
      return {
        vehicleId: vehicle.id,
        listingId: vehicle.listing_id,
        listingLabel: carLabel(listing),
        vehicleLabel: vehicleLabel(vehicle),
        status: vehicle.status,
        isPubliclyVisible: vehicle.is_publicly_visible,
        lanes,
        bars,
      };
    });

  // A booking against a vehicle that is no longer in `vehicles` cannot happen —
  // vehicle_id is a foreign key with ON DELETE RESTRICT — so there is
  // deliberately no "orphaned bars" row to render here.

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
  vehicle_id: string;
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
    daily_rate: number;
    monthly_rate: number;
  } | null;
  vehicles: {
    id: string;
    color: string;
    plate_number: string | null;
    is_publicly_visible: boolean;
    status: VehicleStatus;
    maintenance_notes: string | null;
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
  const vehicle = raw.vehicles;
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
      dailyRateCents: car?.daily_rate ?? 0,
      monthlyRateCents: car?.monthly_rate ?? 0,
    },
    vehicle: {
      id: vehicle?.id ?? raw.vehicle_id,
      label: unitLabel(vehicle),
      color: vehicle?.color ?? "—",
      plateNumber: vehicle?.plate_number ?? null,
      isPubliclyVisible: vehicle?.is_publicly_visible ?? true,
      status: vehicle?.status ?? "available",
      maintenanceNotes: vehicle?.maintenance_notes ?? null,
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

/* ── taking a booking by hand ──────────────────────────────────────────────── */

/**
 * What the manual booking screen needs, in one round trip.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE PUBLIC AVAILABILITY QUERY. The public one
 * answers "which LISTINGS can I offer?" and deliberately hides everything about
 * the cars behind them. This one answers "which CAR shall I give this guest?",
 * which is the opposite: it names every unit, including the ones the site never
 * shows, and says why each is or is not pickable. The two must not be collapsed
 * into one function with a flag — the whole point of the hidden unit is that one
 * of these callers can see it and the other cannot.
 *
 * With no dates supplied, every vehicle comes back with `availability: null`.
 * That is "not asked yet", and the form renders it as such rather than implying
 * a free car it has not checked.
 */
export async function getManualBookingOptions(input: {
  pickupDate?: string | null;
  returnDate?: string | null;
}): Promise<ManualBookingOptions> {
  const now = curacaoNow();
  const db = supabaseAdmin();

  // Only a well-formed, ordered window gets an availability answer. A half-typed
  // date must not produce "everything is taken".
  const hasWindow =
    !!input.pickupDate &&
    !!input.returnDate &&
    DATE_KEY_RE.test(input.pickupDate) &&
    DATE_KEY_RE.test(input.returnDate) &&
    input.returnDate > input.pickupDate;

  const [carsRes, vehiclesRes, clientsRes, rentalsRes, overlapRes] = await Promise.all([
    db
      .from("cars")
      .select("id, model, color, category, daily_rate, monthly_rate")
      .order("daily_rate", { ascending: false }),
    db
      .from("vehicles")
      .select("id, listing_id, color, plate_number, is_publicly_visible, status, created_at"),
    db
      .from("clients")
      .select("id, full_name, email, phone")
      .order("full_name", { ascending: true })
      .limit(CLIENT_PICKER_LIMIT),
    db.from("bookings").select("client_id").neq("booking_status", CANCELLED),
    hasWindow
      ? db
          .from("bookings")
          .select("vehicle_id, return_date, clients ( full_name )")
          .neq("booking_status", CANCELLED)
          // The same half-open overlap the exclusion constraint applies, on the
          // same generated columns — so what this screen shows as free is what
          // the insert will actually accept, give or take the seconds between.
          .lt("pickup_at", `${input.returnDate}T${RETURN_TIME}`)
          .gt("return_at", `${input.pickupDate}T${PICKUP_TIME}`)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const [label, res] of [
    ["listings", carsRes],
    ["vehicles", vehiclesRes],
    ["clients", clientsRes],
    ["client history", rentalsRes],
    ["overlapping rentals", overlapRes],
  ] as const) {
    if (res.error) throw new Error(`Manual booking: failed to load ${label}: ${res.error.message}`);
  }

  const cars = (carsRes.data ?? []) as {
    id: string;
    model: string;
    color: string;
    category: string;
    daily_rate: number;
    monthly_rate: number;
  }[];

  const vehicles = (vehiclesRes.data ?? []) as {
    id: string;
    listing_id: string;
    color: string;
    plate_number: string | null;
    is_publicly_visible: boolean;
    status: VehicleStatus;
    created_at: string;
  }[];

  const overlapping = (overlapRes.data ?? []) as unknown as {
    vehicle_id: string;
    return_date: string;
    clients: { full_name: string } | null;
  }[];
  const takenBy = new Map(overlapping.map((b) => [b.vehicle_id, b]));

  const rentalCounts = new Map<string, number>();
  for (const row of (rentalsRes.data ?? []) as { client_id: string }[]) {
    rentalCounts.set(row.client_id, (rentalCounts.get(row.client_id) ?? 0) + 1);
  }

  const listings: ManualBookingListing[] = cars.map((car) => ({
    id: car.id,
    label: `${car.model} · ${car.color}`,
    category: car.category,
    dailyRateCents: car.daily_rate,
    monthlyRateCents: car.monthly_rate,
    vehicles: vehicles
      .filter((v) => v.listing_id === car.id)
      .sort((a, b) => {
        if (a.is_publicly_visible !== b.is_publicly_visible) return a.is_publicly_visible ? -1 : 1;
        return a.created_at < b.created_at ? -1 : 1;
      })
      .map((v) => {
        const held = takenBy.get(v.id);
        return {
          id: v.id,
          listingId: v.listing_id,
          label: vehicleLabel(v),
          color: v.color,
          plateNumber: v.plate_number,
          isPubliclyVisible: v.is_publicly_visible,
          status: v.status,
          // Off the road beats taken: a car in the shop is not merely busy, and
          // an operator reading "already out" would go looking for it.
          availability: !hasWindow
            ? null
            : v.status !== "available"
              ? ("off_road" as const)
              : held
                ? ("taken" as const)
                : ("free" as const),
          takenBy: held?.clients?.full_name ?? null,
          takenUntil: held?.return_date ?? null,
        };
      }),
  }));

  return {
    today: now.today,
    pickupDate: hasWindow ? (input.pickupDate ?? null) : null,
    returnDate: hasWindow ? (input.returnDate ?? null) : null,
    listings,
    clients: (
      (clientsRes.data ?? []) as {
        id: string;
        full_name: string;
        email: string;
        phone: string;
      }[]
    ).map((c) => ({
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone,
      rentals: rentalCounts.get(c.id) ?? 0,
    })),
  };
}

export interface ManualBookingInput {
  /** An existing guest, or null to create one from `guest`. */
  clientId: string | null;
  guest: { fullName: string; email: string; phone: string } | null;
  /** The PHYSICAL car, named by the operator. Its listing is derived, never
   *  taken from the form — see below. */
  vehicleId: string;
  rentalType: RentalType;
  pickupDate: string;
  /** Ignored for a monthly rental, whose period is derived. */
  returnDate: string | null;
  pickupLocation: string;
  returnLocation: string;
  flightNumber: string | null;
  specialRequests: string | null;
  adminNotes: string | null;
  bookingStatus: Extract<BookingStatus, "pending" | "confirmed">;
  paymentStatus: PaymentStatus;
  /** The admin taking it, for the record. */
  handledBy: string | null;
}

/**
 * Take a booking by hand: a phone call, a walk-in, or a deliberate choice of the
 * backup unit.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE PUBLIC PATH, and it is one thing: the
 * vehicle is NAMED rather than assigned. Everything else is deliberately
 * identical, and identical for the same reasons:
 *
 *   THE PRICE still comes from quoteRental() with rates read here from the
 *   database. An operator cannot type a total any more than a guest can. If a
 *   deal needs a different number, it is recorded as what it is — a payment
 *   against the booking — rather than by quietly restating the price list.
 *
 *   THE WINDOW of a monthly rental is still derived, so a manual monthly booking
 *   occupies the same 30 days it is priced for.
 *
 *   THE EXCLUSION CONSTRAINT is still the authority on whether the car is free.
 *   There is no retry loop here, and that absence is the feature: the operator
 *   picked THIS car, so a clash is reported to them rather than silently
 *   resolved by moving the guest to a different one.
 *
 * The listing is read from the vehicle rather than accepted alongside it. The
 * composite FK would reject a mismatched pair anyway; deriving it means the form
 * cannot construct the pair in the first place.
 */
export async function createManualBooking(input: ManualBookingInput): Promise<ManualBookingResult> {
  const db = supabaseAdmin();
  const window = resolveWindow(input.rentalType, input.pickupDate, input.returnDate);

  if (!DATE_KEY_RE.test(window.pickupDate) || !DATE_KEY_RE.test(window.returnDate)) {
    return { ok: false, reason: "invalid", message: "Enter both dates as YYYY-MM-DD." };
  }
  if (window.returnDate <= window.pickupDate) {
    return { ok: false, reason: "invalid", message: "The return date must be after the pickup." };
  }

  // 1. The car, and through it the listing that carries the price.
  const { data: vehicle, error: vehicleError } = await db
    .from("vehicles")
    .select("id, listing_id, color, plate_number, status, cars ( daily_rate, monthly_rate )")
    .eq("id", input.vehicleId)
    .maybeSingle();

  if (vehicleError)
    throw new Error(`Manual booking: failed to load the car: ${vehicleError.message}`);
  if (!vehicle) {
    return { ok: false, reason: "not_found", message: "That car is not in the fleet." };
  }

  const listing = vehicle.cars as unknown as { daily_rate: number; monthly_rate: number } | null;
  if (!listing) {
    return { ok: false, reason: "not_found", message: "That car has no listing to price against." };
  }

  // An off-road car is refused rather than quietly allowed. Assigning a rental
  // to a car that is in the shop is either a mistake or a decision to put it
  // back on the road, and the second one has its own button on the fleet page.
  if (vehicle.status !== "available") {
    return {
      ok: false,
      reason: "vehicle_off_road",
      message:
        "That car is off the road. Put it back on the road on the fleet page first, or pick another car.",
    };
  }

  // 2. THE price — same function, same rules, same refusals as the public flow.
  const priced = quoteRental({
    rentalType: input.rentalType,
    rates: { dailyRateCents: listing.daily_rate, monthlyRateCents: listing.monthly_rate },
    pickupDate: window.pickupDate,
    returnDate: window.returnDate,
  });
  if (!priced.ok) {
    return { ok: false, reason: priced.reason, message: priced.message };
  }
  const quote = priced.quote;

  // 3. The guest: an existing record, or a new one.
  const clientId = await resolveClient(input);
  if (!clientId.ok) return clientId.error;

  // 4. The booking, against the car the operator named.
  const { data: booking, error } = await db
    .from("bookings")
    .insert({
      client_id: clientId.id,
      car_id: vehicle.listing_id,
      vehicle_id: vehicle.id,
      pickup_date: window.pickupDate,
      pickup_time: PICKUP_TIME,
      return_date: window.returnDate,
      return_time: RETURN_TIME,
      pickup_location: input.pickupLocation,
      return_location: input.returnLocation,
      flight_number: input.flightNumber?.trim() || null,
      total_price: quote.totalCents,
      rental_type: quote.rentalType,
      discount_pct: quote.discountPct,
      discount_cents: quote.discountCents,
      booking_status: input.bookingStatus,
      payment_status: input.paymentStatus,
      special_requests: input.specialRequests?.trim() || null,
      admin_notes: input.adminNotes?.trim() || null,
      handled_by: input.handledBy?.trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      return {
        ok: false,
        reason: "date_conflict",
        message: `${vehicleLabel(vehicle)} is already booked over those dates. Pick another car or change the dates.`,
      };
    }
    throw new Error(`Manual booking: failed to save: ${error.message}`);
  }

  return {
    ok: true,
    bookingId: booking.id,
    ref: booking.id.slice(0, 8),
    vehicleLabel: vehicleLabel(vehicle),
  };
}

/**
 * The guest a manual booking is for.
 *
 * An existing id is used as-is and NEVER updated from the form: a phone booking
 * is not the moment to overwrite a record with whatever was heard down a bad
 * line. Corrections are the client page's job.
 *
 * A new guest is inserted with the email lowercased, matching the public path,
 * so the two cannot produce records that fail to match each other later.
 */
async function resolveClient(
  input: ManualBookingInput,
): Promise<{ ok: true; id: string } | { ok: false; error: ManualBookingResult }> {
  const db = supabaseAdmin();

  if (input.clientId) {
    const { data, error } = await db
      .from("clients")
      .select("id")
      .eq("id", input.clientId)
      .maybeSingle();
    if (error) throw new Error(`Manual booking: failed to load the guest: ${error.message}`);
    if (!data) {
      return {
        ok: false,
        error: { ok: false, reason: "not_found", message: "That guest record no longer exists." },
      };
    }
    return { ok: true, id: data.id };
  }

  const guest = input.guest;
  if (!guest || guest.fullName.trim() === "" || guest.email.trim() === "") {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "invalid",
        message: "Pick an existing guest, or enter a name, email and phone for a new one.",
      },
    };
  }

  const { data, error } = await db
    .from("clients")
    .insert({
      full_name: guest.fullName.trim(),
      email: guest.email.trim().toLowerCase(),
      phone: guest.phone.trim(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Manual booking: failed to save the guest: ${error.message}`);
  return { ok: true, id: data.id };
}
