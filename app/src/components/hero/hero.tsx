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
             the transparent nav's white marks hold over the water.

             The foot was lightened (0.54/0.9 -> 0.46/0.80) when the left-hand
             wash came out: with nothing else greying the frame it read as a
             band rather than a fade. Measured against the loop's brightest
             frames, the copy still clears 11:1 — the floor for white-on-video
             here is 4.5:1, so the headroom is spent on the reef, not on text.

             The TOP band is deliberately untouched. The nav's worst case is
             3.9:1, already under AA for its size, and that is the bright water
             behind it rather than the scrim: lightening the band costs another
             0.1 and buys nothing visible. If the nav is ever fixed properly it
             wants a solid backdrop, not a deeper wash here. */}
      <div aria-hidden="true" className="absolute inset-0 bg-cw-navy/12" />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(2,48,71,0.55) 0%, rgba(2,48,71,0.14) 20%, rgba(2,48,71,0) 40%, rgba(2,48,71,0.46) 74%, rgba(2,48,71,0.8) 100%)',
        }}
      />
      {/* 4. Copy. Centred, and deliberately low in the frame: the drone tracks
             the car, which therefore sits near the middle of the shot for the
             whole loop (measured: x 49-55%, y 39-56% of frame). Bottom-anchoring
             is what keeps centred copy off it — see the padding below. */}
      <div className="relative z-10 mx-auto w-full max-w-[1160px] px-5 pb-[4dvh] pt-32 text-center md:px-8 md:pb-[6dvh]">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="font-display text-lg font-bold text-cw-yellow [text-shadow:0_1px_12px_rgba(2,48,71,0.5)]">
            Bon bini!
          </p>
          <h1 className="mx-auto mt-3 max-w-[16ch] font-display text-[clamp(2.6rem,4.6vw,4.2rem)] font-extrabold leading-[1.02] tracking-tight text-white [text-shadow:0_2px_24px_rgba(2,48,71,0.5)] [@media(max-height:700px)]:mt-2 [@media(max-height:700px)]:text-[clamp(2rem,3.4vw,3rem)]">
            The island is yours.
          </h1>
          <p className="mx-auto mt-4 max-w-[44ch] text-base leading-relaxed text-white [text-shadow:0_1px_14px_rgba(2,48,71,0.55)] md:text-lg [@media(max-height:700px)]:mt-2">
            {POSITIONING}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-5 [@media(max-height:700px)]:mt-4">
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
