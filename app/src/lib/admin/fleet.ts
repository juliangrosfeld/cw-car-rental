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
import type { VehicleStatus } from "../supabase/types";

/* ── standing availability ─────────────────────────────────────────────────── */

/**
 * A PHYSICAL CAR's own availability, which is a different question from any
 * single booking's `prep_status` — and, since migration 0005, a different
 * question from anything the listing knows:
 *
 *   vehicles.status       this car. Is it on the road at all? Applies to every
 *                         future date at once, and is set by the owner.
 *   bookings.prep_status  one rental's lifecycle (booked → needs prep → ready →
 *                         out → returned). Says nothing about the car outside
 *                         that rental.
 *
 * A car can be 'available' with a rental sitting at 'out' — that is the normal
 * case, and it means "this car is part of the working fleet and is currently
 * with a guest". A car at 'maintenance' with a rental at 'ready' is a problem
 * worth seeing, which is precisely why the two are not merged.
 *
 * WHAT TAKING ONE CAR OFF THE ROAD DOES depends on what else backs its listing.
 * With a second car behind it the listing stays on the site and keeps taking
 * bookings; with none, the listing disappears from the booking flow. The fleet
 * page states which of the two just happened rather than leaving it to be
 * discovered — see VehicleWriteResult.listingStillBookable.
 */
export const VEHICLE_STATUS_ORDER = ["available", "maintenance", "offline"] as const;

export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  available: "On the road",
  maintenance: "In maintenance",
  offline: "Off the road",
};

/** What choosing each one actually does. Shown next to the control, because the
 *  consequence (its listing may leave the booking page) is not visible from
 *  here. */
export const VEHICLE_STATUS_MEANING: Record<VehicleStatus, string> = {
  available: "Part of the working fleet. Can be assigned to any free dates.",
  maintenance: "In the shop. Not assigned to new bookings; rentals already on it still stand.",
  offline: "Not being rented at all — sold, insured off, or in personal use.",
};

/** True when a car in this status can be assigned to a new booking. Mirrors the
 *  `status = 'available'` filter in src/lib/booking/availability.server.ts; if
 *  that filter ever widens, this is the other half of the change. */
export function isBookable(status: VehicleStatus): boolean {
  return status === "available";
}

/* ── vehicle labels ────────────────────────────────────────────────────────── */

/**
 * How a physical car is named in the CRM: its colour and its plate.
 *
 * A NULL PLATE PRINTS AS "no plate" AND NOT AS A BLANK. Migration 0005 left the
 * five original cars without one on purpose — their real plates are not recorded
 * anywhere in this repo, and inventing them in a migration would put fiction on
 * a screen an operator trusts. "no plate" is a prompt to fill it in; an empty
 * space is a bug nobody reports.
 */
export function vehicleLabel(vehicle: {
  color: string;
  plate_number?: string | null;
  plateNumber?: string | null;
}): string {
  const plate = (vehicle.plate_number ?? vehicle.plateNumber ?? "").trim();
  return `${vehicle.color} · ${plate.length > 0 ? plate : "no plate"}`;
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
