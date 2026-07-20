import { useEffect, useState } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

/**
 * The spectacle-tier cursor, kept deliberately quiet: a small teal dot that
 * trails the pointer and swells gently over interactive elements. The native
 * cursor stays visible; this is an accent, not a replacement.
 *
 * Fine pointers only, skipped entirely for reduced motion.
 */
export default function Cursor() {
  const [enabled, setEnabled] = useState(false)
  const [hot, setHot] = useState(false)

  const x = useMotionValue(-100)
  const y = useMotionValue(-100)
  const sx = useSpring(x, { stiffness: 420, damping: 38, mass: 0.6 })
  const sy = useSpring(y, { stiffness: 420, damping: 38, mass: 0.6 })

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduced) return
    setEnabled(true)

    const move = (e: PointerEvent) => {
      x.set(e.clientX)
      y.set(e.clientY)
    }
    const over = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      setHot(!!t?.closest('a, button, [role="button"], label, input, select, textarea'))
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', over, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', over)
    }
  }, [x, y])

  if (!enabled) return null

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[90] rounded-full bg-cw-teal mix-blend-multiply"
      style={{ x: sx, y: sy, translateX: '-50%', translateY: '-50%' }}
      animate={{
        width: hot ? 34 : 10,
        height: hot ? 34 : 10,
        opacity: hot ? 0.35 : 0.75,
      }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
    />
  )
}
