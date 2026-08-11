/**
 * /admin/fleet — five cars, what they cost, and what they earn.
 *
 * The page answers three questions in one screen, in the order an owner asks
 * them: is anything off the road, what is each car doing right now, and which
 * car is not paying for itself.
 *
 * THE EARNINGS COLUMN IS THE POINT. A fleet table that lists model, colour and
 * rate tells an owner what they already know. The stub this replaces promised
 * "utilisation and revenue per car, so a car that never earns is visible", so
 * every row carries both, over a window stated at the top of the page, with a
 * bar drawn against the best-earning car — a laggard is meant to be visible from
 * the doorway, not after arithmetic.
 */
import { createFileRoute, Link } from "@tanstack/react-router";

import AdminShell from "../../../components/admin/shell";
import { EmptyState, Panel, Stat, StatusPill, Td, Th } from "../../../components/admin/ui";
import { fetchAdminFleet } from "../../../lib/api/admin.functions";
import {
  CAR_STATUS_LABEL,
  DEFAULT_STATS_WINDOW,
  STATS_WINDOWS,
  STATS_WINDOW_LABEL,
  isStatsWindow,
  type StatsWindow,
} from "../../../lib/admin/fleet";
import { formatDateShort, formatMoney } from "../../../lib/admin/format";
import type { FleetCarRow } from "../../../lib/admin/types";

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

/** What the car is doing at this moment, in one line. Ordered by what an owner
 *  needs to act on: off the road first, then out with a guest, then what is
 *  next, then the honest "nothing booked". */
function CarActivity({ car }: { car: FleetCarRow }) {
  if (car.status !== "available") {
    return (
      <span className="text-[12px] text-cw-ink/60">
        {CAR_STATUS_LABEL[car.status]}
        {car.offRoadDays !== null && (
          <span className="text-cw-ink/45">
            {" "}
            · {car.offRoadDays} {car.offRoadDays === 1 ? "day" : "days"}
          </span>
        )}
      </span>
    );
  }
  if (car.onRentalUntil) {
    return (
      <span className="text-[12px] text-cw-ink/70">
        With {car.onRentalFor} until {formatDateShort(car.onRentalUntil)}
      </span>
    );
  }
  if (car.nextPickupDate) {
    return (
      <span className="text-[12px] text-cw-ink/70">
        Next out {formatDateShort(car.nextPickupDate)} · {car.nextPickupFor}
      </span>
    );
  }
  return <span className="text-[12px] text-cw-ink/40">Free, nothing booked</span>;
}

function FleetPage() {
  const { admin, fleet } = Route.useLoaderData();
  const { cars, totals } = fleet;

  // The bars compare cars against the BEST earner, not against the fleet total:
  // "half of what the Venue took" is a sentence an owner can act on, where "18%
  // of everything" is not.
  const bestCollected = Math.max(...cars.map((c) => c.stats.collectedCents), 0);

  return (
    <AdminShell
      admin={admin}
      title="Fleet"
      subtitle={`${totals.cars} cars · ${totals.outNow} out now · ${totals.offRoad} off the road`}
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
          value={`${totals.outNow} of ${totals.cars}`}
          hint="On rental at this moment"
        />
        <Stat
          label="Off the road"
          value={String(totals.offRoad)}
          hint={totals.offRoad === 0 ? "Every car is bookable" : "Not offered for new dates"}
        />
      </div>

      <div className="mt-4">
        <Panel
          title="The cars"
          subtitle={`Earnings and utilisation from ${formatDateShort(fleet.windowStart)} to ${formatDateShort(
            fleet.windowEnd,
          )}. Rates apply to new bookings only — a reservation keeps the price it was quoted.`}
        >
          {cars.length === 0 ? (
            <EmptyState>No cars in the fleet yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead className="border-b border-cw-navy/8">
                  <tr>
                    <Th>Car</Th>
                    <Th>Standing</Th>
                    <Th align="right">Rates</Th>
                    <Th align="right">Utilisation</Th>
                    <Th align="right">Collected</Th>
                    <Th align="right">Rentals</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cw-navy/8">
                  {cars.map((car) => (
                    <tr key={car.id} className="hover:bg-cw-teal-soft/25">
                      <Td>
                        <div className="flex items-center gap-3">
                          <img
                            src={car.photoUrl}
                            alt=""
                            className="h-10 w-16 shrink-0 rounded-md border border-cw-navy/10 object-cover"
                          />
                          <div className="min-w-0">
                            <Link
                              to="/admin/fleet/$carId"
                              params={{ carId: car.id }}
                              className="font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                            >
                              {car.label}
                            </Link>
                            <span className="block text-[11px] text-cw-ink/45">{car.category}</span>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <StatusPill value={car.status} title="Standing availability" />
                          <CarActivity car={car} />
                          {/* Internal, and only ever rendered behind requireAdmin —
                              the anon role holds no privilege on this column. */}
                          {car.maintenanceNotes && (
                            <span
                              className="max-w-[240px] truncate text-[11px] text-cw-ink/50"
                              title={car.maintenanceNotes}
                            >
                              {car.maintenanceNotes}
                            </span>
                          )}
                        </div>
                      </Td>
                      {/* Both products, one column: a car's price list is the
                          daily rate and the monthly rate together, and reading
                          them apart is how you miss that one has not been set. */}
                      <Td align="right" className="whitespace-nowrap">
                        <span className="font-semibold text-cw-navy">
                          {formatMoney(car.dailyRateCents)}
                        </span>
                        <span className="text-[11px] text-cw-ink/45"> / day</span>
                        <span className="block text-[11px]">
                          {car.monthlyRateCents > 0 ? (
                            <>
                              <span className="font-semibold text-cw-ink/70">
                                {formatMoney(car.monthlyRateCents)}
                              </span>
                              <span className="text-cw-ink/45"> / month</span>
                            </>
                          ) : (
                            <span className="text-cw-ink/45">not offered monthly</span>
                          )}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="font-semibold text-cw-navy">
                          {car.stats.utilisationPct}%
                        </span>
                        <span className="block text-[11px] text-cw-ink/45">
                          {car.stats.daysOut} of {car.stats.windowDays} days
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="font-semibold text-cw-navy">
                          {formatMoney(car.stats.collectedCents)}
                        </span>
                        {/* Against the best earner, so the gap is the message. */}
                        <span className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-cw-navy/8">
                          <span
                            className={car.stats.collectedCents > 0 ? "bg-cw-teal" : ""}
                            style={{
                              width:
                                bestCollected === 0
                                  ? "0%"
                                  : `${(car.stats.collectedCents / bestCollected) * 100}%`,
                            }}
                          />
                        </span>
                      </Td>
                      <Td align="right" className="text-cw-ink/70">
                        {car.stats.rentals}
                        <span className="block text-[11px] text-cw-ink/45">
                          {car.stats.rentals === 0
                            ? "none started"
                            : `avg ${car.stats.averageRentalDays} days`}
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
