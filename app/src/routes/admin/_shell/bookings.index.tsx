/**
 * /admin/bookings — every reservation, two ways.
 *
 * CALENDAR is the default because the question that brings Clay here most often
 * is spatial: which car is free the week of the 12th, and who has the Spark right
 * now. A table cannot answer that without being read line by line.
 *
 * LIST is the same data as a queue, for the questions a grid is slow at: "show me
 * everything still needing prep", "what has this car got booked", "what is
 * running in August". Both views read through the same server functions and the
 * same overlap rule, so switching cannot change which bookings exist.
 *
 * THE URL IS THE STATE. View, month and every filter live in the query string,
 * which means a prep queue is a bookmarkable link, the back button works, and a
 * reload lands where you were. Nothing here is component state except the two
 * date inputs (which need an Apply) and the error banner.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import BookingsTimeline, {
  MonthNav,
  TimelineLegend,
} from "../../../components/admin/bookings-timeline";
import { PrepAdvanceButton } from "../../../components/admin/prep-controls";
import AdminShell from "../../../components/admin/shell";
import {
  Button,
  EmptyState,
  Panel,
  StatusPill,
  Td,
  Th,
  toneBarClass,
} from "../../../components/admin/ui";
import { fetchAdminBookingsBoard, fetchAdminBookingsList } from "../../../lib/api/admin.functions";
import { formatDateShort, formatMoney, formatTime } from "../../../lib/admin/format";
import { PREP_FLOW, PREP_LABEL, isPrepStatus } from "../../../lib/admin/prep";
import { isMonthKey } from "../../../lib/admin/clock";
import type { PrepStatus } from "../../../lib/supabase/types";

interface BookingsSearch {
  /** Absent means the calendar. Only the list needs naming, so the default view
   *  produces a clean `/admin/bookings` with no query string at all. */
  view?: "list";
  /** 'YYYY-MM' for the calendar. Absent means the current month. */
  month?: string;
  /** Prep statuses to keep. Absent or empty means every status. */
  prep?: PrepStatus[];
  /** A car id, for the list. */
  car?: string;
  /** Inclusive 'YYYY-MM-DD' bounds on the rental window. */
  from?: string;
  to?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything below comes out of the URL, so nothing is trusted: an unknown prep
 *  status is dropped rather than sent to the server, and a malformed month or
 *  date is discarded so the page falls back to its default instead of erroring. */
function validateSearch(search: Record<string, unknown>): BookingsSearch {
  const prep = Array.isArray(search.prep) ? search.prep.filter(isPrepStatus) : [];
  const asDate = (value: unknown) =>
    typeof value === "string" && DATE_RE.test(value) ? value : undefined;

  return {
    view: search.view === "list" ? "list" : undefined,
    month: isMonthKey(search.month) ? search.month : undefined,
    prep: prep.length > 0 ? prep : undefined,
    car: typeof search.car === "string" && search.car.length > 0 ? search.car : undefined,
    from: asDate(search.from),
    to: asDate(search.to),
  };
}

export const Route = createFileRoute("/admin/_shell/bookings/")({
  validateSearch,
  loaderDeps: ({ search }) => search,
  // One view, one round trip: the calendar does not pay for the list's queries
  // and the list does not pay for the calendar's.
  loader: async ({ deps }) => {
    if (deps.view === "list") {
      const { admin, list } = await fetchAdminBookingsList({
        data: {
          prep: deps.prep ?? [],
          carId: deps.car ?? null,
          from: deps.from ?? null,
          to: deps.to ?? null,
        },
      });
      return { admin, list, board: null };
    }
    const { admin, board } = await fetchAdminBookingsBoard({ data: { month: deps.month ?? null } });
    return { admin, board, list: null };
  },
  head: () => ({ meta: [{ title: "Bookings | CW back office" }] }),
  component: BookingsPage,
});

/* ── shared chrome ─────────────────────────────────────────────────────────── */

function ViewToggle({ view }: { view: "calendar" | "list" }) {
  const base = "rounded-lg px-3 py-1.5 font-display text-[13px] font-bold transition-colors";
  const active = "bg-cw-navy text-white";
  const idle = "text-cw-navy/60 hover:text-cw-navy";

  return (
    <div className="inline-flex rounded-xl border border-cw-navy/15 bg-white p-0.5">
      <Link
        to="/admin/bookings"
        search={{}}
        className={`${base} ${view === "calendar" ? active : idle}`}
      >
        Calendar
      </Link>
      <Link
        to="/admin/bookings"
        search={{ view: "list" }}
        className={`${base} ${view === "list" ? active : idle}`}
      >
        List
      </Link>
    </div>
  );
}

/**
 * The pipeline as a row of counts, each one a link into the list filtered to that
 * status. This is the "what needs doing" summary: on the calendar it sits above
 * the grid, and in the list it doubles as the filter control.
 *
 * The counts are always across every booking, never the filtered set — a number
 * that changes when you click it cannot help you decide whether to click it.
 */
function PrepQueue({
  counts,
  selected,
  interactive,
}: {
  counts: Record<PrepStatus, number>;
  /** Statuses currently filtered on, for the list view. */
  selected?: PrepStatus[];
  /** In the list, a chip toggles its status. On the calendar it jumps to the
   *  list filtered to it. */
  interactive: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PREP_FLOW.map((status) => {
        const isOn = selected?.includes(status) ?? false;
        const next = isOn
          ? (selected ?? []).filter((s) => s !== status)
          : [...(selected ?? []), status];

        return (
          <Link
            key={status}
            to="/admin/bookings"
            search={(prev: BookingsSearch): BookingsSearch =>
              interactive
                ? { ...prev, view: "list", prep: next.length > 0 ? next : undefined }
                : { view: "list", prep: [status] }
            }
            className={`flex items-center gap-1.5 rounded-lg border-l-[3px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
              isOn
                ? `${toneBarClass(status)} ring-1 ring-inset ring-cw-navy/10`
                : "border-cw-navy/12 bg-white text-cw-ink/65 hover:border-cw-teal hover:text-cw-teal"
            }`}
          >
            {PREP_LABEL[status]}
            <span className="tabular-nums opacity-70">{counts[status]}</span>
          </Link>
        );
      })}
    </div>
  );
}

function Notice({ message, onClear }: { message: string | null; onClear: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-cw-yellow-soft px-3 py-2 text-[13px] text-[#8a6a04]"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 font-semibold underline underline-offset-2"
      >
        Dismiss
      </button>
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────────────── */

function BookingsPage() {
  const { admin, board, list } = Route.useLoaderData();
  const search = Route.useSearch();
  const [notice, setNotice] = useState<string | null>(null);

  const view = list ? "list" : "calendar";
  const filtersActive = list
    ? list.filters.prep.length > 0 ||
      list.filters.carId !== null ||
      list.filters.from !== null ||
      list.filters.to !== null
    : false;

  return (
    <AdminShell
      admin={admin}
      title="Bookings"
      subtitle={
        view === "calendar"
          ? "Who has which car, and when"
          : `${list?.total ?? 0} ${list?.total === 1 ? "booking" : "bookings"} matching these filters`
      }
      actions={<ViewToggle view={view} />}
    >
      <Notice message={notice} onClear={() => setNotice(null)} />

      {board && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <PrepQueue counts={board.prepCounts} interactive={false} />
            <span className="text-[12px] text-cw-ink/45">
              Counts are for {board.monthLabel}. Click one for the full queue.
            </span>
          </div>

          <Panel title="Fleet calendar" action={<MonthNav board={board} />}>
            <BookingsTimeline board={board} />
            <TimelineLegend />
          </Panel>
        </>
      )}

      {list && (
        <>
          <Panel title="Filters" className="mb-3">
            <div className="space-y-3 px-4 py-3">
              <PrepQueue counts={list.prepCounts} selected={list.filters.prep} interactive />
              {/* Keyed on the dates in the URL so a back-button navigation
                  remounts the inputs with the values that URL carries — local
                  state in a filter box must never outlive the filter. */}
              <FilterBar
                key={`${search.from ?? ""}|${search.to ?? ""}`}
                search={search}
                cars={list.cars}
              />
            </div>
          </Panel>

          <Panel
            title="Bookings"
            subtitle={describeFilters(list.filters, list.cars)}
            action={
              list.truncated ? (
                <span className="text-[12px] text-[#b3261e]">
                  Showing the first {list.rows.length} — narrow the filters.
                </span>
              ) : undefined
            }
          >
            {list.rows.length === 0 ? (
              // Two different empty states, because they mean opposite things: a
              // filter that found nothing is a dead end to back out of, while an
              // empty database is simply a business waiting for its first
              // booking. Offering "clear the filters" when none are set reads
              // like the page is broken.
              filtersActive ? (
                <EmptyState>
                  Nothing matches these filters.{" "}
                  <Link to="/admin/bookings" search={{ view: "list" }} className="underline">
                    Clear them
                  </Link>
                  .
                </EmptyState>
              ) : (
                <EmptyState>
                  No bookings yet. Reservations appear here the moment one comes in through the
                  site.
                </EmptyState>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse">
                  <thead className="border-b border-cw-navy/8">
                    <tr>
                      <Th>Guest</Th>
                      <Th>Car</Th>
                      <Th>Pickup</Th>
                      <Th>Return</Th>
                      <Th align="right">Total</Th>
                      <Th>Status</Th>
                      <Th align="right">Prep</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cw-navy/8">
                    {list.rows.map((b) => (
                      <tr key={b.id} className="hover:bg-cw-teal-soft/25">
                        <Td>
                          <Link
                            to="/admin/bookings/$bookingId"
                            params={{ bookingId: b.id }}
                            className="font-semibold text-cw-navy underline-offset-2 hover:text-cw-teal hover:underline"
                          >
                            {b.clientName}
                          </Link>
                          <span className="block text-[11px] tabular-nums text-cw-ink/45">
                            {b.ref} · {b.clientPhone}
                          </span>
                        </Td>
                        <Td className="text-cw-ink/70">{b.carLabel}</Td>
                        <Td className="whitespace-nowrap text-cw-ink/70">
                          {formatDateShort(b.pickupDate)}, {formatTime(b.pickupTime)}
                          <span className="block text-[11px] text-cw-ink/45">
                            {b.pickupLocation}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap text-cw-ink/70">
                          {formatDateShort(b.returnDate)}, {formatTime(b.returnTime)}
                          <span className="block text-[11px] text-cw-ink/45">
                            {b.days} {b.days === 1 ? "day" : "days"}
                          </span>
                        </Td>
                        <Td align="right" className="font-semibold text-cw-navy">
                          {formatMoney(b.totalCents)}
                        </Td>
                        <Td>
                          <span className="flex flex-wrap gap-1">
                            <StatusPill value={b.bookingStatus} title="Booking status" />
                            <StatusPill value={b.paymentStatus} title="Payment status" />
                            <StatusPill value={b.prepStatus} title="Prep status" />
                          </span>
                        </Td>
                        <Td align="right">
                          {/* The whole point of the queue: advance a car without
                              opening anything. */}
                          <PrepAdvanceButton
                            bookingId={b.id}
                            prepStatus={b.prepStatus}
                            bookingStatus={b.bookingStatus}
                            onNotice={setNotice}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </AdminShell>
  );
}

/* ── the filter bar ────────────────────────────────────────────────────────── */

/** A plain-English sentence describing the active filters, so the table always
 *  says what it is showing rather than leaving it to be inferred from chips. */
function describeFilters(
  filters: { prep: PrepStatus[]; carId: string | null; from: string | null; to: string | null },
  cars: { id: string; label: string }[],
): string {
  const parts: string[] = [];
  if (filters.prep.length > 0) {
    parts.push(filters.prep.map((s) => PREP_LABEL[s]).join(", "));
  }
  if (filters.carId) {
    parts.push(cars.find((c) => c.id === filters.carId)?.label ?? filters.carId);
  }
  if (filters.from && filters.to) {
    parts.push(`running ${formatDateShort(filters.from)} – ${formatDateShort(filters.to)}`);
  } else if (filters.from) {
    parts.push(`ending on or after ${formatDateShort(filters.from)}`);
  } else if (filters.to) {
    parts.push(`starting on or before ${formatDateShort(filters.to)}`);
  }

  return parts.length === 0 ? "Every booking, soonest pickup first" : parts.join(" · ");
}

function FilterBar({
  search,
  cars,
}: {
  search: BookingsSearch;
  cars: { id: string; label: string }[];
}) {
  const navigate = Route.useNavigate();

  // The date boxes are the only component state on this page: typing a date is
  // several keystrokes and a navigation per keystroke would fight the input. The
  // caller keys this component on the dates in the URL, so a back navigation
  // remounts it rather than leaving stale text in a box.
  const [from, setFrom] = useState(search.from ?? "");
  const [to, setTo] = useState(search.to ?? "");

  const inputClass =
    "rounded-lg border border-cw-navy/15 bg-white px-2.5 py-1.5 text-[13px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20";

  function apply() {
    navigate({
      search: (prev: BookingsSearch): BookingsSearch => ({
        ...prev,
        view: "list",
        from: DATE_RE.test(from) ? from : undefined,
        to: DATE_RE.test(to) ? to : undefined,
      }),
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-cw-navy/8 pt-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
          Car
        </span>
        <select
          value={search.car ?? ""}
          onChange={(e) =>
            navigate({
              search: (prev: BookingsSearch): BookingsSearch => ({
                ...prev,
                view: "list",
                car: e.target.value || undefined,
              }),
            })
          }
          className={inputClass}
        >
          <option value="">Whole fleet</option>
          {cars.map((car) => (
            <option key={car.id} value={car.id}>
              {car.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
          Running from
        </span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cw-ink/50">
          Running to
        </span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={inputClass}
        />
      </label>

      <Button variant="primary" onClick={apply}>
        Apply dates
      </Button>

      <Link
        to="/admin/bookings"
        search={{ view: "list" }}
        onClick={() => {
          setFrom("");
          setTo("");
        }}
        className="py-1.5 text-[13px] font-semibold text-cw-ink/55 underline underline-offset-2 hover:text-cw-teal"
      >
        Clear all
      </Link>

      {/* Said out loud because it is the difference between this list and a
          naive pickup-date filter, and it is the behaviour an operator wants. */}
      <p className="w-full text-[11px] text-cw-ink/45">
        A date range matches rentals RUNNING in it, including one that started earlier and is still
        out.
      </p>
    </div>
  );
}
