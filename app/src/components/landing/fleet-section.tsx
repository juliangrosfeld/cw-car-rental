import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { FLEET, type Vehicle } from '../../content/brand'

/**
 * The fleet, board 2's diagonal staggered masonry: flagship large on the
 * left, the others stepping down at offset heights. Cards rise into place on
 * scroll (transform only, screenshot-safe) and tilt gently under a fine
 * pointer.
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

  const [flagship, ...rest] = FLEET

  return (
    <section id="fleet" ref={sectionRef} className="bg-cw-mint-soft">
      <div className="mx-auto max-w-[1160px] px-5 py-24 md:px-8 md:py-32">
        <div className="max-w-[560px]">
          <h2 className="font-display text-[clamp(2rem,4vw,3.2rem)] font-extrabold tracking-tight text-cw-navy">
            Pick your ride
          </h2>
          <p className="mt-4 text-base leading-relaxed text-cw-ink/85 md:text-lg">
            Five cars, zero nonsense. All automatic, all checked before every handover.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <FleetCard vehicle={flagship} big />
          </div>
          <div className="flex flex-col gap-6 md:mt-12">
            <FleetCard vehicle={rest[0]} />
            <FleetCard vehicle={rest[1]} />
          </div>
          <div className="flex flex-col gap-6 md:mt-24">
            <FleetCard vehicle={rest[2]} />
            <FleetCard vehicle={rest[3]} />
          </div>
        </div>
      </div>
    </section>
  )
}

function FleetCard({ vehicle, big = false }: { vehicle: Vehicle; big?: boolean }) {
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
      <div className={`overflow-hidden bg-cw-teal-soft ${big ? 'aspect-[4/3]' : 'aspect-[16/10]'}`}>
        <img
          src={vehicle.photo}
          alt={`${vehicle.name}, ${vehicle.colorNote.toLowerCase()}`}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
      </div>
      <div className={`flex flex-1 flex-col ${big ? 'p-7' : 'p-5'}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={`font-display font-bold text-cw-navy ${big ? 'text-2xl' : 'text-lg'}`}>
            {vehicle.name}
            <span className="ml-2 text-sm font-semibold text-cw-ink/60">{vehicle.colorNote}</span>
          </h3>
          {vehicle.flagship && (
            <span className="rounded-full bg-cw-yellow px-3 py-1 font-display text-xs font-bold text-cw-navy">
              The flagship
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-cw-ink/80">{vehicle.tagline}</p>

        <div className="mt-auto pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-cw-ink/85">
              <span className={`font-display font-extrabold text-cw-navy ${big ? 'text-3xl' : 'text-xl'}`}>
                ${vehicle.pricePerDay}
              </span>{' '}
              <span className="text-sm">per day</span>
            </p>
            <span className="rounded-full bg-cw-teal-soft px-3 py-1 text-xs font-semibold text-cw-teal-dark">
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
