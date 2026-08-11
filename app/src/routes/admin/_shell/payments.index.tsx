/**
 * /admin/payments — what has been taken, what is owed, and the ledger behind it.
 *
 * THE DEFAULT VIEW IS WHAT IS OWED, not what has been collected. Money already
 * in the till does not need looking at; a car going out on Friday with XCG 400
 * unpaid does.
 *
 * TWO MONEY BASES ON ONE SCREEN, LABELLED
 * The figures here are bucketed on when the MONEY MOVED (the ledger's own
 * timestamps). The dashboard buckets a booking's whole value on its PICKUP date.
 * Neither is wrong and they will not agree — a deposit taken in June for an
 * August rental is June money here and August money there — so each says what it
 * counts, the same discipline the dashboard's two revenue cards use.
 *
 * NOTHING ON THIS PAGE MOVES MONEY. Sentoo is not connected (blocked on the
 * signed merchant agreement), so every row is a record of something that already
 * happened at the counter or in the bank. The page says so where it matters
 * rather than leaving it to be discovered.
 */
import { createFileRoute, Link } from "@tanstack/react-router";

import AdminShell from "../../../components/admin/shell";
import { EmptyState, Panel, Stat, StatusPill, Td, Th } from "../../../components/admin/ui";
import { fetchAdminPayments } from "../../../lib/api/admin.functions";
import { METHOD_LABEL, PROVIDER, type PaymentMethod } from "../../../lib/admin/payments";
import {
  formatDateShort,
  formatInstant,
  formatMoney,
  formatMoneyExact,
} from "../../../lib/admin/format";
import type { PaymentsFilter } from "../../../lib/admin/types";

const FILTERS = ["outstanding", "paid", "refunded", "mismatched", "all"] as const;

const FILTER_LABEL: Record<PaymentsFilter, string> = {
  outstanding: "Owed",
  paid: "Settled",
  refunded: "Refunded",
  mismatched: "Needs reconciling",
  all: "Every booking",
};

interface PaymentsSearch {
  /** Absent means the owed queue — the default this page exists for. */
  filter?: Exclude<PaymentsFilter, "outstanding">;
}

export const Route = createFileRoute("/admin/_shell/payments/")({
  validateSearch: (search: Record<string, unknown>): PaymentsSearch => ({
    filter: FILTERS.includes(search.filter as PaymentsFilter)
      ? (search.filter as Exclude<PaymentsFilter, "outstanding">)
      : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => fetchAdminPayments({ data: { filter: deps.filter ?? null } }),
  head: () => ({ meta: [{ title: "Payments | CW back office" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const { admin, payments } = Route.useLoaderData();
  const { takings, counts } = payments;

  return (
    <AdminShell
      admin={admin}
      title="Payments"
      subtitle={`${formatMoney(takings.outstandingCents)} outstanding · ${
        counts.outstanding
      } ${counts.outstanding === 1 ? "booking" : "bookings"} still to collect on`}
    >
      {/* The provider notice sits at the top of the money screen, once, where
          nobody can miss it and nothing has to repeat it. */}
      <div className="mb-3 rounded-lg border border-cw-navy/10 bg-cw-navy/[0.03] px-3 py-2.5 text-[12px] leading-relaxed text-cw-ink/70">
        <span className="font-semibold text-cw-navy">
          {PROVIDER.name} is not connected — waiting on {PROVIDER.blockedOn}.
        </span>{" "}
        This ledger records what has already changed hands at the counter or in the bank. No screen
        in the back office can charge or refund a card until that integration exists.
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Outstanding"
          value={formatMoney(takings.outstandingCents)}
          hint="Owed across live bookings"
          emphasis
        />
        <Stat
          label="Taken today"
          value={formatMoney(takings.todayCents)}
          hint="By the date money moved"
        />
        <Stat
          label={`Taken in ${payments.monthLabel.split(" ")[0]}`}
          value={formatMoney(takings.monthCents)}
          hint={
            takings.refundedMonthCents > 0
              ? `Net of ${formatMoney(takings.refundedMonthCents)} refunded`
              : "Net of refunds"
          }
        />
        <Stat
          label="Taken all time"
          value={formatMoney(takings.allTimeCents)}
          hint="Every settled entry"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ── the queue ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Panel
            title="Bookings"
            subtitle={subtitleFor(payments.filter, payments.total)}
            action={
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((filter) => (
                  <Link
                    key={filter}
                    to="/admin/payments"
                    search={{ filter: filter === "outstanding" ? undefined : filter }}
                    className={`rounded-lg border px-2 py-1 text-[12px] font-semibold transition-colors ${
                      payments.filter === filter
                        ? "border-cw-teal bg-cw-teal-soft text-cw-teal-dark"
                        : "border-cw-navy/12 bg-white text-cw-ink/60 hover:border-cw-teal hover:text-cw-teal"
                    }`}
                  >
                    {FILTER_LABEL[filter]}{" "}
                    <span className="tabular-nums opacity-70">{counts[filter]}</span>
                  </Link>
                ))}
              </div>
            }
          >
            {payments.rows.length === 0 ? (
              <EmptyState>
                {payments.filter === "outstanding"
                  ? "Nothing outstanding. Every live booking is paid up."
                  : payments.filter === "mismatched"
                    ? "Every booking's status agrees with its ledger."
                    : "Nothing here."}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead className="border-b border-cw-navy/8">
                    <tr>
                      <Th>Booking</Th>
                      <Th>Dates</Th>
                      <Th align="right">Total</Th>
                      <Th align="right">Collected</Th>
                      <Th align="right">Owed</Th>
                      <Th align="right">Status</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cw-navy/8">
                    {payments.rows.map((row) => (
                      <tr key={row.bookingId} className="hover:bg-cw-teal-soft/25">
                        <Td>
                          <Link
                            to="/admin/bookings/$bookingId"
                            params={{ bookingId: row.bookingId }}
                            className="font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                          >
                            {row.clientName}
                          </Link>
                          {row.isOpen && (
                            <span className="ml-2 rounded-md bg-cw-peach-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[#a3572a]">
                              Live
                            </span>
                          )}
                          <span className="block text-[11px] text-cw-ink/45">
                            {row.ref} · {row.carLabel}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap text-cw-ink/70">
                          {formatDateShort(row.pickupDate)} → {formatDateShort(row.returnDate)}
                        </Td>
                        <Td align="right" className="text-cw-ink/70">
                          {formatMoney(row.totalCents)}
                        </Td>
                        <Td align="right" className="font-semibold text-cw-navy">
                          {formatMoney(row.netCents)}
                          <span className="block text-[11px] font-normal text-cw-ink/45">
                            {row.entries === 0
                              ? "no entries"
                              : `${row.entries} ${row.entries === 1 ? "entry" : "entries"}`}
                          </span>
                        </Td>
                        <Td
                          align="right"
                          className={
                            row.outstandingCents > 0
                              ? "font-semibold text-[#b3261e]"
                              : "text-cw-ink/35"
                          }
                        >
                          {row.outstandingCents > 0 ? formatMoney(row.outstandingCents) : "—"}
                        </Td>
                        <Td align="right">
                          <span className="inline-flex flex-col items-end gap-1">
                            <StatusPill value={row.derivedStatus} title="From the ledger" />
                            {row.mismatch && (
                              <span
                                className="rounded-md bg-cw-yellow-soft px-1.5 py-0.5 text-[10px] font-semibold text-[#8a6a04]"
                                title={row.mismatch.reason}
                              >
                                stored: {row.mismatch.stored}
                              </span>
                            )}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* ── the ledger ─────────────────────────────────────────────────── */}
        <Panel
          title="Recent movements"
          subtitle="Newest first, across every booking"
          className="lg:self-start"
        >
          {payments.recent.length === 0 ? (
            <EmptyState>Nothing recorded yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-cw-navy/8">
              {payments.recent.map((entry) => {
                const refund = entry.amountCents < 0;
                return (
                  <li key={entry.id} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`text-[13px] font-semibold tabular-nums ${
                          refund ? "text-[#b3261e]" : "text-cw-navy"
                        }`}
                      >
                        {refund ? "−" : "+"}
                        {formatMoneyExact(Math.abs(entry.amountCents))}
                      </span>
                      <span className="text-[11px] text-cw-ink/45">
                        {formatInstant(entry.createdAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-2">
                      <Link
                        to="/admin/bookings/$bookingId"
                        params={{ bookingId: entry.bookingId }}
                        className="truncate text-[12px] text-cw-ink/70 underline-offset-2 hover:text-cw-teal hover:underline"
                      >
                        {entry.clientName}
                      </Link>
                      <span className="shrink-0 text-[11px] text-cw-ink/50">
                        {METHOD_LABEL[entry.method as PaymentMethod] ?? entry.method}
                        {entry.status !== "paid" && ` · ${entry.status}`}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-cw-navy/8 px-4 py-2 text-[11px] leading-relaxed text-cw-ink/50">
            A refund is a negative entry, never a deleted one — what was taken and what was given
            back both stay on the record.
          </p>
        </Panel>
      </div>
    </AdminShell>
  );
}

function subtitleFor(filter: PaymentsFilter, total: number): string {
  const noun = total === 1 ? "booking" : "bookings";
  if (filter === "outstanding")
    return `${total} ${noun} with money still to collect, live rentals first`;
  if (filter === "mismatched")
    return `${total} ${noun} whose stored status disagrees with the ledger`;
  if (filter === "paid") return `${total} ${noun} settled in full`;
  if (filter === "refunded") return `${total} ${noun} refunded`;
  return `${total} ${noun}`;
}
