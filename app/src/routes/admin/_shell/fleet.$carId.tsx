/**
 * /admin/fleet/:carId — one car: what it is, what it earns, who has it when.
 *
 * THE EDIT FORM IS THE POINT OF THIS PAGE, and two of its fields reach further
 * than they look, so both say so on screen rather than in a comment only a
 * developer reads:
 *
 *   Rate    changes what FUTURE bookings are quoted. It cannot reprice a
 *           reservation that already exists — `bookings.total_price` was struck
 *           when the booking was taken and nothing recomputes it.
 *
 *   Standing availability   anything other than "on the road" removes the car
 *           from the booking page for every future date at once. It does NOT
 *           cancel, move or otherwise touch a rental already on the books; if
 *           there are any, the page says how many, before and after saving,
 *           because that is a job for a human and a phone call.
 *
 * The month strip below is the same component, geometry and colours as the
 * bookings calendar (src/components/admin/bookings-timeline.tsx), so a car's own
 * schedule and the fleet calendar can never disagree about where a bar starts.
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
import { fetchAdminFleetCar, updateFleetCar } from "../../../lib/api/admin.functions";
import {
  CAR_STATUS_LABEL,
  CAR_STATUS_MEANING,
  CAR_STATUS_ORDER,
  DEFAULT_STATS_WINDOW,
  STATS_WINDOWS,
  STATS_WINDOW_LABEL,
  isStatsWindow,
  type StatsWindow,
} from "../../../lib/admin/fleet";
import { isMonthKey } from "../../../lib/admin/clock";
import {
  formatDate,
  formatDateShort,
  formatInstant,
  formatMoney,
  formatTime,
} from "../../../lib/admin/format";
import type { CarStatus } from "../../../lib/supabase/types";
import type { FleetCarDetail } from "../../../lib/admin/types";

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

function CarPage() {
  const { admin, car } = Route.useLoaderData();
  const search = Route.useSearch();

  if (!car) {
    return (
      <AdminShell admin={admin} title="Car not found">
        <Panel>
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-cw-ink/60">
              No car with that id is in the fleet. It may have been renamed.
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

  return (
    <AdminShell
      admin={admin}
      title={car.label}
      subtitle={`${car.category} · ${car.transmission} · ${car.seats} seats · ${formatMoney(
        car.dailyRateCents,
      )} a day`}
      actions={
        <div className="flex items-center gap-2">
          <StatusPill value={car.status} title="Standing availability" />
          <Link
            to="/admin/fleet"
            className="rounded-lg border border-cw-navy/15 bg-white px-3 py-1.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal"
          >
            ‹ All cars
          </Link>
        </div>
      }
    >
      {/* Standing state first: if the car is off the road, that is the headline
          and everything else on the page is context for it. */}
      {car.status !== "available" && (
        <div className="mb-3 rounded-lg bg-cw-yellow-soft px-3 py-2.5 text-[13px] text-[#8a6a04]">
          <span className="font-semibold">
            {CAR_STATUS_LABEL[car.status]}
            {car.offRoadDays !== null &&
              ` for ${car.offRoadDays} ${car.offRoadDays === 1 ? "day" : "days"}`}
            .
          </span>{" "}
          It is not being offered for new bookings. Rentals already on the books are unaffected —
          they are listed below.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <CarEditor key={car.updatedAt} car={car} />

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
                hint={`${car.stats.daysOut} of ${car.stats.windowDays} days out`}
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
              <Field label="Fleet id" value={car.id} mono />
              <Field
                label="Right now"
                value={
                  car.onRental
                    ? `With ${car.onRental.clientName} until ${formatDate(car.onRental.returnDate)}`
                    : car.status === "available"
                      ? "On the forecourt"
                      : CAR_STATUS_LABEL[car.status]
                }
              />
              <Field
                label="Off the road since"
                value={car.offRoadSince ? formatInstant(car.offRoadSince) : null}
                hint={car.status === "available" ? "It is on the road." : undefined}
              />
              <Field label="Last edited" value={formatInstant(car.updatedAt)} />
            </div>
          </Panel>
        </div>
      </div>

      {/* ── this car's month ─────────────────────────────────────────────── */}
      <div className="mt-4">
        <Panel title="This car's calendar" action={<CarMonthNav car={car} search={search} />}>
          <TimelineGrid
            days={car.days}
            rows={[car.timeline]}
            today={car.today}
            showCarColumn={false}
          />
          <TimelineLegend />
        </Panel>
      </div>

      {/* ── what is still to come ────────────────────────────────────────── */}
      <div className="mt-4">
        <Panel
          title="Rentals still on the books"
          subtitle={
            car.upcoming.length === 0
              ? "Nothing outstanding — every rental on this car is finished"
              : `${car.upcoming.length} ${car.upcoming.length === 1 ? "rental" : "rentals"} not yet returned, including any in progress. These stand whatever the car's status.`
          }
        >
          {car.upcoming.length === 0 ? (
            <EmptyState>
              {car.status === "available"
                ? "Nothing outstanding. This car is free for any dates."
                : "Nothing outstanding, so taking it off the road affects no one."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead className="border-b border-cw-navy/8">
                  <tr>
                    <Th>Guest</Th>
                    <Th>Pickup</Th>
                    <Th>Return</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cw-navy/8">
                  {car.upcoming.map((rental) => (
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
                        {rental.bookingId === car.onRental?.bookingId && (
                          <span className="ml-2 rounded-md bg-cw-peach-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[#a3572a]">
                            Out now
                          </span>
                        )}
                      </Td>
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

/** Month navigation for this car. Deliberately its own few lines rather than a
 *  generalised version of the bookings page's: the two link to different routes
 *  and summarise different things, and a shared component would take a render
 *  prop for every part that differs. */
function CarMonthNav({ car, search }: { car: FleetCarDetail; search: CarSearch }) {
  const linkClass =
    "inline-flex h-[30px] items-center rounded-lg border border-cw-navy/15 bg-white px-2.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal";
  const bars = car.timeline.bars.length;

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

/* ── the editor ────────────────────────────────────────────────────────────── */

/**
 * Rate, standing availability, photo and maintenance notes.
 *
 * MONEY IS TYPED IN DOLLARS AND STORED IN CENTS. The conversion happens here,
 * once, on submit — nobody types 5500 into a field labelled "rate". A value that
 * does not parse is refused in the form rather than being sent as NaN.
 *
 * The whole form is keyed on the car's updated_at by its parent, so a successful
 * save (which changes updated_at) remounts it against the freshly loaded row
 * instead of leaving a stale draft in the boxes.
 */
function CarEditor({ car }: { car: FleetCarDetail }) {
  const router = useRouter();

  const [rate, setRate] = useState((car.dailyRateCents / 100).toString());
  const [status, setStatus] = useState<CarStatus>(car.status);
  const [photoUrl, setPhotoUrl] = useState(car.photoUrl);
  const [notes, setNotes] = useState(car.maintenanceNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const dirty =
    rate !== (car.dailyRateCents / 100).toString() ||
    status !== car.status ||
    photoUrl !== car.photoUrl ||
    notes.trim() !== (car.maintenanceNotes ?? "").trim();

  const leavingTheRoad = car.status === "available" && status !== "available";
  const upcoming = car.upcoming.length;

  const inputClass =
    "w-full rounded-lg border border-cw-navy/15 bg-white px-3 py-2 text-[13px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20";

  async function save() {
    if (busy) return;

    // Parsed here so a typo never becomes a price. `Number("")` is 0, which is a
    // legitimate rate to type but not a legitimate blank, so the empty string is
    // rejected explicitly.
    const dollars = Number(rate.trim());
    if (rate.trim() === "" || !Number.isFinite(dollars) || dollars < 0) {
      setError("Enter the daily rate in dollars, e.g. 55 or 52.50.");
      return;
    }
    const cents = Math.round(dollars * 100);

    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await updateFleetCar({
        data: {
          carId: car.id,
          dailyRateCents: cents,
          status,
          photoUrl,
          maintenanceNotes: notes,
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await router.invalidate();
      setSaved(
        result.wentOffRoad && result.affectedRentals > 0
          ? `Saved. ${result.affectedRentals} ${
              result.affectedRentals === 1 ? "rental is" : "rentals are"
            } still booked on this car — they have NOT been cancelled.`
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
    <Panel className="lg:col-span-2" title="Edit this car">
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        {/* ── rate ─────────────────────────────────────────────────────── */}
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Daily rate
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="text-[14px] font-semibold text-cw-ink/60">$</span>
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                setSaved(null);
              }}
              className={inputClass}
            />
          </span>
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            {car.upcoming.length === 0
              ? "Applies to new bookings only. A reservation always keeps the price it was quoted."
              : `Applies to new bookings only. The ${car.upcoming.length} already on the books keep the price they were quoted.`}
          </span>
        </label>

        {/* ── photo ────────────────────────────────────────────────────── */}
        <label className="block">
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
            A path under /assets/fleet/ or a full https:// URL. Uploading a new photo needs a
            storage bucket, which is not set up yet.
          </span>
        </label>

        {/* ── standing availability ────────────────────────────────────── */}
        <div className="sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Standing availability
          </span>
          <p className="mt-0.5 text-[11px] text-cw-ink/50">
            The car&rsquo;s own state, not a booking&rsquo;s. A rental&rsquo;s prep status lives on
            the booking.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {CAR_STATUS_ORDER.map((option) => (
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
                  {CAR_STATUS_LABEL[option]}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-cw-ink/55">
                  {CAR_STATUS_MEANING[option]}
                </span>
              </button>
            ))}
          </div>

          {/* Said BEFORE saving, with the real number, because this is the one
              edit on the page that can strand a guest. */}
          {leavingTheRoad && (
            <p className="mt-2 rounded-lg bg-cw-yellow-soft px-3 py-2 text-[12px] text-[#8a6a04]">
              {upcoming === 0 ? (
                <>Nothing is booked on this car, so taking it off the road affects no one.</>
              ) : (
                <>
                  <span className="font-semibold">
                    {upcoming} {upcoming === 1 ? "rental is" : "rentals are"} already booked on this
                    car.
                  </span>{" "}
                  Taking it off the road stops NEW bookings only — those rentals stand, and each one
                  needs moving to another car or calling off by hand.
                </>
              )}
            </p>
          )}
        </div>

        {/* ── maintenance notes ────────────────────────────────────────── */}
        <label className="block sm:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
            Maintenance notes
          </span>
          <textarea
            value={notes}
            rows={4}
            maxLength={5000}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(null);
            }}
            placeholder="What is wrong with it, what was done, what it is waiting on…"
            className={`mt-1 resize-y ${inputClass}`}
          />
          <span className="mt-1 block text-[11px] text-cw-ink/50">
            Staff only. The public site cannot read this column at all.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-cw-navy/8 px-4 py-3">
        <Button variant="primary" disabled={busy || !dirty} onClick={save}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        {dirty && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setRate((car.dailyRateCents / 100).toString());
              setStatus(car.status);
              setPhotoUrl(car.photoUrl);
              setNotes(car.maintenanceNotes ?? "");
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
