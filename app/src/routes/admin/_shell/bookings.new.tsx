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
 * THE PRICE, AND "SET OWN PRICE"
 *   By default the price comes from the same quoteRental() the website uses,
 *   with rates read from the database, and nothing can be typed.
 *
 *   "Set own price" is the one exception, and it is here on purpose: Clay
 *   sometimes agrees a deal on the phone that is not on the price list. With
 *   the toggle on, the admin types the total (XCG, more than zero) and an
 *   optional reason. The standard quote stays on screen beside it, and the
 *   server stores both, so the booking page can always say "custom price,
 *   standard would have been X". With the toggle off the form behaves exactly
 *   as it did before the toggle existed.
 *
 *   This is ADMIN ONLY and enforced on the server (requireAdmin in
 *   createBookingManually). The public wizard's endpoint has no price field at
 *   all, so a guest cannot set, lower or even suggest a price.
 *
 * WHAT IS DELIBERATELY NOT NEGOTIABLE HERE
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
import CountrySelect from "../../../components/booking/country-select";
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
import {
  LOCATION_HELPER,
  LOCATION_MAX_LENGTH,
  PICKUP_LOCATIONS,
} from "../../../content/brand";
import type { ManualBookingVehicle } from "../../../lib/admin/types";
import { CURRENCY_CODE } from "../../../lib/money";
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

/**
 * "450", "450.5" or "1,250.00" → integer cents, or null for anything that is
 * not a positive amount with at most two decimals. Strict on purpose: a price
 * box that quietly turns "45o" into 45 is how a booking ends up ten times off.
 */
function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents > 0 ? cents : null;
}

/** A free-text address with the usual answers as quick-fill chips, the same
 *  shape the public wizard uses. Whatever is in the box is what is saved. */
function LocationInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 ${inputClass}`}
      />
      <span className="mt-1 block text-[11px] text-cw-ink/50">{LOCATION_HELPER}</span>
      <span className="mt-1.5 flex flex-wrap gap-1.5">
        {PICKUP_LOCATIONS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => {
              onChange(l.fill);
              document.getElementById(id)?.focus();
            }}
            className="rounded-full border border-cw-navy/15 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-cw-ink/70 transition-colors hover:border-cw-teal hover:text-cw-teal"
          >
            {l.chip}
          </button>
        ))}
      </span>
    </div>
  );
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
  const [guestCountry, setGuestCountry] = useState("");
  const [pickupLocation, setPickupLocation] = useState(PICKUP_LOCATIONS[0].fill);
  const [returnLocation, setReturnLocation] = useState(PICKUP_LOCATIONS[0].fill);
  const [flightNumber, setFlightNumber] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [bookingStatus, setBookingStatus] = useState<"pending" | "confirmed">("confirmed");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  /** "Set own price". Off by default; while off, nothing about it is sent. */
  const [ownPrice, setOwnPrice] = useState(false);
  /** Whole or decimal XCG as typed, e.g. "450" or "450.50". */
  const [ownPriceAmount, setOwnPriceAmount] = useState("");
  const [ownPriceNote, setOwnPriceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parsed to integer cents here, once. Null while the box holds anything that
  // is not a positive amount with at most two decimals.
  const ownPriceCents = parseAmountToCents(ownPriceAmount);

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
    if (!pickupLocation.trim() || !returnLocation.trim()) {
      setError("Enter both the pickup and the return location.");
      return;
    }
    if (
      pickupLocation.trim().length > LOCATION_MAX_LENGTH ||
      returnLocation.trim().length > LOCATION_MAX_LENGTH
    ) {
      setError(`Keep each location under ${LOCATION_MAX_LENGTH} characters.`);
      return;
    }

    if (ownPrice && ownPriceCents === null) {
      setError(`Enter the custom price in ${CURRENCY_CODE}, more than zero.`);
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
            : {
                fullName: guestName,
                email: guestEmail,
                phone: guestPhone,
                country: guestCountry || null,
              },
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
          priceOverride:
            ownPrice && ownPriceCents !== null
              ? { totalCents: ownPriceCents, note: ownPriceNote.trim() || null }
              : null,
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
            subtitle="Every physical car, including the ones the public site does not show. This choice is final: nothing reassigns it later."
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
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                  <div>
                    <label htmlFor="nb-country" className={labelClass}>
                      Country
                    </label>
                    <div className="mt-1">
                      <CountrySelect
                        id="nb-country"
                        value={guestCountry}
                        onChange={setGuestCountry}
                        inputClassName={inputClass}
                        placeholder="Country of residence"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {/* ── handover ──────────────────────────────────────────────── */}
          <Panel title="Handover and notes">
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
              <LocationInput
                id="nb-pickup-location"
                label="Pickup location"
                value={pickupLocation}
                onChange={setPickupLocation}
              />
              <LocationInput
                id="nb-return-location"
                label="Return location"
                value={returnLocation}
                onChange={setReturnLocation}
              />
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
                      {picked.listing.label} · {picked.vehicle.label}
                      {!picked.vehicle.isPubliclyVisible && (
                        <span className="rounded bg-cw-navy/8 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-cw-navy/60">
                          Backup
                        </span>
                      )}
                    </span>
                  ) : null
                }
                hint={picked ? "Assigned exactly as chosen. Nothing moves it." : "Not chosen yet"}
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
                  {ownPrice && (
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
                      Standard price
                    </p>
                  )}
                  <p
                    className={`font-display font-extrabold leading-none tabular-nums ${
                      ownPrice ? "text-[18px] text-cw-ink/55 line-through" : "text-[24px] text-cw-navy"
                    }`}
                  >
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
                    {ownPrice
                      ? "What the price list charges for this car and these dates. Saved with the booking for reference."
                      : "From the price list. The server recalculates this before saving."}
                  </p>
                </div>
              )}

              {/* Set own price. Off = the form behaves exactly as before. */}
              <div className="rounded-lg border border-cw-navy/12 px-3 py-2.5">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ownPrice}
                    onChange={(e) => {
                      setOwnPrice(e.target.checked);
                      setError(null);
                    }}
                    className="h-4 w-4 accent-cw-teal"
                  />
                  <span className="text-[13px] font-semibold text-cw-navy">Set own price</span>
                </label>
                {ownPrice && (
                  <div className="mt-3 space-y-3">
                    <label className="block">
                      <span className={labelClass}>Total ({CURRENCY_CODE})</span>
                      <input
                        inputMode="decimal"
                        value={ownPriceAmount}
                        onChange={(e) => setOwnPriceAmount(e.target.value)}
                        placeholder="e.g. 450"
                        aria-invalid={ownPriceAmount !== "" && ownPriceCents === null}
                        className={`mt-1 ${inputClass}`}
                      />
                      <span className="mt-1 block text-[11px] text-cw-ink/50">
                        {ownPriceCents !== null
                          ? `The guest will owe ${formatMoney(ownPriceCents)} in total.`
                          : "The whole rental, not per day. More than zero."}
                      </span>
                    </label>
                    <label className="block">
                      <span className={labelClass}>Note (optional)</span>
                      <textarea
                        value={ownPriceNote}
                        rows={2}
                        maxLength={500}
                        onChange={(e) => setOwnPriceNote(e.target.value)}
                        placeholder="Why this price: returning guest, agreed on the phone…"
                        className={`mt-1 resize-y ${inputClass}`}
                      />
                      <span className="mt-1 block text-[11px] text-cw-ink/50">
                        Staff only. Shown on the booking page.
                      </span>
                    </label>
                  </div>
                )}
              </div>

              <label className="block">
                <span className={labelClass}>Booking status</span>
                <select
                  value={bookingStatus}
                  onChange={(e) => setBookingStatus(e.target.value as "pending" | "confirmed")}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending (a hold, not yet firm)</option>
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
                  disabled={
                    busy ||
                    !picked ||
                    !datesReady ||
                    (quote !== null && !quote.ok) ||
                    (ownPrice && ownPriceCents === null)
                  }
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
