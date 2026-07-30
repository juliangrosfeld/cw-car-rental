/**
 * Recording money against a booking.
 *
 * WHAT THIS IS AND IS NOT. Every control here writes a row saying what already
 * happened — cash taken at the counter, a card put through the machine, a
 * transfer that landed, a refund handed back. None of it moves money, because
 * Sentoo is not connected (see PROVIDER in src/lib/admin/payments.ts). The
 * screen says so rather than leaving an operator to discover it, and the one
 * control that WOULD talk to a provider is rendered disabled with the reason on
 * it, instead of being hidden and quietly forgotten.
 *
 * The sign of an amount is never typed. Charge and refund are separate actions,
 * so a mistyped minus cannot become a refund.
 */
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { recordBookingPayment, syncBookingPayment } from "../../lib/api/admin.functions";
import {
  METHOD_LABEL,
  PAYMENT_METHODS,
  PROVIDER,
  type PaymentMethod,
} from "../../lib/admin/payments";
import { formatInstant, formatMoneyExact } from "../../lib/admin/format";
import type { BookingLedger } from "../../lib/admin/types";
import { Button, StatusPill } from "./ui";

/* ── the ledger, as a list ─────────────────────────────────────────────────── */

export function LedgerEntries({ ledger }: { ledger: BookingLedger }) {
  if (ledger.entries.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-cw-ink/45">
        Nothing recorded against this booking yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-cw-navy/8">
      {ledger.entries.map((entry) => {
        const refund = entry.amountCents < 0;
        return (
          <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <span
                className={`text-[13px] font-semibold tabular-nums ${
                  refund ? "text-[#b3261e]" : "text-cw-navy"
                }`}
              >
                {refund ? "−" : "+"}
                {formatMoneyExact(Math.abs(entry.amountCents))}
              </span>
              <span className="ml-2 text-[12px] text-cw-ink/60">
                {METHOD_LABEL[entry.method as PaymentMethod] ?? entry.method}
                {refund ? " refund" : ""}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {entry.status !== "paid" && <StatusPill value={entry.status} title="Entry status" />}
              <span className="text-[11px] text-cw-ink/45">{formatInstant(entry.createdAt)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── recording ─────────────────────────────────────────────────────────────── */

export function RecordPayment({ ledger }: { ledger: BookingLedger }) {
  const router = useRouter();

  const [direction, setDirection] = useState<"charge" | "refund">("charge");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const inputClass =
    "rounded-lg border border-cw-navy/15 bg-white px-3 py-2 text-[13px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20";

  async function submit() {
    if (busy) return;

    // Parsed here so a typo never becomes a ledger row. Cents are integers by
    // the time they cross the wire — see the money rule in ./format.
    const dollars = Number(amount.trim());
    if (amount.trim() === "" || !Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter an amount in dollars, e.g. 150 or 82.50.");
      return;
    }

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await recordBookingPayment({
        data: {
          bookingId: ledger.bookingId,
          amountCents: Math.round(dollars * 100),
          method,
          direction,
          pending: direction === "charge" ? pending : false,
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await router.invalidate();
      setAmount("");
      setPending(false);
      setDone(
        direction === "refund"
          ? "Refund recorded. No money was moved by this — hand it back the same way it came in."
          : "Payment recorded.",
      );
    } catch (cause) {
      console.error(cause);
      setError("Could not record that. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const outstanding = ledger.outstandingCents;

  return (
    <div className="border-t border-cw-navy/8 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["charge", "refund"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setDirection(option);
              setError(null);
              setDone(null);
            }}
            aria-pressed={direction === option}
            className={`rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              direction === option
                ? option === "refund"
                  ? "border-[#b3261e]/40 bg-[#fdecec] text-[#b3261e]"
                  : "border-cw-teal bg-cw-teal-soft text-cw-teal-dark"
                : "border-cw-navy/12 bg-white text-cw-ink/60 hover:border-cw-teal hover:text-cw-teal"
            }`}
          >
            {option === "charge" ? "Money in" : "Refund"}
          </button>
        ))}

        {direction === "charge" && outstanding > 0 && (
          <button
            type="button"
            onClick={() => setAmount((outstanding / 100).toFixed(2))}
            className="text-[12px] font-semibold text-cw-teal underline underline-offset-2"
          >
            Fill the balance ({formatMoneyExact(outstanding)})
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Amount
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold text-cw-ink/60">$</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setDone(null);
              }}
              placeholder="0.00"
              aria-label={direction === "refund" ? "Refund amount" : "Payment amount"}
              className={`w-[120px] ${inputClass}`}
            />
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            {direction === "refund" ? "Returned by" : "Method"}
          </span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            aria-label="Payment method"
            className={inputClass}
          >
            {PAYMENT_METHODS.map((option) => (
              <option key={option} value={option}>
                {METHOD_LABEL[option]}
              </option>
            ))}
          </select>
        </label>

        {direction === "charge" && (
          <label className="flex items-center gap-2 pb-2 text-[12px] text-cw-ink/70">
            <input
              type="checkbox"
              checked={pending}
              onChange={(e) => setPending(e.target.checked)}
              className="h-4 w-4 rounded border-cw-navy/25"
            />
            Not arrived yet
          </label>
        )}

        <Button
          variant={direction === "refund" ? "danger" : "primary"}
          disabled={busy}
          onClick={submit}
        >
          {busy ? "Recording…" : direction === "refund" ? "Record refund" : "Record payment"}
        </Button>
      </div>

      {/* A pending row is deliberately excluded from every total; say so where
          the box is, not in a footnote. */}
      {direction === "charge" && pending && (
        <p className="mt-2 text-[12px] text-cw-ink/60">
          Recorded as expected, not collected — it will not count towards takings until you mark it
          arrived by recording it again without this ticked.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-[#fdecec] px-2.5 py-1.5 text-[12px] text-[#b3261e]"
        >
          {error}
        </p>
      )}
      {done && <p className="mt-2 text-[12px] text-[#1a7a45]">{done}</p>}

      {/* ── the provider that is not connected ────────────────────────────── */}
      <div className="mt-3 rounded-lg border border-cw-navy/10 bg-cw-navy/[0.03] px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-cw-navy">
            Refund to card via {PROVIDER.name}
          </span>
          <button
            type="button"
            disabled
            title={`${PROVIDER.name} is not connected — blocked on ${PROVIDER.blockedOn}`}
            className="cursor-not-allowed rounded-lg border border-cw-navy/15 bg-white px-3 py-1.5 font-display text-[13px] font-bold text-cw-ink/35"
          >
            Not connected
          </button>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-cw-ink/60">{PROVIDER.explain}</p>
      </div>
    </div>
  );
}

/* ── repairing a mismatch ──────────────────────────────────────────────────── */

/**
 * Make the booking's stored status agree with its ledger.
 *
 * Offered as a button rather than done automatically at read time: the stored
 * status might be the true one — a payment taken before this ledger existed —
 * and in that case the fix is to record the payment, not to overwrite the
 * status. Both options are put in front of the admin with the numbers behind
 * them.
 */
export function FixMismatch({ ledger }: { ledger: BookingLedger }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!ledger.mismatch) return null;

  return (
    <div className="border-t border-cw-navy/8 bg-cw-yellow-soft/60 px-4 py-3">
      <p className="text-[12px] leading-relaxed text-[#8a6a04]">
        <span className="font-semibold">This booking&rsquo;s status and its ledger disagree.</span>{" "}
        {ledger.mismatch.reason} Either record the payment that actually happened, or set the status
        to match what is recorded here.
      </p>
      <Button
        className="mt-2"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await syncBookingPayment({ data: { bookingId: ledger.bookingId } });
            await router.invalidate();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : `Set status to "${ledger.mismatch.derived}"`}
      </Button>
    </div>
  );
}
