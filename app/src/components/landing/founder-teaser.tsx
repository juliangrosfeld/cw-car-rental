import { Link } from '@tanstack/react-router'
import { FLEET, FOUNDER_NAME, FOUNDER_QUOTE } from '../../content/brand'

/**
 * Founder teaser, off-grid: layered crop frames on the left (brand color
 * fields under the flagship photo, until real portraits land), the quote and
 * a viewfinder link on the right.
 */
export default function FounderTeaser() {
  const flagship = FLEET[0]

  return (
    <section className="overflow-hidden bg-white">
      <div className="mx-auto grid max-w-[1160px] items-center gap-14 px-5 py-24 md:grid-cols-[1fr_1.05fr] md:px-8 md:py-32">
        <div className="relative mx-auto w-full max-w-[440px]">
          {/* Layered crop frames: the motif from board 3. */}
          <div className="absolute -left-5 top-8 h-[78%] w-[86%] -rotate-3 rounded-xl bg-cw-mint" aria-hidden="true" />
          <div className="absolute -right-4 -top-4 h-[70%] w-[80%] rotate-2 rounded-xl bg-cw-peach" aria-hidden="true" />
          <img
            src={flagship.photo}
            alt="The red Hyundai Venue, CW's flagship"
            className="cw-shadow-lift relative rounded-xl"
          />
        </div>

        <div>
          <blockquote className="font-display text-[clamp(1.5rem,2.6vw,2.2rem)] font-bold leading-snug tracking-tight text-cw-navy">
            "{FOUNDER_QUOTE}"
          </blockquote>
          <p className="mt-5 text-[15px] text-cw-ink/80">
            <span className="font-semibold text-cw-navy">{FOUNDER_NAME}</span>, founder. Former
            professional baseball player, born and raised in Curaçao.
          </p>

          {/* "Meet Clay" — viewfinder garment: corner brackets close around
              the label on hover. */}
          <Link
            to="/about"
            className="group relative mt-9 inline-block px-5 py-3 font-display text-[15px] font-bold text-cw-teal-dark"
          >
            <span aria-hidden="true" className="absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2 border-cw-teal transition-all duration-300 group-hover:left-1 group-hover:top-1" />
            <span aria-hidden="true" className="absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2 border-cw-teal transition-all duration-300 group-hover:right-1 group-hover:top-1" />
            <span aria-hidden="true" className="absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-cw-teal transition-all duration-300 group-hover:bottom-1 group-hover:left-1" />
            <span aria-hidden="true" className="absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-cw-teal transition-all duration-300 group-hover:bottom-1 group-hover:right-1" />
            Meet Clay
          </Link>
        </div>
      </div>
    </section>
  )
}
