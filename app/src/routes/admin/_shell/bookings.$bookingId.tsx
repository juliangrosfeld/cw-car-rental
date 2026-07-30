/**
 * /admin/bookings/:id — one booking, in full.
 *
 * This is the page Clay opens with a guest on the phone, so it is ordered by what
 * gets asked: the pipeline and the handover facts first, the guest's details next,
 * money after that, and the two notes fields last.
 *
 * TWO NOTES FIELDS, AND THE DIFFERENCE MATTERS
 *   special_requests  the GUEST wrote it. Read-only here — this page is not
 *                     where a customer's own words get edited — and safe to read
 *                     back to them.
 *   admin_notes       INTERNAL. Editable here, and the only place in the app that
 *                     writes it. Never echo it to a guest: it is where "damage on
 *                     the rear bumper, photographed at handover" lives.
 *
 * Everything on this page arrives from `fetchAdminBooking`, which runs
 * requireAdmin() before it touches the database. A deep link from someone without
 * a session is redirected to the login page by that call, not by this file.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { PrepAdvanceButton, PrepPipeline } from "../../../components/admin/prep-controls";
import AdminShell from "../../../components/admin/shell";
import { Button, Field, Panel, StatusPill } from "../../../components/admin/ui";
import {
  FixMismatch,
  LedgerEntries,
  RecordPayment,
} from "../../../components/admin/payment-controls";
import {
  fetchAdminBooking,
  fetchBookingLedger,
  updateBookingAdminNotes,
} from "../../../lib/api/admin.functions";
import {
  formatDate,
  formatDateLong,
  formatInstant,
  formatMoney,
  formatMoneyExact,
  formatTime,
} from "../../../lib/admin/format";
import type { BookingDetail } from "../../../lib/admin/types";

export const Route = createFileRoute("/admin/_shell/bookings/$bookingId")({
  // Two round trips, deliberately: the ledger is a separate aggregate over a
  // separate table, and keeping it separate is what lets the payments panel
  // redraw after a write without re-reading the whole booking.
  loader: async ({ params }) => {
    const [booking, ledger] = await Promise.all([
      fetchAdminBooking({ data: { bookingId: params.bookingId } }),
      fetchBookingLedger({ data: { bookingId: params.bookingId } }),
    ]);
    return { ...booking, ledger: ledger.ledger };
  },
  head: () => ({ meta: [{ title: "Booking | CW back office" }] }),
  component: BookingDetailPage,
});

function BookingDetailPage() {
  const { admin, booking, ledger } = Route.useLoaderData();
  const [notice, setNotice] = useState<string | null>(null);

  // A booking can legitimately be missing: a bookmarked link to something that
  // was deleted, or a mistyped id. Say so and offer the way back rather than
  // rendering a page of em dashes.
  if (!booking) {
    return (
      <AdminShell admin={admin} title="Booking not found">
        <Panel>
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-cw-ink/60">
              That booking does not exist. It may have been deleted.
            </p>
            <Link
              to="/admin/bookings"
              className="mt-3 inline-block text-[13px] font-semibold text-cw-teal underline underline-offset-2"
            >
              Back to bookings
            </Link>
          </div>
        </Panel>
      </AdminShell>
    );
  }

  const rateChanged = booking.quotedPerDayCents !== booking.car.dailyRateCents;

  return (
    <AdminShell
      admin={admin}
      title={booking.client.fullName}
      subtitle={`${booking.car.label} · ${formatDate(booking.pickupDate)} → ${formatDate(
        booking.returnDate,
      )} · ref ${booking.ref}`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/admin/bookings"
            className="rounded-lg border border-cw-navy/15 bg-white px-3 py-1.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal"
          >
            ‹ All bookings
          </Link>
          <PrepAdvanceButton
            bookingId={booking.id}
            prepStatus={booking.prepStatus}
            bookingStatus={booking.bookingStatus}
            size="md"
            variant="primary"
            onNotice={setNotice}
          />
        </div>
      }
    >
      {notice && (
        <div
          role="alert"
          className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-cw-yellow-soft px-3 py-2 text-[13px] text-[#8a6a04]"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 font-semibold underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── the pipeline ─────────────────────────────────────────────────── */}
      <Panel
        title="Prep status"
        subtitle="One tap moves it on. Any step can be set — a car found dirty goes back."
        action={
          <span className="flex flex-wrap justify-end gap-1">
            <StatusPill value={booking.bookingStatus} title="Booking status" />
            <StatusPill value={booking.paymentStatus} title="Payment status" />
          </span>
        }
      >
        <div className="px-4 py-3.5">
          <PrepPipeline
            bookingId={booking.id}
            prepStatus={booking.prepStatus}
            bookingStatus={booking.bookingStatus}
            onNotice={setNotice}
          />
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ── handover ───────────────────────────────────────────────────── */}
        <Panel className="lg:col-span-2" title="Handover">
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            <div className="rounded-lg bg-cw-teal-soft/50 px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-cw-teal-dark">
                Pickup
              </p>
              <p className="mt-1 font-display text-[15px] font-extrabold text-cw-navy">
                {formatDateLong(booking.pickupDate)}, {formatTime(booking.pickupTime)}
              </p>
              <p className="mt-0.5 text-[13px] text-cw-ink/70">{booking.pickupLocation}</p>
            </div>
            <div className="rounded-lg bg-cw-peach-soft/60 px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#a3572a]">
                Return
              </p>
              <p className="mt-1 font-display text-[15px] font-extrabold text-cw-navy">
                {formatDateLong(booking.returnDate)}, {formatTime(booking.returnTime)}
              </p>
              <p className="mt-0.5 text-[13px] text-cw-ink/70">{booking.returnLocation}</p>
            </div>

            <Field
              label="Flight"
              value={booking.flightNumber}
              hint={
                booking.flightNumber
                  ? "Check the arrival before leaving for the airport"
                  : undefined
              }
            />
            <Field
              label="Length"
              value={`${booking.days} ${booking.days === 1 ? "day" : "days"}`}
              mono
            />
            <Field label="Car" value={booking.car.label} />
            <Field
              label="Car detail"
              value={`${booking.car.category} · ${booking.car.transmission} · ${booking.car.seats} seats`}
            />
          </div>
        </Panel>

        {/* ── money ──────────────────────────────────────────────────────── */}
        <Panel title="Money" className="lg:self-start">
          <div className="px-4 py-4">
            <p className="font-display text-[30px] font-extrabold leading-none tabular-nums tracking-tight text-cw-navy">
              {formatMoneyExact(booking.totalCents)}
            </p>
            <p className="mt-1 text-[12px] text-cw-ink/55">
              {formatMoney(booking.quotedPerDayCents)} × {booking.days}{" "}
              {booking.days === 1 ? "day" : "days"}, quoted when the booking was taken
            </p>

            {/* The total is what was agreed and is never recomputed. If the car's
                rate has moved since, say so plainly instead of silently showing a
                per-day figure that does not match today's price list. */}
            {rateChanged && (
              <p className="mt-2 rounded-lg bg-cw-yellow-soft px-2.5 py-1.5 text-[12px] text-[#8a6a04]">
                This car now rents at {formatMoney(booking.car.dailyRateCents)} a day. The total
                above is the quote that was agreed and has not been changed.
              </p>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-cw-navy/8 pt-3">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
                Payment
              </span>
              <StatusPill value={booking.paymentStatus} />
            </div>
            {ledger && (
              <div className="mt-2 space-y-1 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-cw-ink/55">Collected</span>
                  <span className="font-semibold tabular-nums text-cw-navy">
                    {formatMoneyExact(ledger.netCents)}
                  </span>
                </div>
                {ledger.refundedCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-cw-ink/55">Refunded</span>
                    <span className="font-semibold tabular-nums text-[#b3261e]">
                      −{formatMoneyExact(ledger.refundedCents)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-cw-navy/8 pt-1">
                  <span className="text-cw-ink/55">
                    {ledger.overpaidCents > 0 ? "Overpaid" : "Still owed"}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      ledger.overpaidCents > 0
                        ? "text-[#8a6a04]"
                        : ledger.outstandingCents > 0
                          ? "text-[#b3261e]"
                          : "text-[#1a7a45]"
                    }`}
                  >
                    {formatMoneyExact(
                      ledger.overpaidCents > 0 ? ledger.overpaidCents : ledger.outstandingCents,
                    )}
                  </span>
                </div>
                {ledger.pendingCents > 0 && (
                  <p className="pt-1 text-[11px] text-cw-ink/50">
                    {formatMoneyExact(ledger.pendingCents)} recorded as expected but not arrived —
                    not counted above.
                  </p>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── the guest ────────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Guest">
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name" value={booking.client.fullName} />
            <Field
              label="Phone"
              value={
                <a
                  href={`tel:${booking.client.phone.replace(/\s/g, "")}`}
                  className="text-cw-teal underline underline-offset-2"
                >
                  {booking.client.phone}
                </a>
              }
              mono
            />
            <Field
              label="Email"
              value={
                <a
                  href={`mailto:${booking.client.email}`}
                  className="break-all text-cw-teal underline underline-offset-2"
                >
                  {booking.client.email}
                </a>
              }
            />
            <Field label="Licence" value={booking.client.licenseNumber} mono />
            <Field
              label="Licence expiry"
              value={
                booking.client.licenseExpiry ? formatDateLong(booking.client.licenseExpiry) : null
              }
              hint={licenceHint(booking)}
            />
            <Field label="Country" value={booking.client.countryOfResidence} />
          </div>
        </Panel>

        <Panel title="Record" className="lg:self-start">
          <div className="grid gap-3 px-4 py-4">
            <Field label="Reference" value={booking.ref} mono />
            <Field label="Booked" value={formatInstant(booking.createdAt)} />
            <Field label="Last change" value={formatInstant(booking.updatedAt)} />
            <Field label="Handled by" value={booking.handledBy} />
          </div>
        </Panel>
      </div>

      {/* ── the ledger ───────────────────────────────────────────────────── */}
      {ledger && (
        <div className="mt-4">
          <Panel
            title="Payments"
            subtitle="What has actually changed hands against this booking"
            action={
              <span className="text-[12px] text-cw-ink/55">
                {formatMoneyExact(ledger.netCents)} of {formatMoneyExact(ledger.totalCents)}
              </span>
            }
          >
            <FixMismatch ledger={ledger} />
            <LedgerEntries ledger={ledger} />
            <RecordPayment ledger={ledger} />
          </Panel>
        </div>
      )}

      {/* ── notes ────────────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Guest requests" subtitle="The guest's own words — safe to read back to them">
          <div className="px-4 py-4">
            {booking.specialRequests ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-cw-ink">
                {booking.specialRequests}
              </p>
            ) : (
              <p className="text-[13px] text-cw-ink/40">Nothing requested.</p>
            )}
          </div>
        </Panel>

        <AdminNotes booking={booking} />
      </div>
    </AdminShell>
  );
}

/** Flags a licence that expires before the car comes back — the one date on this
 *  page that can invalidate the rental at the counter. */
function licenceHint(booking: BookingDetail): string | undefined {
  const expiry = booking.client.licenseExpiry;
  if (!expiry) return "Not captured yet — scan it at handover.";
  if (expiry < booking.returnDate) return "⚠ Expires before this rental ends.";
  return undefined;
}

/**
 * The internal notes box. Saves explicitly rather than on blur: an autosaving
 * textarea that eats a half-typed sentence when a phone call interrupts is worse
 * than a button.
 */
function AdminNotes({ booking }: { booking: BookingDetail }) {
  const router = useRouter();
  const [draft, setDraft] = useState(booking.adminNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = draft.trim() !== (booking.adminNotes ?? "").trim();

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await updateBookingAdminNotes({
        data: { bookingId: booking.id, notes: draft },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // The database stamped updated_at; invalidate so the "Last change" figure
      // on this page is the real one rather than the one it loaded with.
      await router.invalidate();
      setSaved(true);
    } catch (cause) {
      console.error(cause);
      setError("Could not save the notes. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Internal notes"
      subtitle="Staff only. Never sent to the guest."
      action={
        saved && !dirty ? <span className="text-[12px] text-[#1a7a45]">Saved</span> : undefined
      }
    >
      <div className="px-4 py-4">
        <textarea
          value={draft}
          rows={6}
          maxLength={5000}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          placeholder="Damage noted at handover, deposit arrangements, who to call…"
          className="w-full resize-y rounded-lg border border-cw-navy/15 bg-white px-3 py-2 text-[13px] leading-relaxed text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20"
        />

        {error && (
          <p
            role="alert"
            className="mt-2 rounded-lg bg-[#fdecec] px-2.5 py-1.5 text-[12px] text-[#b3261e]"
          >
            {error}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-2">
          <Button variant="primary" disabled={busy || !dirty} onClick={save}>
            {busy ? "Saving…" : "Save notes"}
          </Button>
          {dirty && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(booking.adminNotes ?? "");
                setError(null);
              }}
            >
              Discard
            </Button>
          )}
          <span className="ml-auto text-[11px] tabular-nums text-cw-ink/40">
            {draft.length}/5000
          </span>
        </div>
      </div>
    </Panel>
  );
}
