import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CONTACT, PICKUP_LOCATIONS } from '../../content/brand'
import {
  getAvailableCars,
  getFleetAvailability,
  submitBooking,
  type PublicCar,
} from '../../lib/api/booking.functions'
import {
  DISCOUNT_TIERS,
  MAX_SELF_SERVICE_DAYS,
  MIN_RENTAL_DAYS,
  MONTHLY_PERIOD_DAYS,
  fmtDay,
  formatMoney,
  fromKey,
  monthlyReturnDate,
  quoteRental,
  rentalDays,
  splitFleet,
  toKey,
  type BusyRange,
  type Quote,
  type RentalType,
} from '../../lib/booking/rental'
import { CURRENCY_CODE } from '../../lib/money'
import Calendar from './calendar'

/**
 * The 6-step booking wizard: Rental → Dates → Car → Details → Review → Pay.
 * One centered step card under a waypoint progress rail. Every earlier choice
 * stays editable from any later step without losing progress.
 *
 * WHY "RENTAL" COMES FIRST. Daily and monthly are two products, not two ways of
 * saying the same thing: one is a date range billed per day with a length
 * discount, the other a flat monthly rate for a fixed period. That choice
 * changes what the calendar does and what every price on the following screens
 * means, so it cannot be an afterthought at the end.
 *
 * DATA FLOW — everything here is live.
 *   getFleetAvailability  one round trip on mount: the bookable fleet plus every
 *                         occupied date range in the horizon. Powers the
 *                         calendar's crossed-out days AND the car step's
 *                         free/taken split, computed client-side for instant
 *                         feedback as the guest moves dates around.
 *   getAvailableCars      the server's authoritative answer for the chosen
 *                         range, fetched on entering the car step so a stale
 *                         cache cannot offer a car taken thirty seconds ago.
 *                         Monthly rentals go through the same call — the period
 *                         is just another window against the same bookings.
 *   submitBooking         the only write path. Recomputes the price server-side
 *                         from the database and returns the confirmation, which
 *                         the anon key could never read back itself.
 *
 * EVERY PRICE ON THIS PAGE IS ADVISORY. quoteRental() runs here so the guest
 * sees a figure as they choose, and runs again on the server against the rates
 * in the database — that second answer is the one that is charged and stored.
 * Sharing the function is what makes the two agree; it is not what makes the
 * price safe.
 *
 * Prices are CENTS end to end (matching the database); formatMoney is the only
 * place they become XCG.
 */

const STEPS = ['Rental', 'Dates', 'Car', 'Details', 'Review', 'Pay'] as const

/** Step indices, named. Six of them and a lot of `step === 3` reads badly. */
const STEP = { TYPE: 0, DATES: 1, CAR: 2, DETAILS: 3, REVIEW: 4, PAY: 5 } as const

const WHATSAPP_URL = `https://wa.me/${CONTACT.whatsapp.replace(/\D/g, '')}`

interface Details {
  name: string
  email: string
  phone: string
  flight: string
  note: string
}

type Confirmed = Extract<Awaited<ReturnType<typeof submitBooking>>, { ok: true }>['confirmation']

export default function BookingWizard({ initialCarId }: { initialCarId?: string }) {
  const queryClient = useQueryClient()

  const [step, setStep] = useState<number>(STEP.TYPE)
  const [maxReached, setMaxReached] = useState(0)
  const [rentalType, setRentalType] = useState<RentalType>('daily')
  const [start, setStart] = useState<Date | undefined>()
  const [end, setEnd] = useState<Date | undefined>()
  const [location, setLocation] = useState(PICKUP_LOCATIONS[0].id)
  const [carId, setCarId] = useState<string | undefined>()
  const [carNotice, setCarNotice] = useState<string | undefined>()
  const [dateNotice, setDateNotice] = useState<string | undefined>()
  const [details, setDetails] = useState<Details>({ name: '', email: '', phone: '', flight: '', note: '' })
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({})
  const [confirmation, setConfirmation] = useState<Confirmed | undefined>()

  /* ---- live fleet + occupied ranges ---- */
  const fleetQuery = useQuery({
    queryKey: ['fleet-availability'],
    queryFn: () => getFleetAvailability(),
    staleTime: 60_000,
  })

  const cars = useMemo<PublicCar[]>(() => fleetQuery.data?.cars ?? [], [fleetQuery.data])
  const busy = useMemo<BusyRange[]>(() => fleetQuery.data?.busy ?? [], [fleetQuery.data])
  const carIds = useMemo(() => cars.map((c) => c.id), [cars])

  // Honour ?car= only once the fleet is known, so a stale or bogus id is dropped
  // rather than carried into the review step.
  useEffect(() => {
    if (initialCarId && !carId && cars.some((c) => c.id === initialCarId)) {
      setCarId(initialCarId)
    }
  }, [initialCarId, carId, cars])

  const startKey = start ? toKey(start) : undefined
  // A monthly rental's end is DERIVED, here and again on the server. The
  // calendar sets it too, so this is belt and braces for a state that arrived
  // some other way (a type switch, a back-navigation).
  const endKey =
    rentalType === 'monthly'
      ? startKey
        ? monthlyReturnDate(startKey)
        : undefined
      : end
        ? toKey(end)
        : undefined
  const hasRange = Boolean(startKey && endKey)

  /** Billable days for the current selection, before anything is priced. Used
   *  by the gates below, which have to answer "how long is this?" even when the
   *  answer is "too long to price". */
  const selectedDays = startKey && endKey ? rentalDays(startKey, endKey) : 0

  /** 28 days and up is not a checkout, it is a conversation. The flow stops at
   *  the dates step and hands over to us rather than inventing a number. */
  const needsCustomQuote = rentalType === 'daily' && selectedDays > MAX_SELF_SERVICE_DAYS
  const belowMinimum = rentalType === 'daily' && hasRange && selectedDays < MIN_RENTAL_DAYS
  const datesUsable = hasRange && !needsCustomQuote && !belowMinimum

  /* ---- server's authoritative availability for the chosen range ---- */
  const availabilityQuery = useQuery({
    queryKey: ['available-cars', rentalType, startKey, endKey],
    queryFn: () =>
      getAvailableCars({
        data: { rentalType, pickupDate: startKey!, returnDate: endKey ?? null },
      }),
    enabled: datesUsable && step >= STEP.CAR,
    staleTime: 30_000,
  })

  // Client-side split for instant feedback; replaced by the server's answer the
  // moment it lands. Both use the same half-open overlap rule.
  const split = useMemo(() => {
    if (!startKey || !endKey) return { available: cars, unavailable: [] as PublicCar[] }
    if (availabilityQuery.data?.ok) {
      const free = new Set(availabilityQuery.data.cars.map((c) => c.id))
      return {
        available: cars.filter((c) => free.has(c.id)),
        unavailable: cars.filter((c) => !free.has(c.id)),
      }
    }
    return splitFleet(cars, busy, startKey, endKey)
  }, [cars, busy, startKey, endKey, availabilityQuery.data])

  const car = useMemo(() => cars.find((c) => c.id === carId), [cars, carId])
  const locationLabel = PICKUP_LOCATIONS.find((l) => l.id === location)?.label ?? ''

  /** The same function the server prices with, on the same inputs. Undefined
   *  until there is a car and a usable range; a refusal (too short, too long,
   *  no monthly rate on this car) surfaces as `undefined` here and is explained
   *  by the gates above rather than by a half-drawn breakdown. */
  const currentQuote = useMemo<Quote | undefined>(() => {
    if (!car || !startKey || !endKey) return undefined
    const priced = quoteRental({
      rentalType,
      rates: { dailyRateCents: car.dailyRateCents, monthlyRateCents: car.monthlyRateCents },
      pickupDate: startKey,
      returnDate: endKey,
    })
    return priced.ok ? priced.quote : undefined
  }, [car, rentalType, startKey, endKey])

  /* ---- the write ---- */
  const booking = useMutation({
    mutationFn: () =>
      submitBooking({
        data: {
          rentalType,
          pickupDate: startKey!,
          returnDate: rentalType === 'monthly' ? null : endKey!,
          carId: carId!,
          fullName: details.name,
          email: details.email,
          phone: details.phone,
          pickupLocation: locationLabel,
          returnLocation: locationLabel,
          flightNumber: details.flight || null,
          specialRequests: details.note || null,
        },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        setConfirmation(result.confirmation)
        // The fleet just got less available — make sure a second booking in the
        // same session sees it.
        void queryClient.invalidateQueries({ queryKey: ['fleet-availability'] })
        void queryClient.invalidateQueries({ queryKey: ['available-cars'] })
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['fleet-availability'] })
      void queryClient.invalidateQueries({ queryKey: ['available-cars'] })

      // The server refused, and WHICH refusal decides where the guest lands.
      // A pricing refusal is about the dates and sending them to the car step
      // would show them a screen they cannot fix anything on; a conflict is
      // about the car and sending them back to the calendar would lose a
      // perfectly good range.
      if (result.reason === 'below_minimum' || result.reason === 'custom_quote') {
        setDateNotice(result.message)
        setStep(STEP.DATES)
        return
      }
      setCarId(undefined)
      setCarNotice(result.message)
      setStep(STEP.CAR)
    },
  })

  const goTo = (target: number) => {
    if (confirmation) return
    if (target <= maxReached) setStep(target)
  }
  const advance = (target: number) => {
    setStep(target)
    setMaxReached((m) => Math.max(m, target))
  }

  /** Switching product throws the dates away on purpose: a 5-day range is not a
   *  month, and silently reinterpreting one as the other is how a guest ends up
   *  booking something they did not choose. */
  const chooseRentalType = (next: RentalType) => {
    if (next === rentalType) return
    setRentalType(next)
    setStart(undefined)
    setEnd(undefined)
    setCarId(undefined)
    setCarNotice(undefined)
    setDateNotice(undefined)
  }

  const continueFromDates = () => {
    if (!datesUsable) return
    setDateNotice(undefined)
    // Dates changed under a chosen car: keep progress, flag the car step.
    if (carId && !split.available.some((c) => c.id === carId)) {
      setCarId(undefined)
      setCarNotice('Your earlier pick is booked for these dates. Choose another ride.')
    }
    advance(STEP.CAR)
  }

  const continueFromDetails = () => {
    const next: typeof errors = {}
    if (!details.name.trim()) next.name = 'We need a name for the reservation.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.email.trim()))
      next.email = 'That email does not look complete.'
    if (details.phone.replace(/\D/g, '').length < 7)
      next.phone = 'A phone or WhatsApp number helps us meet you.'
    setErrors(next)
    if (Object.keys(next).length === 0) advance(STEP.REVIEW)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[760px]">
        <ProgressRail step={step} maxReached={maxReached} done={!!confirmation} onSelect={goTo} />

        {car && startKey && endKey && currentQuote && !confirmation && (
          <p className="mt-5 text-center text-sm text-cw-ink/70">
            {car.model} · {fmtDay(fromKey(startKey))} → {fmtDay(fromKey(endKey))} ·{' '}
            {formatMoney(currentQuote.totalCents)} total
            {currentQuote.discountPct > 0 && (
              <span className="font-semibold text-cw-teal-dark">
                {' '}
                ({currentQuote.discountPct}% off)
              </span>
            )}
          </p>
        )}

        {fleetQuery.isError && (
          <p className="mt-5 rounded-xl bg-[#fdeceb] px-4 py-3 text-center text-sm font-semibold text-[#b3271d]">
            We could not reach our booking system. Please refresh, or reach us on WhatsApp.
          </p>
        )}

        <div className="relative mt-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={confirmation ? 'done' : step}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="cw-shadow-soft rounded-xl bg-white p-6 md:p-9"
            >
              {confirmation ? (
                <Confirmation confirmation={confirmation} />
              ) : step === STEP.TYPE ? (
                <RentalTypeStep
                  rentalType={rentalType}
                  onChoose={chooseRentalType}
                  onContinue={() => advance(STEP.DATES)}
                />
              ) : step === STEP.DATES ? (
                <DatesStep
                  rentalType={rentalType}
                  start={start}
                  end={endKey ? fromKey(endKey) : undefined}
                  days={selectedDays}
                  location={location}
                  busy={busy}
                  carIds={carIds}
                  loading={fleetQuery.isPending}
                  notice={dateNotice}
                  needsCustomQuote={needsCustomQuote}
                  belowMinimum={belowMinimum}
                  canContinue={datesUsable}
                  onDates={(s, e) => {
                    setStart(s)
                    setEnd(e)
                    setDateNotice(undefined)
                  }}
                  onLocation={setLocation}
                  onContinue={continueFromDates}
                />
              ) : step === STEP.CAR && startKey && endKey && datesUsable ? (
                <CarStep
                  rentalType={rentalType}
                  start={fromKey(startKey)}
                  end={fromKey(endKey)}
                  pickupDate={startKey}
                  returnDate={endKey}
                  available={split.available}
                  unavailable={split.unavailable}
                  carId={carId}
                  notice={carNotice}
                  verifying={availabilityQuery.isFetching}
                  onSelect={(id) => {
                    setCarId(id)
                    setCarNotice(undefined)
                  }}
                  onContinue={() => carId && advance(STEP.DETAILS)}
                />
              ) : step === STEP.DETAILS ? (
                <DetailsStep
                  details={details}
                  errors={errors}
                  onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))}
                  onContinue={continueFromDetails}
                />
              ) : step === STEP.REVIEW && car && startKey && endKey && currentQuote ? (
                <ReviewStep
                  car={car}
                  start={fromKey(startKey)}
                  end={fromKey(endKey)}
                  quote={currentQuote}
                  locationLabel={locationLabel}
                  details={details}
                  onEdit={goTo}
                  onContinue={() => advance(STEP.PAY)}
                />
              ) : step === STEP.PAY && car && startKey && endKey && currentQuote ? (
                <PayStep
                  car={car}
                  start={fromKey(startKey)}
                  end={fromKey(endKey)}
                  quote={currentQuote}
                  processing={booking.isPending}
                  error={booking.isError ? 'Something went wrong on our side. Please try again.' : undefined}
                  onPay={() => booking.mutate()}
                />
              ) : (
                <MissingState onRestart={() => setStep(STEP.DATES)} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  )
}

/* ------------------------------------------------------------------ */
/* Progress rail: the journey's waypoints                              */
/* ------------------------------------------------------------------ */

function ProgressRail({
  step,
  maxReached,
  done,
  onSelect,
}: {
  step: number
  maxReached: number
  done: boolean
  onSelect: (i: number) => void
}) {
  return (
    <ol className="flex items-start" aria-label="Booking steps">
      {STEPS.map((label, i) => {
        const complete = done || i < step
        const current = !done && i === step
        const reachable = !done && i <= maxReached && i !== step
        return (
          <li key={label} className={`flex items-start ${i > 0 ? 'flex-1' : ''}`}>
            {i > 0 && (
              <span
                aria-hidden="true"
                className={`mt-[13px] h-0.5 flex-1 rounded transition-colors duration-500 ${
                  complete || current ? 'bg-cw-teal' : 'bg-cw-navy/15'
                }`}
              />
            )}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(i)}
              className={`group flex flex-col items-center gap-2 px-2 ${
                reachable ? 'cursor-pointer' : 'cursor-default'
              }`}
              aria-current={current ? 'step' : undefined}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                  current
                    ? 'border-cw-yellow bg-white ring-4 ring-cw-yellow/30'
                    : complete
                      ? 'border-cw-teal bg-cw-teal'
                      : 'border-cw-navy/20 bg-white'
                }`}
              >
                {complete ? (
                  <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-white stroke-2" aria-hidden="true">
                    <path d="m2 6.2 2.6 2.6L10 3.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className={`h-2 w-2 rounded-full ${current ? 'bg-cw-teal' : 'bg-cw-navy/20'}`} />
                )}
              </span>
              <span
                className={`font-display text-xs font-bold ${
                  current ? 'text-cw-navy' : complete ? 'text-cw-teal-dark' : 'text-cw-ink/45'
                } ${reachable ? 'group-hover:text-cw-teal' : ''}`}
              >
                {label}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

function StepHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <header>
      <h2 className="font-display text-2xl font-extrabold tracking-tight text-cw-navy">{title}</h2>
      {sub && <p className="mt-2 text-[15px] leading-relaxed text-cw-ink/75">{sub}</p>}
    </header>
  )
}

/** Wizard progression CTA. Garment: navy block that stamps down on press. */
function ContinueButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-8 w-full rounded-xl bg-cw-navy py-4 font-display text-base font-bold text-white transition-all duration-200 enabled:hover:bg-[#03415f] enabled:active:translate-y-[2px] enabled:active:shadow-inner disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  )
}

/**
 * Daily or monthly, chosen before anything else.
 *
 * Both options carry their own price rule on the card, because the difference
 * between them is entirely a pricing difference — the cars, the handover and
 * the service are identical. A guest picking "monthly" is choosing a rate, not
 * a different kind of rental.
 */
function RentalTypeStep({
  rentalType,
  onChoose,
  onContinue,
}: {
  rentalType: RentalType
  onChoose: (t: RentalType) => void
  onContinue: () => void
}) {
  const options: {
    id: RentalType
    title: string
    lead: string
    points: string[]
  }[] = [
    {
      id: 'daily',
      title: 'By the day',
      lead: `Pick your dates. Minimum ${MIN_RENTAL_DAYS} days.`,
      points: [
        ...DISCOUNT_TIERS.map((t) => `${t.label}: ${t.pct}% off automatically`).reverse(),
        `Up to ${MAX_SELF_SERVICE_DAYS} days online, longer is a quick chat with us`,
      ],
    },
    {
      id: 'monthly',
      title: 'By the month',
      lead: `One flat rate for a ${MONTHLY_PERIOD_DAYS} day period.`,
      points: [
        'Our best price for a long stay, already built in',
        'Pick your collection day, we handle the rest',
        'Living here a while? This is the one you want',
      ],
    },
  ]

  return (
    <div>
      <StepHeading
        title="How long do you need it?"
        sub={`Two ways to rent, two prices. Everything else is the same car and the same service. Prices in ${CURRENCY_CODE}.`}
      />
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.id === rentalType
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChoose(option.id)}
              aria-pressed={selected}
              className={`h-full rounded-xl border-2 p-5 text-left transition-all duration-200 ${
                selected
                  ? 'border-cw-teal bg-cw-teal-soft ring-4 ring-cw-teal/15'
                  : 'border-cw-navy/10 bg-white hover:border-cw-teal/50'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected ? 'border-cw-teal bg-cw-teal' : 'border-cw-navy/25 bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="font-display text-lg font-extrabold text-cw-navy">
                  {option.title}
                </span>
              </span>
              <span className="mt-2 block text-[15px] font-semibold text-cw-ink/85">
                {option.lead}
              </span>
              <ul className="mt-3 space-y-1.5">
                {option.points.map((point) => (
                  <li key={point} className="flex gap-2 text-sm leading-snug text-cw-ink/75">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cw-teal" />
                    {point}
                  </li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>
      <ContinueButton label="Continue" onClick={onContinue} />
    </div>
  )
}

function DatesStep({
  rentalType,
  start,
  end,
  days,
  location,
  busy,
  carIds,
  loading,
  notice,
  needsCustomQuote,
  belowMinimum,
  canContinue,
  onDates,
  onLocation,
  onContinue,
}: {
  rentalType: RentalType
  start?: Date
  end?: Date
  days: number
  location: string
  busy: readonly BusyRange[]
  carIds: readonly string[]
  loading: boolean
  notice?: string
  needsCustomQuote: boolean
  belowMinimum: boolean
  canContinue: boolean
  onDates: (s?: Date, e?: Date) => void
  onLocation: (id: string) => void
  onContinue: () => void
}) {
  const monthly = rentalType === 'monthly'
  return (
    <div>
      <StepHeading
        title={monthly ? 'When do you collect?' : 'When and where?'}
        sub={
          monthly
            ? `Tap your collection day. We book a ${MONTHLY_PERIOD_DAYS} day period from there and tell us where to hand you the keys.`
            : `Pick your days, tell us where to hand you the keys. Minimum ${MIN_RENTAL_DAYS} days.`
        }
      />
      {notice && (
        <p className="mt-4 rounded-xl bg-cw-yellow-soft px-4 py-3 text-sm font-semibold text-cw-navy">
          {notice}
        </p>
      )}
      <div className="mt-7 grid gap-8 md:grid-cols-[1.2fr_1fr]">
        <div className={loading ? 'pointer-events-none opacity-50' : undefined}>
          <Calendar
            start={start}
            end={end}
            onChange={onDates}
            busy={busy}
            carIds={carIds}
            rentalType={rentalType}
          />
        </div>
        <div>
          <label htmlFor="pickup-location" className="block font-display text-sm font-bold text-cw-navy">
            Pickup location
          </label>
          <select
            id="pickup-location"
            value={location}
            onChange={(e) => onLocation(e.target.value)}
            className="mt-2 w-full rounded-xl border-2 border-cw-navy/15 bg-white px-4 py-3 text-[15px] text-cw-ink transition-colors focus:border-cw-teal focus:outline-none"
          >
            {PICKUP_LOCATIONS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>

          <div className="mt-6 rounded-xl bg-cw-mint-soft p-4 text-sm leading-relaxed text-cw-ink/80">
            {loading ? (
              'Checking which days are free…'
            ) : start && end ? (
              <>
                <span className="font-semibold text-cw-navy">{fmtDay(start)}</span> pickup,{' '}
                <span className="font-semibold text-cw-navy">{fmtDay(end)}</span> drop-off.
                <span className="mt-1 block text-cw-ink/70">
                  {days} {days === 1 ? 'day' : 'days'}
                  {monthly ? ', at the flat monthly rate.' : '.'}
                </span>
              </>
            ) : start ? (
              'Now tap your drop-off day.'
            ) : monthly ? (
              'Tap the day you want to collect.'
            ) : (
              'Tap a pickup day to start.'
            )}
          </div>

          {/* The minimum is enforced in the calendar (those days do not click),
              so this is the explanation, not the enforcement. */}
          {belowMinimum && (
            <p className="mt-4 rounded-xl bg-cw-yellow-soft px-4 py-3 text-sm font-semibold text-cw-navy">
              Our minimum rental is {MIN_RENTAL_DAYS} days. Stretch the drop-off a little and we are
              good to go.
            </p>
          )}
        </div>
      </div>

      {needsCustomQuote ? (
        <CustomQuoteNotice days={days} />
      ) : (
        <ContinueButton label="Continue" disabled={!canContinue || loading} onClick={onContinue} />
      )}
    </div>
  )
}

/**
 * The 28-day wall. Deliberately NOT a price.
 *
 * A stay this long is priced case by case (insurance, a service mid-rental, a
 * rate that is not on the list), so the flow stops here and hands over to a
 * person. Quoting 35 days at the daily rate would be a number nobody at CW has
 * agreed to, and quietly serving a 30-day monthly rate instead would be selling
 * a guest something other than what they asked for.
 */
function CustomQuoteNotice({ days }: { days: number }) {
  return (
    <div className="mt-8 rounded-xl border-2 border-cw-yellow bg-cw-yellow-soft p-5 text-center">
      <p className="font-display text-lg font-extrabold text-cw-navy">
        {days} days is a long stay. Let's talk.
      </p>
      <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-cw-ink/80">
        Anything over {MAX_SELF_SERVICE_DAYS} days sits outside our standard rates, so we price it
        properly instead of guessing. Message us with your dates and we will come back with a custom
        quote, usually the same day.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl bg-cw-navy px-6 py-3 font-display text-[15px] font-bold text-white transition-all duration-200 hover:bg-[#03415f] active:translate-y-[2px]"
        >
          Ask us on WhatsApp
        </a>
        <a
          href={`mailto:${CONTACT.email}`}
          className="rounded-xl border-2 border-cw-navy/15 bg-white px-6 py-3 font-display text-[15px] font-bold text-cw-navy transition-colors hover:border-cw-teal hover:text-cw-teal"
        >
          Email us
        </a>
      </div>
      <p className="mt-4 text-xs text-cw-ink/60">
        Wanted a month rather than {days} days? Step back and pick the monthly rate.
      </p>
    </div>
  )
}

function CarStep({
  rentalType,
  start,
  end,
  pickupDate,
  returnDate,
  available,
  unavailable,
  carId,
  notice,
  verifying,
  onSelect,
  onContinue,
}: {
  rentalType: RentalType
  start: Date
  end: Date
  pickupDate: string
  returnDate: string
  available: PublicCar[]
  unavailable: PublicCar[]
  carId?: string
  notice?: string
  verifying: boolean
  onSelect: (id: string) => void
  onContinue: () => void
}) {
  return (
    <div>
      <StepHeading
        title="Pick your ride"
        sub={
          rentalType === 'monthly'
            ? `Free for the whole month, ${fmtDay(start)} → ${fmtDay(end)}. Prices shown are the flat monthly rate.`
            : `Free for ${fmtDay(start)} → ${fmtDay(end)}.`
        }
      />
      {notice && (
        <p className="mt-4 rounded-xl bg-cw-yellow-soft px-4 py-3 text-sm font-semibold text-cw-navy">
          {notice}
        </p>
      )}
      {verifying && (
        <p className="mt-4 text-sm text-cw-ink/60">Confirming what's still free…</p>
      )}

      {available.length === 0 && !verifying ? (
        <p className="mt-6 rounded-xl bg-cw-yellow-soft px-4 py-4 text-sm font-semibold text-cw-navy">
          Every car is out for those dates. Try a different range, or message us on WhatsApp —
          we sometimes have a car back early.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {available.map((v) => (
            <CarOption
              key={v.id}
              car={v}
              rentalType={rentalType}
              pickupDate={pickupDate}
              returnDate={returnDate}
              selected={v.id === carId}
              onSelect={() => onSelect(v.id)}
            />
          ))}
        </div>
      )}

      {unavailable.length > 0 && (
        <div className="mt-8">
          <p className="text-sm font-semibold text-cw-ink/60">Out with other guests on your dates</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {unavailable.map((v) => (
              <div key={v.id} className="rounded-xl border-2 border-cw-navy/8 bg-cw-mint-soft/50 p-4 opacity-60">
                <div className="flex items-center gap-3">
                  <img src={v.photoUrl} alt="" loading="lazy" className="h-12 w-16 rounded-lg object-cover grayscale" />
                  <div>
                    <p className="font-display text-sm font-bold text-cw-navy">
                      {v.model} <span className="font-semibold text-cw-ink/60">{v.color}</span>
                    </p>
                    <p className="text-xs text-cw-ink/60">Booked for your dates</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ContinueButton label="Continue" disabled={!carId} onClick={onContinue} />
    </div>
  )
}

function CarOption({
  car,
  rentalType,
  pickupDate,
  returnDate,
  selected,
  onSelect,
}: {
  car: PublicCar
  rentalType: RentalType
  pickupDate: string
  returnDate: string
  selected: boolean
  onSelect: () => void
}) {
  const priced = quoteRental({
    rentalType,
    rates: { dailyRateCents: car.dailyRateCents, monthlyRateCents: car.monthlyRateCents },
    pickupDate,
    returnDate,
  })

  // A car with no monthly rate is offered for daily rentals and not for monthly
  // ones. Saying so beats hiding it: the guest can see the car exists and that
  // there is another way to have it.
  if (!priced.ok) {
    return (
      <div className="rounded-xl border-2 border-cw-navy/8 bg-cw-mint-soft/50 p-4 opacity-70">
        <div className="overflow-hidden rounded-lg bg-cw-mint-soft">
          <img
            src={car.photoUrl}
            alt=""
            loading="lazy"
            className="aspect-[16/9] w-full object-cover grayscale"
          />
        </div>
        <p className="mt-3 font-display text-[15px] font-bold text-cw-navy">
          {car.model} <span className="text-sm font-semibold text-cw-ink/60">{car.color}</span>
        </p>
        <p className="mt-1 text-xs text-cw-ink/70">{priced.message}</p>
      </div>
    )
  }

  const q = priced.quote
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border-2 p-4 text-left transition-all duration-200 ${
        selected
          ? 'border-cw-teal bg-cw-teal-soft ring-4 ring-cw-teal/15'
          : 'border-cw-navy/10 bg-white hover:border-cw-teal/50'
      }`}
    >
      <div className="overflow-hidden rounded-lg bg-cw-mint-soft">
        <img src={car.photoUrl} alt={`${car.model}, ${car.color.toLowerCase()}`} loading="lazy" className="aspect-[16/9] w-full object-cover" />
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-[15px] font-bold text-cw-navy">
            {car.model} <span className="text-sm font-semibold text-cw-ink/60">{car.color}</span>
          </p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-cw-teal-dark ring-1 ring-cw-teal/25">
              {car.transmission}
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-cw-teal-dark ring-1 ring-cw-teal/25">
              {car.seats} seats
            </span>
          </p>
        </div>
        <p className="shrink-0 text-right">
          <span className="font-display text-lg font-extrabold text-cw-navy">
            {formatMoney(q.totalCents)}
          </span>
          <span className="block text-xs text-cw-ink/60">
            {q.rentalType === 'monthly'
              ? `flat rate, ${q.days} days`
              : `${formatMoney(q.rateCents)} × ${q.days} ${q.days === 1 ? 'day' : 'days'}`}
          </span>
          {q.discountPct > 0 && (
            <span className="mt-1 inline-block rounded-full bg-cw-mint px-2 py-0.5 text-[11px] font-bold text-cw-navy">
              {q.discountPct}% off applied
            </span>
          )}
        </p>
      </div>
    </button>
  )
}

function Field({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="block font-display text-sm font-bold text-cw-navy">
        {label}
        {optional && <span className="ml-1.5 font-body text-xs font-normal text-cw-ink/50">optional</span>}
      </label>
      <div className="mt-2">{children}</div>
      {error && <p className="mt-1.5 text-sm font-semibold text-[#b3271d]">{error}</p>}
    </div>
  )
}

const inputClass = (invalid?: boolean) =>
  `w-full rounded-xl border-2 bg-white px-4 py-3 text-[15px] text-cw-ink transition-colors focus:outline-none ${
    invalid ? 'border-[#b3271d]/60 focus:border-[#b3271d]' : 'border-cw-navy/15 focus:border-cw-teal'
  }`

function DetailsStep({
  details,
  errors,
  onChange,
  onContinue,
}: {
  details: Details
  errors: Partial<Record<keyof Details, string>>
  onChange: (patch: Partial<Details>) => void
  onContinue: () => void
}) {
  return (
    <div>
      <StepHeading title="Who's driving?" sub="Just enough to have your keys ready. No account needed." />
      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <Field id="bk-name" label="Full name" error={errors.name}>
          <input id="bk-name" autoComplete="name" value={details.name} onChange={(e) => onChange({ name: e.target.value })} className={inputClass(!!errors.name)} />
        </Field>
        <Field id="bk-email" label="Email" error={errors.email}>
          <input id="bk-email" type="email" autoComplete="email" value={details.email} onChange={(e) => onChange({ email: e.target.value })} className={inputClass(!!errors.email)} />
        </Field>
        <Field id="bk-phone" label="Phone or WhatsApp" error={errors.phone}>
          <input id="bk-phone" type="tel" autoComplete="tel" value={details.phone} onChange={(e) => onChange({ phone: e.target.value })} className={inputClass(!!errors.phone)} />
        </Field>
        <Field id="bk-flight" label="Flight number" optional>
          <input id="bk-flight" value={details.flight} onChange={(e) => onChange({ flight: e.target.value })} placeholder="We track delays for airport pickups" className={inputClass()} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="bk-note" label="Anything we should know?" optional>
            <textarea id="bk-note" rows={3} value={details.note} onChange={(e) => onChange({ note: e.target.value })} className={inputClass()} />
          </Field>
        </div>
      </div>
      <ContinueButton label="Continue" onClick={onContinue} />
    </div>
  )
}

function ReviewStep({
  car,
  start,
  end,
  quote: q,
  locationLabel,
  details,
  onEdit,
  onContinue,
}: {
  car: PublicCar
  start: Date
  end: Date
  quote: Quote
  locationLabel: string
  details: Details
  onEdit: (step: number) => void
  onContinue: () => void
}) {
  const tier = DISCOUNT_TIERS.find((t) => t.pct === q.discountPct)
  return (
    <div>
      <StepHeading title="Look it over" sub="Everything stays editable until you pay." />

      <dl className="mt-7 divide-y divide-cw-navy/10">
        <ReviewRow label="Rental" onEdit={() => onEdit(STEP.TYPE)}>
          {q.rentalType === 'monthly'
            ? `Monthly rate · ${q.days} day period`
            : `By the day · ${q.days} ${q.days === 1 ? 'day' : 'days'}`}
        </ReviewRow>
        <ReviewRow label="Dates" onEdit={() => onEdit(STEP.DATES)}>
          {fmtDay(start)} → {fmtDay(end)} · {locationLabel}
        </ReviewRow>
        <ReviewRow label="Car" onEdit={() => onEdit(STEP.CAR)}>
          {car.model}, {car.color.toLowerCase()} · {car.transmission}
        </ReviewRow>
        <ReviewRow label="Driver" onEdit={() => onEdit(STEP.DETAILS)}>
          {details.name} · {details.email} · {details.phone}
        </ReviewRow>
      </dl>

      {/* The discount gets its own line, with the tier named. A saving that only
          shows up as a smaller total is a saving the guest cannot check. */}
      <div className="mt-7 rounded-xl bg-cw-mint-soft p-5">
        <p className="font-display text-sm font-bold uppercase tracking-widest text-cw-teal-dark">
          Price breakdown
        </p>
        <dl className="mt-3 space-y-2 text-[15px] text-cw-ink/85">
          <div className="flex justify-between">
            <dt>
              {q.rentalType === 'monthly'
                ? `Monthly rate · ${q.days} days`
                : `${formatMoney(q.rateCents)} × ${q.days} ${q.days === 1 ? 'day' : 'days'}`}
            </dt>
            <dd className="font-semibold text-cw-navy">{formatMoney(q.subtotalCents)}</dd>
          </div>
          {q.discountCents > 0 && (
            <div className="flex justify-between text-cw-teal-dark">
              <dt className="font-semibold">
                {tier ? tier.label : 'Long stay'} · {q.discountPct}% off
              </dt>
              <dd className="font-semibold">− {formatMoney(q.discountCents)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>Pickup and drop-off</dt>
            <dd className="font-semibold text-cw-teal-dark">Free</dd>
          </div>
          <div className="flex justify-between border-t border-cw-navy/10 pt-2 text-base">
            <dt className="font-display font-bold text-cw-navy">Total today</dt>
            <dd className="font-display font-extrabold text-cw-navy">
              {formatMoney(q.totalCents)}
            </dd>
          </div>
        </dl>
        {q.rentalType === 'daily' && q.discountPct === 0 && q.days < DISCOUNT_TIERS[2].minDays && (
          <p className="mt-3 text-xs text-cw-ink/65">
            Stay {DISCOUNT_TIERS[2].minDays} days or more and {DISCOUNT_TIERS[2].pct}% comes off
            automatically.
          </p>
        )}
      </div>

      <ContinueButton label="Continue to payment" onClick={onContinue} />
    </div>
  )
}

function ReviewRow({
  label,
  onEdit,
  children,
}: {
  label: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-4">
      <div>
        <dt className="font-display text-sm font-bold text-cw-navy">{label}</dt>
        <dd className="mt-1 text-[15px] text-cw-ink/85">{children}</dd>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="font-display text-sm font-bold text-cw-teal underline decoration-cw-teal/40 underline-offset-4 transition-colors hover:text-cw-teal-dark hover:decoration-cw-teal-dark"
      >
        Edit
      </button>
    </div>
  )
}

function PayStep({
  car,
  start,
  end,
  quote: q,
  processing,
  error,
  onPay,
}: {
  car: PublicCar
  start: Date
  end: Date
  quote: Quote
  processing: boolean
  error?: string
  onPay: () => void
}) {
  return (
    <div>
      <StepHeading
        title="Settle it with Sentoo"
        sub="Curaçao's own payment platform: pay straight from your bank, no card needed."
      />
      <div className="mt-7 rounded-xl border-2 border-cw-navy/10 p-5 text-center">
        <p className="text-sm text-cw-ink/70">Total for the {car.model}</p>
        <p className="mt-1 font-display text-4xl font-extrabold text-cw-navy">
          {formatMoney(q.totalCents)}
        </p>
        <p className="mt-1 text-xs text-cw-ink/60">
          {fmtDay(start)} → {fmtDay(end)} ·{' '}
          {q.rentalType === 'monthly' ? 'monthly rate' : `${q.days} days`}
        </p>
        {q.discountCents > 0 && (
          <p className="mt-2 inline-block rounded-full bg-cw-mint px-3 py-1 text-xs font-bold text-cw-navy">
            {q.discountPct}% long stay discount, {formatMoney(q.discountCents)} off
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-xl bg-[#fdeceb] px-4 py-3 text-sm font-semibold text-[#b3271d]">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={processing}
          onClick={onPay}
          className="mt-6 inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-cw-navy py-4 font-display text-base font-bold text-white transition-all duration-200 enabled:hover:bg-[#03415f] enabled:active:translate-y-[2px] disabled:opacity-70"
        >
          {processing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              Reserving your car
            </>
          ) : (
            <>
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
              </svg>
              Confirm reservation
            </>
          )}
        </button>
        <p className="mt-3 text-xs text-cw-ink/55">
          Sentoo payment is not live yet — your car is held and we settle up at pickup. Prefer
          cash or card? Just say so on WhatsApp.
        </p>
      </div>
    </div>
  )
}

function Confirmation({ confirmation: c }: { confirmation: Confirmed }) {
  const first = c.client.full_name.trim().split(/\s+/)[0] || 'friend'
  /** Short, readable handle for WhatsApp — the full uuid is the real key. */
  const reference = c.bookingId.slice(0, 8).toUpperCase()

  return (
    <div className="text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-cw-mint">
        <svg viewBox="0 0 24 24" className="h-8 w-8 fill-none stroke-cw-navy stroke-[2.5]" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h2 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-cw-navy">
        Masha danki, {first}!
      </h2>
      <p className="mx-auto mt-3 max-w-[44ch] text-[15px] leading-relaxed text-cw-ink/85">
        The {c.car.model} is yours from {fmtDay(fromKey(c.pickupDate))} to{' '}
        {fmtDay(fromKey(c.returnDate))}, keys at {c.pickupLocation}. We'll confirm on WhatsApp
        within the hour.
      </p>

      <dl className="mx-auto mt-7 max-w-[26rem] divide-y divide-cw-navy/10 text-left">
        <ConfirmRow label="Reference">{reference}</ConfirmRow>
        <ConfirmRow label="Car">
          {c.car.model}, {c.car.color.toLowerCase()} · {c.car.transmission} · {c.car.seats} seats
        </ConfirmRow>
        <ConfirmRow label="Pickup">
          {fmtDay(fromKey(c.pickupDate))} at {c.pickupTime.slice(0, 5)} · {c.pickupLocation}
        </ConfirmRow>
        <ConfirmRow label="Drop-off">
          {fmtDay(fromKey(c.returnDate))} at {c.returnTime.slice(0, 5)} · {c.returnLocation}
        </ConfirmRow>
        {c.flightNumber && <ConfirmRow label="Flight">{c.flightNumber}</ConfirmRow>}
        <ConfirmRow label="Rental">
          {c.rentalType === 'monthly'
            ? `Monthly rate · ${c.days} day period`
            : `By the day · ${c.days} ${c.days === 1 ? 'day' : 'days'}`}
        </ConfirmRow>
        <ConfirmRow label="Total">
          {formatMoney(c.totalCents)}
          <span className="block text-xs text-cw-ink/60">
            {c.rentalType === 'monthly'
              ? 'flat monthly rate'
              : `${formatMoney(c.rateCents)} × ${c.days} ${c.days === 1 ? 'day' : 'days'}`}
          </span>
          {c.discountCents > 0 && (
            <span className="block text-xs font-semibold text-cw-teal-dark">
              {c.discountPct}% long stay discount, {formatMoney(c.discountCents)} off
            </span>
          )}
        </ConfirmRow>
        <ConfirmRow label="Status">
          Reservation {c.bookingStatus} · payment {c.paymentStatus}
        </ConfirmRow>
      </dl>

      <p className="mt-6 text-xs text-cw-ink/55">
        A copy is on its way to {c.client.email}. Keep reference {reference} handy if you message us.
      </p>
    </div>
  )
}

function ConfirmRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="font-display text-sm font-bold text-cw-navy">{label}</dt>
      <dd className="text-right text-[15px] text-cw-ink/85">{children}</dd>
    </div>
  )
}

function MissingState({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="py-6 text-center">
      <p className="text-[15px] text-cw-ink/80">This step needs your dates first.</p>
      <button
        type="button"
        onClick={onRestart}
        className="mt-5 rounded-xl bg-cw-teal px-6 py-3 font-display font-bold text-white transition-colors hover:bg-cw-teal-dark active:scale-[0.98]"
      >
        Start with dates
      </button>
    </div>
  )
}
