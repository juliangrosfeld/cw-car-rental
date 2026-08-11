import { VALUES } from '../../content/brand'

/**
 * The second beat (D2, sticky-stack): Trust, Reliable, Experience as full-bleed
 * chapters that cover each other one at a time on scroll. Pure CSS sticky, so
 * it needs no JS, survives screenshots (every chapter is in normal flow), and
 * degrades to plain stacked blocks by itself.
 *
 * Each chapter is an island photo under a 50% wash of its brand colour, rather
 * than the flat colour block it used to be. Layers, in order:
 *   1. the photo, object-cover;
 *   2. the brand colour at WASH;
 *   3. a soft neutral bloom behind the copy. It is deliberately colourless: at
 *      50% the photo carries real detail through, and the navy type needs a
 *      lighter ground under it without pushing the colour past the 50% the
 *      chapter is meant to read at.
 *
 * A chapter must stay fully opaque or the previous one shows through as it
 * slides under. The photo is what guarantees that, so it is a real <img> (with
 * eager decoding) and not a background-image that might not have painted yet.
 */

/** Opacity of the brand-colour wash over each photo. */
const WASH = 0.5
export default function ValuesStack() {
  return (
    <section aria-label="What we stand for">
      {VALUES.map((value, i) => (
        <div
          key={value.name}
          className="sticky top-0 flex h-dvh items-center overflow-hidden bg-cw-navy"
          style={{ zIndex: i + 1 }}
        >
          <img
            src={value.image}
            alt=""
            aria-hidden="true"
            decoding="async"
            loading={i === 0 ? 'eager' : 'lazy'}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* The colour wash. */}
          <span
            aria-hidden="true"
            className={`absolute inset-0 ${value.ground}`}
            style={{ opacity: WASH }}
          />
          {/* The reading bloom: a soft light lift behind the words only, gone
              by the edges, so the photo stays untouched where nothing sits. */}
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 74% 54% at 50% 50%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.3) 46%, rgba(255,255,255,0) 78%)',
            }}
          />

          <div className="relative mx-auto w-full max-w-[900px] px-5 text-center">
            <p className="font-display text-[clamp(3.4rem,13vw,9.5rem)] font-extrabold leading-none tracking-tight text-cw-navy">
              {value.name}
            </p>
            <p className="mx-auto mt-7 max-w-[46ch] text-lg font-semibold leading-relaxed text-cw-navy md:text-xl">
              {value.description}
            </p>
          </div>
        </div>
      ))}
    </section>
  )
}
