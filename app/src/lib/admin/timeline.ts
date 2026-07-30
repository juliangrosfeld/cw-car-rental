/**
 * Turning rentals into bars on a month grid. Pure, isomorphic, no I/O — the
 * server computes the geometry so the browser only has to place `grid-column`
 * values, and the rules below live in exactly one place.
 *
 * THE COLUMN MODEL — read this before changing a width by one.
 * A rental occupies the HALF-OPEN interval [pickup, return): the car is back on
 * the morning of the return day, so that day can start the next rental. That is
 * the rule in src/lib/booking/rental.ts and the rule the
 * `bookings_no_double_booking` exclusion constraint enforces in Postgres, and it
 * is the rule here too. So a bar covers the columns
 *
 *     pickup_date … return_date - 1 day
 *
 * which means its width in columns is exactly `rentalDays()` — the number of
 * days the guest is billed for. Two consequences worth stating, because both
 * look like bugs and neither is:
 *
 *   1. A rental picked up on the 3rd and returned on the 4th is ONE column wide,
 *      on the 3rd. It is one billable day, and the car is free again on the 4th.
 *   2. Back-to-back rentals (one returns the 12th, the next collects the 12th)
 *      tile perfectly with no gap and no overlap. Drawing the return day as
 *      occupied would push the second rental into a second lane and make a
 *      normal Saturday look like a double booking.
 *
 * A rental returned later the SAME day (pickup 10:00, return 18:00) has zero
 * whole days between its dates; it is clamped to one column so it cannot vanish.
 *
 * LANES exist because bars in one car's row can still overlap: a cancelled
 * booking and the rental that replaced it cover the same dates, and cancelled
 * rows are outside the exclusion constraint's partial WHERE. Rather than hide
 * them or draw them on top of each other, overlapping bars stack into lanes.
 */
import { rentalDays } from "../booking/rental";
import type { BookingStatus, PaymentStatus, PrepStatus } from "../supabase/types";
import { addDays, addMonths, daysBetween, monthFirstDay, monthLabel } from "./clock";
import type { TimelineBar } from "./types";

/** The month a timeline is drawn for, resolved once on the server. */
export interface MonthGrid {
  /** 'YYYY-MM' */
  month: string;
  /** e.g. 'July 2026' */
  label: string;
  /** 'YYYY-MM-01' */
  firstDay: string;
  /** Last day of the month, 'YYYY-MM-DD'. */
  lastDay: string;
  /** First day of NEXT month — the exclusive upper bound of the grid. */
  nextMonthFirstDay: string;
  /** Every day in the month, in order. One entry per column. */
  days: string[];
  /** Month keys for the navigation. */
  prevMonth: string;
  nextMonth: string;
}

export function monthGrid(month: string): MonthGrid {
  const firstDay = monthFirstDay(month);
  const nextMonthFirstDay = monthFirstDay(addMonths(month, 1));
  const dayCount = daysBetween(firstDay, nextMonthFirstDay);

  return {
    month,
    label: monthLabel(month),
    firstDay,
    lastDay: addDays(nextMonthFirstDay, -1),
    nextMonthFirstDay,
    days: Array.from({ length: dayCount }, (_, i) => addDays(firstDay, i)),
    prevMonth: addMonths(month, -1),
    nextMonth: addMonths(month, 1),
  };
}

/** Where a bar sits in the grid, or null when it does not reach this month. */
export interface BarGeometry {
  /** 1-based grid column of the first day shown. */
  startCol: number;
  /** How many columns of THIS month the bar covers. Always ≥ 1. */
  span: number;
  /** The rental began before the first column — draw an open left edge. */
  clippedStart: boolean;
  /** It runs past the last column — draw an open right edge. */
  clippedEnd: boolean;
}

/**
 * Clip a rental to a month's columns.
 *
 * `barEnd` is the exclusive end of the occupied range, i.e. the return date, or
 * the day after pickup when the whole rental fits inside one date (see the
 * header). Everything after that is intersection arithmetic.
 */
export function barGeometry(
  pickupDate: string,
  returnDate: string,
  grid: MonthGrid,
): BarGeometry | null {
  const minEnd = addDays(pickupDate, 1);
  const barEnd = returnDate > minEnd ? returnDate : minEnd;

  // Fully outside the month in either direction.
  if (pickupDate >= grid.nextMonthFirstDay || barEnd <= grid.firstDay) return null;

  const startCol = Math.max(1, daysBetween(grid.firstDay, pickupDate) + 1);
  const endColExclusive = Math.min(grid.days.length + 1, daysBetween(grid.firstDay, barEnd) + 1);
  const span = endColExclusive - startCol;

  if (span < 1) return null;

  return {
    startCol,
    span,
    clippedStart: pickupDate < grid.firstDay,
    clippedEnd: barEnd > grid.nextMonthFirstDay,
  };
}

/**
 * One rental, as little of it as a bar needs. The shape both the bookings page
 * and the fleet page hand in — keeping it here rather than importing a
 * database row is what lets this module stay pure and browser-safe.
 */
export interface RentalForBar {
  id: string;
  carId: string;
  clientName: string;
  pickupDate: string;
  returnDate: string;
  pickupTime: string;
  returnTime: string;
  totalCents: number;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  prepStatus: PrepStatus;
}

/**
 * Rentals → bars, dropping the ones that turn out not to reach this month.
 *
 * The SQL windows that fetch these are deliberately a little wider than the grid
 * (they work in whole dates, while a bar's occupied range ends the day BEFORE
 * the return date), so this is where the exact rule is applied and the surplus
 * falls away. Lanes are assigned separately, per car, by packLanes.
 */
export function toBars(rentals: readonly RentalForBar[], grid: MonthGrid): TimelineBar[] {
  const bars: TimelineBar[] = [];

  for (const rental of rentals) {
    const geometry = barGeometry(rental.pickupDate, rental.returnDate, grid);
    if (!geometry) continue;

    bars.push({
      bookingId: rental.id,
      ref: rental.id.slice(0, 8),
      clientName: rental.clientName,
      carId: rental.carId,
      pickupDate: rental.pickupDate,
      returnDate: rental.returnDate,
      pickupTime: rental.pickupTime,
      returnTime: rental.returnTime,
      days: rentalDays(rental.pickupDate, rental.returnDate),
      totalCents: rental.totalCents,
      bookingStatus: rental.bookingStatus,
      paymentStatus: rental.paymentStatus,
      prepStatus: rental.prepStatus,
      ...geometry,
      lane: 0,
    });
  }

  return bars;
}

/**
 * Assign every bar in one car's row to a lane, so no two bars in a lane
 * overlap. Greedy first-fit over bars sorted by start column, which is optimal
 * for interval graphs — it uses exactly as many lanes as the busiest instant
 * needs, and that is one for every row on a normal month.
 *
 * Input order is not relied on; the returned array is sorted by start column,
 * which is also the order that reads correctly for screen readers.
 */
export function packLanes(bars: TimelineBar[]): { bars: TimelineBar[]; lanes: number } {
  const sorted = [...bars].sort((a, b) => a.startCol - b.startCol || a.span - b.span);

  /** The first free column in each lane. */
  const laneFreeFrom: number[] = [];

  for (const bar of sorted) {
    let lane = laneFreeFrom.findIndex((freeFrom) => freeFrom <= bar.startCol);
    if (lane === -1) {
      lane = laneFreeFrom.length;
      laneFreeFrom.push(0);
    }
    laneFreeFrom[lane] = bar.startCol + bar.span;
    bar.lane = lane;
  }

  return { bars: sorted, lanes: Math.max(1, laneFreeFrom.length) };
}
