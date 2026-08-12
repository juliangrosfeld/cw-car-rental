/**
 * /admin/fleet — what CW advertises, and what CW actually owns.
 *
 * THE PAGE IS ORGANISED THE WAY THE FLEET IS (migration 0005): a LISTING is what
 * a guest books, and under each one sit the PHYSICAL CARS that back it. Five
 * listings, six cars — and the sixth, a grey Spark, is the reason this page can
 * no longer be one flat table. It exists, it earns, it can be handed to a guest,
 * and it appears nowhere on the public site.
 *
 * WHAT BELONGS TO WHICH LEVEL, since reading a number at the wrong one is the
 * mistake this layout is arranged to prevent:
 *
 *   LISTING   the price list, the photo, and the combined earnings of every car
 *             behind it. Utilisation here is measured against COMBINED capacity:
 *             two Sparks over 90 days is 180 car-days, so keeping one of them
 *             rented the whole time is 50%, not 100%.
 *
 *   VEHICLE   condition, plate, who has it right now, and what that one car
 *             earned. This is the row an owner acts on — a car goes into the
 *             shop, not a listing.
 *
 * THE EARNINGS COLUMN IS STILL THE POINT. Every row carries utilisation and
 * takings over a window stated at the top of the page, with a bar drawn against
 * the best-earning listing, so a laggard is visible from the doorway rather than
 * after arithmetic. What the split adds is the ability to see that a listing is
 * doing well because one of its cars is working and the other never leaves the
 * yard.
 */
import { createFileRoute, Link } from "@tanstack/react-router";

import AdminShell from "../../../components/admin/shell";
import { EmptyState, Panel, Stat, StatusPill, Td, Th } from "../../../components/admin/ui";
import { fetchAdminFleet } from "../../../lib/api/admin.functions";
import {
  DEFAULT_STATS_WINDOW,
  STATS_WINDOWS,
  STATS_WINDOW_LABEL,
  VEHICLE_STATUS_LABEL,
  isStatsWindow,
  type StatsWindow,
} from "../../../lib/admin/fleet";
import { formatDateShort, formatMoney } from "../../../lib/admin/format";
import type { FleetCarRow, FleetVehicleRow } from "../../../lib/admin/types";

interface FleetSearch {
  /** Stats window in days. Absent means the default. */
  window?: StatsWindow;
}

export const Route = createFileRoute("/admin/_shell/fleet/")({
  validateSearch: (search: Record<string, unknown>): FleetSearch => ({
    // Anything else in the URL is dropped rather than sent on: the server would
    // reject it, and the page should simply show the default window.
    window: isStatsWindow(Number(search.window))
      ? (Number(search.window) as StatsWindow)
      : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => fetchAdminFleet({ data: { windowDays: deps.window ?? null } }),
  head: () => ({ meta: [{ title: "Fleet | CW back office" }] }),
  component: FleetPage,
});

function WindowPicker({ active }: { active: number }) {
  return (
    <div className="inline-flex rounded-xl border border-cw-navy/15 bg-white p-0.5">
      {STATS_WINDOWS.map((days) => (
        <Link
          key={days}
          to="/admin/fleet"
          search={{ window: days === DEFAULT_STATS_WINDOW ? undefined : days }}
          className={`rounded-lg px-3 py-1.5 font-display text-[13px] font-bold transition-colors ${
            days === active ? "bg-cw-navy text-white" : "text-cw-navy/60 hover:text-cw-navy"
          }`}
        >
          {STATS_WINDOW_LABEL[days]}
        </Link>
      ))}
    </div>
  );
}

/** What one physical car is doing at this moment, in one line. Ordered by what
 *  an owner needs to act on: off the road first, then out with a guest, then
 *  what is next, then the honest "nothing booked". */
function VehicleActivity({ vehicle }: { vehicle: FleetVehicleRow }) {
  if (vehicle.status !== "available") {
    return (
      <span className="text-[12px] text-cw-ink/60">
        {VEHICLE_STATUS_LABEL[vehicle.status]}
        {vehicle.offRoadDays !== null && (
          <span className="text-cw-ink/45">
            {" "}
            · {vehicle.offRoadDays} {vehicle.offRoadDays === 1 ? "day" : "days"}
          </span>
        )}
      </span>
    );
  }
  if (vehicle.onRentalUntil) {
    return (
      <span className="text-[12px] text-cw-ink/70">
        With {vehicle.onRentalFor} until {formatDateShort(vehicle.onRentalUntil)}
      </span>
    );
  }
  if (vehicle.nextPickupDate) {
    return (
      <span className="text-[12px] text-cw-ink/70">
        Next out {formatDateShort(vehicle.nextPickupDate)} · {vehicle.nextPickupFor}
      </span>
    );
  }
  return <span className="text-[12px] text-cw-ink/40">Free, nothing booked</span>;
}

/** "Shown on the site" / "Backup unit". Said in words rather than with a colour,
 *  because it changes what a guest can see and is worth reading. */
function VisibilityTag({ visible }: { visible: boolean }) {
  return visible ? (
    <span
      className="rounded-md bg-cw-teal-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-cw-teal-dark"
      title="This is the car in the listing's photo. New bookings are assigned to it first."
    >
      On the site
    </span>
  ) : (
    <span
      className="rounded-md bg-cw-navy/8 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-cw-navy/60"
      title="Not shown publicly. Used when the advertised car is already booked."
    >
      Backup
    </span>
  );
}

/** One listing, with the cars behind it. */
function ListingBlock({ listing, bestCollected }: { listing: FleetCarRow; bestCollected: number }) {
  return (
    <Panel className="mt-3">
      {/* ── the listing ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-cw-navy/8 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={listing.photoUrl}
            alt=""
            className="h-12 w-20 shrink-0 rounded-md border border-cw-navy/10 object-cover"
          />
          <div className="min-w-0">
            <Link
              to="/admin/fleet/$carId"
              params={{ carId: listing.id }}
              className="font-display text-[15px] font-extrabold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
            >
              {listing.label}
            </Link>
            <p className="text-[11px] text-cw-ink/50">
              {listing.category} ·{" "}
              {listing.vehicleCount === 1
                ? "1 car"
                : `${listing.vehicleCount} cars, ${listing.hiddenCount} not shown publicly`}
              {!listing.bookable && (
                <span className="ml-1 font-semibold text-[#b3261e]">· not bookable</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          {/* Both products, one place: a listing's price list is the daily rate
              and the monthly rate together, and reading them apart is how you
              miss that one has not been set. */}
          <div className="whitespace-nowrap text-right">
            <span className="font-semibold text-cw-navy">
              {formatMoney(listing.dailyRateCents)}
            </span>
            <span className="text-[11px] text-cw-ink/45"> / day</span>
            <span className="block text-[11px]">
              {listing.monthlyRateCents > 0 ? (
                <>
                  <span className="font-semibold text-cw-ink/70">
                    {formatMoney(listing.monthlyRateCents)}
                  </span>
                  <span className="text-cw-ink/45"> / month</span>
                </>
              ) : (
                <span className="text-cw-ink/45">not offered monthly</span>
              )}
            </span>
          </div>

          <div className="whitespace-nowrap text-right">
            <span className="font-semibold text-cw-navy">{listing.stats.utilisationPct}%</span>
            <span className="block text-[11px] text-cw-ink/45">
              {listing.stats.daysOut} of {listing.stats.windowDays * listing.vehicleCount} car-days
            </span>
          </div>

          <div className="min-w-[104px] text-right">
            <span className="font-semibold text-cw-navy">
              {formatMoney(listing.stats.collectedCents)}
            </span>
            {/* Against the best-earning listing, so the gap is the message. */}
            <span className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-cw-navy/8">
              <span
                className={listing.stats.collectedCents > 0 ? "bg-cw-teal" : ""}
                style={{
                  width:
                    bestCollected === 0
                      ? "0%"
                      : `${(listing.stats.collectedCents / bestCollected) * 100}%`,
                }}
              />
            </span>
          </div>
        </div>
      </div>

      {/* ── the cars behind it ──────────────────────────────────────────── */}
      {listing.vehicles.length === 0 ? (
        <EmptyState>
          No physical car is assigned to this listing, so it cannot be booked at all.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="border-b border-cw-navy/8">
              <tr>
                <Th>Car</Th>
                <Th>Standing</Th>
                <Th align="right">Utilisation</Th>
                <Th align="right">Collected</Th>
                <Th align="right">Rentals</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cw-navy/8">
              {listing.vehicles.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-cw-teal-soft/25">
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/admin/fleet/$carId"
                        params={{ carId: listing.id }}
                        hash={vehicle.id}
                        className="font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                      >
                        {vehicle.label}
                      </Link>
                      <VisibilityTag visible={vehicle.isPubliclyVisible} />
                    </div>
                    {vehicle.plateNumber === null && (
                      <span className="block text-[11px] text-cw-ink/45">
                        No plate on file — add it on the car&rsquo;s page
                      </span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusPill value={vehicle.status} title="Standing availability" />
                      <VehicleActivity vehicle={vehicle} />
                      {/* Internal, and only ever rendered behind requireAdmin —
                          the anon role holds no privilege on this table. */}
                      {vehicle.maintenanceNotes && (
                        <span
                          className="max-w-[240px] truncate text-[11px] text-cw-ink/50"
                          title={vehicle.maintenanceNotes}
                        >
                          {vehicle.maintenanceNotes}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td align="right">
                    <span className="font-semibold text-cw-navy">
                      {vehicle.stats.utilisationPct}%
                    </span>
                    <span className="block text-[11px] text-cw-ink/45">
                      {vehicle.stats.daysOut} of {vehicle.stats.windowDays} days
                    </span>
                  </Td>
                  <Td align="right" className="font-semibold text-cw-navy">
                    {formatMoney(vehicle.stats.collectedCents)}
                  </Td>
                  <Td align="right" className="text-cw-ink/70">
                    {vehicle.stats.rentals}
                    <span className="block text-[11px] text-cw-ink/45">
                      {vehicle.stats.rentals === 0
                        ? "none started"
                        : `avg ${vehicle.stats.averageRentalDays} days`}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function FleetPage() {
  const { admin, fleet } = Route.useLoaderData();
  const { cars, totals } = fleet;

  const bestCollected = Math.max(...cars.map((c) => c.stats.collectedCents), 0);

  return (
    <AdminShell
      admin={admin}
      title="Fleet"
      subtitle={`${totals.listings} listings · ${totals.vehicles} cars · ${totals.outNow} out now · ${totals.offRoad} off the road`}
      actions={<WindowPicker active={fleet.windowDays} />}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Collected"
          value={formatMoney(totals.collectedCents)}
          hint={`Paid rentals, ${STATS_WINDOW_LABEL[fleet.windowDays as StatsWindow].toLowerCase()}`}
          emphasis
        />
        <Stat
          label="Fleet utilisation"
          value={`${totals.utilisationPct}%`}
          hint="Car-days rented ÷ car-days available"
        />
        <Stat
          label="Out right now"
          value={`${totals.outNow} of ${totals.vehicles}`}
          hint="Physical cars on rental at this moment"
        />
        {/* The one figure on this page that only makes sense after the split, so
            it says what it counts rather than assuming the reader knows. */}
        <Stat
          label="Cars vs listings"
          value={`${totals.vehicles} / ${totals.listings}`}
          hint={
            totals.hidden === 0
              ? "Every car is advertised"
              : `${totals.hidden} backup ${totals.hidden === 1 ? "car" : "cars"} not shown publicly`
          }
        />
      </div>

      <div className="mt-4">
        <Panel
          title="Listings and cars"
          subtitle={`Earnings and utilisation from ${formatDateShort(fleet.windowStart)} to ${formatDateShort(
            fleet.windowEnd,
          )}. Rates apply to new bookings only — a reservation keeps the price it was quoted.`}
        >
          <p className="px-4 py-3 text-[12px] leading-relaxed text-cw-ink/60">
            A guest books a <span className="font-semibold text-cw-navy">listing</span>. The booking
            holds one specific <span className="font-semibold text-cw-navy">car</span>, chosen when
            it is taken: the advertised one whenever it is free, a backup when it is not. A listing
            stays bookable while any of its cars is on the road.
          </p>
        </Panel>

        {cars.length === 0 ? (
          <Panel className="mt-3">
            <EmptyState>No cars in the fleet yet.</EmptyState>
          </Panel>
        ) : (
          cars.map((listing) => (
            <ListingBlock key={listing.id} listing={listing} bestCollected={bestCollected} />
          ))
        )}
      </div>
    </AdminShell>
  );
}
