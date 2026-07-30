/**
 * Display formatting for the CRM. Pure, isomorphic, no I/O.
 *
 * Two rules that everything here follows:
 *
 * MONEY is integer cents everywhere in the app and becomes a string exactly
 * once — here. Never divide by 100 inline in a component.
 *
 * DATES are 'YYYY-MM-DD' strings and must never be handed to `new Date(str)`:
 * that parses a bare date as UTC midnight and then renders it in the viewer's
 * zone, which turns 2026-07-29 into "28 Jul" for anyone west of Greenwich —
 * including Curaçao, where the whole business is. Every formatter below builds
 * the date from its parts with Date.UTC and renders with `timeZone: 'UTC'`, so
 * the string that comes out is the string that went in.
 */

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const moneyPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Cents → "$1,240", or "$1,240.50" when the cents are not round. Whole dollars
 *  are the overwhelming case (rates are set in whole dollars), and dropping the
 *  ".00" makes a wall of figures much faster to scan. */
export function formatMoney(cents: number): string {
  return cents % 100 === 0 ? money.format(cents / 100) : moneyPrecise.format(cents / 100);
}

/** Always two decimals. For a single figure being reconciled against a receipt,
 *  where the trailing zeros are the point. */
export function formatMoneyExact(cents: number): string {
  return moneyPrecise.format(cents / 100);
}

function fromKeyUtc(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** '2026-07-29' → 'Wed 29 Jul'. */
export function formatDate(dateKey: string): string {
  return fromKeyUtc(dateKey).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** '2026-07-29' → '29 Jul 2026'. For anything more than a few months out. */
export function formatDateLong(dateKey: string): string {
  return fromKeyUtc(dateKey).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** '2026-07-29' → '29 Jul'. Axis labels and other tight spots. */
export function formatDateShort(dateKey: string): string {
  return fromKeyUtc(dateKey).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** '10:00:00' → '10:00'. Seconds are always zero in this schema and only add
 *  noise to a schedule. */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

/**
 * An ISO instant (created_at) → '29 Jul, 14:32' in Curaçao time.
 *
 * This one CAN use `new Date()` because a timestamptz really is an instant; the
 * explicit timeZone is what pins it to island time instead of the viewer's.
 */
export function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Curacao",
  });
}

/** A whole-day offset → 'Today' / 'Tomorrow' / 'in 4 days' / '2 days late'. */
export function formatDaysAway(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  if (daysAway === -1) return "1 day late";
  if (daysAway < 0) return `${Math.abs(daysAway)} days late`;
  return `in ${daysAway} days`;
}

/** 'Mon 27 Jul – Sun 2 Aug'. Note the en dash is fine here: the copy rule
 *  against dashes is a public-site brand rule, and this is the back office. */
export function formatDateRange(startKey: string, endKey: string): string {
  return `${formatDate(startKey)} – ${formatDate(endKey)}`;
}

/**
 * Percentage change between two figures, or null when there is no meaningful
 * baseline. Returning null rather than 0 or Infinity keeps "first month of
 * trading" from rendering as "+0%" or "+∞%", both of which are lies.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
