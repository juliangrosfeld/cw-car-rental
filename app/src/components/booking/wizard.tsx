import { useMemo, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { FLEET, PICKUP_LOCATIONS, type Vehicle } from '../../content/brand'
import { fmtDay, quote, splitFleet, vehicleFree } from './availability'
import Calendar from './calendar'

/**
 * The 5-step booking wizard (board 4): Dates → Car → Details → Review → Pay.
 * One centered step card under a waypoint progress rail. Dates and car stay
 * editable from any later step without losing progress; payment is UI-only
 * (Sentoo) ahead of the real integration.
 */

const STEPS = ['Dates', 'Car', 'Details', 'Review', 'Pay'] as const

interface Details {
  name: string
  email: string
  phone: string
  flight: string
  note: string
}

export default function BookingWizard({ initialCarId }: { initialCarId?: string }) {
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [start, setStart] = useState<Date | undefined>()
  const [end, setEnd] = useState<Date | undefined>()
  const [location, setLocation] = useState(PICKUP_LOCATIONS[0].id)
  const [carId, setCarId] = useState<string | undefined>(
    initialCarId && FLEET.some((v) => v.id === initialCarId) ? initialCarId : undefined,
  )
  const [carNotice, setCarNotice] = useState<string | undefined>()
  const [details, setDetails] = useState<Details>({ name: '', email: '', phone: '', flight: '', note: '' })
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({})
  const [payState, setPayState] = useState<'idle' | 'processing' | 'done'>('idle')

  const car = useMemo(() => FLEET.find((v) => v.id === carId), [carId])
  const locationLabel = PICKUP_LOCATIONS.find((l) => l.id === location)?.label ?? ''

  const goTo = (target: number) => {
    if (payState === 'done') return
    if (target <= maxReached) setStep(target)
  }
  const advance = (target: number) => {
    setStep(target)
    setMaxReached((m) => Math.max(m, target))
  }

  const continueFromDates = () => {
    if (!start || !end) return
    // Dates changed under a chosen car: keep progress, flag the car step.
    if (carId && !vehicleFree(carId, start, end)) {
      setCarId(undefined)
      setCarNotice('Your earlier pick is booked for these dates. Choose another ride.')
    }
    advance(1)
  }

  const continueFromDetails = () => {
    const next: typeof errors = {}
    if (!details.name.trim()) next.name = 'We need a name for the reservation.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.email.trim()))
      next.email = 'That email does not look complete.'
    if (details.phone.replace(/\D/g, '').length < 7)
      next.phone = 'A phone or WhatsApp number helps us meet you.'
    setErrors(next)
    if (Object.keys(next).length === 0) advance(3)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[760px]">
        <ProgressRail step={step} maxReached={maxReached} done={payState === 'done'} onSelect={goTo} />

        {car && start && end && payState !== 'done' && (
          <p className="mt-5 text-center text-sm text-cw-ink/70">
            {car.name} · {fmtDay(start)} → {fmtDay(end)} · ${quote(car, start, end).total} total
          </p>
        )}

        <div className="relative mt-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={payState === 'done' ? 'done' : step}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="cw-shadow-soft rounded-xl bg-white p-6 md:p-9"
            >
              {payState === 'done' && car && start && end ? (
                <Confirmation car={car} start={start} end={end} details={details} locationLabel={locationLabel} />
              ) : step === 0 ? (
                <DatesStep
                  start={start}
                  end={end}
                  location={location}
                  onDates={(s, e) => {
                    setStart(s)
                    setEnd(e)
                  }}
                  onLocation={setLocation}
                  onContinue={continueFromDates}
                />
              ) : step === 1 && start && end ? (
                <CarStep
                  start={start}
                  end={end}
                  carId={carId}
                  notice={carNotice}
                  onSelect={(id) => {
                    setCarId(id)
                    setCarNotice(undefined)
                  }}
                  onContinue={() => carId && advance(2)}
                />
              ) : step === 2 ? (
                <DetailsStep
                  details={details}
                  errors={errors}
                  onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))}
                  onContinue={continueFromDetails}
                />
              ) : step === 3 && car && start && end ? (
                <ReviewStep
                  car={car}
                  start={start}
                  end={end}
                  locationLabel={locationLabel}
                  details={details}
                  onEdit={goTo}
                  onContinue={() => advance(4)}
                />
              ) : step === 4 && car && start && end ? (
                <PayStep
                  car={car}
                  start={start}
                  end={end}
                  processing={payState === 'processing'}
                  onPay={() => {
                    setPayState('processing')
                    window.setTimeout(() => setPayState('done'), 1400)
                  }}
                />
              ) : (
                <MissingState onRestart={() => setStep(0)} />
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

function DatesStep({
  start,
  end,
  location,
  onDates,
  onLocation,
  onContinue,
}: {
  start?: Date
  end?: Date
  location: string
  onDates: (s?: Date, e?: Date) => void
  onLocation: (id: string) => void
  onContinue: () => void
}) {
  return (
    <div>
      <StepHeading
        title="When and where?"
        sub="Pick your days, tell us where to hand you the keys."
      />
      <div className="mt-7 grid gap-8 md:grid-cols-[1.2fr_1fr]">
        <Calendar start={start} end={end} onChange={onDates} />
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
            {start && end ? (
              <>
                <span className="font-semibold text-cw-navy">{fmtDay(start)}</span> pickup,{' '}
                <span className="font-semibold text-cw-navy">{fmtDay(end)}</span> drop-off.
              </>
            ) : start ? (
              'Now tap your drop-off day.'
            ) : (
              'Tap a pickup day to start.'
            )}
          </div>
        </div>
      </div>
      <ContinueButton label="Continue" disabled={!start || !end} onClick={onContinue} />
    </div>
  )
}

function CarStep({
  start,
  end,
  carId,
  notice,
  onSelect,
  onContinue,
}: {
  start: Date
  end: Date
  carId?: string
  notice?: string
  onSelect: (id: string) => void
  onContinue: () => void
}) {
  const { available, unavailable } = splitFleet(start, end)

  return (
    <div>
      <StepHeading title="Pick your ride" sub={`Free for ${fmtDay(start)} → ${fmtDay(end)}.`} />
      {notice && (
        <p className="mt-4 rounded-xl bg-cw-yellow-soft px-4 py-3 text-sm font-semibold text-cw-navy">
          {notice}
        </p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {available.map((v) => (
          <CarOption
            key={v.id}
            vehicle={v}
            start={start}
            end={end}
            selected={v.id === carId}
            onSelect={() => onSelect(v.id)}
          />
        ))}
      </div>

      {unavailable.length > 0 && (
        <div className="mt-8">
          <p className="text-sm font-semibold text-cw-ink/60">Out with other guests on your dates</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {unavailable.map((v) => (
              <div key={v.id} className="rounded-xl border-2 border-cw-navy/8 bg-cw-mint-soft/50 p-4 opacity-60">
                <div className="flex items-center gap-3">
                  <img src={v.photo} alt="" loading="lazy" className="h-12 w-16 rounded-lg object-cover grayscale" />
                  <div>
                    <p className="font-display text-sm font-bold text-cw-navy">
                      {v.name} <span className="font-semibold text-cw-ink/60">{v.colorNote}</span>
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
  vehicle,
  start,
  end,
  selected,
  onSelect,
}: {
  vehicle: Vehicle
  start: Date
  end: Date
  selected: boolean
  onSelect: () => void
}) {
  const q = quote(vehicle, start, end)
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
        <img src={vehicle.photo} alt={`${vehicle.name}, ${vehicle.colorNote.toLowerCase()}`} loading="lazy" className="aspect-[16/9] w-full object-cover" />
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-[15px] font-bold text-cw-navy">
            {vehicle.name} <span className="text-sm font-semibold text-cw-ink/60">{vehicle.colorNote}</span>
          </p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-cw-teal-dark ring-1 ring-cw-teal/25">
              {vehicle.transmission}
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-cw-teal-dark ring-1 ring-cw-teal/25">
              {vehicle.seats} seats
            </span>
          </p>
        </div>
        <p className="shrink-0 text-right">
          <span className="font-display text-lg font-extrabold text-cw-navy">${q.total}</span>
          <span className="block text-xs text-cw-ink/60">
            ${q.perDay} × {q.days} {q.days === 1 ? 'day' : 'days'}
          </span>
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
  locationLabel,
  details,
  onEdit,
  onContinue,
}: {
  car: Vehicle
  start: Date
  end: Date
  locationLabel: string
  details: Details
  onEdit: (step: number) => void
  onContinue: () => void
}) {
  const q = quote(car, start, end)
  return (
    <div>
      <StepHeading title="Look it over" sub="Everything stays editable until you pay." />

      <dl className="mt-7 divide-y divide-cw-navy/10">
        <ReviewRow label="Dates" onEdit={() => onEdit(0)}>
          {fmtDay(start)} → {fmtDay(end)} · {locationLabel}
        </ReviewRow>
        <ReviewRow label="Car" onEdit={() => onEdit(1)}>
          {car.name}, {car.colorNote.toLowerCase()} · {car.transmission}
        </ReviewRow>
        <ReviewRow label="Driver" onEdit={() => onEdit(2)}>
          {details.name} · {details.email} · {details.phone}
        </ReviewRow>
      </dl>

      <div className="mt-7 rounded-xl bg-cw-mint-soft p-5">
        <p className="font-display text-sm font-bold uppercase tracking-widest text-cw-teal-dark">
          Price breakdown
        </p>
        <dl className="mt-3 space-y-2 text-[15px] text-cw-ink/85">
          <div className="flex justify-between">
            <dt>
              ${q.perDay} × {q.days} {q.days === 1 ? 'day' : 'days'}
            </dt>
            <dd className="font-semibold text-cw-navy">${q.total}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Pickup and drop-off</dt>
            <dd className="font-semibold text-cw-teal-dark">Free</dd>
          </div>
          <div className="flex justify-between border-t border-cw-navy/10 pt-2 text-base">
            <dt className="font-display font-bold text-cw-navy">Total today</dt>
            <dd className="font-display font-extrabold text-cw-navy">${q.total}</dd>
          </div>
        </dl>
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
  processing,
  onPay,
}: {
  car: Vehicle
  start: Date
  end: Date
  processing: boolean
  onPay: () => void
}) {
  const q = quote(car, start, end)
  return (
    <div>
      <StepHeading
        title="Settle it with Sentoo"
        sub="Curaçao's own payment platform: pay straight from your bank, no card needed."
      />
      <div className="mt-7 rounded-xl border-2 border-cw-navy/10 p-5 text-center">
        <p className="text-sm text-cw-ink/70">Total for the {car.name}</p>
        <p className="mt-1 font-display text-4xl font-extrabold text-cw-navy">${q.total}</p>
        <p className="mt-1 text-xs text-cw-ink/60">
          {fmtDay(start)} → {fmtDay(end)}
        </p>
        <button
          type="button"
          disabled={processing}
          onClick={onPay}
          className="mt-6 inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-cw-navy py-4 font-display text-base font-bold text-white transition-all duration-200 enabled:hover:bg-[#03415f] enabled:active:translate-y-[2px] disabled:opacity-70"
        >
          {processing ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
              Connecting to Sentoo
            </>
          ) : (
            <>
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
              </svg>
              Pay with Sentoo
            </>
          )}
        </button>
        <p className="mt-3 text-xs text-cw-ink/55">
          Demo mode: no payment is processed yet. Prefer cash or card at pickup? Just say so on
          WhatsApp.
        </p>
      </div>
    </div>
  )
}

function Confirmation({
  car,
  start,
  end,
  details,
  locationLabel,
}: {
  car: Vehicle
  start: Date
  end: Date
  details: Details
  locationLabel: string
}) {
  const first = details.name.trim().split(/\s+/)[0] || 'friend'
  const q = quote(car, start, end)
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
        The {car.name} is yours from {fmtDay(start)} to {fmtDay(end)}, keys at {locationLabel}.
        We'll confirm on WhatsApp within the hour.
      </p>
      <p className="mt-4 font-display text-lg font-bold text-cw-navy">${q.total} · paid with Sentoo</p>
      <p className="mt-6 text-xs text-cw-ink/55">Demo mode: no payment was processed.</p>
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
