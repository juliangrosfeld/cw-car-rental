import { useMemo } from 'react'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

/**
 * The flagship as a deliberate object: a stylized, toy-like Hyundai Venue
 * built from beveled primitives. No photo reconstruction, no scanned mesh —
 * stylization is the confident choice here (Bruno Simon spirit), so every
 * surface is clean, brand-true, and cheap to render on a phone.
 *
 * Footprint contract (the camera path is tuned to it): origin-centered,
 * nose toward +z, ~4.1 units long, resting on y=0.
 */

const PAINT = '#cf3a2e' // flagship red
const DARK = '#22303c' // cladding, bumpers, underbody
const GLASS = '#0e2f40'
const CHROME = '#dfe8ec'
const TIRE = '#171d24'
const RIM = '#c7d2d8'

export default function CarModel() {
  const m = useMemo(() => {
    const paint = new THREE.MeshPhysicalMaterial({
      color: PAINT,
      metalness: 0.22,
      roughness: 0.34,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.4,
    })
    const dark = new THREE.MeshStandardMaterial({
      color: DARK,
      metalness: 0.1,
      roughness: 0.85,
    })
    const glass = new THREE.MeshPhysicalMaterial({
      color: GLASS,
      metalness: 0.3,
      roughness: 0.05,
      envMapIntensity: 2.8,
    })
    const chrome = new THREE.MeshStandardMaterial({
      color: CHROME,
      metalness: 0.9,
      roughness: 0.25,
      envMapIntensity: 1.6,
    })
    const lamp = new THREE.MeshStandardMaterial({
      color: '#f4ead2',
      emissive: '#ffedbe',
      emissiveIntensity: 0.5,
      roughness: 0.35,
    })
    const tail = new THREE.MeshStandardMaterial({
      color: '#b3271d',
      emissive: '#e04836',
      emissiveIntensity: 0.5,
      roughness: 0.4,
    })
    const tire = new THREE.MeshStandardMaterial({
      color: TIRE,
      roughness: 0.95,
      flatShading: true,
    })
    const rim = new THREE.MeshStandardMaterial({
      color: RIM,
      metalness: 0.85,
      roughness: 0.35,
      flatShading: true,
    })
    const hub = new THREE.MeshStandardMaterial({
      color: '#118c8c',
      metalness: 0.4,
      roughness: 0.5,
    })
    return { paint, dark, glass, chrome, lamp, tail, tire, rim, hub }
  }, [])

  return (
    <group>
      {/* Body */}
      <RoundedBox args={[1.76, 0.78, 3.9]} radius={0.14} smoothness={4} position={[0, 0.79, 0]} material={m.paint} />
      {/* Underbody / cladding */}
      <RoundedBox args={[1.66, 0.3, 3.68]} radius={0.1} smoothness={3} position={[0, 0.4, 0]} material={m.dark} />
      {/* Greenhouse: wide and low so it reads SUV cabin, not cargo topper.
          The glass band is WIDER than the roof, so the roof sits flush and
          the sloped panes below read as windshield and rear window. */}
      <RoundedBox args={[1.68, 0.46, 2.5]} radius={0.12} smoothness={4} position={[0, 1.26, -0.32]} material={m.glass} />
      <RoundedBox args={[1.6, 0.46, 0.07]} radius={0.05} smoothness={3} position={[0, 1.24, 0.85]} rotation={[-0.55, 0, 0]} material={m.glass} />
      <RoundedBox args={[1.56, 0.38, 0.07]} radius={0.05} smoothness={3} position={[0, 1.26, -1.5]} rotation={[0.42, 0, 0]} material={m.glass} />
      {/* Roof */}
      <RoundedBox args={[1.58, 0.14, 2.3]} radius={0.07} smoothness={3} position={[0, 1.5, -0.32]} material={m.paint} />
      {/* Roof rails */}
      <RoundedBox args={[0.07, 0.06, 1.66]} radius={0.025} smoothness={2} position={[0.54, 1.59, -0.32]} material={m.dark} />
      <RoundedBox args={[0.07, 0.06, 1.66]} radius={0.025} smoothness={2} position={[-0.54, 1.59, -0.32]} material={m.dark} />
      {/* Antenna fin */}
      <RoundedBox args={[0.06, 0.1, 0.2]} radius={0.02} smoothness={2} position={[0, 1.61, -1.28]} material={m.dark} />

      {/* Mirrors */}
      <RoundedBox args={[0.17, 0.1, 0.08]} radius={0.03} smoothness={2} position={[0.92, 1.14, 0.78]} material={m.paint} />
      <RoundedBox args={[0.17, 0.1, 0.08]} radius={0.03} smoothness={2} position={[-0.92, 1.14, 0.78]} material={m.paint} />

      {/* Bumpers */}
      <RoundedBox args={[1.7, 0.36, 0.3]} radius={0.1} smoothness={3} position={[0, 0.56, 1.88]} material={m.dark} />
      <RoundedBox args={[1.7, 0.36, 0.3]} radius={0.1} smoothness={3} position={[0, 0.56, -1.88]} material={m.dark} />

      {/* Face: grille, chrome brow, split lights (Venue-style) */}
      <RoundedBox args={[0.92, 0.36, 0.08]} radius={0.03} smoothness={2} position={[0, 0.84, 1.93]} material={m.dark} />
      <RoundedBox args={[1.04, 0.05, 0.06]} radius={0.02} smoothness={2} position={[0, 1.07, 1.93]} material={m.chrome} />
      <RoundedBox args={[0.24, 0.07, 0.05]} radius={0.02} smoothness={2} position={[0.58, 1.05, 1.95]} material={m.lamp} />
      <RoundedBox args={[0.24, 0.07, 0.05]} radius={0.02} smoothness={2} position={[-0.58, 1.05, 1.95]} material={m.lamp} />
      <RoundedBox args={[0.2, 0.2, 0.06]} radius={0.03} smoothness={2} position={[0.66, 0.7, 1.96]} material={m.lamp} />
      <RoundedBox args={[0.2, 0.2, 0.06]} radius={0.03} smoothness={2} position={[-0.66, 0.7, 1.96]} material={m.lamp} />

      {/* Tail lights */}
      <RoundedBox args={[0.32, 0.11, 0.06]} radius={0.02} smoothness={2} position={[0.58, 1.02, -1.96]} material={m.tail} />
      <RoundedBox args={[0.32, 0.11, 0.06]} radius={0.02} smoothness={2} position={[-0.58, 1.02, -1.96]} material={m.tail} />

      {/* Wheels: pushed to the corners for the short-overhang SUV stance */}
      <Wheel m={m} x={0.78} z={1.42} />
      <Wheel m={m} x={-0.78} z={1.42} />
      <Wheel m={m} x={0.78} z={-1.42} />
      <Wheel m={m} x={-0.78} z={-1.42} />
    </group>
  )
}

function Wheel({
  m,
  x,
  z,
}: {
  m: { tire: THREE.Material; rim: THREE.Material; hub: THREE.Material }
  x: number
  z: number
}) {
  return (
    <group position={[x, 0.42, z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh material={m.tire}>
        <cylinderGeometry args={[0.42, 0.42, 0.3, 18]} />
      </mesh>
      <mesh material={m.rim}>
        <cylinderGeometry args={[0.23, 0.23, 0.32, 12]} />
      </mesh>
      {/* Teal hub cap, the one tiny brand wink on the car */}
      <mesh material={m.hub}>
        <cylinderGeometry args={[0.07, 0.07, 0.34, 12]} />
      </mesh>
    </group>
  )
}
