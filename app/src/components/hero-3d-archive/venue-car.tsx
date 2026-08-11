import { useEffect, useMemo, useRef } from 'react'
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

  // The two branded plates, computed from the model's own plate geometry so
  // they sit exactly where the "MUFASA" placeholders are, whatever the fit.
  const plates = usePlateDecals(scene)

  return (
    <group rotation={[0, ROTATION_Y, 0]}>
      <group scale={fit.scale} position={fit.position.toArray()}>
        <primitive object={scene} />
        {plates.map((p, i) => (
          <PlateDecal key={i} placement={p} />
        ))}
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* CW license-plate decals                                             */
/* ------------------------------------------------------------------ */

interface PlatePlacement {
  center: [number, number, number]
  /** Outward facing normal (unit), ±z. */
  facing: 1 | -1
  width: number
  height: number
}

/**
 * The model ships with "MUFASA" baked into its merged texture atlas, which we
 * must not edit. Instead we read the model's own plate mesh (a single mesh that
 * holds both the front and rear plate boxes), split it into the two plates by
 * their position along the car's length, and hand back a placement for each so
 * a clean CW plane can be floated a hair in front of the original — full
 * coverage, no z-fighting. All maths run in the model's local space, which is
 * exactly the space the decals are rendered in (siblings of the mesh), so the
 * overlay tracks the plate through the entire scroll camera path.
 */
function usePlateDecals(scene: THREE.Object3D): PlatePlacement[] {
  return useMemo(() => {
    let plateMesh: THREE.Mesh | null = null
    scene.traverse((o) => {
      if (plateMesh) return
      const m = o as THREE.Mesh
      const matName = Array.isArray(m.material) ? m.material[0]?.name : m.material?.name
      if (m.isMesh && (/plate/i.test(m.name) || matName === 'plate')) plateMesh = m
    })
    if (!plateMesh) return []

    // Vertices in the model-root's local space (the space the decals live in).
    scene.updateWorldMatrix(true, true)
    const mesh = plateMesh as THREE.Mesh
    const toLocal = new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(mesh.matrixWorld)
    const pos = mesh.geometry.getAttribute('position')
    const pts: THREE.Vector3[] = []
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toLocal)
      pts.push(v.clone())
    }

    // Front plate sits toward the nose (+z), rear toward the tail (-z). Split on
    // the midpoint of the z spread so each plate is clustered on its own.
    let zMin = Infinity
    let zMax = -Infinity
    for (const p of pts) {
      zMin = Math.min(zMin, p.z)
      zMax = Math.max(zMax, p.z)
    }
    const zMid = (zMin + zMax) / 2

    const build = (group: THREE.Vector3[]): PlatePlacement | null => {
      if (group.length < 3) return null
      const bMin = new THREE.Vector3(Infinity, Infinity, Infinity)
      const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
      for (const p of group) {
        bMin.min(p)
        bMax.max(p)
      }
      const width = bMax.x - bMin.x
      const height = bMax.y - bMin.y
      const cz = (bMin.z + bMax.z) / 2
      const facing: 1 | -1 = cz >= 0 ? 1 : -1
      // Nudge the plane to the outer face of the (thin) plate box, then a hair
      // beyond it so it always wins the depth test over the placeholder.
      const outerZ = facing === 1 ? bMax.z : bMin.z
      const eps = Math.max(width, height) * 0.03
      return {
        center: [(bMin.x + bMax.x) / 2, (bMin.y + bMax.y) / 2, outerZ + facing * eps],
        facing,
        width,
        height,
      }
    }

    const front = build(pts.filter((p) => p.z >= zMid))
    const rear = build(pts.filter((p) => p.z < zMid))
    const out = [front, rear].filter((p): p is PlatePlacement => p !== null)
    if (typeof console !== 'undefined')
      console.log('PLATE decals', JSON.stringify(out))
    return out
  }, [scene])
}

/** A single CW plate: a thin plane textured with the branded plate art. */
function PlateDecal({ placement }: { placement: PlatePlacement }) {
  const texture = useCwPlateTexture(placement.width / placement.height)
  // A front plate (facing +z) uses the plane's default +z normal; the rear
  // plate faces -z, so spin it a half-turn to face outward.
  const rotationY = placement.facing === 1 ? 0 : Math.PI
  return (
    <mesh position={placement.center} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[placement.width, placement.height]} />
      <meshBasicMaterial map={texture} toneMapped={false} transparent polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  )
}

/**
 * The CW plate art, drawn to a canvas: a clean white plate with "CW" set in
 * Montserrat (the brand display face, loaded on the page). Redrawn once the
 * font is ready so the very first paint can't fall back to a system face.
 */
function useCwPlateTexture(aspect: number): THREE.CanvasTexture {
  const texRef = useRef<THREE.CanvasTexture | null>(null)
  const texture = useMemo(() => {
    const h = 256
    const w = Math.max(1, Math.round(h * (isFinite(aspect) && aspect > 0 ? aspect : 2)))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    texRef.current = t
    drawCwPlate(canvas)
    return t
  }, [aspect])

  useEffect(() => {
    let cancelled = false
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts
    if (!fonts) return
    Promise.all([fonts.load('800 200px Montserrat'), fonts.load('700 200px Montserrat')])
      .then(() => {
        if (cancelled || !texRef.current) return
        drawCwPlate(texRef.current.image as HTMLCanvasElement)
        texRef.current.needsUpdate = true
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [texture])

  return texture
}

/** Paint the plate: white field, subtle inner keyline, "CW" centered. */
function drawCwPlate(canvas: HTMLCanvasElement) {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  // Plate field.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  // A restrained keyline just inside the edge, echoing a real plate border.
  const inset = Math.round(h * 0.08)
  ctx.strokeStyle = 'rgba(2,48,71,0.28)'
  ctx.lineWidth = Math.max(2, Math.round(h * 0.025))
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2)
  // The mark.
  ctx.fillStyle = '#023047' // cw-navy
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${Math.round(h * 0.58)}px Montserrat, Arial, sans-serif`
  const cx = w / 2
  ctx.fillText('CW', cx, h * 0.54)
}

useGLTF.preload(MODEL_URL, false, true)
