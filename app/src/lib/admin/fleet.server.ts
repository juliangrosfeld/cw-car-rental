/**
 * Fleet management — reads and writes for /admin/fleet. Service role, RLS
 * bypassed: import ONLY from server functions that have already called
 * requireAdmin().
 *
 * THE ONE TABLE THE PUBLIC SITE DEPENDS ON
 * A write here is live on the booking page immediately, which is why every edit
 * below is deliberate about what it does and does not reach:
 *
 *   status      'available' is the only value the booking flow will offer for
 *               NEW dates (src/lib/booking/availability.server.ts filters on it
 *               in both listBookableCars and findAvailableCars). Setting
 *               'maintenance' or 'offline' therefore takes the car out of every
 *               future search at once — and touches nothing else. Existing
 *               rentals are untouched by construction: no query in this app
 *               joins cars.status to bookings, so a guest who already has the
 *               car keeps it and the handover still happens. That is exactly
 *               what an owner means by "take it off the road".
 *
 *   daily_rate   the rate for FUTURE quotes only. `bookings.total_price` was
 *   monthly_rate struck when the booking was taken and is never recomputed from
 *               these columns — see the note on quotedPerDayCents in ./types. A
 *               rate rise cannot reprice a reservation a guest already holds,
 *               and neither can a change to the discount tiers.
 *
 *               The two are independent prices, not one derived from the other:
 *               monthly_rate is the flat price of a ~30-day rental, and setting
 *               it to 0 takes the car off the monthly product without touching
 *               its daily availability.
 *
 *   photo_url   what the public fleet page and the booking wizard display.
 *
 *   maintenance_notes  INTERNAL. Migration 0003 revokes the anon role's
 *               privilege on this column specifically, because `cars` is
 *               otherwise anon-readable and "brakes unsafe" must not be one
 *               publishable key away from being public.
 *
 * THE MARKETING GRID IS NOT DRIVEN BY THIS TABLE. The fleet section on the home
 * page renders FLEET from src/content/brand.ts, which is static content. Taking
 * a car off the road removes it from the BOOKING flow — the calendar, the car
 * step, and any new reservation — but the car still appears in the marketing
 * grid until that file changes. The UI says so rather than implying a reach it
 * does not have.
 */
import { supabaseAdmin } from "../supabase/admin.server";
import { rentalDays } from "../booking/rental";
import { formatMoney } from "../money";
import type { BookingStatus, CarStatus, PaymentStatus, PrepStatus } from "../supabase/types";
import { addDays, curacaoNow, daysBetween, isMonthKey, monthKeyOf } from "./clock";
import { DEFAULT_STATS_WINDOW, STATS_WINDOWS, type StatsWindow } from "./fleet";
import { monthGrid, packLanes, toBars, type RentalForBar } from "./timeline";
import type {
  CarWriteResult,
  FleetCarDetail,
  FleetCarStats,
  FleetCarRow,
  FleetOverview,
  TimelineRow,
} from "./types";

/** How many upcoming rentals a car's page lists, and how far ahead the overview
 *  looks for "what is next for this car". */
const UPCOMING_LIMIT = 25;

/** Same exclusion as everywhere else: a cancelled booking occupies nothing and
 *  earns nothing. */
const CANCELLED = "cancelled";

const CAR_SELECT = `
  id, model, category, color, daily_rate, monthly_rate, transmission, seats,
  photo_url, status, maintenance_notes, off_road_since, created_at, updated_at
`;

const RENTAL_SELECT = `
  id, car_id, pickup_date, pickup_time, return_date, return_time,
  total_price, booking_status, payment_status, prep_status,
  clients ( full_name )
`;

interface RawCar {
  id: string;
  model: string;
  category: string;
  color: string;
  daily_rate: number;
  monthly_rate: number;
  transmission: string;
  seats: number;
  photo_url: string;
  status: CarStatus;
  maintenance_notes: string | null;
  off_road_since: string | null;
  created_at: string;
  updated_at: string;
}

interface RawRental {
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

function carLabel(car: { model: string; color: string }): string {
  return `${car.model} · ${car.color}`;
}

function toRentalForBar(raw: RawRental): RentalForBar {
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

/**
 * UNRETURNED: the car is still committed to this rental.
 *
 * Two ways that is true, and the second is the one a date comparison alone gets
 * wrong: either the return is still ahead of us, OR the rental is marked `out` —
 * the keys are with a guest who has not brought the car back. An overdue return
 * is exactly the case where "is this car free?" and "does the calendar say it is
 * free?" disagree, and it is the case an owner most needs surfaced before taking
 * a car off the road: that car is not in the yard to work on.
 *
 * Expressed once and used by BOTH the per-car list and the affected-rentals
 * count in updateCar, so the number in the warning and the rows underneath it
 * cannot drift apart.
 */
function unreturned(nowTimestamp: string): string {
  return `return_at.gt.${nowTimestamp},prep_status.eq.out`;
}

/* ── the arithmetic ────────────────────────────────────────────────────────── */

/**
 * How many days of [windowStart, windowEndExclusive) this rental occupies.
 *
 * The occupied range is [pickup, return) — the half-open model the whole app
 * uses, so the return day is free for the next rental and is NOT counted (see
 * src/lib/admin/timeline.ts). A rental returned later the same day still counts
 * as one day, matching what the guest was billed.
 *
 * UTILISATION IS MEASURED IN DAYS THE CAR WAS SPOKEN FOR, not days it was paid
 * for: an unpaid rental still kept the car off the forecourt. Revenue is counted
 * separately and on its own basis below, which is why a car can show high
 * utilisation and low takings — a fact worth seeing, not one worth hiding by
 * blending the two.
 */
function occupiedDaysInWindow(
  rental: { pickupDate: string; returnDate: string },
  windowStart: string,
  windowEndExclusive: string,
): number {
  const minEnd = addDays(rental.pickupDate, 1);
  const end = rental.returnDate > minEnd ? rental.returnDate : minEnd;

  const from = rental.pickupDate > windowStart ? rental.pickupDate : windowStart;
  const to = end < windowEndExclusive ? end : windowEndExclusive;

  return Math.max(0, daysBetween(from, to));
}

/**
 * One car's numbers over a window.
 *
 * REVENUE USES THE DASHBOARD'S "COLLECTED" BASIS, deliberately and identically:
 * paid bookings, recognised on the PICKUP date (see the header of
 * ./dashboard.server.ts). Any other choice here would put two different answers
 * to "what did the Spark earn in July" on two pages of the same tool.
 */
function statsFor(
  rentals: RawRental[],
  windowStart: string,
  windowEndExclusive: string,
  windowDays: number,
): FleetCarStats {
  let daysOut = 0;
  let collectedCents = 0;
  let paidRentals = 0;
  let totalDays = 0;

  for (const r of rentals) {
    if (r.booking_status === CANCELLED) continue;

    daysOut += occupiedDaysInWindow(
      { pickupDate: r.pickup_date, returnDate: r.return_date },
      windowStart,
      windowEndExclusive,
    );

    // Bounded at both ends, like every bucket in the dashboard: an open upper
    // bound would sweep a prepaid rental years out into this window's takings.
    const startsInWindow = r.pickup_date >= windowStart && r.pickup_date < windowEndExclusive;
    if (startsInWindow) {
      paidRentals++;
      totalDays += rentalDays(r.pickup_date, r.return_date);
      if (r.payment_status === "paid") collectedCents += r.total_price;
    }
  }

  return {
    windowDays,
    daysOut,
    // Capped at 100: a car cannot be more than fully booked, and floating-point
    // noise on a fully-occupied window should not print "100.4%".
    utilisationPct:
      windowDays === 0 ? 0 : Math.min(100, Math.round((daysOut / windowDays) * 1000) / 10),
    collectedCents,
    rentals: paidRentals,
    averageRentalDays: paidRentals === 0 ? 0 : Math.round((totalDays / paidRentals) * 10) / 10,
  };
}

/* ── the overview ──────────────────────────────────────────────────────────── */

export async function getFleetOverview(windowDays?: number | null): Promise<FleetOverview> {
  const now = curacaoNow();
  const days: StatsWindow = STATS_WINDOWS.find((w) => w === windowDays) ?? DEFAULT_STATS_WINDOW;

  // [start, end) with end one day AFTER today, so "the last 90 days" includes
  // today rather than stopping at midnight this morning.
  const windowEndExclusive = addDays(now.today, 1);
  const windowStart = addDays(windowEndExclusive, -days);

  const db = supabaseAdmin();
  const [carsRes, windowRes, upcomingRes, currentRes] = await Promise.all([
    db.from("cars").select(CAR_SELECT).order("daily_rate", { ascending: false }),

    // Everything overlapping the stats window. Same overlap rule as the bookings
    // page: pickup before the end, return on or after the start.
    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .lt("pickup_date", windowEndExclusive)
      .gte("return_date", windowStart),

    // What each car still owes — deliberately NOT bounded by the window, since
    // the next rental is usually in the future the window does not cover.
    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .neq("booking_status", CANCELLED)
      .gt("pickup_at", now.timestamp)
      .order("pickup_at", { ascending: true })
      .limit(UPCOMING_LIMIT * 5),

    // Out on the road at this instant. Half-open again: a car due back at 10:00
    // is free at 10:00.
    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .neq("booking_status", CANCELLED)
      .lte("pickup_at", now.timestamp)
      .gt("return_at", now.timestamp),
  ]);

  for (const [label, res] of [
    ["cars", carsRes],
    ["rentals in the window", windowRes],
    ["upcoming rentals", upcomingRes],
    ["current rentals", currentRes],
  ] as const) {
    if (res.error) throw new Error(`Fleet: failed to load ${label}: ${res.error.message}`);
  }

  const cars = (carsRes.data ?? []) as unknown as RawCar[];
  const windowRentals = (windowRes.data ?? []) as unknown as RawRental[];
  const upcoming = (upcomingRes.data ?? []) as unknown as RawRental[];
  const current = (currentRes.data ?? []) as unknown as RawRental[];

  const byCar = new Map<string, RawRental[]>();
  for (const r of windowRentals) {
    const list = byCar.get(r.car_id);
    if (list) list.push(r);
    else byCar.set(r.car_id, [r]);
  }

  const nextByCar = new Map<string, RawRental>();
  for (const r of upcoming) {
    if (!nextByCar.has(r.car_id)) nextByCar.set(r.car_id, r);
  }
  const upcomingCounts = new Map<string, number>();
  for (const r of upcoming) {
    upcomingCounts.set(r.car_id, (upcomingCounts.get(r.car_id) ?? 0) + 1);
  }
  const currentByCar = new Map(current.map((r) => [r.car_id, r]));

  const rows: FleetCarRow[] = cars.map((car) => {
    const rentals = byCar.get(car.id) ?? [];
    const next = nextByCar.get(car.id);
    const onRental = currentByCar.get(car.id);

    return {
      id: car.id,
      label: carLabel(car),
      model: car.model,
      color: car.color,
      category: car.category,
      photoUrl: car.photo_url,
      dailyRateCents: car.daily_rate,
      monthlyRateCents: car.monthly_rate,
      status: car.status,
      maintenanceNotes: car.maintenance_notes,
      offRoadSince: car.off_road_since,
      offRoadDays:
        car.status === "available" || !car.off_road_since
          ? null
          : Math.max(0, daysBetween(car.off_road_since.slice(0, 10), now.today)),
      stats: statsFor(rentals, windowStart, windowEndExclusive, days),
      onRentalUntil: onRental?.return_date ?? null,
      onRentalFor: onRental?.clients?.full_name ?? null,
      upcomingCount: upcomingCounts.get(car.id) ?? 0,
      nextPickupDate: next?.pickup_date ?? null,
      nextPickupFor: next?.clients?.full_name ?? null,
    };
  });

  const fleetDaysOut = rows.reduce((sum, r) => sum + r.stats.daysOut, 0);
  const capacityDays = rows.length * days;

  return {
    today: now.today,
    windowDays: days,
    windowStart,
    windowEnd: now.today,
    cars: rows,
    totals: {
      cars: rows.length,
      offRoad: rows.filter((r) => r.status !== "available").length,
      outNow: rows.filter((r) => r.onRentalUntil !== null).length,
      collectedCents: rows.reduce((sum, r) => sum + r.stats.collectedCents, 0),
      utilisationPct:
        capacityDays === 0 ? 0 : Math.round((fleetDaysOut / capacityDays) * 1000) / 10,
    },
  };
}

/* ── one car ───────────────────────────────────────────────────────────────── */

export async function getFleetCar(
  carId: string,
  month?: string | null,
  windowDays?: number | null,
): Promise<FleetCarDetail | null> {
  const now = curacaoNow();
  const currentMonth = monthKeyOf(now.today);
  const grid = monthGrid(isMonthKey(month) ? month : currentMonth);
  const days: StatsWindow = STATS_WINDOWS.find((w) => w === windowDays) ?? DEFAULT_STATS_WINDOW;

  const windowEndExclusive = addDays(now.today, 1);
  const windowStart = addDays(windowEndExclusive, -days);

  const db = supabaseAdmin();
  const carRes = await db.from("cars").select(CAR_SELECT).eq("id", carId).maybeSingle();
  if (carRes.error) throw new Error(`Fleet: failed to load car: ${carRes.error.message}`);
  if (!carRes.data) return null;
  const car = carRes.data as unknown as RawCar;

  const [monthRes, windowRes, upcomingRes, currentRes] = await Promise.all([
    // The month being drawn. Wider than the grid at the lower end for the same
    // reason the bookings board is: a rental can start before the month and
    // still run inside it.
    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .eq("car_id", carId)
      .lt("pickup_date", grid.nextMonthFirstDay)
      .gte("return_date", grid.firstDay)
      .order("pickup_at", { ascending: true }),

    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .eq("car_id", carId)
      .lt("pickup_date", windowEndExclusive)
      .gte("return_date", windowStart),

    // UNFINISHED rentals — see UNRETURNED below for what that means and why it
    // is not simply "returns in the future".
    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .eq("car_id", carId)
      .neq("booking_status", CANCELLED)
      .or(unreturned(now.timestamp))
      .order("pickup_at", { ascending: true })
      .limit(UPCOMING_LIMIT),

    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .eq("car_id", carId)
      .neq("booking_status", CANCELLED)
      .lte("pickup_at", now.timestamp)
      .gt("return_at", now.timestamp)
      .maybeSingle(),
  ]);

  for (const [label, res] of [
    ["the month's rentals", monthRes],
    ["rentals in the window", windowRes],
    ["upcoming rentals", upcomingRes],
  ] as const) {
    if (res.error) throw new Error(`Fleet: failed to load ${label}: ${res.error.message}`);
  }
  // maybeSingle on the current rental: no row is the normal case, not an error.
  if (currentRes.error) {
    throw new Error(`Fleet: failed to load the current rental: ${currentRes.error.message}`);
  }

  const monthRentals = (monthRes.data ?? []) as unknown as RawRental[];
  const { bars, lanes } = packLanes(toBars(monthRentals.map(toRentalForBar), grid));

  const timeline: TimelineRow = {
    carId: car.id,
    carLabel: carLabel(car),
    carStatus: car.status,
    lanes,
    bars,
  };

  const upcoming = (upcomingRes.data ?? []) as unknown as RawRental[];
  const onRental = (currentRes.data ?? null) as unknown as RawRental | null;

  return {
    id: car.id,
    label: carLabel(car),
    model: car.model,
    color: car.color,
    category: car.category,
    transmission: car.transmission,
    seats: car.seats,
    photoUrl: car.photo_url,
    dailyRateCents: car.daily_rate,
    monthlyRateCents: car.monthly_rate,
    status: car.status,
    maintenanceNotes: car.maintenance_notes,
    offRoadSince: car.off_road_since,
    offRoadDays:
      car.status === "available" || !car.off_road_since
        ? null
        : Math.max(0, daysBetween(car.off_road_since.slice(0, 10), now.today)),
    updatedAt: car.updated_at,
    today: now.today,
    stats: statsFor(
      (windowRes.data ?? []) as unknown as RawRental[],
      windowStart,
      windowEndExclusive,
      days,
    ),
    month: grid.month,
    monthLabel: grid.label,
    days: grid.days,
    prevMonth: grid.prevMonth,
    nextMonth: grid.nextMonth,
    currentMonth,
    timeline,
    onRental: onRental
      ? {
          bookingId: onRental.id,
          clientName: onRental.clients?.full_name ?? "Unknown guest",
          returnDate: onRental.return_date,
          returnTime: onRental.return_time,
        }
      : null,
    upcoming: upcoming.map((r) => ({
      bookingId: r.id,
      clientName: r.clients?.full_name ?? "Unknown guest",
      pickupDate: r.pickup_date,
      pickupTime: r.pickup_time,
      returnDate: r.return_date,
      returnTime: r.return_time,
      days: rentalDays(r.pickup_date, r.return_date),
      totalCents: r.total_price,
      bookingStatus: r.booking_status,
      paymentStatus: r.payment_status,
      prepStatus: r.prep_status,
    })),
  };
}

/* ── writes ────────────────────────────────────────────────────────────────── */

/** A rate this far from the current one is almost certainly a units mistake —
 *  guilders typed into a cents field, or the other way round. The UI takes
 *  guilders and converts, so this is the last line of defence rather than the
 *  first. The monthly ceiling is deliberately not 30x the daily one: a monthly
 *  rate is a long-stay price, and a monthly figure that high is the same typo. */
const MAX_DAILY_RATE_CENTS = 500_00;
const MAX_MONTHLY_RATE_CENTS = 10_000_00;

export interface CarUpdate {
  carId: string;
  dailyRateCents: number;
  /** 0 means this car is not offered monthly — a legitimate setting, not a
   *  missing value, so it is allowed through rather than rejected. */
  monthlyRateCents: number;
  status: CarStatus;
  photoUrl: string;
  maintenanceNotes: string;
}

/**
 * Update a car.
 *
 * off_road_since is maintained HERE rather than by a trigger, because it is a
 * transition, not a timestamp of the last write: it is stamped when the car
 * leaves 'available', preserved while it stays off the road (so editing the
 * notes does not reset "off the road for 6 days"), and cleared when it comes
 * back. `updated_at` continues to be the database's job, via
 * trg_cars_updated_at.
 *
 * What this function deliberately does NOT do is touch bookings. Taking a car
 * off the road with rentals already on it is a legitimate and common thing to
 * want — the car is going in for a service next week and the owner needs the
 * booking page to stop offering it — so the write goes through and the CALLER is
 * given the count of affected rentals to show. Silently cancelling a guest's
 * reservation because a status changed would be far worse than a warning.
 */
export async function updateCar(input: CarUpdate): Promise<CarWriteResult> {
  const db = supabaseAdmin();

  const currentRes = await db
    .from("cars")
    .select("id, status, off_road_since")
    .eq("id", input.carId)
    .maybeSingle();
  if (currentRes.error)
    throw new Error(`Fleet: failed to read the car: ${currentRes.error.message}`);
  if (!currentRes.data) {
    return { ok: false, reason: "not_found", message: "That car is not in the fleet." };
  }

  if (!Number.isInteger(input.dailyRateCents) || input.dailyRateCents < 0) {
    return { ok: false, reason: "invalid", message: "A daily rate must be a whole amount." };
  }
  if (input.dailyRateCents > MAX_DAILY_RATE_CENTS) {
    return {
      ok: false,
      reason: "invalid",
      message: `A daily rate over ${formatMoney(MAX_DAILY_RATE_CENTS)} looks like a mistake. Enter the rate in guilders.`,
    };
  }
  if (!Number.isInteger(input.monthlyRateCents) || input.monthlyRateCents < 0) {
    return { ok: false, reason: "invalid", message: "A monthly rate must be a whole amount." };
  }
  if (input.monthlyRateCents > MAX_MONTHLY_RATE_CENTS) {
    return {
      ok: false,
      reason: "invalid",
      message: `A monthly rate over ${formatMoney(MAX_MONTHLY_RATE_CENTS)} looks like a mistake. Enter the rate in guilders.`,
    };
  }

  const was = currentRes.data.status as CarStatus;
  const goingOffRoad = was === "available" && input.status !== "available";
  const comingBack = was !== "available" && input.status === "available";

  const notes = input.maintenanceNotes.trim();

  const { data, error } = await db
    .from("cars")
    .update({
      daily_rate: input.dailyRateCents,
      monthly_rate: input.monthlyRateCents,
      status: input.status,
      photo_url: input.photoUrl.trim(),
      maintenance_notes: notes.length > 0 ? notes : null,
      ...(goingOffRoad ? { off_road_since: new Date().toISOString() } : {}),
      ...(comingBack ? { off_road_since: null } : {}),
    })
    .eq("id", input.carId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Fleet: failed to update the car: ${error.message}`);
  if (!data) return { ok: false, reason: "not_found", message: "That car is not in the fleet." };

  // Rentals still on the books for a car that has just left the road. Reported,
  // never cancelled — see the note above.
  let affectedRentals = 0;
  if (goingOffRoad) {
    const now = curacaoNow();
    const { count, error: countError } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("car_id", input.carId)
      .neq("booking_status", CANCELLED)
      .or(unreturned(now.timestamp));
    if (countError) {
      throw new Error(`Fleet: failed to count affected rentals: ${countError.message}`);
    }
    affectedRentals = count ?? 0;
  }

  return { ok: true, carId: input.carId, wentOffRoad: goingOffRoad, affectedRentals };
}
