/**
 * Client rules. Pure, isomorphic, no I/O — the server aggregates and the client
 * pages both read from here, so "repeat customer" and "licence needs attention"
 * mean the same thing in a query as they do on a badge.
 *
 * WHY THERE IS NO `is_repeat` COLUMN
 * Repeat status is COMPUTED from the bookings a client actually has, every time
 * it is read. A stored flag would be a second source of truth that starts
 * correct and drifts: a booking cancelled, a duplicate merged, a row deleted at
 * 2am, and the badge is now a lie nobody notices. The count is cheap and cannot
 * disagree with the bookings it is derived from.
 */
import type { BookingStatus } from "../supabase/types";

/** Bookings needed to count as a repeat customer. Two: they came back once. */
export const REPEAT_THRESHOLD = 2;

/**
 * Which bookings count towards "how many times has this person rented from us".
 *
 * Cancelled is excluded, matching every other figure in the CRM: a reservation
 * that evaporated is not a rental that happened, and a guest who booked twice
 * and cancelled once is not someone who has come back. It is still shown on
 * their record — the detail page lists every booking including cancellations —
 * it simply does not earn the badge.
 */
export function countsAsRental(status: BookingStatus): boolean {
  return status !== "cancelled";
}

export function isRepeatCustomer(rentalCount: number): boolean {
  return rentalCount >= REPEAT_THRESHOLD;
}

/* ── licences ──────────────────────────────────────────────────────────────── */

/**
 * How much attention a licence needs, worst first.
 *
 *   expired          the expiry date has passed. They cannot legally drive.
 *   expires_mid_hire the licence runs out DURING a rental they already have
 *                    booked — the case a plain "expires soon" check misses, and
 *                    the one that strands a car with a guest who cannot drive it.
 *   expiring         inside the warning window, no rental affected yet.
 *   missing          never captured. Normal for a walk-in until the scan.
 *   ok               nothing to do.
 */
export type LicenceLevel = "expired" | "expires_mid_hire" | "expiring" | "missing" | "ok";

/** How far ahead an expiry starts being worth flagging. A month is long enough
 *  to renew on an island where that means a trip to the office. */
export const LICENCE_WARNING_DAYS = 30;

export const LICENCE_LABEL: Record<LicenceLevel, string> = {
  expired: "Licence expired",
  expires_mid_hire: "Licence expires mid-rental",
  expiring: "Licence expiring",
  missing: "No licence on file",
  ok: "Licence valid",
};

/** True for the levels an admin should act on. `missing` is deliberately NOT
 *  one: a booking taken online has no licence yet by design, and flagging every
 *  new guest as a problem would make the flag worthless. */
export function needsLicenceAttention(level: LicenceLevel): boolean {
  return level === "expired" || level === "expires_mid_hire" || level === "expiring";
}

/**
 * Classify a licence.
 *
 * All comparisons are on 'YYYY-MM-DD' strings, which sort lexicographically and
 * never go through `new Date(...)` — see the header of ./format.ts for why a
 * bare date string must not be parsed into a local Date.
 *
 * `lastReturnDate` is the return date of the furthest-out rental this client
 * already has on the books; pass null when they have none.
 */
export function licenceLevel(
  expiry: string | null,
  today: string,
  lastReturnDate: string | null,
  warningDays = LICENCE_WARNING_DAYS,
): LicenceLevel {
  if (!expiry) return "missing";
  if (expiry < today) return "expired";
  if (lastReturnDate && expiry < lastReturnDate) return "expires_mid_hire";

  const [y, m, d] = today.split("-").map(Number);
  const horizon = new Date(Date.UTC(y, m - 1, d + warningDays)).toISOString().slice(0, 10);
  return expiry <= horizon ? "expiring" : "ok";
}

/* ── matching people to people ─────────────────────────────────────────────── */

/**
 * THE DUPLICATE PROBLEM, AND WHY IT IS THE CRM'S TO SOLVE
 *
 * There is deliberately no unique constraint on clients.email (migration 0002):
 * one address can legitimately cover several drivers — a couple, a travel agent
 * booking for clients — so a constraint would reject real bookings. And the
 * booking path REUSES an existing guest row rather than upserting, so a return
 * visitor who types a new phone number does NOT overwrite what is on file.
 *
 * Both decisions are right, and both mean the same human can end up as two rows,
 * or one row can hold details that no longer match what they last typed. The
 * database will never resolve that, and it must not: picking a winner silently
 * is how a guest's real phone number disappears. So the CRM SURFACES it — these
 * helpers find rows that look like the same person, and the client page shows
 * them side by side with the fields that differ, for a human to judge.
 *
 * Merging is deliberately not implemented here: it rewrites bookings' client_id
 * and destroys a record, which wants its own deliberate design.
 */

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only. Phone numbers are typed with spaces, dashes and country codes in
 *  whatever style the guest uses; "+599 9 512 8823" and "5995128823" are the
 *  same number and must match. */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D+/g, "");
}

/** Case- and accent-insensitive, collapsed whitespace. "José  Peña" matches
 *  "jose pena", which is what someone typing at a counter will produce. */
export function normaliseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * The tail of a phone number that has to match for two records to be a candidate
 * pair. Eight digits: enough that two unrelated guests colliding is vanishingly
 * unlikely, short enough that "+5999 512 8823" and "9512 8823" — the same
 * number with and without the country code — still find each other.
 */
const PHONE_TAIL = 8;

export function phoneTail(phone: string): string {
  const digits = normalisePhone(phone);
  return digits.length <= PHONE_TAIL ? digits : digits.slice(-PHONE_TAIL);
}

/** Why two records look like the same person. Both can be true at once. */
export interface DuplicateReason {
  email: boolean;
  phone: boolean;
}

export function duplicateReason(
  a: { email: string; phone: string },
  b: { email: string; phone: string },
): DuplicateReason | null {
  const email = normaliseEmail(a.email) === normaliseEmail(b.email);
  const aTail = phoneTail(a.phone);
  const phone = aTail.length >= PHONE_TAIL && aTail === phoneTail(b.phone);
  return email || phone ? { email, phone } : null;
}

/* ── search ────────────────────────────────────────────────────────────────── */

/**
 * Does this client match what was typed?
 *
 * Digits in the query are matched against the digits of the phone, so "5128823"
 * finds "+599 9 512 8823" — a number read off a screen never comes with the
 * same spacing it was stored with. Everything else is a normalised substring
 * match across name and email.
 */
export function matchesQuery(
  client: { fullName: string; email: string; phone: string },
  query: string,
): boolean {
  const q = query.trim();
  if (q === "") return true;

  const digits = normalisePhone(q);
  // A query that is mostly digits is a phone number, not a name: "599" should
  // not match a guest called "Bo599" but should match their number.
  if (digits.length >= 3 && digits.length >= q.replace(/\s+/g, "").length - 2) {
    if (normalisePhone(client.phone).includes(digits)) return true;
  }

  const needle = normaliseName(q);
  return (
    normaliseName(client.fullName).includes(needle) || normaliseEmail(client.email).includes(needle)
  );
}
