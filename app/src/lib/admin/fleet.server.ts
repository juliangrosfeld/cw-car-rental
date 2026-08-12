/**
 * Fleet management — reads and writes for /admin/fleet. Service role, RLS
 * bypassed: import ONLY from server functions that have already called
 * requireAdmin().
 *
 * TWO LEVELS, AND EVERY FIGURE ON THE PAGE BELONGS TO EXACTLY ONE OF THEM
 * (migration 0005):
 *
 *   LISTING (`cars`)      what a guest browses and books. Carries the price
 *                         list, the photo and the copy. Has no condition and no
 *                         availability of its own — it is bookable exactly when
 *                         something behind it is.
 *
 *   VEHICLE (`vehicles`)  a physical car. Carries the plate, the colour, the
 *                         standing availability and the maintenance notes, and
 *                         is the thing a booking actually holds.
 *
 * A write here is live on the booking page immediately, which is why each edit
 * is deliberate about what it reaches:
 *
 *   daily_rate   the rate for FUTURE quotes only. `bookings.total_price` was
 *   monthly_rate struck when the booking was taken and is never recomputed from
 *                these columns — see the note on quotedPerDayCents in ./types. A
 *                rate rise cannot reprice a reservation a guest already holds,
 *                and neither can a change to the discount tiers.
 *
 *                The two are independent prices, not one derived from the other:
 *                monthly_rate is the flat price of a ~30-day rental, and setting
 *                it to 0 takes the listing off the monthly product without
 *                touching its daily availability.
 *
 *   photo_url    what the public fleet page and the booking wizard display. It
 *                is the LISTING's photo, and it is a picture of the publicly
 *                visible unit — which is exactly why assignment prefers that
 *                unit (see availability.server.ts).
 *
 *   status       a VEHICLE's. 'available' is the only value the booking flow
 *                will assign, so anything else takes that car out of every
 *                future search at once. What that means to a guest depends on
 *                what else backs the listing: with a second car behind it,
 *                nothing changes on the site at all; with none, the listing
 *                leaves the booking page. updateVehicle returns which of the two
 *                happened rather than leaving it to be found out.
 *
 *                Existing rentals are untouched by construction: no query in
 *                this app joins vehicles.status to bookings, so a guest who
 *                already has the car keeps it and the handover still happens.
 *
 *   maintenance_notes  INTERNAL. The anon role holds no privilege on the
 *                `vehicles` table at all (migration 0005), because "brake line
 *                leaking, unsafe to rent" must not be one publishable key away
 *                from being public.
 *
 * THE MARKETING GRID IS NOT DRIVEN BY THESE TABLES. The fleet section on the
 * home page renders FLEET from src/content/brand.ts, which is static content.
 * Taking a car off the road removes it from the BOOKING flow — the calendar, the
 * car step, and any new reservation — but the listing still appears in the
 * marketing grid until that file changes. The UI says so rather than implying a
 * reach it does not have.
 */
import { supabaseAdmin } from "../supabase/admin.server";
import { rentalDays } from "../booking/rental";
import { formatMoney } from "../money";
import type { BookingStatus, PaymentStatus, PrepStatus, VehicleStatus } from "../supabase/types";
import { addDays, curacaoNow, daysBetween, isMonthKey, monthKeyOf } from "./clock";
import { DEFAULT_STATS_WINDOW, STATS_WINDOWS, vehicleLabel, type StatsWindow } from "./fleet";
import { monthGrid, packLanes, toBars, type RentalForBar } from "./timeline";
import type {
  CarRental,
  CarWriteResult,
  FleetCarDetail,
  FleetCarStats,
  FleetCarRow,
  FleetOverview,
  FleetVehicleRow,
  TimelineRow,
  VehicleWriteResult,
} from "./types";

/** How many upcoming rentals a listing's page lists, and how far ahead the
 *  overview looks for "what is next for this car". */
const UPCOMING_LIMIT = 25;

/** Same exclusion as everywhere else: a cancelled booking occupies nothing and
 *  earns nothing. */
const CANCELLED = "cancelled";

const CAR_SELECT = `
  id, model, category, color, daily_rate, monthly_rate, transmission, seats,
  photo_url, description, created_at, updated_at
`;

const VEHICLE_SELECT = `
  id, listing_id, plate_number, color, is_publicly_visible, status,
  maintenance_notes, off_road_since, created_at, updated_at
`;

const RENTAL_SELECT = `
  id, car_id, vehicle_id, pickup_date, pickup_time, return_date, return_time,
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
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface RawVehicle {
  id: string;
  listing_id: string;
  plate_number: string | null;
  color: string;
  is_publicly_visible: boolean;
  status: VehicleStatus;
  maintenance_notes: string | null;
  off_road_since: string | null;
  created_at: string;
  updated_at: string;
}

interface RawRental {
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

/** "Hyundai Venue · Red" — the LISTING, named by its model and the colour in
 *  its photo. */
function carLabel(car: { model: string; color: string }): string {
  return `${car.model} · ${car.color}`;
}

/**
 * The order vehicles are shown in, which is deliberately the order the booking
 * flow assigns them in (see orderByPreference in availability.server.ts):
 * visible unit first, then oldest. A fleet page that listed the backup first
 * would make "which car will the next guest get" a question you have to work
 * out instead of read.
 */
function byAssignmentOrder(a: RawVehicle, b: RawVehicle): number {
  if (a.is_publicly_visible !== b.is_publicly_visible) return a.is_publicly_visible ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

function toRentalForBar(raw: RawRental): RentalForBar {
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
 * Expressed once and used by BOTH the per-listing list and the affected-rentals
 * count in updateVehicle, so the number in the warning and the rows underneath
 * it cannot drift apart.
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
 * One car's — or one listing's — numbers over a window.
 *
 * `capacityDays` is what utilisation is measured against, and it is a separate
 * argument from `windowDays` for one reason: A LISTING'S CAPACITY IS NOT ITS
 * WINDOW. Two Sparks over 90 days is 180 car-days, so a listing that kept one
 * of them rented the entire time is at 50%, not 100%. Passing windowDays for
 * both (the single-vehicle case) is the only time they coincide.
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
  capacityDays: number,
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
      capacityDays === 0 ? 0 : Math.min(100, Math.round((daysOut / capacityDays) * 1000) / 10),
    collectedCents,
    rentals: paidRentals,
    averageRentalDays: paidRentals === 0 ? 0 : Math.round((totalDays / paidRentals) * 10) / 10,
  };
}

/** Group anything carrying a vehicle_id by that id. */
function groupByVehicle(rentals: RawRental[]): Map<string, RawRental[]> {
  const byVehicle = new Map<string, RawRental[]>();
  for (const r of rentals) {
    const list = byVehicle.get(r.vehicle_id);
    if (list) list.push(r);
    else byVehicle.set(r.vehicle_id, [r]);
  }
  return byVehicle;
}

/** One physical car's row, given the rentals already grouped onto it. */
function toVehicleRow(
  vehicle: RawVehicle,
  parts: {
    windowRentals: RawRental[];
    windowStart: string;
    windowEndExclusive: string;
    windowDays: number;
    today: string;
    next?: RawRental;
    upcomingCount: number;
    onRental?: RawRental;
  },
): FleetVehicleRow {
  return {
    id: vehicle.id,
    listingId: vehicle.listing_id,
    label: vehicleLabel(vehicle),
    color: vehicle.color,
    plateNumber: vehicle.plate_number,
    isPubliclyVisible: vehicle.is_publicly_visible,
    status: vehicle.status,
    maintenanceNotes: vehicle.maintenance_notes,
    offRoadSince: vehicle.off_road_since,
    offRoadDays:
      vehicle.status === "available" || !vehicle.off_road_since
        ? null
        : Math.max(0, daysBetween(vehicle.off_road_since.slice(0, 10), parts.today)),
    stats: statsFor(
      parts.windowRentals,
      parts.windowStart,
      parts.windowEndExclusive,
      parts.windowDays,
      // A single car's capacity is the window itself.
      parts.windowDays,
    ),
    onRentalUntil: parts.onRental?.return_date ?? null,
    onRentalFor: parts.onRental?.clients?.full_name ?? null,
    onRentalBookingId: parts.onRental?.id ?? null,
    upcomingCount: parts.upcomingCount,
    nextPickupDate: parts.next?.pickup_date ?? null,
    nextPickupFor: parts.next?.clients?.full_name ?? null,
    updatedAt: vehicle.updated_at,
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
  const [carsRes, vehiclesRes, windowRes, upcomingRes, currentRes] = await Promise.all([
    db.from("cars").select(CAR_SELECT).order("daily_rate", { ascending: false }),

    db.from("vehicles").select(VEHICLE_SELECT),

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
    ["listings", carsRes],
    ["vehicles", vehiclesRes],
    ["rentals in the window", windowRes],
    ["upcoming rentals", upcomingRes],
    ["current rentals", currentRes],
  ] as const) {
    if (res.error) throw new Error(`Fleet: failed to load ${label}: ${res.error.message}`);
  }

  const cars = (carsRes.data ?? []) as unknown as RawCar[];
  const vehicles = ((vehiclesRes.data ?? []) as unknown as RawVehicle[]).sort(byAssignmentOrder);
  const windowRentals = (windowRes.data ?? []) as unknown as RawRental[];
  const upcoming = (upcomingRes.data ?? []) as unknown as RawRental[];
  const current = (currentRes.data ?? []) as unknown as RawRental[];

  const windowByVehicle = groupByVehicle(windowRentals);

  const nextByVehicle = new Map<string, RawRental>();
  const upcomingCounts = new Map<string, number>();
  for (const r of upcoming) {
    if (!nextByVehicle.has(r.vehicle_id)) nextByVehicle.set(r.vehicle_id, r);
    upcomingCounts.set(r.vehicle_id, (upcomingCounts.get(r.vehicle_id) ?? 0) + 1);
  }
  const currentByVehicle = new Map(current.map((r) => [r.vehicle_id, r]));

  const vehiclesByListing = new Map<string, RawVehicle[]>();
  for (const v of vehicles) {
    const list = vehiclesByListing.get(v.listing_id);
    if (list) list.push(v);
    else vehiclesByListing.set(v.listing_id, [v]);
  }

  const rows: FleetCarRow[] = cars.map((car) => {
    const units = vehiclesByListing.get(car.id) ?? [];

    const vehicleRows = units.map((vehicle) =>
      toVehicleRow(vehicle, {
        windowRentals: windowByVehicle.get(vehicle.id) ?? [],
        windowStart,
        windowEndExclusive,
        windowDays: days,
        today: now.today,
        next: nextByVehicle.get(vehicle.id),
        upcomingCount: upcomingCounts.get(vehicle.id) ?? 0,
        onRental: currentByVehicle.get(vehicle.id),
      }),
    );

    // The listing's own numbers: every rental across every unit, measured
    // against the combined capacity of those units.
    const listingRentals = units.flatMap((v) => windowByVehicle.get(v.id) ?? []);

    return {
      id: car.id,
      label: carLabel(car),
      model: car.model,
      color: car.color,
      category: car.category,
      photoUrl: car.photo_url,
      description: car.description,
      dailyRateCents: car.daily_rate,
      monthlyRateCents: car.monthly_rate,
      vehicles: vehicleRows,
      vehicleCount: vehicleRows.length,
      vehiclesOnRoad: vehicleRows.filter((v) => v.status === "available").length,
      vehiclesOutNow: vehicleRows.filter((v) => v.onRentalUntil !== null).length,
      hiddenCount: vehicleRows.filter((v) => !v.isPubliclyVisible).length,
      bookable: vehicleRows.some((v) => v.status === "available"),
      stats: statsFor(
        listingRentals,
        windowStart,
        windowEndExclusive,
        days,
        days * vehicleRows.length,
      ),
    };
  });

  const fleetDaysOut = rows.reduce((sum, r) => sum + r.stats.daysOut, 0);
  const vehicleCount = vehicles.length;
  const capacityDays = vehicleCount * days;

  return {
    today: now.today,
    windowDays: days,
    windowStart,
    windowEnd: now.today,
    cars: rows,
    totals: {
      listings: rows.length,
      vehicles: vehicleCount,
      hidden: vehicles.filter((v) => !v.is_publicly_visible).length,
      offRoad: vehicles.filter((v) => v.status !== "available").length,
      outNow: currentByVehicle.size,
      collectedCents: rows.reduce((sum, r) => sum + r.stats.collectedCents, 0),
      utilisationPct:
        capacityDays === 0 ? 0 : Math.round((fleetDaysOut / capacityDays) * 1000) / 10,
    },
  };
}

/* ── one listing ───────────────────────────────────────────────────────────── */

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
  if (carRes.error) throw new Error(`Fleet: failed to load listing: ${carRes.error.message}`);
  if (!carRes.data) return null;
  const car = carRes.data as unknown as RawCar;

  // Every query below filters on car_id — the LISTING — and then splits by
  // vehicle in memory. Filtering on the listing is what makes "this listing's
  // calendar" include a rental on the hidden unit, which is the whole point of
  // the page.
  const [vehiclesRes, monthRes, windowRes, upcomingRes, currentRes] = await Promise.all([
    db.from("vehicles").select(VEHICLE_SELECT).eq("listing_id", carId),

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

    // UNFINISHED rentals — see `unreturned` above for what that means and why it
    // is not simply "returns in the future".
    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .eq("car_id", carId)
      .neq("booking_status", CANCELLED)
      .or(unreturned(now.timestamp))
      .order("pickup_at", { ascending: true })
      .limit(UPCOMING_LIMIT),

    // Out on the road right now. NOT maybeSingle any more: a listing with two
    // cars can legitimately have two rentals in progress, which is exactly the
    // case the old single-row query would have thrown on.
    db
      .from("bookings")
      .select(RENTAL_SELECT)
      .eq("car_id", carId)
      .neq("booking_status", CANCELLED)
      .lte("pickup_at", now.timestamp)
      .gt("return_at", now.timestamp),
  ]);

  for (const [label, res] of [
    ["the listing's vehicles", vehiclesRes],
    ["the month's rentals", monthRes],
    ["rentals in the window", windowRes],
    ["upcoming rentals", upcomingRes],
    ["current rentals", currentRes],
  ] as const) {
    if (res.error) throw new Error(`Fleet: failed to load ${label}: ${res.error.message}`);
  }

  const vehicles = ((vehiclesRes.data ?? []) as unknown as RawVehicle[]).sort(byAssignmentOrder);
  const monthRentals = (monthRes.data ?? []) as unknown as RawRental[];
  const windowRentals = (windowRes.data ?? []) as unknown as RawRental[];
  const upcoming = (upcomingRes.data ?? []) as unknown as RawRental[];
  const current = (currentRes.data ?? []) as unknown as RawRental[];

  const windowByVehicle = groupByVehicle(windowRentals);
  const currentByVehicle = new Map(current.map((r) => [r.vehicle_id, r]));

  const nextByVehicle = new Map<string, RawRental>();
  const upcomingCounts = new Map<string, number>();
  for (const r of upcoming) {
    // `upcoming` includes rentals already running, so "next pickup" is the first
    // one that has not started.
    if (r.pickup_date > now.today && !nextByVehicle.has(r.vehicle_id)) {
      nextByVehicle.set(r.vehicle_id, r);
    }
    upcomingCounts.set(r.vehicle_id, (upcomingCounts.get(r.vehicle_id) ?? 0) + 1);
  }

  const vehicleRows = vehicles.map((vehicle) =>
    toVehicleRow(vehicle, {
      windowRentals: windowByVehicle.get(vehicle.id) ?? [],
      windowStart,
      windowEndExclusive,
      windowDays: days,
      today: now.today,
      next: nextByVehicle.get(vehicle.id),
      upcomingCount: upcomingCounts.get(vehicle.id) ?? 0,
      onRental: currentByVehicle.get(vehicle.id),
    }),
  );

  // One timeline row per vehicle, in assignment order. Bars are computed from
  // the whole listing's month and then split, so a bar cannot be dropped by
  // being fetched for the wrong row.
  const allBars = toBars(monthRentals.map(toRentalForBar), grid);
  const labelById = new Map(vehicleRows.map((v) => [v.id, v.label]));

  const timeline: TimelineRow[] = vehicles.map((vehicle) => {
    const { bars, lanes } = packLanes(allBars.filter((b) => b.vehicleId === vehicle.id));
    return {
      vehicleId: vehicle.id,
      listingId: car.id,
      listingLabel: carLabel(car),
      vehicleLabel: vehicleLabel(vehicle),
      status: vehicle.status,
      isPubliclyVisible: vehicle.is_publicly_visible,
      lanes,
      bars,
    };
  });

  const upcomingRentals: CarRental[] = upcoming.map((r) => ({
    bookingId: r.id,
    clientName: r.clients?.full_name ?? "Unknown guest",
    vehicleId: r.vehicle_id,
    vehicleLabel: labelById.get(r.vehicle_id) ?? "Unknown car",
    pickupDate: r.pickup_date,
    pickupTime: r.pickup_time,
    returnDate: r.return_date,
    returnTime: r.return_time,
    days: rentalDays(r.pickup_date, r.return_date),
    totalCents: r.total_price,
    bookingStatus: r.booking_status,
    paymentStatus: r.payment_status,
    prepStatus: r.prep_status,
  }));

  return {
    id: car.id,
    label: carLabel(car),
    model: car.model,
    color: car.color,
    category: car.category,
    transmission: car.transmission,
    seats: car.seats,
    photoUrl: car.photo_url,
    description: car.description,
    dailyRateCents: car.daily_rate,
    monthlyRateCents: car.monthly_rate,
    updatedAt: car.updated_at,
    today: now.today,
    stats: statsFor(windowRentals, windowStart, windowEndExclusive, days, days * vehicles.length),
    vehicles: vehicleRows,
    bookable: vehicleRows.some((v) => v.status === "available"),
    month: grid.month,
    monthLabel: grid.label,
    days: grid.days,
    prevMonth: grid.prevMonth,
    nextMonth: grid.nextMonth,
    currentMonth,
    timeline,
    upcoming: upcomingRentals,
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
  /** 0 means this listing is not offered monthly — a legitimate setting, not a
   *  missing value, so it is allowed through rather than rejected. */
  monthlyRateCents: number;
  photoUrl: string;
  description: string;
}

/**
 * Update a LISTING: its price list, its photo, its copy.
 *
 * Nothing here can take a car off the road any more — that is a vehicle's
 * business, and it moved to updateVehicle below. This function therefore has no
 * warning to give and no rentals to count: a rate change cannot strand anyone,
 * because a booking keeps the price it was struck at.
 */
export async function updateCar(input: CarUpdate): Promise<CarWriteResult> {
  const db = supabaseAdmin();

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

  const description = input.description.trim();

  const { data, error } = await db
    .from("cars")
    .update({
      daily_rate: input.dailyRateCents,
      monthly_rate: input.monthlyRateCents,
      photo_url: input.photoUrl.trim(),
      description: description.length > 0 ? description : null,
    })
    .eq("id", input.carId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Fleet: failed to update the listing: ${error.message}`);
  if (!data)
    return { ok: false, reason: "not_found", message: "That listing is not in the fleet." };

  return { ok: true, carId: input.carId };
}

export interface VehicleUpdate {
  vehicleId: string;
  status: VehicleStatus;
  /** Empty means "no plate on file", stored as NULL so the unique index and
   *  every "is it recorded?" test keep meaning one thing. */
  plateNumber: string;
  color: string;
  maintenanceNotes: string;
}

/** Postgres unique_violation — the plate index firing. */
const UNIQUE_VIOLATION = "23505";

/**
 * Update a VEHICLE: its condition, its plate, its colour.
 *
 * off_road_since is maintained HERE rather than by a trigger, because it is a
 * transition, not a timestamp of the last write: it is stamped when the car
 * leaves 'available', preserved while it stays off the road (so editing the
 * notes does not reset "off the road for 6 days"), and cleared when it comes
 * back. `updated_at` continues to be the database's job, via
 * trg_vehicles_updated_at.
 *
 * What this deliberately does NOT do is touch bookings. Taking a car off the
 * road with rentals already on it is a legitimate and common thing to want — it
 * is going in for a service next week and must stop being assigned — so the
 * write goes through and the CALLER is given the count of affected rentals to
 * show. Silently cancelling a guest's reservation because a status changed
 * would be far worse than a warning.
 *
 * `listingStillBookable` is the second half of that honesty, and it is new with
 * pooling: taking one of two Sparks off the road is invisible to guests, while
 * taking the last one off removes the listing from the site. The page says
 * which.
 *
 * VISIBILITY IS NOT EDITABLE HERE. Which unit a listing advertises is bound to
 * which unit is in the listing's photograph, and flipping the flag alone would
 * leave the site showing a black Spark while quietly preferring the grey one.
 * Changing it is a photo change too, so it stays a deliberate two-part job
 * rather than a switch.
 */
export async function updateVehicle(input: VehicleUpdate): Promise<VehicleWriteResult> {
  const db = supabaseAdmin();

  const currentRes = await db
    .from("vehicles")
    .select("id, listing_id, status, off_road_since")
    .eq("id", input.vehicleId)
    .maybeSingle();
  if (currentRes.error) {
    throw new Error(`Fleet: failed to read the vehicle: ${currentRes.error.message}`);
  }
  if (!currentRes.data) {
    return { ok: false, reason: "not_found", message: "That car is not in the fleet." };
  }

  const color = input.color.trim();
  if (color.length === 0) {
    return { ok: false, reason: "invalid", message: "A car needs a colour." };
  }

  const was = currentRes.data.status as VehicleStatus;
  const listingId = currentRes.data.listing_id;
  const goingOffRoad = was === "available" && input.status !== "available";
  const comingBack = was !== "available" && input.status === "available";

  const plate = input.plateNumber.trim();
  const notes = input.maintenanceNotes.trim();

  const { data, error } = await db
    .from("vehicles")
    .update({
      status: input.status,
      plate_number: plate.length > 0 ? plate : null,
      color,
      maintenance_notes: notes.length > 0 ? notes : null,
      ...(goingOffRoad ? { off_road_since: new Date().toISOString() } : {}),
      ...(comingBack ? { off_road_since: null } : {}),
    })
    .eq("id", input.vehicleId)
    .select("id")
    .maybeSingle();

  if (error) {
    // The plate index is the one constraint an operator can trip by typing, so
    // it comes back as something to read rather than as a 500.
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        reason: "conflict",
        message: `Plate ${plate} is already recorded against another car.`,
      };
    }
    throw new Error(`Fleet: failed to update the vehicle: ${error.message}`);
  }
  if (!data) return { ok: false, reason: "not_found", message: "That car is not in the fleet." };

  // Rentals still on the books for a car that has just left the road. Reported,
  // never cancelled — see the note above.
  let affectedRentals = 0;
  if (goingOffRoad) {
    const now = curacaoNow();
    const { count, error: countError } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", input.vehicleId)
      .neq("booking_status", CANCELLED)
      .or(unreturned(now.timestamp));
    if (countError) {
      throw new Error(`Fleet: failed to count affected rentals: ${countError.message}`);
    }
    affectedRentals = count ?? 0;
  }

  const { count: onRoad, error: onRoadError } = await db
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listingId)
    .eq("status", "available");
  if (onRoadError) {
    throw new Error(`Fleet: failed to re-check the listing: ${onRoadError.message}`);
  }

  return {
    ok: true,
    vehicleId: input.vehicleId,
    wentOffRoad: goingOffRoad,
    affectedRentals,
    listingStillBookable: (onRoad ?? 0) > 0,
  };
}
