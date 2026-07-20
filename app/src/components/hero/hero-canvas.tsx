import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import type { MotionValue } from 'framer-motion'
import HeroScene from './hero-scene'

interface HeroCanvasProps {
  progress?: MotionValue<number>
  mode: 'scroll' | 'turntable' | 'static'
  className?: string
  fov: number
  position: [number, number, number]
  dpr: [number, number]
  frameloop?: 'always' | 'demand'
}

/**
 * The WebGL half of the hero, its own lazy chunk so three.js streams in
 * behind the copy and atmosphere.
 *
 * Resolution scales down before frame rate does: PerformanceMonitor watches
 * the real frame rate and steps the device-pixel-ratio cap toward 1 on
 * devices that can't hold 60fps. Decline-only — no climbing back up, which
 * would oscillate on machines sitting right at the threshold.
 */
export default function HeroCanvas({
  progress,
  mode,
  className,
  fov,
  position,
  dpr,
  frameloop = 'always',
}: HeroCanvasProps) {
  const [dprCap, setDprCap] = useState(dpr[1])

  return (
    <Canvas
      className={className}
      camera={{ fov, position }}
      dpr={[dpr[0], dprCap]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      frameloop={frameloop}
    >
      <PerformanceMonitor onDecline={() => setDprCap((cap) => Math.max(1, cap - 0.5))} />
      <Suspense fallback={null}>
        <HeroScene progress={progress} mode={mode} />
      </Suspense>
    </Canvas>
  )
}
