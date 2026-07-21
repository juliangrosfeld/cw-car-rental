import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

/**
 * The flagship as the real thing: a 216k-triangle Hyundai Venue with genuine
 * PBR paint, glass, and chrome, replacing the earlier primitive stand-in.
 *
 * The GLB is optimized upstream (meshopt geometry, EXT_texture_webp at 1k,
 * interior geometry stripped) so it streams in ~1.9 MB. Meshopt decoding is
 * bundled locally by drei; Draco is left OFF so nothing hits a CDN, matching
 * the procedural-environment choice in the scene.
 *
 * The camera path and lights are tuned to a fixed footprint contract:
 * origin-centered in x/z, nose toward +z, ~4.05 units long, resting on y=0.
 * The mesh meets that box here rather than the choreography bending to it.
 */
const MODEL_URL = '/assets/hero/venue.glb'
const TARGET_LENGTH = 4.05
/** The model already authors its nose toward +z, matching the contract. */
const ROTATION_Y = 0

export default function VenueCar() {
  const { scene } = useGLTF(MODEL_URL, false, true)

  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    const scale = TARGET_LENGTH / size.z
    // Center in x/z; drop the base onto y=0. Rotation about the origin (below)
    // then keeps it centered and grounded.
    const position = new THREE.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale)
    return { scale, position }
  }, [scene])

  return (
    <group rotation={[0, ROTATION_Y, 0]}>
      <group scale={fit.scale} position={fit.position.toArray()}>
        <primitive object={scene} />
      </group>
    </group>
  )
}

useGLTF.preload(MODEL_URL, false, true)
