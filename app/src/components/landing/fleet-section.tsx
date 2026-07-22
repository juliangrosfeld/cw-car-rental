import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { FLEET, type Vehicle } from '../../content/brand'

/**
 * The fleet, a single aligned grid: five identical cards on an even gutter.
 * Every card shares the same image crop, the same body layout and the same
 * height, so nothing steps out of line. The flagship reads through a badge
 * pinned over its photo (an overlay), never through a taller or wider card, so
 * it can't skew the grid. Cards rise on scroll (transform only, screenshot
 * safe) and tilt gently under a fine pointer.
 */

const ACCENT_BAR: Record<Vehicle['accent'], string> = {
  peach: 'bg-cw-peach',
  yellow: 'bg-cw-yellow',
  mint: 'bg-cw-mint',
  pink: 'bg-cw-pink',
  teal: 'bg-cw-teal',
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
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FLEET.map((vehicle, i) => (
            <FleetCard key={vehicle.id} vehicle={vehicle} eager={i === 0} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FleetCard({ vehicle, eager = false }: { vehicle: Vehicle; eager?: boolean }) {
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
          loading={eager ? 'eager' : 'lazy'}
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
        {vehicle.flagship && (
          <span className="absolute left-3 top-3 rounded-full bg-cw-yellow px-3 py-1 font-display text-xs font-bold text-cw-navy shadow-[0_2px_10px_rgba(2,48,71,0.18)]">
            The flagship
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-lg font-bold text-cw-navy">{vehicle.name}</h3>
          <span className="shrink-0 text-sm font-semibold text-cw-ink/60">{vehicle.colorNote}</span>
        </div>
        <p className="mt-2 line-clamp-2 min-h-[2.6em] text-sm leading-relaxed text-cw-ink/80">
          {vehicle.tagline}
        </p>

        <div className="mt-auto pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-cw-ink/85">
              <span className="font-display text-xl font-extrabold text-cw-navy">
                ${vehicle.pricePerDay}
              </span>{' '}
              <span className="text-sm">per day</span>
            </p>
            <span className="shrink-0 rounded-full bg-cw-teal-soft px-3 py-1 text-xs font-semibold text-cw-teal-dark">
              {vehicle.transmission} · {vehicle.seats} seats
            </span>
          </div>

          {/* "Book this car" — split-slide garment: the label slides away,
              the invitation rolls in, over this car's own accent bar. */}
          <Link
            to="/booking"
            search={{ car: vehicle.id }}
            className="mt-4 inline-block font-display text-[15px] font-bold text-cw-navy"
          >
            <span className="block h-[1.5em] overflow-hidden">
              <span className="block transition-transform duration-300 ease-out group-hover:-translate-y-full">
                <span className="block">Book this car</span>
                <span className="block text-cw-teal-dark">Ban, let's go →</span>
              </span>
            </span>
            <span className={`mt-1 block h-[3px] w-16 rounded-full ${ACCENT_BAR[vehicle.accent]}`} />
          </Link>
        </div>
      </div>
    </motion.article>
  )
}
