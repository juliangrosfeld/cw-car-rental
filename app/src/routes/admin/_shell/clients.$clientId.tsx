/**
 * /admin/clients/:id — one guest, everything on file.
 *
 * READ-ONLY, DELIBERATELY. Nothing here writes: this phase is about the record
 * being visible and honest, not editable. See the header of
 * src/lib/admin/clients.server.ts for why editing and merging are their own
 * piece of work rather than a form bolted on here.
 *
 * THE DUPLICATES PANEL IS THE POINT OF THIS PAGE, not the profile. A guest who
 * has booked twice with the same address can exist as two rows, or as one row
 * holding a phone number they replaced a year ago — because the booking path
 * REUSES an existing guest rather than overwriting it, and that is the right
 * behaviour (see migration 0002). Nothing reconciles that automatically. So when
 * two records look like the same person, this page puts them side by side and
 * names the fields that differ, and leaves the judgement to a human who can ring
 * the number and ask.
 */
import { createFileRoute, Link } from "@tanstack/react-router";

import { LicenceBadge, RepeatBadge } from "../../../components/admin/client-badges";
import AdminShell from "../../../components/admin/shell";
import { EmptyState, Field, Panel, Stat, StatusPill, Td, Th } from "../../../components/admin/ui";
import { fetchAdminClient } from "../../../lib/api/admin.functions";
import { LICENCE_LABEL, REPEAT_THRESHOLD, needsLicenceAttention } from "../../../lib/admin/clients";
import {
  formatDate,
  formatDateLong,
  formatDateShort,
  formatInstant,
  formatMoney,
  formatTime,
} from "../../../lib/admin/format";
import type { ClientDetail } from "../../../lib/admin/types";

export const Route = createFileRoute("/admin/_shell/clients/$clientId")({
  loader: ({ params }) => fetchAdminClient({ data: { clientId: params.clientId } }),
  head: () => ({ meta: [{ title: "Client | CW back office" }] }),
  component: ClientPage,
});

function ClientPage() {
  const { admin, client } = Route.useLoaderData();

  if (!client) {
    return (
      <AdminShell admin={admin} title="Client not found">
        <Panel>
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-cw-ink/60">
              No guest with that id. The record may have been removed.
            </p>
            <Link
              to="/admin/clients"
              className="mt-3 inline-block text-[13px] font-semibold text-cw-teal underline underline-offset-2"
            >
              Back to clients
            </Link>
          </div>
        </Panel>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      admin={admin}
      title={client.fullName}
      subtitle={subtitleFor(client)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {client.isRepeat && <RepeatBadge rentals={client.value.rentals} />}
          <LicenceBadge level={client.licenceLevel} expiry={client.licenseExpiry} />
          <Link
            to="/admin/clients"
            className="rounded-lg border border-cw-navy/15 bg-white px-3 py-1.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal"
          >
            ‹ All clients
          </Link>
        </div>
      }
    >
      {/* A licence problem is the one thing on this page that can stop a
          handover, so it goes above everything else. */}
      {needsLicenceAttention(client.licenceLevel) && (
        <div
          role="alert"
          className={`mb-3 rounded-lg px-3 py-2.5 text-[13px] ${
            client.licenceLevel === "expiring"
              ? "bg-cw-yellow-soft text-[#8a6a04]"
              : "bg-[#fdecec] text-[#b3261e]"
          }`}
        >
          <span className="font-semibold">{LICENCE_LABEL[client.licenceLevel]}.</span>{" "}
          {client.licenseExpiry && <>Expires {formatDateLong(client.licenseExpiry)}. </>}
          {client.licenceLevel === "expires_mid_hire" &&
            client.value.lastReturn &&
            `Their licence runs out before a rental they already hold returns on ${formatDateShort(
              client.value.lastReturn,
            )} — check it before the keys go over.`}
          {client.licenceLevel === "expired" && "They cannot legally drive until it is renewed."}
          {client.licenceLevel === "expiring" && "Worth checking at the next handover."}
        </div>
      )}

      {/* ── lifetime value ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Paid to date"
          value={formatMoney(client.value.paidCents)}
          hint="Money actually collected"
          emphasis
        />
        <Stat
          label="Outstanding"
          value={formatMoney(client.value.outstandingCents)}
          hint={client.value.outstandingCents > 0 ? "Booked and not yet paid" : "Nothing owed"}
        />
        <Stat
          label="Rentals"
          value={String(client.value.rentals)}
          hint={
            client.value.cancelled > 0
              ? `${client.value.cancelled} cancelled, not counted`
              : "Cancellations excluded"
          }
        />
        <Stat
          label="With CW since"
          value={client.value.firstPickup ? formatDateShort(client.value.firstPickup) : "—"}
          hint={
            client.value.lastPickup
              ? `Last rental ${formatDateShort(client.value.lastPickup)}`
              : "No rentals yet"
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ── profile ────────────────────────────────────────────────────── */}
        <Panel className="lg:col-span-2" title="Profile">
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name" value={client.fullName} />
            <Field
              label="Phone"
              value={
                <a
                  href={`tel:${client.phone.replace(/\s/g, "")}`}
                  className="text-cw-teal underline underline-offset-2"
                >
                  {client.phone}
                </a>
              }
              mono
            />
            <Field
              label="Email"
              value={
                <a
                  href={`mailto:${client.email}`}
                  className="break-all text-cw-teal underline underline-offset-2"
                >
                  {client.email}
                </a>
              }
            />
            <Field label="Licence number" value={client.licenseNumber} mono />
            <Field
              label="Licence expiry"
              value={client.licenseExpiry ? formatDateLong(client.licenseExpiry) : null}
              hint={
                client.licenseExpiry ? LICENCE_LABEL[client.licenceLevel] : "Scan it at handover"
              }
            />
            <Field
              label="Date of birth"
              value={client.dateOfBirth ? formatDateLong(client.dateOfBirth) : null}
            />
            <Field label="Country" value={client.countryOfResidence} />
            <Field label="On file since" value={formatInstant(client.createdAt)} />
            <Field label="Record updated" value={formatInstant(client.updatedAt)} />
          </div>
        </Panel>

        <Panel title="Usual car" className="lg:self-start">
          <div className="px-4 py-4">
            {client.favouriteCars.length === 0 ? (
              <p className="text-[13px] text-cw-ink/40">No rentals yet.</p>
            ) : (
              <ul className="space-y-2">
                {client.favouriteCars.map((car) => (
                  <li key={car.carId} className="flex items-center justify-between gap-3">
                    <Link
                      to="/admin/fleet/$carId"
                      params={{ carId: car.carId }}
                      className="truncate text-[13px] font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                    >
                      {car.carLabel}
                    </Link>
                    <span className="shrink-0 text-[12px] tabular-nums text-cw-ink/55">
                      {car.rentals}×
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-cw-navy/8 pt-2 text-[11px] text-cw-ink/45">
              What they have driven before — worth offering first.
            </p>
          </div>
        </Panel>
      </div>

      {/* ── possible duplicates ──────────────────────────────────────────── */}
      {client.duplicates.length > 0 && (
        <div className="mt-4">
          <Panel
            title="Possible duplicate records"
            subtitle="These share an email or a phone number with this guest. Nothing is merged automatically."
          >
            <div className="px-4 py-3">
              <p className="mb-3 max-w-[80ch] text-[12px] leading-relaxed text-cw-ink/60">
                A booking reuses an existing guest rather than overwriting one, so the same person
                can end up as more than one record and a record can hold details they have since
                changed. Nothing here picks a winner — that would quietly delete whichever version
                is right. Check which is current, and treat the others as history.
              </p>
              <ul className="divide-y divide-cw-navy/8 border-t border-cw-navy/8">
                {client.duplicates.map((dup) => (
                  <li
                    key={dup.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        to="/admin/clients/$clientId"
                        params={{ clientId: dup.id }}
                        className="text-[13px] font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                      >
                        {dup.fullName}
                      </Link>
                      <span className="block text-[12px] text-cw-ink/60">
                        {dup.phone} · {dup.email}
                      </span>
                      <span className="block text-[11px] text-cw-ink/45">
                        {dup.rentals} {dup.rentals === 1 ? "rental" : "rentals"} · on file since{" "}
                        {formatDateShort(dup.createdAt.slice(0, 10))}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {dup.matchedOn.email && (
                        <span className="rounded-md bg-cw-navy/6 px-1.5 py-0.5 text-[11px] font-semibold text-cw-navy/70">
                          same email
                        </span>
                      )}
                      {dup.matchedOn.phone && (
                        <span className="rounded-md bg-cw-navy/6 px-1.5 py-0.5 text-[11px] font-semibold text-cw-navy/70">
                          same phone
                        </span>
                      )}
                      {dup.differs.length > 0 && (
                        <span className="rounded-md bg-cw-yellow-soft px-1.5 py-0.5 text-[11px] font-semibold text-[#8a6a04]">
                          differs: {dup.differs.join(", ")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>
      )}

      {/* ── booking history ──────────────────────────────────────────────── */}
      <div className="mt-4">
        <Panel
          title="Booking history"
          subtitle={
            client.bookings.length === 0
              ? "No bookings on this record"
              : `${client.bookings.length} ${
                  client.bookings.length === 1 ? "booking" : "bookings"
                }, newest first · ${client.value.upcoming} still open`
          }
        >
          {client.bookings.length === 0 ? (
            <EmptyState>
              This guest has no bookings. The record exists because it was created for one that was
              since removed.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse">
                <thead className="border-b border-cw-navy/8">
                  <tr>
                    <Th>Ref</Th>
                    <Th>Car</Th>
                    <Th>Dates</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cw-navy/8">
                  {client.bookings.map((booking) => (
                    <tr
                      key={booking.id}
                      className={`hover:bg-cw-teal-soft/25 ${
                        booking.bookingStatus === "cancelled" ? "opacity-60" : ""
                      }`}
                    >
                      <Td>
                        <Link
                          to="/admin/bookings/$bookingId"
                          params={{ bookingId: booking.id }}
                          className="font-semibold tabular-nums text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                        >
                          {booking.ref}
                        </Link>
                        {booking.isOpen && (
                          <span className="ml-2 rounded-md bg-cw-teal-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-cw-teal-dark">
                            Open
                          </span>
                        )}
                      </Td>
                      <Td className="text-cw-ink/70">{booking.carLabel}</Td>
                      <Td className="whitespace-nowrap text-cw-ink/70">
                        {formatDate(booking.pickupDate)}, {formatTime(booking.pickupTime)} →{" "}
                        {formatDateShort(booking.returnDate)}
                        <span className="block text-[11px] text-cw-ink/45">
                          {booking.days} {booking.days === 1 ? "day" : "days"} · booked{" "}
                          {formatDateShort(booking.createdAt.slice(0, 10))}
                        </span>
                      </Td>
                      <Td align="right" className="font-semibold text-cw-navy">
                        {formatMoney(booking.totalCents)}
                      </Td>
                      <Td align="right">
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          <StatusPill value={booking.bookingStatus} title="Booking status" />
                          <StatusPill value={booking.paymentStatus} title="Payment status" />
                          <StatusPill value={booking.prepStatus} title="Prep status" />
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
    </AdminShell>
  );
}

/** The one line under the name. Says what they are worth and how often they come
 *  back, because that is what decides how the conversation goes. */
function subtitleFor(client: ClientDetail): string {
  if (client.value.rentals === 0) {
    return `${client.email} · no rentals yet`;
  }
  const rentals = `${client.value.rentals} ${client.value.rentals === 1 ? "rental" : "rentals"}`;
  const repeat = client.isRepeat
    ? "repeat customer"
    : `one rental so far — ${REPEAT_THRESHOLD} makes them a repeat customer`;
  return `${rentals} · ${formatMoney(client.value.paidCents)} paid · ${repeat}`;
}
