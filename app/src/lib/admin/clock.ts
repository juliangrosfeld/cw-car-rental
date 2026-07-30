/**
 * "Now", in Curaçao. Pure, no I/O — imported by both the server aggregates and
 * the admin UI.
 *
 * WHY THIS EXISTS
 * The server runs in UTC (Vercel Functions always do) while `bookings.pickup_at`
 * and `return_at` are `timestamp` WITHOUT time zone — deliberate wall-clock
 * values, per the migration header. Comparing those columns against a UTC
 * `new Date()` would put every window four hours out: between 20:00 and midnight
 * Curaçao time the server would already be on tomorrow's date, so "today's
 * revenue" and "upcoming pickups" would both quietly answer the wrong question.
 *
 * Curaçao is AST (UTC-4) all year with no daylight saving, which is what makes a
 * fixed offset correct here rather than a lucky approximation. If CW ever opens
 * somewhere with DST, replace this with Intl.DateTimeFormat time-zone parts —
 * do not just change the number.
 */

export const CURACAO_UTC_OFFSET_HOURS = -4;

/** For building an exact instant out of a Curaçao wall-clock date, e.g.
 *  `2026-07-29T00:00:00-04:00`. Used against timestamptz columns. */
export const CURACAO_UTC_OFFSET = "-04:00";

const HOUR_MS = 3_600_000;

/**
 * A Date whose **UTC** fields read as Curaçao wall clock. Only ever read it with
 * getUTCFullYear/getUTCMonth/…; its `getTime()` is shifted and meaningless as an
 * instant. The helpers below are the intended interface.
 */
function curacaoWallClock(now: Date = new Date()): Date {
  return new Date(now.getTime() + CURACAO_UTC_OFFSET_HOURS * HOUR_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD' for a wall-clock Date. */
function dateKey(wall: Date): string {
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
}

export interface CuracaoNow {
  /** Today in Curaçao, 'YYYY-MM-DD'. */
  today: string;
  /** Wall-clock instant, 'YYYY-MM-DDTHH:MM:SS' — compare against pickup_at / return_at. */
  timestamp: string;
  /** First day of the current month, 'YYYY-MM-DD'. */
  monthStart: string;
  /**
   * First day of NEXT month — the exclusive upper bound of "this month".
   *
   * Not cosmetic. Bookings carry pickup dates arbitrarily far into the future,
   * so a bucket written as `date >= monthStart` with no upper bound silently
   * means "this month and every month after it", and a prepaid December rental
   * lands in July's revenue. Always pair the two.
   */
  nextMonthStart: string;
  /** January 1st of the current year, 'YYYY-MM-DD'. */
  yearStart: string;
  /** January 1st of NEXT year — exclusive upper bound, for the same reason. */
  nextYearStart: string;
  /** Monday of the current week, 'YYYY-MM-DD'. */
  weekStart: string;
  /** Sunday of the current week, 'YYYY-MM-DD'. */
  weekEnd: string;
  /** e.g. 'July 2026'. */
  monthLabel: string;
  /** The real UTC instant this was computed at, for display. */
  computedAtIso: string;
}

export function curacaoNow(now: Date = new Date()): CuracaoNow {
  const wall = curacaoWallClock(now);
  const y = wall.getUTCFullYear();
  const m = wall.getUTCMonth();
  const d = wall.getUTCDate();

  // getUTCDay() is 0 for Sunday; the CRM week runs Monday to Sunday, so Sunday
  // has to count as day 7 and look back six days rather than forward one.
  const dow = wall.getUTCDay() === 0 ? 7 : wall.getUTCDay();
  const monday = new Date(Date.UTC(y, m, d - (dow - 1)));
  const sunday = new Date(Date.UTC(y, m, d + (7 - dow)));

  return {
    today: dateKey(wall),
    timestamp: `${dateKey(wall)}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(
      wall.getUTCSeconds(),
    )}`,
    monthStart: `${y}-${pad(m + 1)}-01`,
    // Date.UTC normalises month 12 into January of the next year, so December
    // needs no special case.
    nextMonthStart: dateKey(new Date(Date.UTC(y, m + 1, 1))),
    yearStart: `${y}-01-01`,
    nextYearStart: `${y + 1}-01-01`,
    weekStart: dateKey(monday),
    weekEnd: dateKey(sunday),
    monthLabel: new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    computedAtIso: now.toISOString(),
  };
}

/** Shift a 'YYYY-MM-DD' key by whole days. Pure string in, string out. */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(Date.UTC(y, m - 1, d + days)));
}

/**
 * Whole days from `from` to `to`, negative when `to` is the earlier date.
 *
 * Date.UTC on the parts, never `new Date(key)`: the point of going through UTC
 * is that no local offset or DST transition can make a day come out as 23 or 25
 * hours and round the difference the wrong way.
 */
export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/* ── months ──────────────────────────────────────────────────────────────────
   A MONTH KEY is 'YYYY-MM'. It is what the bookings calendar puts in the URL,
   so these five helpers are the only place month arithmetic happens.          */

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_RE.test(value);
}

/** 'YYYY-MM-DD' → 'YYYY-MM'. */
export function monthKeyOf(dateKeyStr: string): string {
  return dateKeyStr.slice(0, 7);
}

/** First day of a month key, 'YYYY-MM-01'. */
export function monthFirstDay(monthKey: string): string {
  return `${monthKey}-01`;
}

/** Shift a month key by whole months. Date.UTC normalises month -1 and month 12
 *  into the neighbouring year, so December and January need no special case. */
export function addMonths(monthKey: string, months: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

/** '2026-07' → 'July 2026'. */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Midnight on a Curaçao date as an exact instant — for timestamptz columns
 *  (created_at) which, unlike pickup_at, really are absolute times. */
export function curacaoMidnightInstant(dateKeyStr: string): string {
  return `${dateKeyStr}T00:00:00${CURACAO_UTC_OFFSET}`;
}

/**
 * The inverse: which Curaçao DAY did this instant fall on?
 *
 * Needed to bucket `created_at` (a timestamptz) into daily and monthly totals.
 * `iso.slice(0, 10)` would be the UTC day, which is wrong for the four hours
 * either side of midnight: a booking taken at 21:00 on 31 July island time is
 * stored as 01:00 on 1 August UTC and would land in the wrong month, quietly
 * moving revenue between reporting periods.
 */
export function toCuracaoDateKey(instant: string | Date): string {
  return dateKey(curacaoWallClock(new Date(instant)));
}
