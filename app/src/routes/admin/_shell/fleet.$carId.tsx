/**
 * /admin/fleet/:carId — one LISTING: what it costs, what it earns, which cars
 * back it, and who has each of them when.
 *
 * TWO EDITORS, BECAUSE THERE ARE TWO THINGS TO EDIT (migration 0005), and
 * keeping them apart is what stops a rate change and a trip to the garage from
 * looking like the same kind of decision:
 *
 *   THE LISTING   rates, photo, guest-facing copy. Changing a rate reaches
 *                 FUTURE quotes only — `bookings.total_price` was struck when
 *                 the booking was taken and nothing recomputes it, so a rate
 *                 rise cannot reprice a reservation a guest already holds.
 *
 *   EACH CAR      standing availability, plate, colour, maintenance notes.
 *                 Taking one off the road stops it being assigned to new
 *                 bookings and touches nothing already on the books. Whether a
 *                 guest can tell depends on what else backs the listing: with a
 *                 second car behind it, the site does not change at all; with
 *                 none, the listing leaves the booking page. The form says which
 *                 before you save, and the result says which happened after.
 *
 * The month strip below is the same component, geometry and colours as the
 * bookings calendar (src/components/admin/bookings-timeline.tsx), with ONE ROW
 * PER CAR — so two rentals running at once on a two-car listing read as a good
 * week rather than as a double booking.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { TimelineGrid, TimelineLegend } from "../../../components/admin/bookings-timeline";
import AdminShell from "../../../components/admin/shell";
import {
  Button,
  EmptyState,
  Field,
  Panel,
  Stat,
  StatusPill,
  Td,
  Th,
} from "../../../components/admin/ui";
import {
  fetchAdminFleetCar,
  updateFleetCar,
  updateFleetVehicle,
} from "../../../lib/api/admin.functions";
import {
  DEFAULT_STATS_WINDOW,
  STATS_WINDOWS,
  STATS_WINDOW_LABEL,
  VEHICLE_STATUS_LABEL,
  VEHICLE_STATUS_MEANING,
  VEHICLE_STATUS_ORDER,
  isStatsWindow,
  type StatsWindow,
} from "../../../lib/admin/fleet";
import { isMonthKey } from "../../../lib/admin/clock";
import {
  CURRENCY_CODE,
  formatDate,
  formatDateShort,
  formatInstant,
  formatMoney,
  formatTime,
} from "../../../lib/admin/format";
import { DISCOUNT_TIER_SUMMARY, MONTHLY_PERIOD_DAYS } from "../../../lib/booking/rental";
import type { VehicleStatus } from "../../../lib/supabase/types";
import type { FleetCarDetail, FleetVehicleRow } from "../../../lib/admin/types";

interface CarSearch {
  month?: string;
  window?: StatsWindow;
}

export const Route = createFileRoute("/admin/_shell/fleet/$carId")({
  validateSearch: (search: Record<string, unknown>): CarSearch => ({
    month: isMonthKey(search.month) ? search.month : undefined,
    window: isStatsWindow(Number(search.window))
      ? (Number(search.window) as StatsWindow)
      : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    fetchAdminFleetCar({
      data: {
        carId: params.carId,
        month: deps.month ?? null,
        windowDays: deps.window ?? null,
      },
    }),
  head: () => ({ meta: [{ title: "Car | CW back office" }] }),
  component: CarPage,
});

const inputClass =
  "w-full rounded-lg border border-cw-navy/15 bg-white px-3 py-2 text-[13px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20";

function CarPage() {
  const { admin, car } = Route.useLoaderData();
  const search = Route.useSearch();

  if (!car) {
    return (
      <AdminShell admin={admin} title="Listing not found">
        <Panel>
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-cw-ink/60">
              No listing with that id is in the fleet. It may have been renamed.
            </p>
            <Link
              to="/admin/fleet"
              className="mt-3 inline-block text-[13px] font-semibold text-cw-teal underline underline-offset-2"
            >
              Back to the fleet
            </Link>
          </div>
        </Panel>
      </AdminShell>
    );
  }

  const offRoad = car.vehicles.filter((v) => v.status !== "available");

  return (
    <AdminShell
      admin={admin}
      title={car.label}
      subtitle={`${car.category} · ${car.transmission} · ${car.seats} seats · ${formatMoney(
        car.dailyRateCents,
      )} a day · ${
        car.monthlyRateCents > 0
          ? `${formatMoney(car.monthlyRateCents)} a month`
          : "no monthly rate"
      }`}
      actions={
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-cw-navy/6 px-2 py-1 text-[12px] font-semibold text-cw-navy/70">
            {car.vehicles.length} {car.vehicles.length === 1 ? "car" : "cars"}
          </span>
          <Link
            to="/admin/fleet"
            className="rounded-lg border border-cw-navy/15 bg-white px-3 py-1.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal"
          >
            ‹ All listings
          </Link>
        </div>
      }
    >
      {/* Standing state first. Which of the two sentences this is depends on
          whether anything is left on the road, which is exactly the fact the old
          single-car version of this page could not express. */}
      {!car.bookable ? (
        <div className="mb-3 rounded-lg bg-[#fdecec] px-3 py-2.5 text-[13px] text-[#b3261e]">
          <span className="font-semibold">Every car on this listing is off the road.</span> It is
          not being offered for new bookings at all. Rentals already on the books are unaffected —
          they are listed below.
        </div>
      ) : offRoad.length > 0 ? (
        <div className="mb-3 rounded-lg bg-cw-yellow-soft px-3 py-2.5 text-[13px] text-[#8a6a04]">
          <span className="font-semibold">
            {offRoad.length} of {car.vehicles.length} cars off the road.
          </span>{" "}
          The listing is still bookable — guests see no change while another car can take the dates.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <ListingEditor key={car.updatedAt} car={car} />

        <div className="space-y-4">
          <Panel
            title="Earnings"
            subtitle={`${STATS_WINDOW_LABEL[car.stats.windowDays as StatsWindow]}, to ${formatDateShort(
              car.today,
            )}`}
            action={<WindowPicker carId={car.id} search={search} active={car.stats.windowDays} />}
          >
            <div className="grid grid-cols-2 gap-3 px-4 py-4">
              <Stat
                label="Collected"
                value={formatMoney(car.stats.collectedCents)}
                hint="Paid rentals, by pickup date"
                emphasis
              />
              <Stat
                label="Utilisation"
                value={`${car.stats.utilisationPct}%`}
                hint={`${car.stats.daysOut} of ${car.stats.windowDays * car.vehicles.length} car-days`}
              />
              <Stat
                label="Rentals"
                value={String(car.stats.rentals)}
                hint="Started in the window"
              />
              <Stat
                label="Average length"
                value={car.stats.rentals === 0 ? "—" : `${car.stats.averageRentalDays} days`}
                hint="Billable days per rental"
              />
            </div>
          </Panel>

          <Panel title="Record" className="lg:self-start">
            <div className="grid gap-3 px-4 py-4">
              <Field label="Listing id" value={car.id} mono />
              <Field
                label="Cars behind it"
                value={car.vehicles.map((v) => v.label).join(", ")}
                hint={
                  car.vehicles.length > 1
                    ? "New bookings take the car shown on the site first, then a backup."
                    : undefined
                }
              />
              <Field
                label="Out right now"
                value={
                  car.vehicles
                    .filter((v) => v.onRentalUntil)
                    .map((v) => `${v.label} — ${v.onRentalFor}`)
                    .join(", ") || null
                }
                hint={
                  car.vehicles.some((v) => v.onRentalUntil)
                    ? undefined
                    : "Everything is in the yard."
                }
              />
              <Field label="Last edited" value={formatInstant(car.updatedAt)} />
            </div>
          </Panel>
        </div>
      </div>

      {/* ── the physical cars ────────────────────────────────────────────── */}
      <div className="mt-4">
        <Panel
          title="The cars behind this listing"
          subtitle={
            car.vehicles.length === 1
              ? "One car backs this listing. Taking it off the road removes the listing from the booking page."
              : `${car.vehicles.length} cars back this listing, so it can take that many rentals at once. Bookings are assigned to the car shown on the site first.`
          }
        >
          {car.vehicles.length === 0 ? (
            <EmptyState>
              No physical car is assigned to this listing, so it cannot be booked at all.
            </EmptyState>
          ) : (
            <div className="divide-y divide-cw-navy/8">
              {car.vehicles.map((vehicle) => (
                <VehicleEditor key={`${vehicle.id}:${vehicle.updatedAt}`} vehicle={vehicle} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── this listing's month, one row per car ────────────────────────── */}
      <div className="mt-4">
        <Panel title="This listing's calendar" action={<CarMonthNav car={car} search={search} />}>
          <TimelineGrid days={car.days} rows={car.timeline} today={car.today} />
          <TimelineLegend />
        </Panel>
      </div>

      {/* ── what is still to come ────────────────────────────────────────── */}
      <div className="mt-4">
        <Panel
          title="Rentals still on the books"
          subtitle={
            car.upcoming.length === 0
              ? "Nothing outstanding — every rental on this listing is finished"
              : `${car.upcoming.length} ${car.upcoming.length === 1 ? "rental" : "rentals"} not yet returned, including any in progress. These stand whatever a car's status.`
          }
        >
          {car.upcoming.length === 0 ? (
            <EmptyState>
              {car.bookable
                ? "Nothing outstanding. Every car on this listing is free for any dates."
                : "Nothing outstanding, so taking these cars off the road affects no one."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead className="border-b border-cw-navy/8">
                  <tr>
                    <Th>Guest</Th>
                    <Th>Car</Th>
                    <Th>Pickup</Th>
                    <Th>Return</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cw-navy/8">
                  {car.upcoming.map((rental) => {
                    const outNow = car.vehicles.some(
                      (v) => v.onRentalBookingId === rental.bookingId,
                    );
                    return (
                      <tr key={rental.bookingId} className="hover:bg-cw-teal-soft/25">
                        <Td>
                          <Link
                            to="/admin/bookings/$bookingId"
                            params={{ bookingId: rental.bookingId }}
                            className="font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                          >
                            {rental.clientName}
                          </Link>
                          {/* The car is physically with this guest — the row an
                              owner needs to see first when taking it off road. */}
                          {outNow && (
                            <span className="ml-2 rounded-md bg-cw-peach-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[#a3572a]">
                              Out now
                            </span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap text-cw-ink/70">{rental.vehicleLabel}</Td>
                        <Td className="whitespace-nowrap text-cw-ink/70">
                          {formatDateShort(rental.pickupDate)}, {formatTime(rental.pickupTime)}
                        </Td>
                        <Td className="whitespace-nowrap text-cw-ink/70">
                          {formatDateShort(rental.returnDate)}
                          <span className="text-cw-ink/45"> · {rental.days}d</span>
                        </Td>
                        <Td align="right" className="font-semibold text-cw-navy">
                          {formatMoney(rental.totalCents)}
                        </Td>
                        <Td align="right">
                          <span className="inline-flex gap-1">
                            <StatusPill value={rental.paymentStatus} title="Payment status" />
                            <StatusPill value={rental.prepStatus} title="Prep status" />
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}

/* ── navigation ────────────────────────────────────────────────────────────── */

function WindowPicker({
  carId,
  search,
  active,
}: {
  carId: string;
  search: CarSearch;
  active: number;
}) {
  return (
    <div className="inline-flex rounded-lg border border-cw-navy/15 bg-white p-0.5">
      {STATS_WINDOWS.map((days) => (
        <Link
          key={days}
          to="/admin/fleet/$carId"
          params={{ carId }}
          search={{ ...search, window: days === DEFAULT_STATS_WINDOW ? undefined : days }}
          className={`rounded-md px-2 py-1 text-[12px] font-semibold transition-colors ${
            days === active ? "bg-cw-navy text-white" : "text-cw-navy/60 hover:text-cw-navy"
          }`}
        >
          {days === 365 ? "12m" : `${days}d`}
        </Link>
      ))}
    </div>
  );
}

/** Month navigation for this listing. Deliberately its own few lines rather than
 *  a generalised version of the bookings page's: the two link to different
 *  routes and summarise different things, and a shared component would take a
 *  render prop for every part that differs. */
function CarMonthNav({ car, search }: { car: FleetCarDetail; search: CarSearch }) {
  const linkClass =
    "inline-flex h-[30px] items-center rounded-lg border border-cw-navy/15 bg-white px-2.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal";
  const bars = car.timeline.reduce((sum, row) => sum + row.bars.length, 0);

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/admin/fleet/$carId"
        params={{ carId: car.id }}
        search={{ ...search, month: car.prevMonth }}
        className={linkClass}
        aria-label="Previous month"
      >
        ‹
      </Link>
      <span className="min-w-[112px] text-center font-display text-[14px] font-extrabold text-cw-navy">
        {car.monthLabel}
      </span>
      <Link
        to="/admin/fleet/$carId"
        params={{ carId: car.id }}
        search={{ ...search, month: car.nextMonth }}
        className={linkClass}
        aria-label="Next month"
      >
        ›
      </Link>
      {car.month !== car.currentMonth && (
        <Link
          to="/admin/fleet/$carId"
          params={{ carId: car.id }}
          search={{ ...search, month: undefined }}
          className={linkClass}
        >
          This month
        </Link>
      )}
      <span className="ml-1 text-[12px] text-cw-ink/50">
        {bars} {bars === 1 ? "rental" : "rentals"}
      </span>
    </div>
  );
}

/* ── the listing editor ────────────────────────────────────────────────────── */

/**
 * Rates, photo and guest-facing copy — the things a LISTING owns.
 *
 * MONEY IS TYPED IN GUILDERS AND STORED IN CENTS. The conversion happens here,
 * once, on submit — nobody types 6000 into a field labelled "rate". A value that
 * does not parse is refused in the form rather than being sent as NaN.
 *
 * The form is keyed on the listing's updated_at by its parent, so a successful
 * save (which changes updated_at) remounts it against the freshly loaded row
 * instead of leaving a stale draft in the boxes.
 */
function ListingEditor({ car }: { car: FleetCarDetail }) {
  const router = useRouter();

  const asField = (cents: number) => (cents / 100).toString();

  const [rate, setRate] = useState(asField(car.dailyRateCents));
  const [monthlyRate, setMonthlyRate] = useState(asField(car.monthlyRateCents));
  const [photoUrl, setPhotoUrl] = useState(car.photoUrl);
  const [description, setDescription] = useState(car.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const dirty =
    rate !== asField(car.dailyRateCents) ||
    monthlyRate !== asField(car.monthlyRateCents) ||
    photoUrl !== car.photoUrl ||
    description.trim() !== (car.description ?? "").trim();

  async function save() {
    if (busy) return;

    // Parsed here so a typo never becomes a price. `Number("")` is 0, which is a
    // legitimate rate to type but not a legitimate blank, so the empty string is
    // rejected explicitly — for both fields.
    const guilders = Number(rate.trim());
    if (rate.trim() === "" || !Number.isFinite(guilders) || guilders < 0) {
      setError("Enter the daily rate in guilders, e.g. 70 or 62.50.");
      return;
    }
    const monthlyGuilders = Number(monthlyRate.trim());
    if (monthlyRate.trim() === "" || !Number.isFinite(monthlyGuilders) || monthlyGuilders < 0) {
      setError("Enter the monthly rate in guilders, or 0 if this car is not rented by the month.");
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await updateFleetCar({
        data: {
          carId: car.id,
          dailyRateCents: Math.round(guilders * 100),
          monthlyRateCents: Math.round(monthlyGuilders * 100),
          photoUrl,
          description,
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await router.invalidate();
      setSaved("Saved.");
    } catch (cause) {
      console.error(cause);
      setError("Could not save the listing. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="lg:col-span-2" title="Edit this listing">
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        {/* ── the two rates ────────────────────────────────────────────── */}
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Daily rate
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-cw-ink/60">{CURRENCY_CODE}</span>
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                setSaved(null);
              }}
              className={inputClass}
            />
            <span className="whitespace-nowrap text-[12px] text-cw-ink/50">/ day</span>
          </span>
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            The list rate. Length discounts ({DISCOUNT_TIER_SUMMARY}) come off this automatically at
            checkout, so do not build them in here.
          </span>
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Monthly rate
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-cw-ink/60">{CURRENCY_CODE}</span>
            <input
              inputMode="decimal"
              value={monthlyRate}
              onChange={(e) => {
                setMonthlyRate(e.target.value);
                setSaved(null);
              }}
              className={inputClass}
            />
            <span className="whitespace-nowrap text-[12px] text-cw-ink/50">
              / {MONTHLY_PERIOD_DAYS} days
            </span>
          </span>
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            A flat price for a {MONTHLY_PERIOD_DAYS} day rental, with no further discount on top.
            Set 0 to stop offering this car by the month.
          </span>
        </label>

        {/* Said once, under both fields, because it is true of both and is the
            thing an owner most needs to know before changing a price. */}
        <p className="rounded-lg bg-cw-teal-soft/50 px-3 py-2 text-[11px] leading-snug text-cw-ink/70 sm:col-span-2">
          {car.upcoming.length === 0
            ? "Both rates apply to new bookings only. A reservation always keeps the price it was quoted."
            : `Both rates apply to new bookings only. The ${car.upcoming.length} ${
                car.upcoming.length === 1 ? "rental" : "rentals"
              } already on the books keep the price they were quoted.`}{" "}
          Every car on this listing is rented at these rates — a physical car has no price of its
          own.
        </p>

        {/* ── photo ────────────────────────────────────────────────────── */}
        <label className="block sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Photo
          </span>
          <span className="mt-1 flex items-start gap-2">
            <img
              src={photoUrl}
              alt=""
              className="h-[38px] w-[62px] shrink-0 rounded-md border border-cw-navy/10 object-cover"
            />
            <input
              value={photoUrl}
              onChange={(e) => {
                setPhotoUrl(e.target.value);
                setSaved(null);
              }}
              className={inputClass}
            />
          </span>
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            A path under /assets/fleet/ or a full https:// URL. This is a picture of the car marked
            &ldquo;on the site&rdquo; below, which is why new bookings are assigned to that one
            first. Uploading a new photo needs a storage bucket, which is not set up yet.
          </span>
        </label>

        {/* ── description ──────────────────────────────────────────────── */}
        <label className="block sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Description
          </span>
          <textarea
            value={description}
            rows={3}
            maxLength={2000}
            onChange={(e) => {
              setDescription(e.target.value);
              setSaved(null);
            }}
            placeholder="How you would describe this car to a guest…"
            className={`mt-1 resize-y ${inputClass}`}
          />
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            Guest-facing copy for the listing. Stored and public, but the marketing fleet grid still
            renders from src/content/brand.ts, so nothing on the site reads it yet.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-cw-navy/8 px-4 py-3">
        <Button variant="primary" disabled={busy || !dirty} onClick={save}>
          {busy ? "Saving…" : "Save listing"}
        </Button>
        {dirty && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setRate(asField(car.dailyRateCents));
              setMonthlyRate(asField(car.monthlyRateCents));
              setPhotoUrl(car.photoUrl);
              setDescription(car.description ?? "");
              setError(null);
            }}
          >
            Discard
          </Button>
        )}
        {error && (
          <span role="alert" className="text-[12px] font-semibold text-[#b3261e]">
            {error}
          </span>
        )}
        {saved && !dirty && <span className="text-[12px] text-[#1a7a45]">{saved}</span>}
      </div>
    </Panel>
  );
}

/* ── the vehicle editor ────────────────────────────────────────────────────── */

/**
 * One physical car: its condition, its plate, its colour.
 *
 * WHY VISIBILITY IS SHOWN BUT NOT EDITABLE. Which unit a listing advertises is
 * bound to which unit is in the listing's photograph. Flipping a switch here
 * would leave the site showing a black Spark while quietly handing out the grey
 * one — so changing it is a photo change too, and stays a deliberate two-part
 * job rather than a toggle that can be half-done.
 */
function VehicleEditor({ vehicle }: { vehicle: FleetVehicleRow }) {
  const router = useRouter();

  const [status, setStatus] = useState<VehicleStatus>(vehicle.status);
  const [plate, setPlate] = useState(vehicle.plateNumber ?? "");
  const [color, setColor] = useState(vehicle.color);
  const [notes, setNotes] = useState(vehicle.maintenanceNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const dirty =
    status !== vehicle.status ||
    plate.trim() !== (vehicle.plateNumber ?? "").trim() ||
    color.trim() !== vehicle.color.trim() ||
    notes.trim() !== (vehicle.maintenanceNotes ?? "").trim();

  const leavingTheRoad = vehicle.status === "available" && status !== "available";

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await updateFleetVehicle({
        data: {
          vehicleId: vehicle.id,
          status,
          plateNumber: plate,
          color,
          maintenanceNotes: notes,
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await router.invalidate();
      // Three different true things to say, and which one it is matters: a car
      // off the road with rentals on it needs phone calls, and a listing that
      // has just left the site needs to be known about immediately.
      setSaved(
        !result.listingStillBookable
          ? "Saved. This was the last car on the road for this listing — it is no longer offered for new bookings."
          : result.wentOffRoad && result.affectedRentals > 0
            ? `Saved. ${result.affectedRentals} ${
                result.affectedRentals === 1 ? "rental is" : "rentals are"
              } still booked on this car — they have NOT been cancelled.`
            : result.wentOffRoad
              ? "Saved. Nothing was booked on this car, and the listing is still bookable on another."
              : "Saved.",
      );
    } catch (cause) {
      console.error(cause);
      setError("Could not save the car. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id={vehicle.id} className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-[14px] font-extrabold text-cw-navy">
            {vehicle.label}
            {vehicle.isPubliclyVisible ? (
              <span className="ml-2 rounded-md bg-cw-teal-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-cw-teal-dark">
                On the site
              </span>
            ) : (
              <span className="ml-2 rounded-md bg-cw-navy/8 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-cw-navy/60">
                Backup
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[11px] text-cw-ink/50">
            {vehicle.isPubliclyVisible
              ? "The car in the listing's photo. New bookings are assigned to it whenever it is free."
              : "Not shown publicly. Assigned only when the advertised car is already booked for those dates."}
          </p>
        </div>

        <div className="text-right text-[12px] text-cw-ink/60">
          {vehicle.onRentalUntil ? (
            <span className="font-semibold text-[#a3572a]">
              With {vehicle.onRentalFor} until {formatDate(vehicle.onRentalUntil)}
            </span>
          ) : vehicle.nextPickupDate ? (
            <>
              Next out {formatDateShort(vehicle.nextPickupDate)} · {vehicle.nextPickupFor}
            </>
          ) : (
            <span className="text-cw-ink/40">In the yard, nothing booked</span>
          )}
          <span className="block text-[11px] text-cw-ink/45">
            {vehicle.stats.utilisationPct}% used · {formatMoney(vehicle.stats.collectedCents)}{" "}
            collected · {vehicle.upcomingCount} on the books
          </span>
          {vehicle.offRoadSince && (
            <span className="block text-[11px] text-cw-ink/45">
              Off the road since {formatInstant(vehicle.offRoadSince)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Plate
          </span>
          <input
            value={plate}
            maxLength={20}
            onChange={(e) => {
              setPlate(e.target.value);
              setSaved(null);
            }}
            placeholder="Not on file"
            className={`mt-1 ${inputClass}`}
          />
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            {vehicle.plateNumber === null
              ? "Never recorded for this car. Adding it is how the CRM can name the exact vehicle at handover."
              : "Two cars cannot share a plate — the database refuses it."}
          </span>
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Colour
          </span>
          <input
            value={color}
            maxLength={40}
            onChange={(e) => {
              setColor(e.target.value);
              setSaved(null);
            }}
            className={`mt-1 ${inputClass}`}
          />
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            This car&rsquo;s actual colour. The listing has its own, which is what the photo shows.
          </span>
        </label>

        <div className="sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Standing availability
          </span>
          <p className="mt-0.5 text-[11px] text-cw-ink/50">
            This car&rsquo;s own state, not a booking&rsquo;s. A rental&rsquo;s prep status lives on
            the booking.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {VEHICLE_STATUS_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setStatus(option);
                  setSaved(null);
                }}
                aria-pressed={status === option}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  status === option
                    ? "border-cw-teal bg-cw-teal-soft/70"
                    : "border-cw-navy/12 bg-white hover:border-cw-teal/50"
                }`}
              >
                <span className="block text-[13px] font-semibold text-cw-navy">
                  {VEHICLE_STATUS_LABEL[option]}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-cw-ink/55">
                  {VEHICLE_STATUS_MEANING[option]}
                </span>
              </button>
            ))}
          </div>

          {/* Said BEFORE saving, with the real number, because this is the one
              edit on the page that can strand a guest. */}
          {leavingTheRoad && (
            <p className="mt-2 rounded-lg bg-cw-yellow-soft px-3 py-2 text-[12px] text-[#8a6a04]">
              {vehicle.upcomingCount === 0 ? (
                <>Nothing is booked on this car, so taking it off the road affects no one.</>
              ) : (
                <>
                  <span className="font-semibold">
                    {vehicle.upcomingCount}{" "}
                    {vehicle.upcomingCount === 1 ? "rental is" : "rentals are"} already booked on
                    this car.
                  </span>{" "}
                  Taking it off the road stops NEW assignments only — those rentals stand, and each
                  one needs moving to another car or calling off by hand.
                </>
              )}
            </p>
          )}
        </div>

        <label className="block sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Maintenance notes
          </span>
          <textarea
            value={notes}
            rows={3}
            maxLength={5000}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(null);
            }}
            placeholder="What is wrong with it, what was done, what it is waiting on…"
            className={`mt-1 resize-y ${inputClass}`}
          />
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            Staff only. The public site cannot read this table at all.
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={save}>
          {busy ? "Saving…" : "Save car"}
        </Button>
        {dirty && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setStatus(vehicle.status);
              setPlate(vehicle.plateNumber ?? "");
              setColor(vehicle.color);
              setNotes(vehicle.maintenanceNotes ?? "");
              setError(null);
            }}
          >
            Discard
          </Button>
        )}
        {error && (
          <span role="alert" className="text-[12px] font-semibold text-[#b3261e]">
            {error}
          </span>
        )}
        {saved && !dirty && <span className="text-[12px] text-[#1a7a45]">{saved}</span>}
      </div>
    </div>
  );
}
