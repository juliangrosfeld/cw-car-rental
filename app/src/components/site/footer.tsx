import { Link } from '@tanstack/react-router'
import { CONTACT, POSITIONING } from '../../content/brand'

/**
 * The navy dusk footer, the page's one material switch. Full name
 * "CW Car Rental" lives here (legal context) per the naming rule.
 */
export default function Footer() {
  return (
    <footer id="contact" className="bg-cw-navy text-white scroll-mt-[72px]">
      {/* WhatsApp band. Garment: the whole strip shifts grade and shears a
          touch on hover; press flickers mint toward pink. */}
      <a
        href={`https://wa.me/${CONTACT.whatsapp.replace(/\D/g, '')}`}
        target="_blank"
        rel="noreferrer"
        className="group block bg-cw-mint text-cw-navy transition-colors duration-300 hover:bg-[#cbe6da] active:bg-cw-pink-soft"
      >
        <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-4 px-5 py-6 transition-transform duration-300 ease-out group-hover:-skew-x-1 md:px-8">
          <p className="font-display text-xl font-bold md:text-2xl">
            Faster by chat? WhatsApp us.
          </p>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cw-navy text-white transition-transform duration-300 group-hover:scale-110">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden="true">
              <path d="M12 2a9.9 9.9 0 0 0-8.5 15.1L2 22l5-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.6.1a6.8 6.8 0 0 1-3.4-2.9c-.3-.4 0-.6.2-.8l.5-.6c.1-.2.2-.3.1-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4 5.3 5.3 0 0 0 3.2.7 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.4Z" />
            </svg>
          </span>
        </div>
      </a>

      <div className="mx-auto max-w-[1160px] px-5 py-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <img
              src="/assets/cw-logo-320.png"
              alt="CW Car Rental"
              className="h-16 w-16 select-none"
              draggable={false}
            />
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
                <a className="text-white/85 transition-colors hover:text-cw-peach" href={`tel:${CONTACT.whatsapp}`}>
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
                <a className="text-white/85 transition-colors hover:text-cw-peach" href={CONTACT.facebook} target="_blank" rel="noreferrer">
                  Facebook
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
