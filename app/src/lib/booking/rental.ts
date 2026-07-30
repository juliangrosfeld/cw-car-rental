/**
 * Pure rental domain logic — no React, no Supabase, no I/O.
 *
 * Imported by BOTH the browser (calendar, wizard) and the server functions, so
 * the price the guest is shown and the price the server charges come from one
 * implementation. The server still recomputes rather than trusting the client;
 * sharing the function just means the two agree when nobody is cheating.
 *
 * DAY MODEL — a rental occupies the HALF-OPEN interval [pickup, return). The
 * car is back on the morning of the return day, so that day can start the next
 * rental. This is the same rule the `bookings_no_double_booking` exclusion
 * constraint enforces in Postgres; keep the two in step.
 *
 * MONEY — cents everywhere, matching the database. Only formatUsd() converts.
 */

/** Wall-clock handover times. The wizard collects dates only; these fill in the
 *  time-of-day the schema requires. Both 10:00, which is what makes a same-day
 *  handover (one guest returns, the next collects) land exactly on the boundary
 *  of the half-open interval rather than overlapping. */
export const PICKUP_TIME = "10:00:00";
export const RETURN_TIME = "10:00:00";

/** How far ahead the calendar loads existing bookings. */
export const CALENDAR_HORIZON_DAYS = 240;

export const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' in LOCAL time — never toISOString(), which shifts to UTC and
 *  silently moves the date backwards for anyone west of Greenwich. */
export function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Cents → "$55" / "$52.50". Whole dollars stay clean, which is the common case. */
export function formatUsd(cents: number): string {
  return cents % 100 === 0
    ? `$${cents / 100}`
    : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Billable days between two 'YYYY-MM-DD' keys. Minimum 1: a same-day rental
 * still costs a day.
 *
 * Uses UTC.parse on the date parts so DST transitions cannot make a day come
 * out as 23 or 25 hours and round the wrong way.
 */
export function rentalDays(pickupDate: string, returnDate: string): number {
  const [ay, am, ad] = pickupDate.split("-").map(Number);
  const [by, bm, bd] = returnDate.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.max(1, Math.round((b - a) / DAY_MS));
}

export interface Quote {
  days: number;
  /** Cents. */
  perDayCents: number;
  /** Cents. */
  totalCents: number;
}

/** THE pricing rule. The server calls this with the daily_rate it read from the
 *  database, never with a number that came from the browser. */
export function quote(dailyRateCents: number, pickupDate: string, returnDate: string): Quote {
  const days = rentalDays(pickupDate, returnDate);
  return { days, perDayCents: dailyRateCents, totalCents: dailyRateCents * days };
}

/** A date range a car is already spoken for. Dates are 'YYYY-MM-DD'. */
export interface BusyRange {
  carId: string;
  pickupDate: string;
  returnDate: string;
}

/**
 * Do [aStart, aEnd) and [bStart, bEnd) overlap? Half-open, so touching
 * endpoints do not collide. String comparison is valid because 'YYYY-MM-DD'
 * sorts lexicographically.
 */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** True if this car has no booking colliding with [pickupDate, returnDate). */
export function carFreeForRange(
  busy: readonly BusyRange[],
  carId: string,
  pickupDate: string,
  returnDate: string,
): boolean {
  return !busy.some(
    (b) =>
      b.carId === carId && rangesOverlap(pickupDate, returnDate, b.pickupDate, b.returnDate),
  );
}

/**
 * True when every car in the fleet is occupied on this single day — the
 * calendar hard-disables those. A day is "occupied" for the range
 * [day, day+1), matching the half-open model: a car returning at 10:00 on a
 * day is available to rent that same day.
 */
export function dayFullyBooked(
  busy: readonly BusyRange[],
  carIds: readonly string[],
  dayKey: string,
): boolean {
  if (carIds.length === 0) return false;
  const next = toKey(new Date(fromKey(dayKey).getTime() + DAY_MS));
  return carIds.every((id) => !carFreeForRange(busy, id, dayKey, next));
}

/** Split a fleet into what's bookable for a range and what isn't. */
export function splitFleet<T extends { id: string }>(
  cars: readonly T[],
  busy: readonly BusyRange[],
  pickupDate: string,
  returnDate: string,
): { available: T[]; unavailable: T[] } {
  const available: T[] = [];
  const unavailable: T[] = [];
  for (const car of cars) {
    (carFreeForRange(busy, car.id, pickupDate, returnDate) ? available : unavailable).push(car);
  }
  return { available, unavailable };
}

/**
 * 'YYYY-MM-DD' + 'HH:MM:SS' → the naive timestamp string Postgres compares the
 * generated pickup_at / return_at columns against.
 *
 * Deliberately NOT an ISO instant: those columns are `timestamp` WITHOUT time
 * zone (wall clock, per the migration's header note). Sending a 'Z'-suffixed
 * value would make PostgREST coerce through UTC and shift every comparison by
 * the offset.
 */
export function toTimestamp(date: string, time: string): string {
  return `${date}T${time}`;
}
