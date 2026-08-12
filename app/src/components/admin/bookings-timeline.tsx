/**
 * The month timeline: one row per PHYSICAL CAR, one column per day, one bar per
 * booking.
 *
 * ROWS ARE VEHICLES, NOT LISTINGS (migration 0005). A listing backed by two cars
 * gets two rows, because both can be rented over the same week — drawing that in
 * one row would stack the bars into lanes, which is the shape this calendar uses
 * to mean "these overlap", i.e. exactly the wrong message.
 *
 * Presentational only. Every bar arrives from the server with its column, span
 * and lane already computed (src/lib/admin/timeline.ts), so this file is layout
 * and colour and nothing else — there is no date arithmetic below.
 *
 * WHY A CSS GRID AND NOT ABSOLUTE PERCENTAGES
 * Percentage-positioned bars drift against the day headers by a fraction of a
 * column as the container resizes, which on a 31-column month is enough to make
 * a bar look like it starts on the 4th when it starts on the 3rd. Placing bars in
 * the same grid as the header cells makes that class of error impossible: a bar
 * on column 3 is on the 3rd at every viewport width.
 *
 * The whole grid scrolls horizontally below ~1000px with the car column pinned,
 * because the alternative — squeezing 31 columns into a phone — makes every bar
 * an unreadable sliver.
 */
import { Link } from "@tanstack/react-router";

import { formatDate, formatDateShort, formatMoney, formatTime } from "../../lib/admin/format";
import { PREP_LABEL } from "../../lib/admin/prep";
import type { BookingsBoardData, TimelineBar, TimelineRow } from "../../lib/admin/types";
import { EmptyState, StatusPill, toneBarClass } from "./ui";

/** Width of the pinned car column, and the minimum a day column may shrink to
 *  before the grid starts scrolling instead. */
const CAR_COL = 168;
const MIN_DAY_COL = 26;
/** Height of one lane. Two lanes in a row is the overlap case (a cancellation
 *  and its replacement), so rows are usually this tall. */
const LANE_H = 30;

function weekdayLetter(dateKey: string): string {
  // Date.UTC + timeZone UTC, never `new Date(key)` — see the header of
  // src/lib/admin/format.ts for why a bare date string must not be parsed
  // locally.
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "narrow",
    timeZone: "UTC",
  });
}

function isWeekend(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** What the bar says out loud, for the title attribute and screen readers. */
function barDescription(bar: TimelineBar): string {
  return [
    `${bar.clientName} · ${bar.ref}`,
    `${formatDate(bar.pickupDate)} ${formatTime(bar.pickupTime)} → ${formatDate(
      bar.returnDate,
    )} ${formatTime(bar.returnTime)}`,
    `${bar.days} ${bar.days === 1 ? "day" : "days"} · ${formatMoney(bar.totalCents)}`,
    `Prep: ${PREP_LABEL[bar.prepStatus]} · Payment: ${bar.paymentStatus} · Booking: ${bar.bookingStatus}`,
  ].join("\n");
}

function Bar({ bar }: { bar: TimelineBar }) {
  const cancelled = bar.bookingStatus === "cancelled";

  return (
    <Link
      to="/admin/bookings/$bookingId"
      params={{ bookingId: bar.bookingId }}
      title={barDescription(bar)}
      style={{
        gridColumn: `${bar.startCol} / span ${bar.span}`,
        gridRow: bar.lane + 1,
      }}
      className={`group relative z-10 my-[3px] flex items-center overflow-hidden border-l-[3px] px-1.5 text-[11px] font-semibold leading-none transition-shadow hover:z-20 hover:shadow-[0_2px_8px_rgba(2,48,71,0.18)] ${
        // A clipped edge is squared off and gets no left accent, so "this runs in
        // from last month" is visible without reading the dates.
        bar.clippedStart ? "rounded-r-md border-l-0" : "rounded-md"
      } ${bar.clippedEnd ? "!rounded-r-none" : ""} ${toneBarClass(bar.prepStatus)} ${
        cancelled ? "border-dashed opacity-60 saturate-50" : ""
      }`}
    >
      {bar.clippedStart && <span className="mr-1 shrink-0 opacity-60">‹</span>}
      <span className={`truncate ${cancelled ? "line-through" : ""}`}>{bar.clientName}</span>
      {/* Payment is the one thing worth flagging on the calendar itself: an
          unpaid car about to go out is the expensive mistake.

          The guilder sign rather than the "XCG" token used for actual figures:
          this is a one-glyph marker in a bar that may be three characters wide,
          and it is labelled in the legend below. Keep the two in step. */}
      {!cancelled && bar.paymentStatus !== "paid" && bar.span > 2 && (
        <span className="ml-auto shrink-0 pl-1 font-bold opacity-70">ƒ</span>
      )}
      {bar.clippedEnd && <span className="ml-auto shrink-0 pl-1 opacity-60">›</span>}
    </Link>
  );
}

/**
 * The grid itself, given days and rows. Split out from the bookings page's
 * wrapper so the fleet page can draw ONE car's month with the same geometry,
 * the same colours and the same clipping rules — a car's schedule and the fleet
 * calendar must never disagree about where a bar starts.
 */
export function TimelineGrid({
  days,
  rows,
  today,
  showCarColumn = true,
}: {
  days: string[];
  rows: TimelineRow[];
  today: string;
  /** Off on a single-car page, where every row would repeat the same name. */
  showCarColumn?: boolean;
}) {
  const labelWidth = showCarColumn ? CAR_COL : 0;
  const gridColumns = `repeat(${days.length}, minmax(${MIN_DAY_COL}px, 1fr))`;
  const minWidth = labelWidth + days.length * MIN_DAY_COL;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        {/* ── day headers ──────────────────────────────────────────────── */}
        <div className="flex border-b border-cw-navy/10">
          {showCarColumn && (
            <div
              style={{ width: CAR_COL }}
              className="sticky left-0 z-30 shrink-0 border-r border-cw-navy/10 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-cw-ink/50"
            >
              Car
            </div>
          )}
          <div className="grid flex-1" style={{ gridTemplateColumns: gridColumns }}>
            {days.map((day) => {
              const isToday = day === today;
              return (
                <div
                  key={day}
                  className={`border-l border-cw-navy/5 py-1 text-center ${
                    isToday ? "bg-cw-teal-soft" : isWeekend(day) ? "bg-cw-navy/[0.03]" : ""
                  }`}
                >
                  <div
                    className={`text-[9px] uppercase ${
                      isToday ? "text-cw-teal-dark" : "text-cw-ink/40"
                    }`}
                  >
                    {weekdayLetter(day)}
                  </div>
                  <div
                    className={`text-[11px] font-semibold tabular-nums ${
                      isToday ? "text-cw-teal-dark" : "text-cw-ink/70"
                    }`}
                  >
                    {Number(day.slice(8, 10))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── one row per PHYSICAL car ─────────────────────────────────────
            Two rows can carry the same listing name, which is the point: they
            are two cars, they can be out at the same time, and the unit line
            below the model is what tells them apart. */}
        {rows.map((row) => (
          <div key={row.vehicleId} className="flex border-b border-cw-navy/8 last:border-b-0">
            {showCarColumn && (
              <div
                style={{ width: CAR_COL }}
                className="sticky left-0 z-30 flex shrink-0 flex-col justify-center border-r border-cw-navy/10 bg-white px-3 py-2"
              >
                <span
                  className="truncate text-[12px] font-semibold text-cw-navy"
                  title={`${row.listingLabel} — ${row.vehicleLabel}`}
                >
                  {row.listingLabel}
                </span>
                <span className="truncate text-[11px] text-cw-ink/55">
                  {row.vehicleLabel}
                  {/* A unit the public site never shows. Marked, because
                      "why is there a second Spark?" is the first question this
                      row raises and the cheapest one to answer in place. */}
                  {!row.isPubliclyVisible && (
                    <span
                      className="ml-1 rounded bg-cw-navy/8 px-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-cw-navy/60"
                      title="Backup unit — not shown on the public site"
                    >
                      hidden
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-cw-ink/45">
                  {row.status !== "available" ? (
                    <StatusPill value={row.status} title="Fleet status" />
                  ) : (
                    <>
                      {row.bars.length} {row.bars.length === 1 ? "booking" : "bookings"}
                    </>
                  )}
                </span>
              </div>
            )}

            <div
              className="relative grid flex-1"
              style={{
                gridTemplateColumns: gridColumns,
                gridTemplateRows: `repeat(${row.lanes}, ${LANE_H}px)`,
              }}
            >
              {/* Day stripes, spanning every lane. Drawn as grid items rather
                  than a background image so they stay locked to the columns the
                  bars are placed in. */}
              {days.map((day, i) => (
                <div
                  key={day}
                  aria-hidden
                  style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
                  className={`border-l border-cw-navy/5 ${
                    day === today
                      ? "bg-cw-teal-soft/70"
                      : isWeekend(day)
                        ? "bg-cw-navy/[0.025]"
                        : ""
                  }`}
                />
              ))}

              {row.bars.map((bar) => (
                <Bar key={bar.bookingId} bar={bar} />
              ))}
            </div>
          </div>
        ))}

        {rows.length === 0 && <EmptyState>No vehicles in the fleet yet.</EmptyState>}
      </div>
    </div>
  );
}

/** The bookings page's whole-fleet month: every car, one row each. */
export default function BookingsTimeline({ board }: { board: BookingsBoardData }) {
  return <TimelineGrid days={board.days} rows={board.rows} today={board.today} />;
}

/**
 * The legend. Separate export so the page can place it outside the scrolling
 * area — a legend that scrolls away with the grid is a legend nobody reads.
 */
export function TimelineLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-cw-navy/8 px-4 py-2.5 text-[11px] text-cw-ink/55">
      <span className="font-semibold uppercase tracking-[0.07em] text-cw-ink/45">Prep</span>
      {(["booked", "needs_prep", "ready", "out", "returned"] as const).map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <i className={`h-3 w-4 rounded-sm border-l-[3px] ${toneBarClass(status)}`} />
          {PREP_LABEL[status]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <i className="h-3 w-4 rounded-sm border-l-[3px] border-dashed border-cw-navy/25 bg-cw-navy/10 opacity-60" />
        Cancelled
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-cw-ink/70">ƒ</span> Not yet paid
      </span>
      {/* Stated explicitly because it looks like an off-by-one until you know
          the rule: the return day is the next rental's pickup day. */}
      <span className="text-cw-ink/45">
        A bar covers the days billed — it ends the day the car comes back, which is free again.
      </span>
    </div>
  );
}

/** Month navigation, used in the page header. */
export function MonthNav({ board }: { board: BookingsBoardData }) {
  const linkClass =
    "inline-flex h-[30px] items-center rounded-lg border border-cw-navy/15 bg-white px-2.5 text-[13px] font-semibold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal";

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/admin/bookings"
        search={{ month: board.prevMonth }}
        className={linkClass}
        aria-label="Previous month"
      >
        ‹
      </Link>
      <span className="min-w-[112px] text-center font-display text-[14px] font-extrabold text-cw-navy">
        {board.monthLabel}
      </span>
      <Link
        to="/admin/bookings"
        search={{ month: board.nextMonth }}
        className={linkClass}
        aria-label="Next month"
      >
        ›
      </Link>
      {board.month !== board.currentMonth && (
        <Link to="/admin/bookings" search={{ month: board.currentMonth }} className={linkClass}>
          This month
        </Link>
      )}
      <span className="ml-1 text-[12px] text-cw-ink/50">
        {board.visibleCount} {board.visibleCount === 1 ? "booking" : "bookings"} ·{" "}
        {formatDateShort(board.days[0])} – {formatDateShort(board.days[board.days.length - 1])}
      </span>
    </div>
  );
}
