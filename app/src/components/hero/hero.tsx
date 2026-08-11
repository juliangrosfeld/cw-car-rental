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
 * Loading is a two-step handoff so the section is never empty:
 *   1. The poster frame paints on first render as a CSS background (170 KB).
 *      It is the first frame of the video, so the swap is invisible.
 *   2. The video source is chosen in an effect (viewport + connection) and
 *      fades in once it can actually play.
 *
 * The video is deliberately skipped — poster only — for reduced-motion users,
 * Save-Data, and 2g-class connections. Copy and CTAs never depend on it.
 */

const POSTER = '/assets/hero/curacao-coast-aerial-poster.jpg'
const SRC_1080 = '/assets/hero/curacao-coast-aerial-1080.mp4'
const SRC_720 = '/assets/hero/curacao-coast-aerial-720.mp4'

/** Which rendition to fetch, or `null` to stay on the poster entirely. */
function pickSource(reducedMotion: boolean): string | null {
  if (reducedMotion) return null

  // Save-Data and slow radio links: the poster is the whole hero. Chromium-only
  // API, so absence is treated as "no objection", not as "slow".
  const conn = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  if (conn?.saveData) return null
  if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return null

  // Phones, tablets and any coarse-pointer device take the 720p cut (1.6 MB vs
  // 3.4 MB). Portrait crops to the centre of the frame, where the road and the
  // car already sit, so the smaller rendition loses nothing that shows.
  const small = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches
  const lowMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (small || (lowMemory !== undefined && lowMemory <= 4)) return SRC_720
  return SRC_1080
}

export default function Hero() {
  const reducedMotion = useReducedMotion() ?? false
  const [src, setSrc] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    setSrc(pickSource(reducedMotion))
  }, [reducedMotion])

  // Autoplay can still be refused (low-power mode, aggressive policies). That
  // is not an error state: the poster is already correct, so we just stay on it.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return
    // React sets `muted` as a property and does not always reflect it to the
    // attribute; iOS checks the element itself when deciding whether an inline
    // autoplay is allowed, so assert it here before asking to play.
    video.muted = true
    const play = video.play()
    if (play) play.catch(() => setPlaying(false))
  }, [src])

  return (
    <section className="relative isolate flex min-h-dvh flex-col justify-end overflow-hidden">
      {/* 1. Poster frame — the hero has a real image from first paint, and
             keeps one for good if the video is skipped or never arrives. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cw-navy bg-cover bg-center"
        style={{ backgroundImage: `url(${POSTER})` }}
      />

      {/* 2. The footage, fading over the poster once it is genuinely playing. */}
      {src && (
        <video
          ref={videoRef}
          src={src}
          poster={POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          disablePictureInPicture
          onPlaying={() => setPlaying(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out ${
            playing ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* 3. Scrim. The footage is bright — sunlit scrub and turquoise reef — so
             legibility is bought here, not with text shadows alone:
             a navy wash overall, a deep foot under the copy, and a top band so
             the transparent nav's white marks hold over the water. */}
      <div aria-hidden="true" className="absolute inset-0 bg-cw-navy/12" />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(2,48,71,0.55) 0%, rgba(2,48,71,0.14) 20%, rgba(2,48,71,0) 38%, rgba(2,48,71,0.54) 72%, rgba(2,48,71,0.9) 100%)',
        }}
      />
      {/* A gentle pull from the left anchors the copy column on wide screens.
          Kept shallow on purpose: the reef in the left of frame is the best
          thing in the shot, and a heavier wash turns it grey. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 hidden md:block"
        style={{
          background:
            'linear-gradient(90deg, rgba(2,48,71,0.5) 0%, rgba(2,48,71,0.14) 34%, rgba(2,48,71,0) 62%)',
        }}
      />

      {/* 4. Copy. */}
      <div className="relative z-10 mx-auto w-full max-w-[1160px] px-5 pb-[9dvh] pt-32 md:px-8 md:pb-[14dvh]">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="font-display text-lg font-bold text-cw-yellow [text-shadow:0_1px_12px_rgba(2,48,71,0.5)]">
            Bon bini!
          </p>
          <h1 className="mt-3 max-w-[16ch] font-display text-[clamp(2.6rem,4.6vw,4.2rem)] font-extrabold leading-[1.02] tracking-tight text-white [text-shadow:0_2px_24px_rgba(2,48,71,0.5)]">
            The island is yours.
          </h1>
          <p className="mt-4 max-w-[44ch] text-base leading-relaxed text-white [text-shadow:0_1px_14px_rgba(2,48,71,0.55)] md:text-lg">
            {POSITIONING}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-5">
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
