# CW — design brief

## Design read
Vacationers landing in Curaçao who want freedom without friction, greeted by a
proud local friend: bright, warm, sun-lit confidence, zero corporate gloss.

## Concept spine
**"The island drive"** (journey/waypoints): the whole site is one drive around
Curaçao. The hero is walking around your car before you get in; each section is
a stop on the coast road; booking is being handed the keys.

## Delivery tier
**spectacle** (user-mandated 3D scroll hero): Lenis + GSAP + R3F, Tier-1 hero,
second beat mid-page, subtle custom cursor (small dot, grows on interactives;
restrained per the user's craft standard).

## Locked palette (user's explicit brand, overrides defaults)
White base, Teal `#118C8C` primary anchor, Deep Navy `#023047` ink/depth.
Accent system, assigned not sprinkled: Sun Yellow `#F2BB16` (Pride, highlights,
sun), Peach `#FFB085` (Hospitality, warm hovers), Soft Mint `#BAD9CE`
(Respect, calm surfaces), Pink `#FF99D8` (rare delight moments: selection
states, one hover surprise). Defense: this is the brand's own Caribbean
palette; every section leads teal-on-light with exactly one assigned accent.
Footer is the page's single material switch: deep navy "dusk".

## Locked type (user's explicit brand)
Montserrat 600-800 display, Open Sans 400-600 body (Google Fonts). No serif.

## Tier-1 technique
**B3 — 3D subject scene** (catalog ID), spectacle. Real-time R3F scene:
stylized low-poly Hyundai Venue + Curaçao atmosphere in ONE rendered scene,
scroll-driven CatmullRom camera (tight on headlight, pull back, orbit, settle
wide — proven choreography ported from the previous build). Defense: the spine
is a drive; the Tier-1 is literally circling your car before the trip.
Stylization is a confident choice (Bruno Simon spirit), not failed realism: flat
shaded facets, crisp bevels, brand-true paint, soft contact shadow, all lit by
one Lightformer environment. No photo reconstruction, no composited layers.
**Second beat (different family): D2 sticky-stack** — the three values stack as
full-bleed color chapters (yellow, peach, mint), one at a time on scroll.
Mobile degradation (declared): hero becomes non-pinned slow turntable at capped
DPR (static frame under reduced motion); sticky-stack becomes plain stacked
blocks with reveals; tilt/cursor effects off on touch.

## Combinatorial pick (held across all boards)
- Theme paradigm: **Pristine Light** (white, bright, teal-anchored).
- Background character: **solid with soft ambient depth** (turquoise gradient
  air, sun glow), one full-bleed moment (values chapters).
- Typography character: geometric bold sans display (Montserrat), humanist body.
- Hero architecture: **image-as-canvas** (full-bleed 3D scene, copy staged over
  it, bottom-left settle). Not left-text/right-image.
- Section system: **asymmetric premium flow**.
- Signature components: diagonal staggered masonry (fleet) · sticky color
  chapters (values) · layered image crop frames (founder) · vertical rhythm
  lines (accent hairlines as waypoint markers).
- Second-read moment: the **navy dusk footer** material switch.
- Corner language: all-soft 12px, page-wide.

## Section plan
**Landing (6):** 1 Hero, image-as-canvas 3D scroll scene · 2 "Bon bini" intro,
centered statement, mint hairline rhythm · 3 Fleet, diagonal staggered masonry,
top-left lead, stagger-rise reveal + gentle hover tilt · 4 Values, D2
sticky color chapters · 5 Founder teaser, off-grid offset with layered crop
frames, peach accent · 6 Footer, navy dusk, WhatsApp banner CTA.
**About (4 + footer):** 1 Story opener, editorial offset (Clay, baseball →
keys) · 2 Why CW, centered statement (positioning line) · 3 Vision/Mission,
alternating editorial blocks · 4 Island waypoints, gallery-led strip
(Westpunt, Shete Boka, Willemstad) using real island color, code-built
atmosphere. Shared dusk footer.
**Booking (wizard shell):** progress rail as journey waypoints (spine), one
step card at a time: dates+pickup → cars (availability-filtered, transmission
chip on every card) → details → review with full price breakdown → Sentoo pay
(UI only) → confirmation. Dates/car editable from any later step, state kept.
Eyebrow budget: 2 on landing, 1 on about, 0 in wizard.

## Asset plan (13-credit budget, triaged)
- Real, carried over: CW logo (as-is), 5 real fleet photos (brand rule: real
  CW cars only, never stock, never generated "photos").
- Code-built: stylized low-poly Venue GLB-equivalent (procedural R3F),
  atmosphere (gradient air, sun, coastline), accent patterns.
- Generated: 5 reference boards (4× nano_banana_pro, 1× nano_banana, 9cr),
  launch cover + OG per app-cover.md (2cr), 2cr re-roll reserve. Favicon from
  the existing logo mark (no generation). Icon set: library icons
  (functional-UI fallback rule) — generated icon set doesn't fit the budget.

## CTA inventory (bespoke chrome, one label per intent)
- **"Book your car"** (booking intent, global): nav + hero primary + about
  close. Solid teal soft-block; on hover the arrow drives forward and the
  block warms toward peach. Active: scale 0.98.
- **"See the fleet"** (browse intent, hero secondary): underlined inline link
  + arrow, underline sweeps teal→yellow.
- **"Book this car"** (per-car intent, fleet cards + wizard step 2): inline
  framed link on each card, underline in that car's assigned accent.
- **"WhatsApp us"** (contact intent, footer banner + booking help): mint
  banner block with the glyph, lifts 1px, mint→pink flicker on press.
- **"Continue" / "Pay with Sentoo"** (wizard progression): navy solid block,
  full-width in the step card; Sentoo button carries Sentoo mark, teal.

## Copy rules applied
No em/en dashes anywhere visible (brand copy rewritten accordingly, including
punctuating the founder quote as two sentences). Headlines ≤8 words.
Papiamentu touches: "Bon bini!", "Masha danki". Voice: warm, direct, proud.
