/**
 * /admin — the dashboard. The landing page after login.
 *
 * Four questions, in the order an owner asks them:
 *   1. What has the business taken?          revenue row + 14-day trend
 *   2. What is happening today and tomorrow?  next pickups and returns
 *   3. How much of the fleet is earning?      occupancy
 *   4. What came in this week?                new bookings
 *
 * All of it arrives in ONE server round trip (`fetchAdminDashboard`), which
 * checks the admin session server-side before it touches the database. The
 * loader means the page is server-rendered complete — no spinner, no flash of
 * empty panels, which for a tool that gets opened twenty times a day matters
 * more than it does on a marketing page.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import AdminShell from "../../../components/admin/shell";
import {
  EmptyState,
  MetricCard,
  Panel,
  Stat,
  StatusPill,
  Td,
  Th,
} from "../../../components/admin/ui";
import { fetchAdminDashboard } from "../../../lib/api/admin.functions";
import {
  formatDate,
  formatDateRange,
  formatDateShort,
  formatDaysAway,
  formatMoney,
  formatTime,
  percentChange,
} from "../../../lib/admin/format";

export const Route = createFileRoute("/admin/_shell/")({
  loader: () => fetchAdminDashboard(),
  head: () => ({ meta: [{ title: "Dashboard | CW back office" }] }),
  component: DashboardPage,
});

function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await router.invalidate();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-lg border border-cw-navy/15 bg-white px-3 py-1.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal disabled:opacity-60"
    >
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}

function DashboardPage() {
  const { admin, data } = Route.useLoaderData();
  const { revenue, booked, week, upcoming, fleet } = data;

  // Each figure is compared against the previous calendar month on its OWN
  // basis. Comparing one to the other would be meaningless — they are not two
  // views of the same money.
  const collectedDelta = percentChange(revenue.monthCents, revenue.previousMonthCents);
  const bookedDelta = percentChange(booked.monthCents, booked.previousMonthCents);

  return (
    <AdminShell
      admin={admin}
      title="Dashboard"
      subtitle={`${formatDate(data.today)} · as of ${data.asOf.slice(11, 16)} island time`}
      actions={<RefreshButton />}
    >
      {/*
        THE TWO MONTHLY FIGURES.
        Side by side and equally weighted on purpose. They answer different
        questions and will routinely disagree, so neither gets to look like the
        headline and the other a footnote — each states its own date basis, in
        its own colour, above its own trend.
      */}
      <div className="grid gap-3 lg:grid-cols-2">
        <MetricCard
          accent="collected"
          label="Revenue collected"
          basis="by pickup date"
          period={data.monthLabel}
          value={formatMoney(revenue.monthCents)}
          explain="Money earned this month: paid bookings, counted on the day the car goes out."
          footnote={`${revenue.monthCount} ${revenue.monthCount === 1 ? "rental" : "rentals"}.`}
          delta={{ pct: collectedDelta, label: "vs last month" }}
          trend={{
            points: revenue.daily,
            labelFor: (date, cents) => `${formatDate(date)} pickups: ${formatMoney(cents)}`,
            startLabel: formatDateShort(revenue.daily[0].date),
            endLabel: formatDateShort(revenue.daily[revenue.daily.length - 1].date),
          }}
        />
        <MetricCard
          accent="booked"
          label="Bookings made"
          basis="by booking date"
          period={data.monthLabel}
          value={formatMoney(booked.monthCents)}
          explain="Sales taken this month, whenever the car actually goes out. Paid or not."
          footnote={`${booked.monthCount} ${booked.monthCount === 1 ? "booking" : "bookings"}.`}
          delta={{ pct: bookedDelta, label: "vs last month" }}
          trend={{
            points: booked.daily,
            labelFor: (date, cents) => `${formatDate(date)} booked: ${formatMoney(cents)}`,
            startLabel: formatDateShort(booked.daily[0].date),
            endLabel: formatDateShort(booked.daily[booked.daily.length - 1].date),
          }}
        />
      </div>

      {/* ── the supporting figures ───────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Collected today"
          value={formatMoney(revenue.todayCents)}
          hint="Pickups collected today"
        />
        {/* "This year", not "year to date": the bucket is the whole calendar
            year on a pickup-date basis, so an already-paid December pickup
            belongs to it. That also keeps the four figures strictly nested —
            today ⊆ July ⊆ 2026 ⊆ all time — which "to date" would break. */}
        <Stat
          label={`Collected ${data.today.slice(0, 4)}`}
          value={formatMoney(revenue.ytdCents)}
          hint={`Pickups dated ${data.today.slice(0, 4)}, paid`}
        />
        <Stat
          label="Collected all time"
          value={formatMoney(revenue.allTimeCents)}
          hint="Every paid booking, any date"
        />
        <Stat
          label="Outstanding"
          value={formatMoney(revenue.outstandingCents)}
          hint="Booked, not yet paid"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ── next movements ─────────────────────────────────────────────── */}
        <Panel
          className="lg:col-span-2"
          title="Next pickups and returns"
          subtitle="Anything already late is listed first"
        >
          {upcoming.length === 0 ? (
            <EmptyState>Nothing on the schedule.</EmptyState>
          ) : (
            <ul className="divide-y divide-cw-navy/8">
              {upcoming.map((m) => (
                <li key={`${m.bookingId}-${m.kind}`} className="flex items-start gap-3 px-4 py-3">
                  {/* Pickup and return are the two halves of the day's work, so
                      they get opposite colours rather than a shared label. */}
                  <span
                    className={`mt-0.5 inline-flex w-[62px] shrink-0 justify-center rounded-md py-0.5 text-[11px] font-bold uppercase tracking-[0.04em] ${
                      m.kind === "pickup"
                        ? "bg-cw-teal-soft text-cw-teal-dark"
                        : "bg-cw-peach-soft text-[#a3572a]"
                    }`}
                  >
                    {m.kind}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-cw-navy">
                      {m.clientName}
                      {/* The listing, then the actual car. A pickup line that
                          named only the model would not say which key. */}
                      <span className="font-normal text-cw-ink/55">
                        {" "}
                        · {m.carLabel} <span className="text-cw-ink/40">({m.vehicleLabel})</span>
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-cw-ink/55">
                      {formatDate(m.date)}, {formatTime(m.time)} · {m.location}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`text-[12px] font-semibold ${
                        m.daysAway < 0 ? "text-[#b3261e]" : "text-cw-ink/70"
                      }`}
                    >
                      {formatDaysAway(m.daysAway)}
                    </p>
                    <div className="mt-1 flex justify-end gap-1">
                      <StatusPill value={m.paymentStatus} title="Payment status" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── occupancy ──────────────────────────────────────────────────── */}
        {/* self-start so a long movements list beside it does not stretch this
            panel into a column of white space. */}
        <Panel
          className="lg:self-start"
          title="Occupancy now"
          // PHYSICAL cars, not listings: two Sparks are two cars that can be out
          // at once, and counting listings here would put the fleet at five and
          // overstate how busy it is. The listing count is said alongside so the
          // two numbers cannot be mistaken for each other.
          subtitle={`${fleet.outNow} of ${fleet.total} cars on rental · ${fleet.listings} listings`}
        >
          <div className="px-4 pb-4 pt-4">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[34px] font-extrabold leading-none tabular-nums tracking-tight text-cw-navy">
                {fleet.occupancyPct}%
              </span>
              <span className="text-[12px] text-cw-ink/55">of the fleet is out</span>
            </div>

            {/* One bar, three segments: out / free / off the road. Widths are
                percentages of the whole fleet so the bar always fills. */}
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-cw-navy/8">
              {fleet.total > 0 && (
                <>
                  <div
                    className="bg-cw-teal"
                    style={{ width: `${(fleet.outNow / fleet.total) * 100}%` }}
                  />
                  <div
                    className="bg-cw-mint"
                    style={{ width: `${(fleet.availableNow / fleet.total) * 100}%` }}
                  />
                  <div
                    className="bg-cw-navy/25"
                    style={{ width: `${(fleet.offRoad / fleet.total) * 100}%` }}
                  />
                </>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-cw-ink/60">
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-cw-teal" /> {fleet.outNow} out
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-cw-mint" /> {fleet.availableNow} free
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full bg-cw-navy/25" /> {fleet.offRoad} off road
              </span>
            </div>

            <ul className="mt-4 divide-y divide-cw-navy/8 border-t border-cw-navy/8">
              {fleet.cars.map((car) => (
                <li key={car.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-cw-navy">
                      {car.label}
                    </span>
                    {!car.isPubliclyVisible && (
                      <span
                        className="shrink-0 rounded bg-cw-navy/8 px-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-cw-navy/60"
                        title="Backup unit — not shown on the public site"
                      >
                        backup
                      </span>
                    )}
                  </span>
                  {car.onRentalUntil ? (
                    <span className="shrink-0 text-[11px] text-cw-ink/60">
                      out until {formatDateShort(car.onRentalUntil)}
                    </span>
                  ) : (
                    <StatusPill value={car.status} />
                  )}
                </li>
              ))}
              {fleet.cars.length === 0 && <EmptyState>No cars in the fleet yet.</EmptyState>}
            </ul>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        {/* The week's slice of "Bookings made" above: same created_at basis,
            drilled down to the individual reservations. */}
        <Panel
          title="Booked this week"
          subtitle={`${week.count} ${week.count === 1 ? "booking" : "bookings"} · ${formatMoney(
            week.valueCents,
          )} taken · ${formatDateRange(week.start, week.end)}`}
        >
          {week.bookings.length === 0 ? (
            <EmptyState>No new bookings this week yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead className="border-b border-cw-navy/8">
                  <tr>
                    <Th>Guest</Th>
                    <Th>Car</Th>
                    <Th>Dates</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cw-navy/8">
                  {week.bookings.map((b) => (
                    <tr key={b.id}>
                      <Td className="font-semibold text-cw-navy">{b.clientName}</Td>
                      <Td className="text-cw-ink/70">
                        {b.carLabel}
                        <span className="block text-[11px] text-cw-ink/45">{b.vehicleLabel}</span>
                      </Td>
                      <Td className="whitespace-nowrap text-cw-ink/70">
                        {formatDateShort(b.pickupDate)} → {formatDateShort(b.returnDate)}
                        <span className="text-cw-ink/45"> · {b.days}d</span>
                      </Td>
                      <Td align="right" className="font-semibold text-cw-navy">
                        {formatMoney(b.totalCents)}
                      </Td>
                      <Td align="right">
                        <span className="inline-flex gap-1">
                          <StatusPill value={b.bookingStatus} title="Booking status" />
                          <StatusPill value={b.paymentStatus} title="Payment status" />
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* The headline count is the whole week; the table is the newest
                  few. Saying so is cheaper than making the reader count rows
                  and wonder which number is wrong. */}
              {week.count > week.bookings.length && (
                <p className="border-t border-cw-navy/8 px-3 py-2 text-[12px] text-cw-ink/50">
                  Showing the {week.bookings.length} most recent of {week.count}.
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
