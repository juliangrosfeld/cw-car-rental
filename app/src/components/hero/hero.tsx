import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { POSITIONING } from '../../content/brand'
import { BookCta } from '../site/nav'
import { SETTLE_POSITION } from './hero-scene'

// three.js + R3F live in a lazy chunk: copy and atmosphere paint first,
// the 3D scene streams in behind them. Rendered only after mount (SSR-safe).
const HeroCanvas = lazy(() => import('./hero-canvas'))

/**
 * Hero — the Tier-1 mechanic (B3, 3D subject scene).
 *
 * Desktop: a 400vh scroll track pins a full-viewport canvas while the camera
 * travels around the stylized Venue — close on a headlight, pull back,
 * orbit, settle wide. Copy stages trade places in sync.
 *
 * Mobile / touch: no scroll hijacking; the same scene on a slow turntable at
 * capped DPR. Reduced motion: settled camera, one static copy block.
 * No WebGL: the CSS atmosphere carries the hero alone.
 */

export default function Hero() {
  const [client, setClient] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [webgl, setWebgl] = useState(true)
  const reducedMotion = useReducedMotion() ?? false

  useEffect(() => {
    setClient(true)
    const mq = window.matchMedia('(max-width: 767px), (pointer: coarse)')
    const sync = () => setMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    try {
      const canvas = document.createElement('canvas')
      setWebgl(!!(canvas.getContext('webgl2') || canvas.getContext('webgl')))
    } catch {
      setWebgl(false)
    }
    return () => mq.removeEventListener('change', sync)
  }, [])

  if (client && (mobile || !webgl)) {
    return <MobileHero webgl={webgl} spin={!reducedMotion} />
  }
  return <ScrollHero showCanvas={client && webgl} staticCamera={reducedMotion} />
}

/** The Curaçao morning painted in CSS: first paint and the no-WebGL floor. */
function Atmosphere() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, #f2fdfb 0%, #cdf0ea 46%, #9fdcd4 62%, #54bcae 63%, #3da294 100%)',
        }}
      />
      <div
        className="absolute -right-[10%] top-[8%] h-[46vw] w-[46vw] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(255,245,214,0.85) 0%, rgba(255,233,176,0.28) 40%, rgba(255,233,176,0) 70%)',
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Desktop: pinned scroll-driven sequence                              */
/* ------------------------------------------------------------------ */

function ScrollHero({ showCanvas, staticCamera }: { showCanvas: boolean; staticCamera: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end'],
  })

  // Copy stages, keyed to the camera journey.
  const s1Opacity = useTransform(scrollYProgress, [0, 0.18, 0.28], [1, 1, 0])
  const s1Y = useTransform(scrollYProgress, [0, 0.28], [0, -40])
  const s2Opacity = useTransform(scrollYProgress, [0.34, 0.44, 0.56, 0.66], [0, 1, 1, 0])
  const s3Opacity = useTransform(scrollYProgress, [0.74, 0.87], [0, 1])
  const s3Y = useTransform(scrollYProgress, [0.74, 0.87], [30, 0])

  if (staticCamera) {
    return (
      <section className="relative flex min-h-dvh items-end">
        <Atmosphere />
        {showCanvas && (
          <Suspense fallback={null}>
            <HeroCanvas
              className="!absolute !inset-0"
              fov={32}
              position={SETTLE_POSITION}
              dpr={[1, 1.5]}
              frameloop="demand"
              mode="static"
            />
          </Suspense>
        )}
        <div className="relative z-10 mx-auto w-full max-w-[1160px] px-5 pb-20 pt-32 md:px-8">
          <HeroIntroCopy />
        </div>
      </section>
    )
  }

  return (
    <section
      ref={trackRef}
      className="relative h-[400vh]"
      style={{
        // The 300vh of track below the sticky viewport: keep it in the same
        // atmosphere so full-page renders show a wash, never a dead band.
        background: 'linear-gradient(180deg, #cdf0ea 0%, #9fdcd4 34%, #dff2ee 72%, #ffffff 100%)',
      }}
    >
      <div className="sticky top-0 h-dvh overflow-hidden">
        <Atmosphere />
        {showCanvas && (
          <Suspense fallback={null}>
            <HeroCanvas
              className="!absolute !inset-0"
              fov={34}
              position={[2.3, 0.95, 3.6]}
              dpr={[1, 2]}
              progress={scrollYProgress}
              mode="scroll"
            />
          </Suspense>
        )}

        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="mx-auto h-full max-w-[1160px] px-5 md:px-8">
            {/* Stage 1: the welcome, on screen at scroll zero. */}
            <ClickableStage
              opacity={s1Opacity}
              style={{ y: s1Y }}
              data-stage="1"
              className="absolute bottom-[10dvh] left-5 max-w-[680px] md:left-8"
            >
              <HeroIntroCopy />
            </ClickableStage>

            {/* Stage 2: the flagship caption, mid-orbit. */}
            <motion.div
              style={{ opacity: s2Opacity }}
              data-stage="2"
              className="absolute left-5 top-[20dvh] max-w-[380px] md:left-8"
            >
              <p className="font-display text-lg font-bold text-white md:text-xl">The flagship.</p>
              <p className="mt-2 text-[15px] leading-relaxed text-white/90 md:text-base">
                The Hyundai Venue: cleaned, checked, and ready. Every car we hand over is a small
                ambassador for the island.
              </p>
            </motion.div>

            {/* Stage 3: the settle, keys out. */}
            <ClickableStage
              opacity={s3Opacity}
              style={{ y: s3Y }}
              data-stage="3"
              className="absolute bottom-[12dvh] left-5 md:left-8"
            >
              <h2 className="font-display text-[clamp(2.2rem,4.4vw,3.8rem)] font-extrabold leading-none tracking-tight text-white [text-shadow:0_2px_24px_rgba(2,48,71,0.25)]">
                Your island. Your keys.
              </h2>
              <div className="mt-7">
                <BookCta large />
              </div>
            </ClickableStage>
          </div>
        </div>
      </div>
    </section>
  )
}

/** A copy stage that only accepts clicks while it is actually visible. */
function ClickableStage({
  opacity,
  style,
  className,
  children,
  ...rest
}: {
  opacity: MotionValue<number>
  style?: Record<string, unknown>
  className?: string
  children: React.ReactNode
} & Record<`data-${string}`, string>) {
  const pointerEvents = useTransform(opacity, (v) => (v > 0.35 ? 'auto' : 'none'))
  return (
    <motion.div style={{ opacity, pointerEvents, ...style }} className={className} {...rest}>
      {children}
    </motion.div>
  )
}

/** Welcome copy block, shared by every hero variant (board 1 composition). */
function HeroIntroCopy() {
  return (
    <div>
      <p className="font-display text-lg font-bold text-cw-navy">Bon bini!</p>
      <h1 className="mt-3 font-display text-[clamp(2.6rem,4.6vw,4.2rem)] font-extrabold leading-[1.02] tracking-tight text-white [text-shadow:0_2px_24px_rgba(2,48,71,0.35)]">
        The island is yours.
      </h1>
      <p className="mt-4 max-w-[44ch] text-base leading-relaxed text-white [text-shadow:0_1px_14px_rgba(2,48,71,0.35)] md:text-lg">
        {POSITIONING}
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-6">
        <BookCta large />
        <FleetLink />
      </div>
    </div>
  )
}

/**
 * "See the fleet" — the page's one drawing-underline garment: the line
 * sweeps in teal, then warms to yellow as it completes.
 */
function FleetLink() {
  return (
    <a href="#fleet" className="group relative font-display text-lg font-bold text-white">
      See the fleet
      <span className="absolute -bottom-1 left-0 h-0.5 w-full overflow-hidden">
        <span className="block h-full w-full origin-left scale-x-0 bg-gradient-to-r from-cw-teal via-cw-mint to-cw-yellow transition-transform duration-500 ease-out group-hover:scale-x-100" />
      </span>
      <span className="absolute -bottom-1 left-0 h-px w-full bg-white/40" />
    </a>
  )
}

/* ------------------------------------------------------------------ */
/* Mobile / touch: non-pinned, calm turntable                          */
/* ------------------------------------------------------------------ */

function MobileHero({ webgl, spin }: { webgl: boolean; spin: boolean }) {
  return (
    <section className="relative flex min-h-dvh flex-col justify-end overflow-hidden">
      <Atmosphere />
      {webgl && (
        <div className="absolute inset-x-0 top-[8dvh] h-[52dvh]">
          <Suspense fallback={null}>
            <HeroCanvas
              fov={32}
              position={[6.6, 2.7, 8.4]}
              dpr={[1, 1.5]}
              frameloop={spin ? 'always' : 'demand'}
              mode={spin ? 'turntable' : 'static'}
            />
          </Suspense>
        </div>
      )}
      <div className="relative z-10 mx-auto w-full max-w-[1160px] px-5 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <HeroIntroCopy />
        </motion.div>
      </div>
    </section>
  )
}
