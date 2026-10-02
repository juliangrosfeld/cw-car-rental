import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { FLEET, type Vehicle } from '../../content/brand'
import { CURRENCY_CODE } from '../../lib/money'
import { DISCOUNT_TIER_SUMMARY, MIN_RENTAL_DAYS } from '../../lib/booking/rental'

/**
 * The fleet, a single aligned grid: identical cards on an even gutter.
 * Every card shares the same image crop, the same body layout and the same
 * height, so nothing steps out of line. The flagship reads through a badge
 * pinned over its photo (an overlay), never through a taller or wider card, so
 * it can't skew the grid. Cards rise on scroll (transform only, screenshot
 * safe) and tilt gently under a fine pointer.
 */

/** The paint colour behind each colorNote, for the dot beside it. Keyed by the
 *  label rather than added to Vehicle so the fleet data stays as it is; a car
 *  in a colour missing here renders a hollow ring, never a wrong colour. */
const SWATCH: Record<string, string> = {
  Grey: '#9a9ea4',
  Silver: '#cfd3d8',
  Red: '#c8102e',
  Black: '#1c1f24',
}

export default function FleetSection() {
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const section = sectionRef.current
    if (!section) return

    let ctx: { revert: () => void } | undefined
    let cancelled = false
    Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled) return
      gsap.registerPlugin(ScrollTrigger)
      ctx = gsap.context(() => {
        gsap.from('[data-fleet-card]', {
          y: 44,
          duration: 0.9,
          ease: 'power3.out',
          stagger: 0.09,
          scrollTrigger: { trigger: section, start: 'top 78%' },
        })
      }, section)
    })
    return () => {
      cancelled = true
      ctx?.revert()
    }
  }, [])

  return (
    <section id="fleet" ref={sectionRef} className="scroll-mt-[72px] bg-cw-mint-soft">
      <div className="mx-auto max-w-[1160px] px-5 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[820px] text-center">
          <p className="cw-waypoint justify-center text-cw-teal">
            <span className="h-2 w-2 rounded-full bg-cw-mint" />
          </p>
          <h2 className="mt-6 font-display text-[clamp(1.9rem,3.6vw,3rem)] font-extrabold leading-tight tracking-tight text-cw-navy">
            No counters. No queues. Just keys.
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-base leading-relaxed text-cw-ink/85 md:text-lg">
            You land, we meet you, you drive. Booking takes two minutes, and a real person answers
            every message.
          </p>

          {/* The discount ladder, said once, in the place a guest is choosing a
              car. Built from DISCOUNT_TIERS, so it cannot drift from what the
              server actually takes off at checkout. */}
          <p className="mx-auto mt-6 inline-flex flex-wrap items-center justify-center gap-x-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-cw-navy shadow-[0_2px_10px_rgba(2,48,71,0.06)]">
            <span>Longer stays save more:</span>
            <span className="font-normal text-cw-ink/80">{DISCOUNT_TIER_SUMMARY}.</span>
          </p>
          <p className="mt-3 text-sm text-cw-ink/65">
            Prices in {CURRENCY_CODE}. Minimum rental {MIN_RENTAL_DAYS} days. Staying a month or
            more? Ask us, we do monthly rates too.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-[960px] gap-6 md:grid-cols-2">
          {FLEET.map((vehicle) => (
            <FleetCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FleetCard({ vehicle }: { vehicle: Vehicle }) {
  const [tiltOn, setTiltOn] = useState(false)
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const srx = useSpring(rx, { stiffness: 220, damping: 18 })
  const sry = useSpring(ry, { stiffness: 220, damping: 18 })

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setTiltOn(fine && !reduced)
  }, [])

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!tiltOn) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    ry.set(px * 5)
    rx.set(py * -5)
  }
  const onLeave = () => {
    rx.set(0)
    ry.set(0)
  }

  return (
    <motion.article
      data-fleet-card
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={tiltOn ? { rotateX: srx, rotateY: sry, transformPerspective: 900 } : undefined}
      className="group cw-shadow-soft flex h-full flex-col overflow-hidden rounded-xl bg-white transition-shadow duration-300 hover:cw-shadow-lift"
    >
      {/* Identical crop on every card; the flagship badge is an overlay so it
          never adds height or shifts the header below it. */}
      <div className="relative aspect-[16/10] overflow-hidden bg-cw-teal-soft">
        <img
          src={vehicle.photo}
          alt={`${vehicle.name}, ${vehicle.colorNote.toLowerCase()}`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
        {vehicle.flagship && (
          <span className="absolute left-3 top-3 rounded-full bg-cw-yellow px-3 py-1 font-display text-xs font-bold text-cw-navy shadow-[0_2px_10px_rgba(2,48,71,0.18)]">
            The flagship
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-xl font-extrabold tracking-tight text-cw-navy">
            {vehicle.name}
          </h3>
          <span className="flex shrink-0 items-center gap-2 text-sm text-cw-ink/75">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-full ring-1 ring-cw-ink/15"
              style={{ backgroundColor: SWATCH[vehicle.colorNote] ?? 'transparent' }}
            />
            {vehicle.colorNote}
          </span>
        </div>
        <p className="mt-1 text-sm font-semibold text-cw-teal">
          {vehicle.transmission} · {vehicle.seats} seats
        </p>
        <p className="mt-2 line-clamp-2 min-h-[2.6em] text-sm leading-relaxed text-cw-ink/80">
          {vehicle.tagline}
        </p>

        <div className="mt-auto pt-5">
          {/* Two prices, one product each: the daily rate a week's holiday is
              billed at, and the flat monthly rate that is NOT thirty of them. */}
          <dl className="grid grid-cols-2 border-t border-cw-ink/10 pt-4">
            <div className="pr-3">
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-cw-ink/60">
                Daily rate
              </dt>
              <dd className="mt-1 flex flex-wrap items-baseline gap-x-1 text-cw-ink/70">
                <span className="font-display text-[17px] font-extrabold text-cw-navy lg:text-xl">
                  {CURRENCY_CODE} {vehicle.pricePerDay}
                </span>
                <span className="whitespace-nowrap text-[13px] lg:text-sm">/ day</span>
              </dd>
            </div>
            <div className="border-l border-cw-ink/10 pl-3">
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-cw-ink/60">
                Monthly rate
              </dt>
              <dd className="mt-1 flex flex-wrap items-baseline gap-x-1 text-cw-ink/70">
                <span className="font-display text-[17px] font-extrabold text-cw-navy lg:text-xl">
                  {CURRENCY_CODE} {vehicle.pricePerMonth.toLocaleString('en-US')}
                </span>
                <span className="whitespace-nowrap text-[13px] lg:text-sm">/ month</span>
              </dd>
            </div>
          </dl>

          {/* "Book this car" — the label crossfades to the invitation, inside
              a full-width navy button with the arrow pinned to its right edge.

              Both labels are stacked in ONE grid cell rather than sequenced in
              a scrolling column. The previous version slid a two-line stack
              inside an h-[1.5em] clip, which glitched twice over: the lines
              inherit a line-height taller than 1.5em so the second one was
              never fully hidden, and -translate-y-full moves an element by its
              OWN height — two lines — when the travel needed is one. Stacking
              removes both: nothing moves, and the cell is as tall and as wide
              as the longer label, so hovering cannot reflow the card.

              The hover label is aria-hidden so the link's accessible name stays
              "Book this car" instead of both strings run together. On touch
              there is no hover at all — Tailwind v4 emits hover variants under
              @media (hover: hover) — so the resting label is what shows. */}
          <Link
            to="/booking"
            search={{ car: vehicle.id }}
            className="mt-5 flex w-full items-center justify-between gap-3 rounded-lg bg-cw-navy px-5 py-3.5 font-display text-[15px] font-bold text-white transition-colors duration-200 hover:bg-cw-navy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cw-teal"
          >
            <span className="grid">
              <span className="col-start-1 row-start-1 transition-opacity duration-200 ease-out group-hover:opacity-0">
                Book this car
              </span>
              <span
                aria-hidden="true"
                className="col-start-1 row-start-1 text-cw-mint opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
              >
                Ban, let&apos;s go →
              </span>
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 text-cw-yellow"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </div>
    </motion.article>
  )
}
