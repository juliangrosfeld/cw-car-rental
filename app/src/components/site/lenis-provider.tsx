import { useEffect, type ReactNode } from 'react'

/**
 * Weighted smooth scroll for the whole site: Lenis driven by GSAP's ticker
 * (autoRaf off) with ScrollTrigger kept in sync. Without this bridge,
 * scroll-scrubbed motion stutters against Lenis' interpolation.
 *
 * Everything loads inside the effect so SSR never touches window, and
 * reduced-motion users keep native scrolling untouched.
 */
export default function LenisProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let cleanup: (() => void) | undefined
    let cancelled = false

    Promise.all([
      import('lenis'),
      import('gsap'),
      import('gsap/ScrollTrigger'),
    ]).then(([{ default: Lenis }, { gsap }, { ScrollTrigger }]) => {
      if (cancelled) return
      gsap.registerPlugin(ScrollTrigger)

      const lenis = new Lenis({
        autoRaf: false,
        lerp: 0.12,
        wheelMultiplier: 1,
      })
      lenis.on('scroll', ScrollTrigger.update)
      // Dev/test handle: programmatic window.scrollTo fights Lenis' own
      // interpolation, so tooling scrolls through the instance instead.
      ;(window as unknown as { __lenis?: unknown }).__lenis = lenis

      const tick = (time: number) => {
        lenis.raf(time * 1000)
      }
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)

      cleanup = () => {
        gsap.ticker.remove(tick)
        lenis.destroy()
      }
    })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  return <>{children}</>
}
