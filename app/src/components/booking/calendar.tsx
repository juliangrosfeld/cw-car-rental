import { useMemo, useState } from 'react'
import {
  DAY_MS,
  MIN_RENTAL_DAYS,
  MONTHLY_PERIOD_DAYS,
  dayFullyBooked,
  toKey,
  type BusyRange,
  type RentalType,
} from '../../lib/booking/rental'

/**
 * Custom range picker, board 4's calendar: teal selected range, disabled
 * past days, hard-disabled days where the whole fleet is out. First click
 * sets pickup, second sets drop-off (clicking behind the start restarts).
 *
 * `busy` and `carIds` come from the live database (getFleetAvailability), so
 * the crossed-out days are real bookings, not sample data. While the query is
 * still loading both arrive empty, which disables nothing — the wizard shows a
 * loading state rather than letting someone pick into a booked day.
 *
 * TWO MODES, because there are two products:
 *
 *   daily    a range. The days between the pickup and the MINIMUM drop-off are
 *            not clickable at all — the 3-day minimum is a shape the calendar
 *            has, not an error message after the fact. A range longer than
 *            MAX_SELF_SERVICE_DAYS stays selectable on purpose: the wizard
 *            answers that with a custom quote, and a guest who wants five
 *            weeks should be able to say so rather than find the day dead.
 *
 *   monthly  one click. The period is fixed at MONTHLY_PERIOD_DAYS, so picking
 *            the start picks the end; the tail is drawn as the selected range
 *            so the guest can see exactly which days they are buying.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

interface CalendarProps {
  start?: Date
  end?: Date
  onChange: (start?: Date, end?: Date) => void
  /** Occupied ranges across the whole fleet. */
  busy: readonly BusyRange[]
  /** Every bookable car id — a day is only "full" when all of them are out. */
  carIds: readonly string[]
  /** Which product is being booked. Changes what a click means. */
  rentalType: RentalType
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS)

export default function Calendar({
  start,
  end,
  onChange,
  busy,
  carIds,
  rentalType,
}: CalendarProps) {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1)
    const out: (Date | null)[] = Array.from({ length: first.getDay() }, () => null)
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
    for (let d = 1; d <= days; d++) out.push(new Date(view.getFullYear(), view.getMonth(), d))
    return out
  }, [view])

  const pick = (day: Date) => {
    if (rentalType === 'monthly') {
      // One click buys the whole period. The end is derived here and again on
      // the server; the guest never chooses it.
      onChange(day, addDays(day, MONTHLY_PERIOD_DAYS))
      return
    }
    if (!start || (start && end)) {
      onChange(day, undefined)
    } else if (day.getTime() <= start.getTime()) {
      onChange(day, undefined)
    } else {
      onChange(start, day)
    }
  }

  /** True while a drop-off is being chosen and this day would make the rental
   *  shorter than the minimum. Only ever set in daily mode. */
  const belowMinimum = (day: Date) =>
    rentalType === 'daily' &&
    !!start &&
    !end &&
    day.getTime() > start.getTime() &&
    day.getTime() < addDays(start, MIN_RENTAL_DAYS).getTime()

  const inRange = (day: Date) => {
    if (!start) return false
    const hi = end ?? start
    return day.getTime() >= start.getTime() && day.getTime() <= hi.getTime()
  }

  const monthLabel = view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const atCurrentMonth =
    view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth()

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={atCurrentMonth}
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-cw-teal-dark transition-colors hover:bg-cw-teal-soft disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ‹
        </button>
        <p className="font-display text-[15px] font-bold text-cw-navy">{monthLabel}</p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-cw-teal-dark transition-colors hover:bg-cw-teal-soft"
        >
          ›
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((wd) => (
          <span key={wd} className="py-1 text-xs font-semibold text-cw-ink/50">
            {wd}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`pad-${i}`} />
          const past = day.getTime() < today.getTime()
          const full = dayFullyBooked(busy, carIds, toKey(day))
          const tooSoon = belowMinimum(day)
          const disabled = past || full || tooSoon
          const isStart = start && toKey(day) === toKey(start)
          const isEnd = end && toKey(day) === toKey(end)
          const selected = inRange(day)
          return (
            <button
              key={toKey(day)}
              type="button"
              disabled={disabled}
              onClick={() => pick(day)}
              aria-pressed={selected}
              title={
                tooSoon
                  ? `Minimum rental is ${MIN_RENTAL_DAYS} days`
                  : full && !past
                    ? 'Fully booked'
                    : undefined
              }
              className={`mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-sm transition-colors ${
                isStart || isEnd
                  ? 'bg-cw-teal font-bold text-white'
                  : selected
                    ? 'bg-cw-teal-soft font-semibold text-cw-teal-dark'
                    : full && !past
                      ? 'text-cw-ink/25 line-through'
                      : tooSoon
                        ? 'text-cw-ink/25 ring-1 ring-inset ring-cw-navy/8'
                        : disabled
                          ? 'text-cw-ink/20'
                          : 'text-cw-ink hover:bg-cw-mint-soft'
              }`}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-cw-ink/60">
        {rentalType === 'monthly' ? (
          <>
            Tap the day you want to collect. We book a {MONTHLY_PERIOD_DAYS} day period from there.
            Crossed out days: the whole fleet is on the road.
          </>
        ) : start && !end ? (
          <>
            Minimum rental is {MIN_RENTAL_DAYS} days, so the next {MIN_RENTAL_DAYS - 1} days are
            greyed out. Crossed out days: the whole fleet is on the road.
          </>
        ) : (
          <>
            Crossed out days: the whole fleet is on the road. Drop-off morning frees the car for the
            next guest.
          </>
        )}
      </p>
    </div>
  )
}

export { DAY_MS }
