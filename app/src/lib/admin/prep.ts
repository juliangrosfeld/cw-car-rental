/**
 * The prep pipeline — what physically has to happen to a car between a
 * reservation being taken and the keys coming back. Pure, isomorphic, no I/O:
 * the server validates transitions against this file and the UI draws its
 * buttons from it, so the two cannot drift.
 *
 * WHY prep_status IS NOT booking_status
 * `booking_status` is the commercial state of the reservation (pending →
 * confirmed → active → completed, or cancelled). `prep_status` is the state of
 * the CAR for that reservation, which is the thing Clay actually works through
 * on a Tuesday morning: which cars need washing and fuelling today, which are
 * standing ready, which are out. They move on their own clocks — a confirmed
 * booking three weeks out sits at 'booked' the whole time — so the CRM never
 * derives one from the other.
 *
 * ORDER IS LOAD-BEARING. PREP_FLOW is the pipeline left to right, and every
 * "advance" action in the CRM is one step along it. Reordering this array
 * reorders the pipeline everywhere, including the queue counts on the bookings
 * page; the strings themselves are pinned by a CHECK constraint in
 * supabase/migrations/…_init.sql and cannot be renamed here alone.
 */
import type { PrepStatus } from "../supabase/types";

/** The pipeline, in order. Mirrors PREP_STATUS in ../supabase/types. */
export const PREP_FLOW = ["booked", "needs_prep", "ready", "out", "returned"] as const;

/** Human label. `booked` says "in the diary" rather than "booked" so it cannot
 *  be misread as the booking's own status. */
export const PREP_LABEL: Record<PrepStatus, string> = {
  booked: "Booked",
  needs_prep: "Needs prep",
  ready: "Ready",
  out: "Out",
  returned: "Returned",
};

/** One line on what the state means, for the pipeline strip on the detail page.
 *  These are the operational definitions — if the wording here and the way the
 *  yard actually works disagree, the yard wins and this file changes. */
export const PREP_MEANING: Record<PrepStatus, string> = {
  booked: "In the diary. Nobody has touched the car yet.",
  needs_prep: "Needs cleaning, fuel and a check before it can go out.",
  ready: "Prepped and waiting for the guest.",
  out: "Keys handed over. The guest has the car.",
  returned: "Back with us and checked in.",
};

/**
 * The label on the button that moves a booking OUT of this status — i.e. the
 * next piece of work, phrased as the action rather than the destination.
 * `returned` is the end of the line and has no button.
 */
export const PREP_ADVANCE_LABEL: Record<PrepStatus, string | null> = {
  booked: "Flag for prep",
  needs_prep: "Mark ready",
  ready: "Hand over",
  out: "Mark returned",
  returned: null,
};

/** Where this status sits in the pipeline, 0-based. */
export function prepStage(status: PrepStatus): number {
  return PREP_FLOW.indexOf(status);
}

/** The next status along, or null at the end of the pipeline. */
export function nextPrepStatus(status: PrepStatus): PrepStatus | null {
  const at = prepStage(status);
  return at >= 0 && at < PREP_FLOW.length - 1 ? PREP_FLOW[at + 1] : null;
}

/**
 * Is `to` a status the CRM will write?
 *
 * Deliberately permissive about DIRECTION: any status may be set to any other.
 * A single-step forward action covers the normal day, but a car that was marked
 * ready and then found with a flat tyre has to be able to go back to
 * 'needs_prep', and a mis-tap has to be undoable. A pipeline that only moves
 * forwards would be corrected with SQL at the counter, which is worse. What this
 * does reject is a value outside the vocabulary, which the CHECK constraint
 * would refuse anyway — better a typed error than a 500 from Postgres.
 */
export function isPrepStatus(value: unknown): value is PrepStatus {
  return typeof value === "string" && (PREP_FLOW as readonly string[]).includes(value);
}
