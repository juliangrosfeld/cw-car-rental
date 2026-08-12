/**
 * /admin/bookings/new — take a booking by hand, against a car you choose.
 *
 * WHY THIS SCREEN EXISTS. The public flow assigns a vehicle automatically:
 * advertised unit first, backup only when it is busy (see
 * src/lib/booking/availability.server.ts). That is right for a guest, who booked
 * a model and does not care which key they get. It is wrong at a counter, where
 * the reason for taking a booking is often the car itself — the grey Spark is
 * the one with the roof rack, the black one is going in for a service on
 * Thursday, the guest asked for the one they had last time. So here the car is
 * NAMED, and nothing silently moves the guest off it.
 *
 * WHAT IS DELIBERATELY NOT NEGOTIABLE HERE
 *   THE PRICE. It comes from the same quoteRental() the website uses, with rates
 *   read from the database. An operator cannot type a total any more than a
 *   guest can. A genuinely different deal is recorded as what it is — a payment
 *   against the booking — rather than by quietly restating the price list.
 *
 *   THE CLASH. If the car is taken, the answer is "it is taken", not a different
 *   car. Reassigning would undo the one thing this page is for.
 *
 * THE DATES LIVE IN THE URL, so availability is answered by the server loader
 * rather than guessed in the browser: what this page shows as free is what the
 * exclusion constraint will actually accept.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import AdminShell from "../../../components/admin/shell";
import { Button, Field, Panel, StatusPill } from "../../../components/admin/ui";
import { createBookingManually, fetchManualBookingOptions } from "../../../lib/api/admin.functions";
import { formatDate, formatDateShort, formatMoney } from "../../../lib/admin/format";
import { VEHICLE_STATUS_LABEL } from "../../../lib/admin/fleet";
import {
  MIN_RENTAL_DAYS,
  MONTHLY_PERIOD_DAYS,
  monthlyReturnDate,
  quoteRental,
  rentalDays,
  type RentalType,
} from "../../../lib/booking/rental";
import { PICKUP_LOCATIONS } from "../../../content/brand";
import type { ManualBookingVehicle } from "../../../lib/admin/types";
import type { PaymentStatus } from "../../../lib/supabase/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface NewBookingSearch {
  /** 'YYYY-MM-DD'. In the URL so the loader can answer availability for them. */
  pickup?: string;
  return?: string;
  type?: RentalType;
}

export const Route = createFileRoute("/admin/_shell/bookings/new")({
  validateSearch: (search: Record<string, unknown>): NewBookingSearch => ({
    pickup:
      typeof search.pickup === "string" && DATE_RE.test(search.pickup) ? search.pickup : undefined,
    return:
      typeof search.return === "string" && DATE_RE.test(search.return) ? search.return : undefined,
    type: search.type === "monthly" ? "monthly" : search.type === "daily" ? "daily" : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    // A monthly rental's window is DERIVED, here and again on the server, so the
    // availability shown is for the period that will actually be booked.
    const pickup = deps.pickup ?? null;
    const end =
      deps.type === "monthly" && pickup ? monthlyReturnDate(pickup) : (deps.return ?? null);
    return fetchManualBookingOptions({ data: { pickupDate: pickup, returnDate: end } });
  },
  head: () => ({ meta: [{ title: "New booking | CW back office" }] }),
  component: NewBookingPage,
});

const inputClass =
  "w-full rounded-lg border border-cw-navy/15 bg-white px-3 py-2 text-[13px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20";

const labelClass = "text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50";

/** Why a car cannot be picked, said plainly. "Already out with Marisol until the
 *  8th" and "in the shop" both stop the assignment and mean entirely different
 *  things to whoever is on the phone. */
function VehicleNote({ vehicle }: { vehicle: ManualBookingVehicle }) {
  if (vehicle.availability === null) {
    return <span className="text-[11px] text-cw-ink/40">Pick dates to check</span>;
  }
  if (vehicle.availability === "off_road") {
    return (
      <span className="text-[11px] font-semibold text-[#b3261e]">
        {VEHICLE_STATUS_LABEL[vehicle.status]}
      </span>
    );
  }
  if (vehicle.availability === "taken") {
    return (
      <span className="text-[11px] text-[#a3572a]">
        With {vehicle.takenBy ?? "a guest"}
        {vehicle.takenUntil ? ` until ${formatDateShort(vehicle.takenUntil)}` : ""}
      </span>
    );
  }
  return <span className="text-[11px] font-semibold text-[#1a7a45]">Free for these dates</span>;
}

function NewBookingPage() {
  const { admin, options } = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();

  const rentalType: RentalType = search.type ?? "daily";
  const pickupDate = search.pickup ?? "";
  const returnDate =
    rentalType === "monthly" && pickupDate ? monthlyReturnDate(pickupDate) : (search.return ?? "");

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [useExistingClient, setUseExistingClient] = useState(true);
  const [clientId, setClientId] = useState<string>("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [pickupLocation, setPickupLocation] = useState(PICKUP_LOCATIONS[0].label);
  const [returnLocation, setReturnLocation] = useState(PICKUP_LOCATIONS[0].label);
  const [flightNumber, setFlightNumber] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [bookingStatus, setBookingStatus] = useState<"pending" | "confirmed">("confirmed");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allVehicles = options.listings.flatMap((l) =>
    l.vehicles.map((v) => ({ vehicle: v, listing: l })),
  );
  const picked = allVehicles.find((entry) => entry.vehicle.id === vehicleId) ?? null;

  const datesReady =
    DATE_RE.test(pickupDate) && DATE_RE.test(returnDate) && returnDate > pickupDate;

  // The same price book the site quotes from, called with the same inputs. The
  // server recomputes it from the database before writing — this is a preview,
  // not the price.
  const quote =
    picked && datesReady
      ? quoteRental({
          rentalType,
          rates: {
            dailyRateCents: picked.listing.dailyRateCents,
            monthlyRateCents: picked.listing.monthlyRateCents,
          },
          pickupDate,
          returnDate,
        })
      : null;

  function setDates(next: Partial<NewBookingSearch>) {
    setVehicleId(null);
    router.navigate({ to: "/admin/bookings/new", search: { ...search, ...next } });
  }

  async function submit() {
    if (busy) return;
    if (!picked) {
      setError("Pick the car this booking is for.");
      return;
    }
    if (!datesReady) {
      setError("Enter a pickup date and a return date after it.");
      return;
    }
    if (useExistingClient && !clientId) {
      setError("Pick the guest, or switch to entering a new one.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await createBookingManually({
        data: {
          clientId: useExistingClient ? clientId : null,
          guest: useExistingClient
            ? null
            : { fullName: guestName, email: guestEmail, phone: guestPhone },
          vehicleId: picked.vehicle.id,
          rentalType,
          pickupDate,
          returnDate: rentalType === "monthly" ? null : returnDate,
          pickupLocation,
          returnLocation,
          flightNumber: flightNumber.trim() || null,
          specialRequests: specialRequests.trim() || null,
          adminNotes: adminNotes.trim() || null,
          bookingStatus,
          paymentStatus,
        },
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      await router.invalidate();
      await router.navigate({
        to: "/admin/bookings/$bookingId",
        params: { bookingId: result.bookingId },
      });
    } catch (cause) {
      console.error(cause);
      setError("Could not save the booking. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell
      admin={admin}
      title="New booking"
      subtitle="A booking taken over the phone, at the counter, or on a car you choose yourself"
      actions={
        <Link
          to="/admin/bookings"
          className="rounded-lg border border-cw-navy/15 bg-white px-3 py-1.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal"
        >
          ‹ All bookings
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ── dates ─────────────────────────────────────────────────── */}
          <Panel
            title="Dates"
            subtitle="Availability below is answered for these dates by the database, not guessed."
          >
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-3">
              <label className="block">
                <span className={labelClass}>Rental type</span>
                <select
                  value={rentalType}
                  onChange={(e) => setDates({ type: e.target.value as RentalType })}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="daily">Daily</option>
                  <option value="monthly">Monthly · flat rate</option>
                </select>
              </label>

              <label className="block">
                <span className={labelClass}>Pickup</span>
                <input
                  type="date"
                  value={pickupDate}
                  min={options.today}
                  onChange={(e) => setDates({ pickup: e.target.value || undefined })}
                  className={`mt-1 ${inputClass}`}
                />
              </label>

              <label className="block">
                <span className={labelClass}>Return</span>
                {rentalType === "monthly" ? (
                  // Derived, never typed: a monthly rental's period is fixed, and
                  // an editable box here would let the counter sell 90 days for
                  // one month's money — the exact hole the server closes.
                  <p
                    className={`mt-1 rounded-lg bg-cw-navy/5 px-3 py-2 text-[13px] text-cw-ink/70`}
                  >
                    {returnDate ? formatDate(returnDate) : `${MONTHLY_PERIOD_DAYS} days on`}
                  </p>
                ) : (
                  <input
                    type="date"
                    value={returnDate}
                    min={pickupDate || options.today}
                    onChange={(e) => setDates({ return: e.target.value || undefined })}
                    className={`mt-1 ${inputClass}`}
                  />
                )}
                <span className="mt-1 block text-[11px] text-cw-ink/50">
                  {rentalType === "monthly"
                    ? `Fixed at ${MONTHLY_PERIOD_DAYS} days from the pickup.`
                    : `The car is back that morning. Minimum ${MIN_RENTAL_DAYS} days.`}
                </span>
              </label>
            </div>
          </Panel>

          {/* ── the car ───────────────────────────────────────────────── */}
          <Panel
            title="Which car"
            subtitle="Every physical car, including the ones the public site does not show. This choice is final — nothing reassigns it later."
          >
            <div className="space-y-3 px-4 py-4">
              {options.listings.map((listing) => (
                <div key={listing.id}>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] font-semibold text-cw-navy">
                    {listing.label}
                    <span className="text-[11px] font-normal text-cw-ink/50">
                      {formatMoney(listing.dailyRateCents)} / day
                      {listing.monthlyRateCents > 0
                        ? ` · ${formatMoney(listing.monthlyRateCents)} / month`
                        : " · not offered monthly"}
                    </span>
                  </p>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {listing.vehicles.map((vehicle) => {
                      const pickable = vehicle.availability === "free" || !datesReady;
                      const active = vehicleId === vehicle.id;
                      return (
                        <button
                          key={vehicle.id}
                          type="button"
                          disabled={datesReady && !pickable}
                          onClick={() => {
                            setVehicleId(vehicle.id);
                            setError(null);
                          }}
                          aria-pressed={active}
                          className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                            active
                              ? "border-cw-teal bg-cw-teal-soft/70"
                              : "border-cw-navy/12 bg-white hover:border-cw-teal/50"
                          }`}
                        >
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-cw-navy">
                              {vehicle.label}
                            </span>
                            {!vehicle.isPubliclyVisible && (
                              <span className="rounded bg-cw-navy/8 px-1 text-[10px] font-bold uppercase tracking-[0.04em] text-cw-navy/60">
                                Backup
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block">
                            <VehicleNote vehicle={vehicle} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* ── the guest ─────────────────────────────────────────────── */}
          <Panel title="Guest">
            <div className="px-4 py-4">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={useExistingClient ? "primary" : "secondary"}
                  onClick={() => setUseExistingClient(true)}
                >
                  Existing guest
                </Button>
                <Button
                  size="sm"
                  variant={useExistingClient ? "secondary" : "primary"}
                  onClick={() => setUseExistingClient(false)}
                >
                  New guest
                </Button>
              </div>

              {useExistingClient ? (
                <label className="mt-3 block">
                  <span className={labelClass}>Who is it for</span>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  >
                    <option value="">Pick a guest…</option>
                    {options.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} · {c.email}
                        {c.rentals > 0 ? ` · ${c.rentals} rentals` : ""}
                      </option>
                    ))}
                  </select>
                  {/* Said out loud because it is a deliberate choice, not a
                      limitation: a phone line is not where a customer record
                      should be overwritten. */}
                  <span className="mt-1 block text-[11px] text-cw-ink/50">
                    Their details are used as they stand. Corrections belong on the client page.
                  </span>
                </label>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className={labelClass}>Name</span>
                    <input
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      className={`mt-1 ${inputClass}`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Email</span>
                    <input
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      className={`mt-1 ${inputClass}`}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Phone</span>
                    <input
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      className={`mt-1 ${inputClass}`}
                    />
                  </label>
                </div>
              )}
            </div>
          </Panel>

          {/* ── handover ──────────────────────────────────────────────── */}
          <Panel title="Handover and notes">
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Pickup location</span>
                <select
                  value={pickupLocation}
                  onChange={(e) => setPickupLocation(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                >
                  {PICKUP_LOCATIONS.map((l) => (
                    <option key={l.id} value={l.label}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Return location</span>
                <select
                  value={returnLocation}
                  onChange={(e) => setReturnLocation(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                >
                  {PICKUP_LOCATIONS.map((l) => (
                    <option key={l.id} value={l.label}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Flight number</span>
                <input
                  value={flightNumber}
                  maxLength={20}
                  onChange={(e) => setFlightNumber(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Special requests</span>
                <input
                  value={specialRequests}
                  maxLength={2000}
                  onChange={(e) => setSpecialRequests(e.target.value)}
                  placeholder="Child seat, late arrival…"
                  className={`mt-1 ${inputClass}`}
                />
                <span className="mt-1 block text-[11px] text-cw-ink/50">
                  Customer-facing. Safe to read back to them.
                </span>
              </label>
              <label className="block sm:col-span-2">
                <span className={labelClass}>Internal notes</span>
                <textarea
                  value={adminNotes}
                  rows={2}
                  maxLength={5000}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Why this car, what was agreed on the phone…"
                  className={`mt-1 resize-y ${inputClass}`}
                />
                <span className="mt-1 block text-[11px] text-cw-ink/50">
                  Staff only. Never sent to a guest.
                </span>
              </label>
            </div>
          </Panel>
        </div>

        {/* ── the summary and the button ──────────────────────────────── */}
        <div className="space-y-4">
          <Panel title="This booking" className="lg:sticky lg:top-4">
            <div className="grid gap-3 px-4 py-4">
              <Field
                label="Car"
                value={
                  picked ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {picked.listing.label} — {picked.vehicle.label}
                      {!picked.vehicle.isPubliclyVisible && (
                        <span className="rounded bg-cw-navy/8 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-cw-navy/60">
                          Backup
                        </span>
                      )}
                    </span>
                  ) : null
                }
                hint={picked ? "Assigned exactly as chosen — nothing moves it." : "Not chosen yet"}
              />
              <Field
                label="Dates"
                value={
                  datesReady
                    ? `${formatDate(pickupDate)} → ${formatDate(returnDate)} · ${rentalDays(
                        pickupDate,
                        returnDate,
                      )} days`
                    : null
                }
              />

              {quote && !quote.ok && (
                <p className="rounded-lg bg-cw-yellow-soft px-3 py-2 text-[12px] text-[#8a6a04]">
                  {quote.message}
                </p>
              )}

              {quote && quote.ok && (
                <div className="rounded-lg bg-cw-teal-soft/50 px-3 py-2.5">
                  <p className="font-display text-[24px] font-extrabold leading-none tabular-nums text-cw-navy">
                    {formatMoney(quote.quote.totalCents)}
                  </p>
                  <p className="mt-1 text-[11px] text-cw-ink/60">
                    {rentalType === "monthly" ? (
                      <>Flat monthly rate over {quote.quote.days} days</>
                    ) : (
                      <>
                        {formatMoney(quote.quote.rateCents)} × {quote.quote.days} days
                        {quote.quote.discountPct > 0 && (
                          <>
                            {" "}
                            less {quote.quote.discountPct}% (
                            {formatMoney(quote.quote.discountCents)})
                          </>
                        )}
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-cw-ink/50">
                    The price list applies at the counter too. The server recalculates this before
                    saving; record any different arrangement as a payment.
                  </p>
                </div>
              )}

              <label className="block">
                <span className={labelClass}>Booking status</span>
                <select
                  value={bookingStatus}
                  onChange={(e) => setBookingStatus(e.target.value as "pending" | "confirmed")}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending — a hold, not yet firm</option>
                </select>
              </label>

              <label className="block">
                <span className={labelClass}>Payment</span>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="unpaid">Unpaid</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </select>
                <span className="mt-1 block text-[11px] text-cw-ink/50">
                  Marking it paid does not record a payment. Add that on the booking&rsquo;s page so
                  the ledger and the status agree.
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  variant="primary"
                  disabled={busy || !picked || !datesReady || (quote !== null && !quote.ok)}
                  onClick={submit}
                >
                  {busy ? "Saving…" : "Take the booking"}
                </Button>
                {picked && <StatusPill value={bookingStatus} title="Booking status" />}
              </div>

              {error && (
                <p role="alert" className="text-[12px] font-semibold text-[#b3261e]">
                  {error}
                </p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </AdminShell>
  );
}
