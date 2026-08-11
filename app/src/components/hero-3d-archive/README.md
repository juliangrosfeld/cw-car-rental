# 3D hero (archived)

The original Tier-1 homepage hero: a 400vh scroll track that pinned a
full-viewport R3F canvas and flew the camera around a stylized Hyundai Venue
while copy stages traded places.

**Nothing here is wired into the live site.** The homepage now uses the
full-bleed looping video hero in `src/components/hero/hero.tsx`. This directory
is kept intact for reference and so the mechanic can be restored.

## Contents

| File | Role |
| --- | --- |
| `hero.tsx` | Entry point. Picked the desktop scroll / mobile turntable / reduced-motion variant, and owned the CSS `Atmosphere` sky. |
| `hero-canvas.tsx` | Lazy R3F `<Canvas>` chunk, so three.js stayed out of the initial bundle. |
| `hero-scene.tsx` | Camera journey, lighting, sky, and `SETTLE_POSITION`. |
| `venue-car.tsx` | The Venue model: GLTF load, material treatment, wheel spin. |
| `assets/venue.glb` | The car model (1.9 MB). Moved out of `public/` so it is no longer shipped to visitors. |

## Restoring it

1. Move the model back into the served tree — `venue-car.tsx` still loads it
   from the absolute URL `/assets/hero/venue.glb`:

   ```sh
   git mv src/components/hero-3d-archive/assets/venue.glb public/assets/hero/venue.glb
   ```

2. Move the four components back to `src/components/hero/` (or point the import
   at this directory).

3. Re-point the homepage in `src/routes/index.tsx`:

   ```tsx
   import Hero from '../components/hero/hero'
   ```

4. Restore the nav's hero threshold in `src/components/site/nav.tsx`. The video
   hero is one viewport tall, so the check is now
   `window.scrollY > window.innerHeight * 0.7`. The 400vh pinned track needed
   the taller, breakpoint-aware bound it replaced:

   ```ts
   const heroEnd = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
     ? window.innerHeight * 0.7
     : window.innerHeight * 2.85
   setScrolled(window.scrollY > heroEnd)
   ```

## About the R3F dependencies

`three`, `@react-three/fiber`, `@react-three/drei` and `@types/three` are now
used by **nothing but this directory** — no live code imports them. They were
deliberately left in `package.json` so this archive still typechecks and can be
restored without a reinstall.

They cost install time, not page weight: since no route imports them, they are
tree-shaken out of the client bundle entirely. If the 3D hero is ever retired
for good, dropping those four packages is the cleanup.
