import { Link } from '@tanstack/react-router'
import { CONTACT, POSITIONING } from '../../content/brand'

/**
 * The navy dusk footer, the page's one material switch. Full name
 * "CW Car Rental" lives here (legal context) per the naming rule.
 */
export default function Footer() {
  return (
    <footer id="contact" className="bg-cw-navy text-white scroll-mt-[72px]">
      <div className="mx-auto max-w-[1160px] px-5 py-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            {/* Dark teal ink on navy would disappear, so the lockup rides the
                same white plate the nav uses. */}
            <span className="inline-flex rounded-2xl bg-white px-4 py-3">
              <img
                src="/assets/cw-logo-lockup-480.png"
                alt="CW Car Rental"
                className="h-14 w-auto select-none"
                draggable={false}
              />
            </span>
            <p className="mt-5 max-w-[36ch] text-[15px] leading-relaxed text-white/80">
              {POSITIONING}
            </p>
          </div>

          <div>
            <p className="font-display text-sm font-bold uppercase tracking-widest text-cw-mint">
              Reach us
            </p>
            <ul className="mt-4 space-y-2.5 text-[15px]">
              <li>
                <a className="text-white/85 transition-colors hover:text-cw-peach" href={`mailto:${CONTACT.email}`}>
                  {CONTACT.email}
                </a>
              </li>
              <li>
                <a className="text-white/85 transition-colors hover:text-cw-peach" href={`tel:${CONTACT.phone.replace(/\s/g, '')}`}>
                  {CONTACT.phone}
                </a>
              </li>
              <li className="text-white/60">Willemstad, Curaçao</li>
            </ul>
          </div>

          <div>
            <p className="font-display text-sm font-bold uppercase tracking-widest text-cw-mint">
              Follow along
            </p>
            <ul className="mt-4 space-y-2.5 text-[15px]">
              <li>
                <a className="text-white/85 transition-colors hover:text-cw-peach" href={CONTACT.instagram} target="_blank" rel="noreferrer">
                  Instagram
                </a>
              </li>
              <li>
                <Link className="text-white/85 transition-colors hover:text-cw-peach" to="/about">
                  Our story
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/15 pt-6 text-[13px] text-white/55 md:flex-row md:items-center">
          <p>© 2026 CW Car Rental. Proudly local in Curaçao.</p>
          <p>Masha danki for driving with us.</p>
        </div>
      </div>
    </footer>
  )
}
