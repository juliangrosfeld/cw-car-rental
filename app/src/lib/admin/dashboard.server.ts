/**
 * Dashboard aggregates. Service role, RLS bypassed — import ONLY from server
 * functions that have already called requireAdmin().
 *
 * TWO MONEY FIGURES, ON TWO DIFFERENT CLOCKS — read this before changing a
 * number on the dashboard.
 *
 *   revenue  MONEY EARNED. `sum(total_price)` over bookings with
 *            `payment_status = 'paid'`, recognised on the **pickup date**. CW
 *            collects at the counter when the keys change hands, so a rental
 *            booked in March for a July pickup is July's money, and "today"
 *            means "what came in over the counter today".
 *
 *   booked   SALES ACTIVITY. `sum(total_price)` over bookings recognised on
 *            **created_at**, paid or not. That same March booking counts in
 *            March here, in full, months before a cent of it arrives.
 *
 * Both exclude cancelled bookings. Neither is "the" revenue and they are not
 * meant to reconcile in any given month: one measures the till, the other
 * measures the phone. The UI names each by its date basis for that reason, and
 * that labelling is load-bearing — do not shorten either to "revenue".
 *
 * The `payments` table is deliberately not the source yet: it exists for the
 * per-booking ledger (deposit, balance, refund) that phase 3 will fill in, and
 * summing a half-populated ledger next to a fully-populated booking table would
 * put two different totals on the same screen. When payments become the record
 * of truth, move this to sum(payments.amount) where status = 'paid' bucketed on
 * payments.created_at, and delete this paragraph.
 *
 * QUERY SHAPE
 * These are row fetches aggregated in JS rather than SQL aggregates, because
 * PostgREST has no GROUP BY and the fleet is five cars: the all-time paid set is
 * a few hundred rows and will be a few thousand after years of trading. That is
 * cheap. If it ever stops being cheap, the fix is a Postgres view or an RPC —
 * not pagination here.
 */
import { supabaseAdmin } from "../supabase/admin.server";
import { rentalDays } from "../booking/rental";
import type { BookingStatus, PaymentStatus, PrepStatus, VehicleStatus } from "../supabase/types";
import { vehicleLabel } from "./fleet";
import {
  addDays,
  curacaoMidnightInstant,
  curacaoNow,
  daysBetween,
  toCuracaoDateKey,
} from "./clock";
import type { BookingRow, DashboardData, FleetStatusRow, MovementRow, RevenuePoint } from "./types";

/** Every status except 'cancelled' still occupies a car and still owes money —
 *  mirrors the partial WHERE on the bookings exclusion constraint. */
const CANCELLED = "cancelled";

/** How many days of the revenue sparkline to draw. */
const TREND_DAYS = 14;

/** Movements shown on the dashboard. The full schedule is the Bookings page. */
const MOVEMENT_LIMIT = 8;

/** Rows pulled for the week panel. The headline count comes from PostgREST's
 *  exact count, not from this page, so the number stays right even if the week
 *  ever overflows the fetch — which five cars cannot manage, but the count and
 *  the summed value should not be able to disagree by construction. */
const WEEK_FETCH_LIMIT = 200;

/** How far back to keep surfacing a pickup nobody marked as collected, and a
 *  return that never came back. These are the rows an operator most needs to
 *  see; dropping them at "now" would hide exactly the problem cases. */
const LATE_PICKUP_GRACE_DAYS = 3;
const OVERDUE_RETURN_GRACE_DAYS = 7;

const BOOKING_SELECT = `
  id, car_id, vehicle_id, pickup_date, pickup_time, return_date, return_time,
  pickup_location, return_location, total_price,
  booking_status, payment_status, prep_status, created_at,
  cars ( id, model, color ),
  vehicles ( id, color, plate_number, is_publicly_visible ),
  clients ( full_name, email, phone )
`;

/** The join result as PostgREST actually returns it. Cast rather than fight the
 *  generated relationship types, the same way availability.server.ts does. */
interface RawBookingRow {
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

/** "Hyundai Venue · Red" — the LISTING. The fleet has two Versas, so the colour
 *  is not decoration, it is how an admin tells them apart. */
function carLabel(car: { model: string; color: string } | null): string {
  if (!car) return "Unknown car";
  return `${car.model} · ${car.color}`;
}

/** "Grey · P-4821" — the PHYSICAL car. On a movement row this is the one that
 *  matters: it says which keys to take off the board. */
function unitLabel(vehicle: { color: string; plate_number: string | null } | null): string {
  if (!vehicle) return "Unassigned";
  return vehicleLabel(vehicle);
}

function toBookingRow(raw: RawBookingRow): BookingRow {
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

function toMovement(raw: RawBookingRow, kind: MovementRow["kind"], today: string): MovementRow {
  const date = kind === "pickup" ? raw.pickup_date : raw.return_date;
  const time = kind === "pickup" ? raw.pickup_time : raw.return_time;
  return {
    bookingId: raw.id,
    ref: raw.id.slice(0, 8),
    kind,
    at: `${date}T${time}`,
    date,
    time,
    clientName: raw.clients?.full_name ?? "Unknown guest",
    clientPhone: raw.clients?.phone ?? "",
    carLabel: carLabel(raw.cars),
    vehicleLabel: unitLabel(raw.vehicles),
    location: kind === "pickup" ? raw.pickup_location : raw.return_location,
    bookingStatus: raw.booking_status,
    paymentStatus: raw.payment_status,
    daysAway: daysBetween(today, date),
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = supabaseAdmin();
  const now = curacaoNow();

  const trendStart = addDays(now.today, -(TREND_DAYS - 1));
  const previousMonthStart = addDays(now.monthStart, -1).slice(0, 7) + "-01";

  const [
    paidRes,
    bookedRes,
    outstandingRes,
    weekRes,
    pickupsRes,
    returnsRes,
    carsRes,
    occupiedRes,
  ] = await Promise.all([
    // ── revenue: every paid, non-cancelled booking, all time ──────────────
    db
      .from("bookings")
      .select("pickup_date, total_price")
      .eq("payment_status", "paid")
      .neq("booking_status", CANCELLED),

    // ── sales activity: bookings TAKEN recently, paid or not ──────────────
    // Deliberately unfiltered by payment status: the question is what was
    // sold, not what has been collected. Cancelled is still excluded — a
    // reservation that evaporated is not activity that happened.
    //
    // One fetch covers all three figures the `booked` block needs (this
    // month, last month, the 14-day trend) because the previous month always
    // begins on or before the trend window: the worst case is the 1st of a
    // month, where the trend reaches 13 days back into a month that started
    // on its own 1st.
    db
      .from("bookings")
      .select("created_at, total_price")
      .neq("booking_status", CANCELLED)
      .gte("created_at", curacaoMidnightInstant(previousMonthStart)),

    // ── money still to collect ────────────────────────────────────────────
    db
      .from("bookings")
      .select("total_price")
      .in("payment_status", ["unpaid", "pending"])
      .neq("booking_status", CANCELLED),

    // ── new business this week ────────────────────────────────────────────
    // created_at is timestamptz — a real instant — so it is compared against
    // an offset-qualified instant, NOT the wall-clock strings used below.
    db
      .from("bookings")
      .select(BOOKING_SELECT, { count: "exact" })
      .gte("created_at", curacaoMidnightInstant(now.weekStart))
      .order("created_at", { ascending: false })
      .limit(WEEK_FETCH_LIMIT),

    // ── pickups due ───────────────────────────────────────────────────────
    // pickup_at / return_at are wall-clock `timestamp` columns, so they take
    // an unqualified 'YYYY-MM-DDTHH:MM:SS'. Adding a 'Z' or an offset here
    // would make PostgREST coerce through UTC and shift every comparison.
    db
      .from("bookings")
      .select(BOOKING_SELECT)
      .in("booking_status", ["pending", "confirmed"])
      .gte("pickup_at", `${addDays(now.today, -LATE_PICKUP_GRACE_DAYS)}T00:00:00`)
      .order("pickup_at", { ascending: true })
      .limit(MOVEMENT_LIMIT + 4),

    // ── returns due (including ones already overdue) ──────────────────────
    db
      .from("bookings")
      .select(BOOKING_SELECT)
      .in("booking_status", ["pending", "confirmed", "active"])
      .gte("return_at", `${addDays(now.today, -OVERDUE_RETURN_GRACE_DAYS)}T00:00:00`)
      .order("return_at", { ascending: true })
      .limit(MOVEMENT_LIMIT + 4),

    // ── the fleet ─────────────────────────────────────────────────────────
    // PHYSICAL cars, joined to the listing they are rented as. Occupancy is a
    // question about metal, not about products: with two Sparks, "1 of 5 out"
    // would understate the fleet and overstate how busy it is.
    db
      .from("vehicles")
      .select(
        "id, listing_id, color, plate_number, is_publicly_visible, status, created_at, cars ( model, color, daily_rate )",
      ),

    // ── what is out on the road at this exact moment ──────────────────────
    // Half-open [pickup, return): a car returning at 10:00 is free at 10:00.
    db
      .from("bookings")
      .select("vehicle_id, return_date, return_time, clients ( full_name )")
      .neq("booking_status", CANCELLED)
      .lte("pickup_at", now.timestamp)
      .gt("return_at", now.timestamp),
  ]);

  for (const [label, res] of [
    ["paid bookings", paidRes],
    ["bookings taken", bookedRes],
    ["outstanding bookings", outstandingRes],
    ["this week's bookings", weekRes],
    ["upcoming pickups", pickupsRes],
    ["upcoming returns", returnsRes],
    ["cars", carsRes],
    ["current rentals", occupiedRes],
  ] as const) {
    if (res.error) throw new Error(`Dashboard: failed to load ${label}: ${res.error.message}`);
  }

  // ── revenue buckets ────────────────────────────────────────────────────────
  const paid = (paidRes.data ?? []) as { pickup_date: string; total_price: number }[];

  const dailyTotals = new Map<string, number>();
  let todayCents = 0;
  let monthCents = 0;
  let monthCount = 0;
  let previousMonthCents = 0;
  let ytdCents = 0;
  let allTimeCents = 0;

  // EVERY period bucket is half-open [start, end). Pickup dates run arbitrarily
  // far into the future, so a bare `date >= monthStart` would quietly read as
  // "this month and all months after it" and file a prepaid December rental
  // under July. Each figure below equals exactly the period it is labelled with,
  // which is also what keeps them nested: today ⊆ month ⊆ year ⊆ all time.
  for (const row of paid) {
    const date = row.pickup_date;
    const cents = row.total_price;

    allTimeCents += cents;
    if (date === now.today) todayCents += cents;
    if (date >= now.monthStart && date < now.nextMonthStart) {
      monthCents += cents;
      monthCount++;
    } else if (date >= previousMonthStart && date < now.monthStart) {
      previousMonthCents += cents;
    }
    if (date >= now.yearStart && date < now.nextYearStart) ytdCents += cents;
    if (date >= trendStart && date <= now.today) {
      dailyTotals.set(date, (dailyTotals.get(date) ?? 0) + cents);
    }
  }

  // ── sales-activity buckets ─────────────────────────────────────────────────
  // Same shape as above, but bucketed on the day the booking was TAKEN. Note
  // `date` comes from toCuracaoDateKey rather than slicing the ISO string: a
  // booking taken at 21:00 island time is stored as the next day in UTC, and
  // slicing would file it under the wrong day — and, on the 31st, the wrong
  // month.
  const bookedRows = (bookedRes.data ?? []) as {
    created_at: string;
    total_price: number;
  }[];

  const bookedDailyTotals = new Map<string, number>();
  let bookedMonthCents = 0;
  let bookedMonthCount = 0;
  let bookedPreviousMonthCents = 0;

  for (const row of bookedRows) {
    const date = toCuracaoDateKey(row.created_at);
    const cents = row.total_price;

    // Bounded at both ends like the buckets above. A booking cannot be created
    // in the future in production, but a bare `>=` here would be the same latent
    // trap, and a clock skew or a backfill script should not be able to spring
    // it.
    if (date >= now.monthStart && date < now.nextMonthStart) {
      bookedMonthCents += cents;
      bookedMonthCount++;
    } else if (date >= previousMonthStart && date < now.monthStart) {
      bookedPreviousMonthCents += cents;
    }
    if (date >= trendStart && date <= now.today) {
      bookedDailyTotals.set(date, (bookedDailyTotals.get(date) ?? 0) + cents);
    }
  }

  // Zero-filled so the sparklines have a point per day and quiet days read as
  // quiet rather than as missing data.
  const toTrend = (totals: Map<string, number>): RevenuePoint[] =>
    Array.from({ length: TREND_DAYS }, (_, i) => {
      const date = addDays(trendStart, i);
      return { date, cents: totals.get(date) ?? 0 };
    });

  const daily = toTrend(dailyTotals);
  const bookedDaily = toTrend(bookedDailyTotals);

  const outstandingCents = ((outstandingRes.data ?? []) as { total_price: number }[]).reduce(
    (sum, row) => sum + row.total_price,
    0,
  );

  // ── this week's new bookings ───────────────────────────────────────────────
  const weekBookings = ((weekRes.data ?? []) as unknown as RawBookingRow[]).map(toBookingRow);

  // ── the next movements ─────────────────────────────────────────────────────
  const pickups = ((pickupsRes.data ?? []) as unknown as RawBookingRow[]).map((r) =>
    toMovement(r, "pickup", now.today),
  );
  const returns = ((returnsRes.data ?? []) as unknown as RawBookingRow[]).map((r) =>
    toMovement(r, "return", now.today),
  );
  const upcoming = [...pickups, ...returns]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, MOVEMENT_LIMIT);

  // ── occupancy ──────────────────────────────────────────────────────────────
  const vehicles = (carsRes.data ?? []) as unknown as {
    id: string;
    listing_id: string;
    color: string;
    plate_number: string | null;
    is_publicly_visible: boolean;
    status: VehicleStatus;
    created_at: string;
    cars: { model: string; color: string; daily_rate: number } | null;
  }[];

  const occupied = (occupiedRes.data ?? []) as unknown as {
    vehicle_id: string;
    return_date: string;
    return_time: string;
    clients: { full_name: string } | null;
  }[];

  const occupiedByVehicle = new Map(occupied.map((row) => [row.vehicle_id, row]));

  const fleetCars: FleetStatusRow[] = [...vehicles]
    .sort((a, b) => {
      // Dearest listing first, matching every other fleet ordering in the CRM,
      // then the visible unit before its backup.
      const rate = (b.cars?.daily_rate ?? 0) - (a.cars?.daily_rate ?? 0);
      if (rate !== 0) return rate;
      if (a.listing_id !== b.listing_id) return a.listing_id < b.listing_id ? -1 : 1;
      if (a.is_publicly_visible !== b.is_publicly_visible) return a.is_publicly_visible ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    })
    .map((vehicle) => {
      const rental = occupiedByVehicle.get(vehicle.id);
      return {
        id: vehicle.id,
        // The MODEL plus THIS car's colour, not the listing's: on the dashboard
        // the two Sparks must be tellable apart at a glance, and "Chevrolet
        // Spark · Black" twice would be worse than useless.
        label: `${vehicle.cars?.model ?? "Unknown"} · ${vehicle.color}`,
        listingId: vehicle.listing_id,
        isPubliclyVisible: vehicle.is_publicly_visible,
        status: vehicle.status,
        dailyRateCents: vehicle.cars?.daily_rate ?? 0,
        onRentalUntil: rental ? rental.return_date : null,
        onRentalFor: rental?.clients?.full_name ?? null,
      };
    });

  const listingCount = new Set(vehicles.map((v) => v.listing_id)).size;

  // A car that is out is counted as out even if someone also flagged it for
  // maintenance — where the car physically is beats what the record says.
  const outNow = fleetCars.filter((c) => c.onRentalUntil !== null).length;
  const offRoad = fleetCars.filter(
    (c) => c.onRentalUntil === null && c.status !== "available",
  ).length;

  return {
    asOf: now.timestamp,
    today: now.today,
    monthLabel: now.monthLabel,
    revenue: {
      todayCents,
      monthCents,
      monthCount,
      ytdCents,
      allTimeCents,
      outstandingCents,
      previousMonthCents,
      daily,
    },
    booked: {
      monthCents: bookedMonthCents,
      monthCount: bookedMonthCount,
      previousMonthCents: bookedPreviousMonthCents,
      daily: bookedDaily,
    },
    week: {
      start: now.weekStart,
      end: now.weekEnd,
      count: weekRes.count ?? weekBookings.length,
      valueCents: weekBookings.reduce((sum, b) => sum + b.totalCents, 0),
      bookings: weekBookings.slice(0, 8),
    },
    upcoming,
    fleet: {
      total: fleetCars.length,
      listings: listingCount,
      outNow,
      availableNow: fleetCars.length - outNow - offRoad,
      offRoad,
      occupancyPct:
        fleetCars.length === 0 ? 0 : Math.round((outNow / fleetCars.length) * 1000) / 10,
      cars: fleetCars,
    },
  };
}
