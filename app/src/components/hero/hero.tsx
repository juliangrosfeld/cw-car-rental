import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { POSITIONING } from '../../content/brand'
import { BookCta } from '../site/nav'

/**
 * Hero — full-bleed looping aerial of the Curaçao coast road.
 *
 * A static, continuously looping background video: no scroll hijacking, no
 * WebGL. (The previous scroll-driven 3D hero lives in
 * `src/components/hero-3d-archive/` — see the README there.)
 *
 * The <video> ships in the server HTML, so the browser starts fetching and
 * autoplaying it with the first bytes of the page instead of waiting for
 * hydration (that wait was ~1s on a 4G phone). Which rendition to fetch, or
 * none, is decided by `media` on each <source>, which the browser evaluates
 * before any JS runs:
 *   - reduced motion: no source matches, so nothing downloads and the poster
 *     is the whole hero;
 *   - fine pointer and wider than 900px: the 1080p cut (3.4 MB);
 *   - everything else: the 720p cut (1.6 MB). Portrait crops to the centre of
 *     the frame, where the road and the car already sit, so it loses nothing.
 *
 * The poster is the first frame of the video, so the element shows the same
 * picture before and after it starts: no fade is needed to hide the swap.
 *
 * Save-Data and 2g-class connections can only be read from JS, so once
 * hydrated those drop the video back to the poster (and low-memory desktops
 * step down to 720p). Copy and CTAs never depend on the video.
 */

const POSTER = '/assets/hero/curacao-coast-aerial-poster.jpg'
const SRC_1080 = '/assets/hero/curacao-coast-aerial-1080.mp4'
const SRC_720 = '/assets/hero/curacao-coast-aerial-720.mp4'

const MOTION_OK = '(prefers-reduced-motion: no-preference)'

/*
 * Raw markup rather than JSX because React never writes `muted` into server
 * HTML (it only sets the property after hydration), and browsers refuse to
 * autoplay an unmuted video. Without the attribute the video would wait for
 * hydration, which is exactly the delay this avoids.
 */
const VIDEO_HTML = `<video autoplay muted loop playsinline preload="auto" poster="${POSTER}" aria-hidden="true" tabindex="-1" disablepictureinpicture class="absolute inset-0 h-full w-full object-cover"><source src="${SRC_1080}" type="video/mp4" media="${MOTION_OK} and (min-width: 901px) and (pointer: fine)"><source src="${SRC_720}" type="video/mp4" media="${MOTION_OK}"></video>`

/** What the connection says about the video, readable only once hydrated. */
function connectionVerdict(): 'skip' | 'small' | 'ok' {
  // Chromium-only APIs, so absence is treated as "no objection", not as "slow".
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
    deviceMemory?: number
  }
  const conn = nav.connection
  if (conn?.saveData) return 'skip'
  if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return 'skip'
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) return 'small'
  return 'ok'
}

export default function Hero() {
  const reducedMotion = useReducedMotion() ?? false
  const [videoOn, setVideoOn] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const video = wrapRef.current?.querySelector('video')
    if (!video || reducedMotion) return
    const verdict = connectionVerdict()
    if (verdict === 'skip') {
      // Abort whatever has been fetched so far and fall back to the poster.
      video.pause()
      video.querySelectorAll('source').forEach((s) => s.remove())
      video.load()
      setVideoOn(false)
      return
    }
    if (verdict === 'small' && video.currentSrc.endsWith(SRC_1080)) {
      video.src = SRC_720
    }
    // Autoplay can still be refused (low-power mode, aggressive policies).
    // That is not an error state: the poster frame is already showing.
    if (video.paused) {
      const play = video.play()
      if (play) play.catch(() => {})
    }
  }, [reducedMotion])

  return (
    <section className="relative isolate flex min-h-svh flex-col justify-center overflow-hidden">
      {/* 1. Poster frame. Paints before the video element has decoded anything,
             and stays as the hero for good if the video is skipped. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cw-navy bg-cover bg-center"
        style={{ backgroundImage: `url(${POSTER})` }}
      />

      {/* 2. The footage, from the server HTML (see VIDEO_HTML). */}
      {videoOn && (
        <div
          ref={wrapRef}
          aria-hidden="true"
          className="absolute inset-0"
          dangerouslySetInnerHTML={{ __html: VIDEO_HTML }}
        />
      )}

      {/* 3. Copy. Vertically centred, held to the left of frame. The drone
             tracks the car, so it sits in one column for the whole loop
             (measured: x 49-55%, y 39-56% of the source frame); from md up the
             copy stays left of that column at every height, which is the only
             separation that survives vertical centring. Below md the copy spans
             the width and does sit over the car — an accepted trade. */}
      <div className="relative z-10 mx-auto w-full max-w-[1160px] px-5 py-24 md:px-8">
        {/* md+: the column's right edge stops at 47vw, measured from where the
            centred container actually starts, so it clears the car's left edge
            (49vw) at every width rather than only at the one it was tuned on. */}
        <motion.div
          className="md:max-w-[calc(47vw_-_max(0px,(100vw_-_1160px)/2)_-_2rem)]"
          initial={reducedMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="font-display text-lg font-bold text-cw-yellow [text-shadow:0_1px_12px_rgba(2,48,71,0.5)]">
            Bon bini!
          </p>
          <h1 className="mt-3 max-w-[16ch] font-display text-[clamp(2.6rem,4.6vw,4.2rem)] font-extrabold leading-[1.02] tracking-tight text-white [text-shadow:0_2px_24px_rgba(2,48,71,0.5)] [@media(max-height:700px)]:mt-2 [@media(max-height:700px)]:text-[clamp(2rem,3.4vw,3rem)]">
            The island is yours.
          </h1>
          <p className="mt-4 max-w-[44ch] text-base leading-relaxed text-white [text-shadow:0_1px_14px_rgba(2,48,71,0.55)] md:text-lg [@media(max-height:700px)]:mt-2">
            {POSITIONING}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-5 [@media(max-height:700px)]:mt-4">
            <BookCta large />
            <FleetLink />
          </div>
        </motion.div>
      </div>
    </section>
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
