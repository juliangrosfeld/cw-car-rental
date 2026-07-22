import { Suspense, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import type { MotionValue } from 'framer-motion'
import VenueCar from './venue-car'

interface HeroSceneProps {
  /** Scroll progress 0..1 — required when mode is "scroll". */
  progress?: MotionValue<number>
  mode: 'scroll' | 'turntable' | 'static'
}

/**
 * One consistent rendered scene: the car AND its atmosphere share the same
 * lights, fog and ground, so nothing floats and nothing is composited.
 *
 * The mood is deliberately spare — a beautifully lit gradient sky and haze do
 * the work, with the car as the only real subject and a single wind-bent
 * divi-divi tree for a whisper of Curaçao. No island, no palm grove.
 *
 * Camera journey (proven choreography): starts tight on the front-right
 * headlight, pulls back to reveal the car, sweeps around the far side, settles
 * on a wide, slightly elevated three-quarter view.
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

/* ------------------------------------------------------------------ */
/* Colour temperature — one warm→cool axis, driven by scroll progress   */
/* ------------------------------------------------------------------ */

/** Raw sRGB channel triplet (bypasses colour management for the flat sky). */
function srgb(hex: string) {
  return new THREE.Vector3(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  )
}

// Lights, fog and sky each carry a warm (t≈0, tight opening) and a cool
// (t≈1, settled wide) end, all pulled from the CW palette. One `temp` value
// crossfades every one of them, so light and camera read as a single system.
const KEY_WARM = new THREE.Color('#ffd7a0') // golden hour key
const KEY_COOL = new THREE.Color('#eaf6f1') // cool daylight
const FILL_WARM = new THREE.Color('#ffcf9a')
const FILL_COOL = new THREE.Color('#bad9ce') // brand mint
const RIM_WARM = new THREE.Color('#ffb877') // brand peach, hot
const RIM_COOL = new THREE.Color('#7fd4ce') // brand teal-mint
const AMB_WARM = new THREE.Color('#ffe7cc')
const AMB_COOL = new THREE.Color('#dbeef0')
const FOG_WARM = new THREE.Color('#f4cfa2') // peach haze
const FOG_COOL = new THREE.Color('#cceee6') // mint haze

const SKY_TOP_WARM = srgb('#2c8f94') // teal zenith, warm daylight
const SKY_TOP_COOL = srgb('#0e6a70') // deeper teal
const SKY_BOT_WARM = srgb('#ffd2a0') // warm gold horizon
const SKY_BOT_COOL = srgb('#d9efe6') // pale mint horizon
const GLOW_WARM = srgb('#ffcf9e')
const GLOW_COOL = srgb('#bfe7de')

export default function HeroScene({ progress, mode }: HeroSceneProps) {
  const { camera, scene } = useThree()
  const carGroup = useRef<THREE.Group>(null)
  const keyLight = useRef<THREE.DirectionalLight>(null)
  const fillLight = useRef<THREE.DirectionalLight>(null)
  const rimLight = useRef<THREE.SpotLight>(null)
  const ambient = useRef<THREE.AmbientLight>(null)
  const smoothed = useRef(0)
  const lookTarget = useMemo(() => new THREE.Vector3(), [])
  const posTarget = useMemo(() => new THREE.Vector3(), [])

  // Sky shader: a gradient dome with a horizon glow, all animatable. Held in a
  // ShaderMaterial so the colours are uniforms we can crossfade every frame
  // (a baked texture couldn't shift). toneMapped off + raw sRGB uniforms keep
  // it a predictable, art-directed backdrop.
  const skyMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uTop: { value: SKY_TOP_WARM.clone() },
        uBottom: { value: SKY_BOT_WARM.clone() },
        uGlow: { value: GLOW_WARM.clone() },
        uGlowStrength: { value: 0.55 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform vec3 uTop;
        uniform vec3 uBottom;
        uniform vec3 uGlow;
        uniform float uGlowStrength;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          // Transition tuned to the camera's actual pitch range, so the teal
          // zenith reads in the upper frame while the warm horizon sits low.
          float grad = smoothstep(-0.2, 0.35, h);
          vec3 col = mix(uBottom, uTop, grad);
          // Warm band hugging the horizon — the light source, no sun disc.
          float band = exp(-pow((h - 0.01) / 0.16, 2.0));
          col += uGlow * band * uGlowStrength;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  }, [])

  useFrame((state, delta) => {
    // --- Camera ---
    let temp: number
    if (mode === 'scroll' && progress) {
      // Damp toward the scroll position so fast scrolling stays buttery.
      smoothed.current = THREE.MathUtils.damp(smoothed.current, progress.get(), 4.5, delta)
      const t = THREE.MathUtils.clamp(smoothed.current, 0, 1)

      CAMERA_PATH.getPoint(t, posTarget)
      camera.position.copy(posTarget)

      // Ease the gaze from the headlight detail to the whole car early on.
      lookTarget.lerpVectors(LOOK_START, LOOK_CENTER, THREE.MathUtils.smoothstep(t, 0, 0.3))
      camera.lookAt(lookTarget)

      // Same progress drives the light: golden through the detail shot,
      // cooling to teal/mint as the camera pulls back and settles.
      temp = THREE.MathUtils.smoothstep(t, 0.04, 0.8)
    } else if (mode === 'turntable' && carGroup.current) {
      // Mobile: calm idle rotation, held at a balanced warm-cool mood.
      carGroup.current.rotation.y = state.clock.elapsedTime * 0.18
      camera.lookAt(LOOK_CENTER)
      temp = 0.55
    } else {
      // Reduced-motion settle == the cool, wide resting look.
      camera.lookAt(LOOK_CENTER)
      temp = 1
    }

    // --- Light temperature crossfade ---
    if (keyLight.current) keyLight.current.color.copy(KEY_WARM).lerp(KEY_COOL, temp)
    if (fillLight.current) fillLight.current.color.copy(FILL_WARM).lerp(FILL_COOL, temp)
    if (rimLight.current) rimLight.current.color.copy(RIM_WARM).lerp(RIM_COOL, temp)
    if (ambient.current) ambient.current.color.copy(AMB_WARM).lerp(AMB_COOL, temp)
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(FOG_WARM).lerp(FOG_COOL, temp)

    const u = skyMaterial.uniforms
    u.uTop.value.lerpVectors(SKY_TOP_WARM, SKY_TOP_COOL, temp)
    u.uBottom.value.lerpVectors(SKY_BOT_WARM, SKY_BOT_COOL, temp)
    u.uGlow.value.lerpVectors(GLOW_WARM, GLOW_COOL, temp)
    u.uGlowStrength.value = THREE.MathUtils.lerp(0.55, 0.16, temp)
  })

  return (
    <>
      <fog attach="fog" args={['#f4cfa2', 24, 82]} />

      {/*
        Procedural studio environment — Lightformers instead of a fetched
        HDRI so nothing depends on a CDN. Baked once (frames={1}) and kept
        neutral, so the car's reflections stay consistent while the direct
        lights above carry the warm→cool story. This is what the paint
        reflects: a soft warm key, a bright sky card overhead, cool flank
        strips for showroom streaks on curved panels.
      */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4} color="#fff2dd" position={[5, 6, 4]} scale={[7, 4, 1]} target={[0, 0.7, 0]} />
        <Lightformer form="rect" intensity={1.6} color="#ffffff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#eafaf7" position={[-8, 1.6, 0]} rotation-y={Math.PI / 2} scale={[10, 1.6, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#dff3ef" position={[8, 1.6, 0]} rotation-y={-Math.PI / 2} scale={[10, 1.6, 1]} />
        <Lightformer form="circle" intensity={3.4} color="#fff8e8" position={[3, 9, -4]} scale={2.4} target={[0, 0, 0]} />
      </Environment>

      {/* Three-point rig whose colours crossfade warm→cool across the scroll:
          warm key, mint fill, teal rim. */}
      <directionalLight ref={keyLight} position={[6, 8, 5]} intensity={2} color="#ffd7a0" />
      <directionalLight ref={fillLight} position={[-6, 4, -2]} intensity={0.55} color="#ffcf9a" />
      <spotLight ref={rimLight} position={[-2, 6, -8]} intensity={1.4} color="#ffb877" angle={0.6} penumbra={1} />
      <ambientLight ref={ambient} intensity={0.28} color="#ffe7cc" />

      {/* The atmosphere: gradient sky, a calm ground, one divi-divi. */}
      <mesh material={skyMaterial}>
        <sphereGeometry args={[72, 24, 16]} />
      </mesh>
      <Ground />
      <DiviDivi position={[18, 0, -8]} rotationY={1.5} scale={1.4} />

      <group ref={carGroup}>
        <Suspense fallback={null}>
          <VenueCar />
        </Suspense>
        <GroundShadow />
      </group>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The ground: a calm teal plane, brighter under the car, hazing out    */
/* ------------------------------------------------------------------ */

/**
 * A single restrained ground plane. It receives the same directional lights
 * as the car, so its colour temperature drifts with the scroll too, and its
 * far edge dissolves into the fog for a soft, sceneryless horizon.
 */
function Ground() {
  const texture = useMemo(() => {
    const size = 512
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.04, size / 2, size / 2, size / 2)
    g.addColorStop(0, '#5bbfb2')
    g.addColorStop(0.4, '#48ac9f')
    g.addColorStop(1, '#2f8e84')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
      <circleGeometry args={[75, 48]} />
      <meshStandardMaterial map={texture} roughness={0.92} metalness={0} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/* The one signature element: a wind-bent divi-divi tree silhouette      */
/* ------------------------------------------------------------------ */

/**
 * Curaçao's iconic divi-divi — permanently combed to the leeward side by the
 * trade winds. Built as a dark, near-silhouette so the warm key light rims its
 * windward edge and canopy. Placed well back and to the side: character, never
 * competition for the car.
 *
 * Local space: the trunk rises from the origin and bends toward -x, the canopy
 * and bare branches all sweeping the same way, as a real divi-divi does.
 */
function DiviDivi({
  position,
  rotationY = 0,
  scale = 1,
}: {
  position: [number, number, number]
  rotationY?: number
  scale?: number
}) {
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#06222e', roughness: 0.5, metalness: 0 }),
    [],
  )

  const trunk = useMemo(() => {
    // Short and low-slung, canting to leeward (-x) — a divi-divi is wider than
    // it is tall, its whole form pressed sideways by the trade wind.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.04, 0.55, 0),
      new THREE.Vector3(-0.25, 1.05, 0.02),
      new THREE.Vector3(-0.68, 1.45, 0),
      new THREE.Vector3(-1.2, 1.62, 0.02),
      new THREE.Vector3(-1.6, 1.66, 0),
    ])
    return new THREE.TubeGeometry(curve, 26, 0.1, 7, false)
  }, [])

  const branches = useMemo(() => {
    const mk = (pts: [number, number, number][], r: number) =>
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))),
        14,
        r,
        5,
        false,
      )
    // Bare limbs fanning leeward, under and through the flat canopy.
    return [
      mk([[-1.0, 1.55, 0], [-2.0, 1.76, 0.26], [-2.95, 1.82, 0.36]], 0.035),
      mk([[-1.1, 1.5, 0], [-2.25, 1.56, -0.16], [-3.2, 1.52, -0.32]], 0.032),
      mk([[-1.15, 1.44, 0], [-2.1, 1.4, 0.1], [-2.95, 1.28, 0.18]], 0.03),
    ]
  }, [])

  // The signature windswept flag: a broad, flat canopy spread entirely to the
  // leeward side and flattened in Y, so it reads as foliage from above and in
  // silhouette against the sky rather than as a thin edge.
  const canopy = useMemo(
    () =>
      [
        { p: [-1.75, 1.62, 0], s: [1.65, 0.5, 1.15] },
        { p: [-2.6, 1.68, 0.1], s: [1.42, 0.44, 0.98] },
        { p: [-3.35, 1.6, -0.06], s: [1.05, 0.36, 0.74] },
        { p: [-2.2, 1.76, 0.06], s: [1.22, 0.42, 0.92] },
        { p: [-3.05, 1.5, 0.22], s: [0.92, 0.32, 0.64] },
      ] as const,
    [],
  )

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh geometry={trunk} material={material} />
      {branches.map((g, i) => (
        <mesh key={i} geometry={g} material={material} />
      ))}
      {canopy.map((c, i) => (
        <mesh key={i} position={c.p as unknown as [number, number, number]} scale={c.s as unknown as [number, number, number]} material={material}>
          <sphereGeometry args={[0.5, 10, 8]} />
        </mesh>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Contact shadow under the car                                         */
/* ------------------------------------------------------------------ */

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
