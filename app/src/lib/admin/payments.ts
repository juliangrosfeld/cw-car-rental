/**
 * Money rules. Pure, isomorphic, no I/O — the ledger writer and the payments
 * pages both read from here, so "paid" means the same thing in a query as it
 * does on a badge.
 *
 * THE LEDGER MODEL, IN FOUR SENTENCES
 * A `payments` row records a MOVEMENT of money that has already happened. A
 * charge is positive, a refund is the same row type with a negative amount — a
 * refund is never a deletion, so what was taken and what was given back both
 * stay on the record and `sum(amount)` is the net take. A booking's
 * `payment_status` is DERIVED from that sum rather than typed by hand, so the
 * status and the ledger cannot disagree. Nothing here talks to a payment
 * provider: every row is something a human did at a counter or a bank, which is
 * exactly what CW can honestly claim today.
 *
 * WHY A REFUND IS NOT A DELETED PAYMENT
 * Editing away a $300 charge and editing away a $300 refund produce the same
 * empty ledger and mean opposite things — one is a booking that never paid, the
 * other is a booking that paid and was made whole. Signed rows keep the
 * difference, which is what an accountant and a chargeback dispute both need.
 */
import type { PaymentStatus } from "../supabase/types";

/* ── how money actually arrives ────────────────────────────────────────────── */

/**
 * The methods an admin can record. `stripe` from the original schema comment is
 * deliberately absent: no provider is connected, and offering a method the
 * system cannot actually process would put a lie in the ledger.
 */
export const PAYMENT_METHODS = ["cash", "card", "bank_transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/* ── the provider that is not connected yet ────────────────────────────────── */

/**
 * SENTOO IS NOT INTEGRATED. It is blocked on Clay's signed merchant agreement,
 * so there is no API call to make and no credentials to make it with.
 *
 * This constant exists so the UI can say that in one place instead of five, and
 * so nothing accidentally grows a code path that pretends to reach a provider.
 * When the agreement lands, an integration adds a real client, writes rows with
 * `provider_transaction_id` set, and deletes this block — it does not repurpose
 * the manual path below, which will still be needed for cash at the counter.
 */
export const PROVIDER = {
  name: "Sentoo",
  connected: false,
  blockedOn: "Clay's signed merchant agreement",
  /** Shown wherever an online refund or charge would otherwise be offered. */
  explain:
    "Sentoo is not connected yet — it is waiting on the signed merchant agreement. " +
    "Nothing on this screen can move money through a provider. Recording a payment " +
    "or a refund here is bookkeeping: it says what already happened at the counter " +
    "or in the bank.",
} as const;

/* ── deriving a booking's payment status ───────────────────────────────────── */

/** What the ledger says about one booking. */
export interface LedgerTotals {
  /** Sum of settled rows, charges minus refunds. Can be negative in the pathological
   *  case of refunding more than was taken, which is worth seeing, not hiding. */
  netCents: number;
  /** Settled money in. */
  chargedCents: number;
  /** Settled money out, as a positive number. */
  refundedCents: number;
  /** Rows recorded but not confirmed — a transfer said to be on its way. Never
   *  counted as collected; the whole point of the status is that it has not
   *  arrived. */
  pendingCents: number;
  entries: number;
}

export function emptyLedger(): LedgerTotals {
  return { netCents: 0, chargedCents: 0, refundedCents: 0, pendingCents: 0, entries: 0 };
}

/**
 * The booking's payment status, from its ledger and its price.
 *
 * ORDER MATTERS. A booking that took money and gave all of it back is
 * `refunded`, not `unpaid` — the two look identical if you only compare a total
 * against zero, and telling them apart is the entire reason refunds are signed
 * rows. `pending` is used for a genuine part payment (a deposit against a
 * balance still to come), which is the shape almost every CW booking takes.
 */
export function derivePaymentStatus(ledger: LedgerTotals, totalCents: number): PaymentStatus {
  if (ledger.refundedCents > 0 && ledger.netCents <= 0) return "refunded";
  if (ledger.netCents >= totalCents && totalCents > 0) return "paid";
  if (ledger.netCents > 0) return "pending";
  return "unpaid";
}

/** What is still owed. Never negative: an overpayment is not a debt, and it is
 *  surfaced separately rather than as a negative outstanding figure. */
export function outstandingCents(ledger: LedgerTotals, totalCents: number): number {
  return Math.max(0, totalCents - ledger.netCents);
}

/** Paid more than the booking is worth — a double-charged card, or a price
 *  reduced after payment. Rare, and always worth a human looking. */
export function overpaidCents(ledger: LedgerTotals, totalCents: number): number {
  return Math.max(0, ledger.netCents - totalCents);
}

/* ── reconciliation ────────────────────────────────────────────────────────── */

/**
 * Does the booking's stored status agree with its ledger?
 *
 * These can disagree for one honest reason: a booking taken before this ledger
 * existed, or set by hand, carries a `payment_status` with no rows behind it.
 * That is not corruption and it is not fixed silently — the payments page lists
 * them so an admin can either record the payment that actually happened or
 * correct the status deliberately.
 */
export interface Mismatch {
  stored: PaymentStatus;
  derived: PaymentStatus;
  reason: string;
}

export function reconcile(
  stored: PaymentStatus,
  ledger: LedgerTotals,
  totalCents: number,
): Mismatch | null {
  const derived = derivePaymentStatus(ledger, totalCents);
  if (stored === derived) return null;

  const reason =
    ledger.entries === 0
      ? `Marked "${stored.replace(/_/g, " ")}" with nothing recorded against it.`
      : `Marked "${stored.replace(/_/g, " ")}", but the ledger adds up to "${derived}".`;

  return { stored, derived, reason };
}
