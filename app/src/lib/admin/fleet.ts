/**
 * Fleet vocabulary. Pure, isomorphic, no I/O — the server aggregates and the
 * fleet pages both read from here, so a status means the same thing in a query
 * as it does in a label.
 *
 * This file exists separately from ./fleet.server.ts for one hard reason: a
 * route that imported a constant from the `.server` module would drag the
 * service-role Supabase client into the browser bundle. Anything the UI needs to
 * know about the fleet lives here instead.
 */
import type { CarStatus } from "../supabase/types";

/* ── standing availability ─────────────────────────────────────────────────── */

/**
 * A car's OWN availability, which is a different question from any single
 * booking's `prep_status`:
 *
 *   cars.status           the car. Is it on the road at all? Applies to every
 *                         future date at once, and is set by the owner.
 *   bookings.prep_status  one rental's lifecycle (booked → needs prep → ready →
 *                         out → returned). Says nothing about the car outside
 *                         that rental.
 *
 * A car can be 'available' with a rental sitting at 'out' — that is the normal
 * case, and it means "this car is part of the working fleet and is currently
 * with a guest". A car at 'maintenance' with a rental at 'ready' is a problem
 * worth seeing, which is precisely why the two are not merged.
 */
export const CAR_STATUS_ORDER = ["available", "maintenance", "offline"] as const;

export const CAR_STATUS_LABEL: Record<CarStatus, string> = {
  available: "On the road",
  maintenance: "In maintenance",
  offline: "Off the road",
};

/** What choosing each one actually does. Shown next to the control, because the
 *  consequence (it disappears from the booking page) is not visible from here. */
export const CAR_STATUS_MEANING: Record<CarStatus, string> = {
  available: "Offered to guests for any free dates.",
  maintenance: "In the shop. Not offered for new dates; rentals already booked still stand.",
  offline: "Not being rented at all — sold, insured off, or in personal use.",
};

/** True when a car in this status is offered for new bookings. Mirrors the
 *  `status = 'available'` filter in src/lib/booking/availability.server.ts; if
 *  that filter ever widens, this is the other half of the change. */
export function isBookable(status: CarStatus): boolean {
  return status === "available";
}

/* ── stats windows ─────────────────────────────────────────────────────────── */

/** Trailing windows the fleet stats offer, in days ending today inclusive.
 *  Kept to three: a window picker with six options is a decision an owner has to
 *  make before reading a number, every time. */
export const STATS_WINDOWS = [30, 90, 365] as const;
export type StatsWindow = (typeof STATS_WINDOWS)[number];

/** Long enough to smooth out a quiet fortnight, short enough to still be about
 *  now rather than about last season. */
export const DEFAULT_STATS_WINDOW: StatsWindow = 90;

export const STATS_WINDOW_LABEL: Record<StatsWindow, string> = {
  30: "Last 30 days",
  90: "Last 90 days",
  365: "Last 12 months",
};

export function isStatsWindow(value: unknown): value is StatsWindow {
  return typeof value === "number" && (STATS_WINDOWS as readonly number[]).includes(value);
}
