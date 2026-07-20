import { VALUES } from '../../content/brand'

/**
 * The second beat (D2, sticky-stack): Pride, Hospitality, Respect as
 * full-bleed color chapters that cover each other one at a time on scroll.
 * Pure CSS sticky, so it needs no JS, survives screenshots (every chapter
 * is in normal flow), and degrades to plain stacked blocks by itself.
 */
export default function ValuesStack() {
  return (
    <section aria-label="What we stand for">
      {VALUES.map((value, i) => (
        <div
          key={value.name}
          className={`sticky top-0 flex h-dvh items-center ${value.ground}`}
          style={{ zIndex: i + 1 }}
        >
          <div className="mx-auto w-full max-w-[900px] px-5 text-center">
            <p className="font-display text-[clamp(3.4rem,13vw,9.5rem)] font-extrabold leading-none tracking-tight text-cw-navy">
              {value.name}
            </p>
            <p className="mx-auto mt-7 max-w-[46ch] text-lg leading-relaxed text-cw-navy/85 md:text-xl">
              {value.description}
            </p>
          </div>
        </div>
      ))}
    </section>
  )
}
