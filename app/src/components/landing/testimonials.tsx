import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { TESTIMONIALS, type Testimonial } from '../../content/brand'

/**
 * Guest testimonials, one at a time.
 *
 * Copy lives in `TESTIMONIALS` (src/content/brand.ts), so swapping placeholder
 * quotes for real ones is a content edit and never a code edit. Length, order
 * and star ratings all come off that array.
 *
 * Motion is deliberately quiet: every quote is rendered into the same grid
 * cell, so the section is as tall as the longest one and nothing reflows when
 * the slide changes. The change itself is a crossfade with a one-step settle,
 * no sliding track, no shadows moving around.
 *
 * The auto-advance yields to the person using it, in three ways:
 *   1. hover or keyboard focus inside the carousel holds it entirely;
 *   2. an arrow, a dot or a swipe buys a longer pause (RESUME_MS) before the
 *      rotation picks up again, so it never advances out from under a click;
 *   3. `prefers-reduced-motion` stops it for good, matching the hero, which
 *      drops its video for the same users.
 */

/** Time on each quote when rotating on its own. */
const AUTO_MS = 5500
/** Longer gap after a manual move, before auto-advance resumes. */
const RESUME_MS = 12000
/** Horizontal travel that counts as a swipe rather than a tap or a scroll. */
const SWIPE_PX = 45

export default function Testimonials() {
  const reducedMotion = useReducedMotion() ?? false
  const count = TESTIMONIALS.length

  const [index, setIndex] = useState(0)
  /** Hover or focus inside the carousel. Holds the rotation outright. */
  const [held, setHeld] = useState(false)
  /** Bumped on every manual move; a non-zero value means "wait longer". */
  const [nudge, setNudge] = useState(0)

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  )

  /** Navigation the user asked for, as opposed to the timer's. */
  const goManual = useCallback(
    (next: number) => {
      go(next)
      setNudge((n) => n + 1)
    },
    [go],
  )

  useEffect(() => {
    if (reducedMotion || held || count < 2) return
    const id = window.setTimeout(
      () => {
        // Clearing the nudge here is what returns the carousel to its normal
        // cadence: the next pass through this effect sees nudge === 0 again.
        setNudge(0)
        go(index + 1)
      },
      nudge > 0 ? RESUME_MS : AUTO_MS,
    )
    return () => window.clearTimeout(id)
  }, [index, held, nudge, reducedMotion, count, go])

  // Swipe. Pointer events cover touch, pen and mouse drag alike; the vertical
  // check lets a scroll that starts on the quote stay a scroll.
  const swipeFrom = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    swipeFrom.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const from = swipeFrom.current
    swipeFrom.current = null
    if (!from) return
    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return
    goManual(index + (dx < 0 ? 1 : -1))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goManual(index - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goManual(index + 1)
    }
  }

  return (
    <section className="bg-cw-teal-soft">
      <div className="mx-auto max-w-[1160px] px-5 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-[820px] text-center">
          <p className="cw-waypoint justify-center text-cw-teal">
            <span className="h-2 w-2 rounded-full bg-cw-yellow" />
          </p>
          <h2 className="mt-6 font-display text-[clamp(1.9rem,3.6vw,3rem)] font-extrabold leading-tight tracking-tight text-cw-navy">
            What guests say when they get home.
          </h2>
        </div>

        <div
          role="group"
          aria-roledescription="carousel"
          aria-label="Guest testimonials"
          onKeyDown={onKeyDown}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
          className="mx-auto mt-14 max-w-[760px]"
        >
          {/* The quotes, stacked in one grid cell: the tallest sets the height
              once, so a change of slide never moves the controls below. */}
          <div
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (swipeFrom.current = null)}
            aria-live={held ? 'polite' : 'off'}
            className="grid touch-pan-y"
          >
            {TESTIMONIALS.map((testimonial, i) => (
              <Quote key={testimonial.id} testimonial={testimonial} active={i === index} />
            ))}
          </div>

          <div className="mt-10 flex items-center justify-center gap-3">
            <Arrow
              direction="prev"
              label="Previous testimonial"
              onClick={() => goManual(index - 1)}
            />

            <div className="flex items-center gap-2 px-1">
              {TESTIMONIALS.map((testimonial, i) => (
                <button
                  key={testimonial.id}
                  type="button"
                  onClick={() => goManual(i)}
                  aria-label={`Show testimonial ${i + 1} of ${count}, ${testimonial.name}`}
                  aria-current={i === index}
                  className="group grid h-9 w-5 place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cw-teal"
                >
                  <span
                    className={`h-2 w-2 rounded-full transition-colors duration-300 ${
                      i === index
                        ? 'bg-cw-teal'
                        : 'bg-cw-navy/20 group-hover:bg-cw-navy/40'
                    }`}
                  />
                </button>
              ))}
            </div>

            <Arrow direction="next" label="Next testimonial" onClick={() => goManual(index + 1)} />
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * One quote. Inactive quotes stay in the flow to hold the height but are taken
 * out of the accessibility tree, so only the visible one is ever read out.
 */
function Quote({ testimonial, active }: { testimonial: Testimonial; active: boolean }) {
  return (
    <figure
      aria-hidden={!active}
      className={`col-start-1 row-start-1 text-center transition-[opacity,transform] duration-500 ease-out ${
        active ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-1'
      }`}
    >
      <Stars rating={testimonial.rating} />

      <blockquote className="mx-auto mt-6 max-w-[46ch] text-[clamp(1.1rem,1.9vw,1.45rem)] leading-relaxed text-cw-navy">
        "{testimonial.quote}"
      </blockquote>

      <figcaption className="mt-7">
        <span className="block font-display text-base font-bold text-cw-navy">
          {testimonial.name}
        </span>
        {testimonial.from && (
          <span className="mt-1 block text-sm text-cw-ink/70">{testimonial.from}</span>
        )}
      </figcaption>
    </figure>
  )
}

/** Five stars, filled to `rating`. One label for the group, not per star. */
function Stars({ rating }: { rating: number }) {
  return (
    <span
      role="img"
      aria-label={`${rating} out of 5 stars`}
      className="flex justify-center gap-1.5"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-[18px] w-[18px] ${n <= rating ? 'fill-cw-yellow' : 'fill-cw-navy/15'}`}
        >
          <path d="M12 2l2.47 6.6 7.04.31-5.52 4.39 1.89 6.79L12 16.2l-5.88 3.89 1.89-6.79L2.49 8.91l7.04-.31z" />
        </svg>
      ))}
    </span>
  )
}

function Arrow({
  direction,
  label,
  onClick,
}: {
  direction: 'prev' | 'next'
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-cw-navy/15 bg-white text-cw-navy transition-colors duration-300 hover:border-cw-navy hover:bg-cw-navy hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cw-teal"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d={direction === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  )
}
