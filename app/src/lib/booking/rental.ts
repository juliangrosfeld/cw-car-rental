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
 * MONEY — cents everywhere, matching the database. Only src/lib/money.ts
 * converts, and it prints XCG (the Caribbean guilder), which is what CW quotes.
 */
export { formatMoney } from "../money";

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

/** 'YYYY-MM-DD' + n days, in UTC arithmetic for the same DST reason as above. */
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(
    shifted.getUTCDate(),
  ).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* THE PRICE BOOK                                                      */
/* ------------------------------------------------------------------ */

/**
 * How a rental is priced. Two products, not two views of one:
 *
 *   daily    a date range. Billed per day at the car's daily_rate, with the
 *            length discounts below applied automatically.
 *   monthly  a flat monthly_rate for a ~30-day period. No day count, no tier —
 *            the monthly rate IS the long-stay price, and stacking a length
 *            discount on top of it would discount it twice.
 */
export const RENTAL_TYPES = ["daily", "monthly"] as const;
export type RentalType = (typeof RENTAL_TYPES)[number];

export function isRentalType(value: unknown): value is RentalType {
  return typeof value === "string" && (RENTAL_TYPES as readonly string[]).includes(value);
}

/** Nobody collects a car for two days. Enforced in the calendar, in the server
 *  function, and stated on screen — not just refused. */
export const MIN_RENTAL_DAYS = 3;

/**
 * The longest daily rental this site will price by itself.
 *
 * 28 days and over is a month-plus stay, which is a conversation (insurance,
 * servicing mid-rental, a rate that is not on the price list) rather than a
 * checkout. The flow sends those to us instead of inventing a number — see
 * `custom_quote` below. It is deliberately NOT silently converted into a
 * monthly booking: a guest asking for 35 days has not asked for 30.
 */
export const MAX_SELF_SERVICE_DAYS = 27;

/** What "a month" means when a monthly rental is booked. Roughly a month, said
 *  plainly, rather than a calendar month that would make February cheaper. */
export const MONTHLY_PERIOD_DAYS = 30;

export interface DiscountTier {
  /** Inclusive lower bound in billable days. */
  minDays: number;
  pct: number;
  /** How the tier is described to a guest on a price breakdown. */
  label: string;
  /** The same tier inside a sentence: "5% off a week". Spelled out, because the
   *  public site's copy is written, not tabulated. */
  shortLabel: string;
}

/**
 * Automatic length discounts off the daily-rate total. Ordered longest first so
 * the first match is the best one the guest qualifies for.
 *
 * These are applied SERVER-SIDE from the day count the server derived, exactly
 * like the rate itself. Nothing the browser sends influences the tier.
 */
export const DISCOUNT_TIERS: readonly DiscountTier[] = [
  { minDays: 21, pct: 15, label: "Three weeks or more", shortLabel: "three weeks" },
  { minDays: 14, pct: 10, label: "Two weeks or more", shortLabel: "two weeks" },
  { minDays: 7, pct: 5, label: "A week or more", shortLabel: "a week" },
];

/** The tier a length earns, or 0. */
export function discountPctForDays(days: number): number {
  return DISCOUNT_TIERS.find((tier) => days >= tier.minDays)?.pct ?? 0;
}

/** The tier a length earns, in full, or null. */
export function discountTierForDays(days: number): DiscountTier | null {
  return DISCOUNT_TIERS.find((tier) => days >= tier.minDays) ?? null;
}

/** "5% off a week, 10% off two weeks, 15% off three weeks" — the one-liner the
 *  fleet and booking pages both show, built from the tiers rather than typed
 *  out twice and left to drift out of step with what the server charges. */
export const DISCOUNT_TIER_SUMMARY = [...DISCOUNT_TIERS]
  .reverse()
  .map((tier) => `${tier.pct}% off ${tier.shortLabel}`)
  .join(", ");

/** The return date a monthly rental runs to, given its pickup day. */
export function monthlyReturnDate(pickupDate: string): string {
  return addDaysToKey(pickupDate, MONTHLY_PERIOD_DAYS);
}

/**
 * The dates a booking actually occupies.
 *
 * For a monthly rental the return date is DERIVED, never accepted: the guest
 * picks a start day and the period is fixed. The server calls this before it
 * checks availability and before it prices, so the window it books is the
 * window it quoted.
 */
export function resolveWindow(
  rentalType: RentalType,
  pickupDate: string,
  returnDate?: string | null,
): { pickupDate: string; returnDate: string } {
  return {
    pickupDate,
    returnDate: rentalType === "monthly" ? monthlyReturnDate(pickupDate) : (returnDate ?? ""),
  };
}

export interface Quote {
  rentalType: RentalType;
  /** Billable days. For a monthly rental this is the period length, not a
   *  billing unit — the total does not depend on it. */
  days: number;
  /** Cents. The daily rate for a daily rental, the monthly rate for a monthly
   *  one. What the total was built from, whichever product this is. */
  rateCents: number;
  /** Cents, before any discount. Equals totalCents when nothing applied. */
  subtotalCents: number;
  /** 0 when no tier applied. */
  discountPct: number;
  /** Cents taken off. Stored on the booking so the saving is a fact, not a
   *  number re-derived later from a rate that may since have changed. */
  discountCents: number;
  /** Cents. What the guest is charged. */
  totalCents: number;
}

/** Why a rental could not be self-service priced. Each one has its own thing to
 *  say to the guest, so they are distinct rather than one "invalid". */
export type QuoteRefusal = "below_minimum" | "custom_quote" | "monthly_unavailable";

export type QuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; reason: QuoteRefusal; message: string; days: number };

export interface RateCard {
  /** Cents per rental day. */
  dailyRateCents: number;
  /** Cents for a ~30-day period. 0 means this car is not offered monthly. */
  monthlyRateCents: number;
}

export const MIN_RENTAL_MESSAGE = `Our minimum rental is ${MIN_RENTAL_DAYS} days.`;

/** Guest-facing, so it follows the brand copy rule: no em or en dashes. */
export const CUSTOM_QUOTE_MESSAGE =
  `${MAX_SELF_SERVICE_DAYS + 1} days or more is beyond our standard rates. ` +
  "Message us and we will put together a custom quote.";

/**
 * THE pricing rule, for both products.
 *
 * The server calls this with rates it read from the database and dates it
 * derived itself, never with a number that came from the browser. The wizard
 * calls it too, with the same inputs, so what a guest is shown and what the
 * server charges come from one implementation — but the server's answer is the
 * one that is stored.
 *
 * Returns a result rather than throwing: "3-day minimum" and "talk to us about
 * a month" are things to SAY to a guest mid-flow, not exceptions.
 */
export function quoteRental(input: {
  rentalType: RentalType;
  rates: RateCard;
  pickupDate: string;
  returnDate: string;
}): QuoteResult {
  const days = rentalDays(input.pickupDate, input.returnDate);

  if (input.rentalType === "monthly") {
    if (input.rates.monthlyRateCents <= 0) {
      return {
        ok: false,
        reason: "monthly_unavailable",
        message: "This car is not offered on a monthly rate. Pick another, or message us.",
        days,
      };
    }
    return {
      ok: true,
      quote: {
        rentalType: "monthly",
        days,
        rateCents: input.rates.monthlyRateCents,
        subtotalCents: input.rates.monthlyRateCents,
        discountPct: 0,
        discountCents: 0,
        totalCents: input.rates.monthlyRateCents,
      },
    };
  }

  if (days < MIN_RENTAL_DAYS) {
    return { ok: false, reason: "below_minimum", message: MIN_RENTAL_MESSAGE, days };
  }
  if (days > MAX_SELF_SERVICE_DAYS) {
    return { ok: false, reason: "custom_quote", message: CUSTOM_QUOTE_MESSAGE, days };
  }

  const subtotalCents = input.rates.dailyRateCents * days;
  const discountPct = discountPctForDays(days);
  // Rounded once, off the subtotal, so the parts always add up to the total —
  // a per-day rounding would leave a stray cent on long rentals.
  const discountCents = Math.round((subtotalCents * discountPct) / 100);

  return {
    ok: true,
    quote: {
      rentalType: "daily",
      days,
      rateCents: input.rates.dailyRateCents,
      subtotalCents,
      discountPct,
      discountCents,
      totalCents: subtotalCents - discountCents,
    },
  };
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
