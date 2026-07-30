/**
 * The payments ledger — reads and writes for /admin/payments and the payments
 * panel on a booking. Service role, RLS bypassed: import ONLY from server
 * functions that have already called requireAdmin().
 *
 * NO PROVIDER IS CONTACTED FROM THIS FILE, and none can be: there is no client,
 * no credentials and no webhook, because Sentoo is blocked on a signed merchant
 * agreement. Every write here records something a human already did — cash over
 * the counter, a card machine, a bank transfer that landed. That is a real,
 * useful ledger, and it is the honest limit of what CW can claim today. See
 * PROVIDER in ./payments.
 *
 * TWO WRITES, ONE TRANSACTION-SHAPED PROBLEM
 * Recording a payment inserts a row AND updates the booking's payment_status,
 * which is derived from the rows. PostgREST has no client-side transaction, so
 * these are two calls: the insert first, then the status recomputed from a
 * re-read of the ledger. If the second fails the ledger is still right and the
 * status is merely stale — recoverable, and visible, because the payments page
 * lists exactly those disagreements. The reverse order would be worse: a status
 * claiming money that no row accounts for.
 *
 * WHAT THIS DOES NOT TOUCH: bookings.total_price. What a rental costs is the
 * quote that was struck when it was taken; the ledger records what was paid
 * against it, and the two are compared, never reconciled by editing the price.
 */
import { supabaseAdmin } from "../supabase/admin.server";
import type { BookingStatus, PaymentStatus } from "../supabase/types";
import { addDays, curacaoNow } from "./clock";
import {
  derivePaymentStatus,
  emptyLedger,
  outstandingCents,
  overpaidCents,
  reconcile,
  type LedgerTotals,
  type PaymentMethod,
} from "./payments";
import type {
  BookingLedger,
  LedgerEntry,
  PaymentWriteResult,
  PaymentsFilter,
  PaymentsOverview,
  PaymentsRow,
} from "./types";

/** A cancelled booking owes nothing and earns nothing — the same exclusion the
 *  rest of the CRM applies. Its ledger is still visible on the booking itself,
 *  because a cancelled booking that was paid and refunded is exactly the case
 *  worth being able to look up. */
const CANCELLED = "cancelled";

/** Rows the queue renders. The counts above it are the full set. */
const DISPLAY_LIMIT = 200;

/** How many recent movements the payments page lists. */
const RECENT_LIMIT = 25;

const LEDGER_SELECT = "id, booking_id, amount, method, status, provider_transaction_id, created_at";

const BOOKING_SELECT = `
  id, client_id, car_id, pickup_date, return_date, return_time,
  total_price, booking_status, payment_status, prep_status,
  cars ( model, color ),
  clients ( full_name )
`;

interface RawPayment {
  id: string;
  booking_id: string;
  amount: number;
  method: string;
  status: PaymentStatus;
  provider_transaction_id: string | null;
  created_at: string;
}

interface RawBooking {
  id: string;
  client_id: string;
  car_id: string;
  pickup_date: string;
  return_date: string;
  return_time: string;
  total_price: number;
  booking_status: BookingStatus;
  payment_status: PaymentStatus;
  prep_status: string;
  cars: { model: string; color: string } | null;
  clients: { full_name: string } | null;
}

function toEntry(raw: RawPayment): LedgerEntry {
  return {
    id: raw.id,
    bookingId: raw.booking_id,
    amountCents: raw.amount,
    method: raw.method,
    status: raw.status,
    providerTransactionId: raw.provider_transaction_id,
    createdAt: raw.created_at,
  };
}

/**
 * Total a set of rows.
 *
 * ONLY `paid` ROWS COUNT AS MONEY. A `pending` row is a transfer someone says is
 * coming; treating it as collected is how a business believes it has been paid
 * twice. It is carried separately so the screen can show it without it reaching
 * any total.
 */
function total(rows: RawPayment[]): LedgerTotals {
  const totals = emptyLedger();
  totals.entries = rows.length;

  for (const row of rows) {
    if (row.status === "pending") {
      totals.pendingCents += row.amount;
      continue;
    }
    if (row.status !== "paid") continue;

    totals.netCents += row.amount;
    if (row.amount >= 0) totals.chargedCents += row.amount;
    else totals.refundedCents += -row.amount;
  }

  return totals;
}

function toLedger(
  bookingId: string,
  totalCents: number,
  stored: PaymentStatus,
  rows: RawPayment[],
): BookingLedger {
  const totals = total(rows);
  return {
    bookingId,
    totalCents,
    netCents: totals.netCents,
    chargedCents: totals.chargedCents,
    refundedCents: totals.refundedCents,
    pendingCents: totals.pendingCents,
    outstandingCents: outstandingCents(totals, totalCents),
    overpaidCents: overpaidCents(totals, totalCents),
    derivedStatus: derivePaymentStatus(totals, totalCents),
    mismatch: reconcile(stored, totals, totalCents),
    entries: rows.map(toEntry).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/* ── one booking's ledger ──────────────────────────────────────────────────── */

export async function getBookingLedger(bookingId: string): Promise<BookingLedger | null> {
  const db = supabaseAdmin();

  const bookingRes = await db
    .from("bookings")
    .select("id, total_price, payment_status")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingRes.error)
    throw new Error(`Payments: failed to load booking: ${bookingRes.error.message}`);
  if (!bookingRes.data) return null;

  const rowsRes = await db.from("payments").select(LEDGER_SELECT).eq("booking_id", bookingId);
  if (rowsRes.error) throw new Error(`Payments: failed to load ledger: ${rowsRes.error.message}`);

  return toLedger(
    bookingRes.data.id,
    bookingRes.data.total_price,
    bookingRes.data.payment_status as PaymentStatus,
    (rowsRes.data ?? []) as unknown as RawPayment[],
  );
}

/* ── the overview ──────────────────────────────────────────────────────────── */

export async function getPaymentsOverview(filter: PaymentsFilter): Promise<PaymentsOverview> {
  const now = curacaoNow();
  const db = supabaseAdmin();

  const [bookingsRes, paymentsRes] = await Promise.all([
    db.from("bookings").select(BOOKING_SELECT).order("pickup_at", { ascending: false }),
    db.from("payments").select(LEDGER_SELECT).order("created_at", { ascending: false }),
  ]);

  if (bookingsRes.error)
    throw new Error(`Payments: failed to load bookings: ${bookingsRes.error.message}`);
  if (paymentsRes.error)
    throw new Error(`Payments: failed to load the ledger: ${paymentsRes.error.message}`);

  const bookings = (bookingsRes.data ?? []) as unknown as RawBooking[];
  const payments = (paymentsRes.data ?? []) as unknown as RawPayment[];

  const byBooking = new Map<string, RawPayment[]>();
  for (const row of payments) {
    const list = byBooking.get(row.booking_id);
    if (list) list.push(row);
    else byBooking.set(row.booking_id, [row]);
  }

  const refByBooking = new Map<string, { ref: string; clientName: string }>();

  const all: PaymentsRow[] = bookings.map((b) => {
    const rows = byBooking.get(b.id) ?? [];
    const totals = total(rows);
    const derived = derivePaymentStatus(totals, b.total_price);

    refByBooking.set(b.id, {
      ref: b.id.slice(0, 8),
      clientName: b.clients?.full_name ?? "Unknown guest",
    });

    return {
      bookingId: b.id,
      ref: b.id.slice(0, 8),
      clientId: b.client_id,
      clientName: b.clients?.full_name ?? "Unknown guest",
      carLabel: b.cars ? `${b.cars.model} · ${b.cars.color}` : "Unknown car",
      pickupDate: b.pickup_date,
      returnDate: b.return_date,
      bookingStatus: b.booking_status,
      storedStatus: b.payment_status,
      derivedStatus: derived,
      totalCents: b.total_price,
      netCents: totals.netCents,
      outstandingCents:
        b.booking_status === CANCELLED ? 0 : outstandingCents(totals, b.total_price),
      entries: rows.length,
      mismatch: reconcile(b.payment_status, totals, b.total_price),
      isOpen:
        b.booking_status !== CANCELLED &&
        (`${b.return_date}T${b.return_time}` > now.timestamp || b.prep_status === "out"),
    };
  });

  const isOutstanding = (r: PaymentsRow) => r.bookingStatus !== CANCELLED && r.outstandingCents > 0;

  const counts = {
    all: all.length,
    outstanding: all.filter(isOutstanding).length,
    paid: all.filter((r) => r.derivedStatus === "paid").length,
    refunded: all.filter((r) => r.derivedStatus === "refunded").length,
    mismatched: all.filter((r) => r.mismatch !== null).length,
  };

  const matched = all.filter((r) => {
    if (filter === "outstanding") return isOutstanding(r);
    if (filter === "paid") return r.derivedStatus === "paid";
    if (filter === "refunded") return r.derivedStatus === "refunded";
    if (filter === "mismatched") return r.mismatch !== null;
    return true;
  });

  // Money owed on a car that is already out beats money owed on a booking in
  // November, so open rentals sort first and then by soonest pickup.
  matched.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    return a.pickupDate.localeCompare(b.pickupDate);
  });

  // Takings are bucketed on when the MONEY moved, which is not the basis the
  // dashboard uses (a booking's whole value on its pickup date). Both are right
  // for their own question and both are labelled; they are not meant to agree.
  const monthStart = now.monthStart;
  const nextMonthStart = now.nextMonthStart;
  const todayStart = `${now.today}T00:00:00`;
  const tomorrowStart = `${addDays(now.today, 1)}T00:00:00`;

  let todayCents = 0;
  let monthCents = 0;
  let allTimeCents = 0;
  let refundedMonthCents = 0;

  for (const row of payments) {
    if (row.status !== "paid") continue;
    // created_at is a timestamptz; compare Curaçao wall-clock days by shifting
    // the instant, the same way toCuracaoDateKey does for the dashboard.
    const wall = new Date(new Date(row.created_at).getTime() - 4 * 3_600_000)
      .toISOString()
      .slice(0, 19);

    allTimeCents += row.amount;
    if (wall >= todayStart && wall < tomorrowStart) todayCents += row.amount;
    if (wall.slice(0, 10) >= monthStart && wall.slice(0, 10) < nextMonthStart) {
      monthCents += row.amount;
      if (row.amount < 0) refundedMonthCents += -row.amount;
    }
  }

  return {
    today: now.today,
    monthLabel: now.monthLabel,
    filter,
    rows: matched.slice(0, DISPLAY_LIMIT),
    total: matched.length,
    truncated: matched.length > DISPLAY_LIMIT,
    counts,
    takings: {
      todayCents,
      monthCents,
      allTimeCents,
      refundedMonthCents,
      outstandingCents: all.filter(isOutstanding).reduce((sum, r) => sum + r.outstandingCents, 0),
    },
    recent: payments.slice(0, RECENT_LIMIT).map((row) => ({
      ...toEntry(row),
      ref: refByBooking.get(row.booking_id)?.ref ?? row.booking_id.slice(0, 8),
      clientName: refByBooking.get(row.booking_id)?.clientName ?? "Unknown guest",
    })),
  };
}

/* ── writes ────────────────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nobody hands over more than this in cash at a rental counter; a bigger number
 *  is a decimal point in the wrong place. The form takes dollars and converts. */
const MAX_ENTRY_CENTS = 20_000_00;

/**
 * Record money that has already changed hands.
 *
 * `direction` decides the sign, and the caller states it explicitly rather than
 * passing a negative number: a form that lets someone type "-300" into an amount
 * box will eventually have someone type it by accident.
 */
export async function recordPayment(input: {
  bookingId: string;
  amountCents: number;
  method: PaymentMethod;
  direction: "charge" | "refund";
  /** A transfer said to be on its way, not money that has arrived. */
  pending?: boolean;
}): Promise<PaymentWriteResult> {
  if (!UUID_RE.test(input.bookingId)) {
    return { ok: false, reason: "not_found", message: "That booking no longer exists." };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: "invalid", message: "Enter an amount greater than zero." };
  }
  if (input.amountCents > MAX_ENTRY_CENTS) {
    return {
      ok: false,
      reason: "invalid",
      message: `That is over $${MAX_ENTRY_CENTS / 100}. Check the amount.`,
    };
  }

  const db = supabaseAdmin();
  const bookingRes = await db
    .from("bookings")
    .select("id, total_price, payment_status")
    .eq("id", input.bookingId)
    .maybeSingle();
  if (bookingRes.error)
    throw new Error(`Payments: failed to read booking: ${bookingRes.error.message}`);
  if (!bookingRes.data) {
    return { ok: false, reason: "not_found", message: "That booking no longer exists." };
  }

  // A refund bigger than what was actually taken is almost always a typo, and
  // the ledger is the one place a typo becomes a number someone reports to a
  // tax office. Refusing is cheap; a negative net take is not.
  if (input.direction === "refund") {
    const existing = await db
      .from("payments")
      .select(LEDGER_SELECT)
      .eq("booking_id", input.bookingId);
    if (existing.error)
      throw new Error(`Payments: failed to read ledger: ${existing.error.message}`);
    const totals = total((existing.data ?? []) as unknown as RawPayment[]);
    if (input.amountCents > totals.netCents) {
      return {
        ok: false,
        reason: "invalid",
        message:
          totals.netCents <= 0
            ? "Nothing has been collected on this booking, so there is nothing to refund."
            : `That is more than the $${(totals.netCents / 100).toFixed(2)} collected on this booking.`,
      };
    }
  }

  const { error: insertError } = await db.from("payments").insert({
    booking_id: input.bookingId,
    amount: input.direction === "refund" ? -input.amountCents : input.amountCents,
    method: input.method,
    status: input.pending ? "pending" : "paid",
    // Always null: a value here would claim a provider processed this, and none
    // did. The Sentoo integration sets it when it exists.
    provider_transaction_id: null,
  });
  if (insertError) throw new Error(`Payments: failed to record: ${insertError.message}`);

  return { ok: true, ledger: await syncBookingPaymentStatus(input.bookingId) };
}

/**
 * Recompute a booking's payment_status from its ledger and write it back.
 *
 * Exported because it is also the repair action for a mismatch: an admin who
 * decides the ledger is right can make the booking agree with it in one click,
 * rather than the CRM deciding that for them at read time.
 */
export async function syncBookingPaymentStatus(bookingId: string): Promise<BookingLedger> {
  const db = supabaseAdmin();

  const [bookingRes, rowsRes] = await Promise.all([
    db.from("bookings").select("id, total_price, payment_status").eq("id", bookingId).single(),
    db.from("payments").select(LEDGER_SELECT).eq("booking_id", bookingId),
  ]);
  if (bookingRes.error)
    throw new Error(`Payments: failed to read booking: ${bookingRes.error.message}`);
  if (rowsRes.error) throw new Error(`Payments: failed to read ledger: ${rowsRes.error.message}`);

  const rows = (rowsRes.data ?? []) as unknown as RawPayment[];
  const derived = derivePaymentStatus(total(rows), bookingRes.data.total_price);

  if (derived !== bookingRes.data.payment_status) {
    const { error } = await db
      .from("bookings")
      .update({ payment_status: derived })
      .eq("id", bookingId);
    if (error) throw new Error(`Payments: failed to update the booking: ${error.message}`);
  }

  return toLedger(bookingId, bookingRes.data.total_price, derived, rows);
}
