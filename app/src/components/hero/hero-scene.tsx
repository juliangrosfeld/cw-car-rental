import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import type { MotionValue } from 'framer-motion'
import CarModel from './car-model'

interface HeroSceneProps {
  /** Scroll progress 0..1 — required when mode is "scroll". */
  progress?: MotionValue<number>
  mode: 'scroll' | 'turntable' | 'static'
}

/**
 * One consistent rendered scene: the car AND its Curaçao morning share the
 * same lights, fog, and ground, so nothing floats and nothing is composited.
 *
 * Camera journey (proven choreography, ported): starts tight on the
 * front-right headlight, pulls back to reveal the car, sweeps around the far
 * side, settles on a wide, slightly elevated three-quarter view.
 */
const CAMERA_PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(2.7, 1.1, 4.1), //  close: headlight / front wheel detail
    new THREE.Vector3(5.0, 1.8, 6.4), //  pull back: 3/4 front reveal
    new THREE.Vector3(6.8, 2.3, 0.6), //  slide along the right flank
    new THREE.Vector3(1.0, 2.7, -7.4), // sweep behind the car
    new THREE.Vector3(-6.4, 2.4, -1.2), // far side
    new THREE.Vector3(-6.4, 3.1, 7.6), // settle: wide 3/4 front-left, elevated
  ],
  false,
  'catmullrom',
  0.35,
)

/** What the camera looks at: a headlight detail first, then the car's heart. */
const LOOK_START = new THREE.Vector3(0.7, 0.8, 1.9)
const LOOK_CENTER = new THREE.Vector3(0, 0.7, 0)

/** Static/settled camera for reduced motion and the mobile turntable. */
export const SETTLE_POSITION: [number, number, number] = [-6.4, 3.1, 7.6]

export default function HeroScene({ progress, mode }: HeroSceneProps) {
  const { camera } = useThree()
  const carGroup = useRef<THREE.Group>(null)
  const smoothed = useRef(0)
  const lookTarget = useMemo(() => new THREE.Vector3(), [])
  const posTarget = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    if (mode === 'scroll' && progress) {
      // Damp toward the scroll position so fast scrolling stays buttery.
      smoothed.current = THREE.MathUtils.damp(smoothed.current, progress.get(), 4.5, delta)
      const t = THREE.MathUtils.clamp(smoothed.current, 0, 1)

      CAMERA_PATH.getPoint(t, posTarget)
      camera.position.copy(posTarget)

      // Ease the gaze from the headlight detail to the whole car early on.
      lookTarget.lerpVectors(LOOK_START, LOOK_CENTER, THREE.MathUtils.smoothstep(t, 0, 0.3))
      camera.lookAt(lookTarget)
    } else if (mode === 'turntable' && carGroup.current) {
      // Mobile: calm idle rotation, no scroll coupling.
      carGroup.current.rotation.y = state.clock.elapsedTime * 0.18
      camera.lookAt(LOOK_CENTER)
    } else {
      camera.lookAt(LOOK_CENTER)
    }
  })

  return (
    <>
      <fog attach="fog" args={['#bfe8e2', 26, 80]} />

      {/*
        Procedural studio environment — Lightformers instead of a fetched
        HDRI so nothing depends on a CDN. This is what the paint reflects:
        a warm sun card, a bright sky card overhead, and long cool strips
        along the flanks for showroom streaks on curved panels.
      */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.6} color="#fff3dd" position={[5, 6, 4]} scale={[7, 4, 1]} target={[0, 0.7, 0]} />
        <Lightformer form="rect" intensity={1.6} color="#ffffff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#eafaf7" position={[-8, 1.6, 0]} rotation-y={Math.PI / 2} scale={[10, 1.6, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#dff3ef" position={[8, 1.6, 0]} rotation-y={-Math.PI / 2} scale={[10, 1.6, 1]} />
        <Lightformer form="circle" intensity={4} color="#fff8e8" position={[3, 9, -4]} scale={2.4} target={[0, 0, 0]} />
      </Environment>

      {/* Three-point rig over the environment: warm key, mint fill, teal rim. */}
      <directionalLight position={[6, 8, 5]} intensity={2} color="#fff2dc" />
      <directionalLight position={[-6, 4, -2]} intensity={0.55} color="#bad9ce" />
      <spotLight position={[-2, 6, -8]} intensity={1.4} color="#9fdcd6" angle={0.6} penumbra={1} />
      <ambientLight intensity={0.25} color="#eafaf7" />

      <IslandWorld />

      <group ref={carGroup}>
        <CarModel />
        <GroundShadow />
      </group>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The island around the car — same scene, same light, same fog        */
/* ------------------------------------------------------------------ */

function IslandWorld() {
  return (
    <>
      <Sky />
      <Sea />
      <Sun />
      <Palm position={[-5.6, 0, -3.2]} lean={0.12} height={2.7} />
      <Palm position={[10.5, 0, -3.5]} lean={-0.09} height={3.1} />
      <Palm position={[-8.5, 0, 4.5]} lean={0.16} height={2.4} />
    </>
  )
}

/** Gradient sky dome: light zenith into a pale turquoise horizon. */
function Sky() {
  const texture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 4
    c.height = 256
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#f2fdfb')
    g.addColorStop(0.55, '#cdf0ea')
    g.addColorStop(1, '#9fdcd4')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 4, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  return (
    <mesh>
      <sphereGeometry args={[72, 24, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} />
    </mesh>
  )
}

/** The sea-teal ground: brighter under the car, deepening toward the fog. */
function Sea() {
  const texture = useMemo(() => {
    const size = 512
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.04, size / 2, size / 2, size / 2)
    g.addColorStop(0, '#6cc9bc')
    g.addColorStop(0.4, '#54bcae')
    g.addColorStop(1, '#3da294')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
      <circleGeometry args={[75, 48]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0} />
    </mesh>
  )
}

/** Low sun with a soft additive glow, placed where the settled view finds it. */
function Sun() {
  const glow = useMemo(() => {
    const size = 256
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255, 245, 214, 0.9)')
    g.addColorStop(0.35, 'rgba(255, 233, 176, 0.35)')
    g.addColorStop(1, 'rgba(255, 233, 176, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    return new THREE.CanvasTexture(c)
  }, [])

  return (
    <group position={[20, 13, -27]}>
      <mesh>
        <circleGeometry args={[3.2, 32]} />
        <meshBasicMaterial color="#fff6dc" fog={false} />
      </mesh>
      <sprite scale={[26, 26, 1]}>
        <spriteMaterial map={glow} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </sprite>
    </group>
  )
}

/**
 * Stylized palm: leaning faceted trunk, a crown of drooping fronds. Each
 * frond is a squashed sphere pivoted AT the crown so the leaves visibly grow
 * out of the trunk top instead of floating beside it.
 */
function Palm({
  position,
  lean,
  height,
}: {
  position: [number, number, number]
  lean: number
  height: number
}) {
  const fronds = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        angle: (i / 6) * Math.PI * 2 + 0.3,
        droop: 0.35 + (i % 3) * 0.12,
        length: 1.15 + (i % 2) * 0.25,
      })),
    [],
  )

  return (
    <group position={position} rotation={[0, 0, lean]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.13, height, 6]} />
        <meshStandardMaterial color="#b98d67" roughness={0.9} flatShading />
      </mesh>
      {/* Crown knot covers the trunk tip and roots the fronds visually. */}
      <mesh position={[0, height, 0]}>
        <sphereGeometry args={[0.14, 8, 6]} />
        <meshStandardMaterial color="#8f6b4e" roughness={0.9} flatShading />
      </mesh>
      <group position={[0, height + 0.02, 0]}>
        {fronds.map(({ angle, droop, length }, i) => (
          <group key={i} rotation={[0, angle, -droop]}>
            {/* Pivot at the crown: the frond stretches outward from x=0. */}
            <mesh position={[length / 2, 0, 0]} scale={[length, 0.05, 0.34]}>
              <sphereGeometry args={[0.5, 8, 6]} />
              <meshStandardMaterial color={i % 2 ? '#2f9e7e' : '#3cae8d'} roughness={0.8} flatShading />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

/**
 * Soft baked shadow under the car — a radial-gradient sprite on the ground.
 * Cheaper than real-time contact shadows (no extra render passes), which
 * matters on mobile, and it can't misbehave.
 */
function GroundShadow() {
  const texture = useMemo(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(2, 48, 71, 0.62)')
    g.addColorStop(0.45, 'rgba(2, 48, 71, 0.4)')
    g.addColorStop(1, 'rgba(2, 48, 71, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    return new THREE.CanvasTexture(canvas)
  }, [])

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} scale={[1.35, 1.9, 1]}>
      <planeGeometry args={[3.4, 3.4]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}
