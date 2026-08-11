import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'

/**
 * Fixed nav. Over the landing hero it starts transparent with white marks and
 * eases into the CW teal-to-mint gradient once the atmosphere scrolls away (a
 * real transition, not a hard cut). Inner pages start on the gradient.
 *
 * In the gradient state every mark is navy (navy reads cleanly across the whole
 * teal->mint span); over the dark hero every mark is white.
 */
export default function Nav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const onHero = pathname === '/'
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!onHero) return
    let raf = 0
    const check = () => {
      raf = 0
      // The landing hero is one viewport of looping video: stay transparent
      // over the footage, warm into the gradient just before it scrolls away.
      setScrolled(window.scrollY > window.innerHeight * 0.7)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check)
    }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [onHero])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const solid = !onHero || scrolled || open

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background,box-shadow,backdrop-filter] duration-500 ${
        solid
          ? 'bg-gradient-to-r from-cw-teal via-cw-teal to-cw-mint shadow-[0_8px_30px_rgba(2,48,71,0.18)] backdrop-blur-md'
          : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex h-[72px] max-w-[1160px] items-center justify-between px-5 md:px-8">
        <Link to="/" aria-label="CW Car Rental, home" className="flex items-center">
          {/* The CW lockup, used as-is: never stretched, recolored, or redrawn.
              Its ink is dark teal on transparent, which would sink into both
              nav states (teal->mint gradient, dark hero footage), so it rides a
              white plate rather than being knocked out to white. The plate is
              the contrast, the mark stays the mark. */}
          <span className="flex items-center rounded-xl bg-white px-2.5 py-1.5 shadow-[0_2px_12px_rgba(2,48,71,0.16)]">
            <img
              src="/assets/cw-logo-lockup-480.png"
              alt=""
              className="h-9 w-auto shrink-0 select-none"
              draggable={false}
            />
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <NavLink to="/" label="Home" current={pathname === '/'} dark={solid} />
          <NavLink to="/" hash="fleet" label="Fleet" current={false} dark={solid} />
          <NavLink to="/about" label="About" current={pathname === '/about'} dark={solid} />
          <NavAnchor href="#contact" label="Contact" dark={solid} />
          <NavCta dark={solid} />
        </div>

        <button
          type="button"
          className="relative flex h-11 w-11 items-center justify-center md:hidden"
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <span
            className={`absolute h-0.5 w-6 rounded transition-transform duration-300 ${
              solid ? 'bg-cw-navy' : 'bg-white'
            } ${open ? 'rotate-45' : '-translate-y-1.5'}`}
          />
          <span
            className={`absolute h-0.5 w-6 rounded transition-transform duration-300 ${
              solid ? 'bg-cw-navy' : 'bg-white'
            } ${open ? '-rotate-45' : 'translate-y-1.5'}`}
          />
        </button>
      </nav>

      {/* Mobile menu */}
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-400 md:hidden ${
          open ? 'grid-rows-[1fr] bg-gradient-to-b from-cw-teal to-cw-mint backdrop-blur-md' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0">
          <div className="flex flex-col gap-1 px-5 pb-6 pt-2">
            <MobileLink to="/" label="Home" />
            <MobileLink to="/" hash="fleet" label="Fleet" />
            <MobileLink to="/about" label="About" />
            <MobileAnchor href="#contact" label="Contact" onNavigate={() => setOpen(false)} />
            <div className="pt-3">
              <NavCta dark />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

function NavLink({
  to,
  hash,
  label,
  current,
  dark,
}: {
  to: string
  hash?: string
  label: string
  current: boolean
  dark: boolean
}) {
  return (
    <Link
      to={to}
      hash={hash}
      className={`group relative font-display text-[15px] font-semibold tracking-wide ${
        dark ? 'text-cw-navy' : 'text-white'
      }`}
    >
      {label}
      {/* Moving hairline, the nav's own garment: a waypoint dash that slides in. */}
      <span
        className={`absolute -bottom-1.5 left-0 h-0.5 rounded bg-cw-yellow transition-all duration-300 ease-out ${
          current ? 'w-4' : 'w-0 group-hover:w-4'
        }`}
      />
    </Link>
  )
}

/** Same garment as NavLink but for a same-page hash target (Contact -> footer). */
function NavAnchor({ href, label, dark }: { href: string; label: string; dark: boolean }) {
  return (
    <a
      href={href}
      className={`group relative font-display text-[15px] font-semibold tracking-wide ${
        dark ? 'text-cw-navy' : 'text-white'
      }`}
    >
      {label}
      <span className="absolute -bottom-1.5 left-0 h-0.5 w-0 rounded bg-cw-yellow transition-all duration-300 ease-out group-hover:w-4" />
    </a>
  )
}

function MobileLink({ to, hash, label }: { to: string; hash?: string; label: string }) {
  return (
    <Link
      to={to}
      hash={hash}
      className="rounded-xl px-3 py-3 font-display text-lg font-semibold text-cw-navy active:bg-cw-navy/10"
    >
      {label}
    </Link>
  )
}

function MobileAnchor({
  href,
  label,
  onNavigate,
}: {
  href: string
  label: string
  onNavigate: () => void
}) {
  return (
    <a
      href={href}
      onClick={onNavigate}
      className="rounded-xl px-3 py-3 font-display text-lg font-semibold text-cw-navy active:bg-cw-navy/10"
    >
      {label}
    </a>
  )
}

/**
 * The nav's booking CTA. On the gradient it fills navy (a firm block against
 * the teal->mint wash); over the dark hero it fills teal like the hero CTAs.
 */
function NavCta({ dark }: { dark: boolean }) {
  return (
    <Link
      to="/booking"
      className={`group inline-flex items-center gap-2.5 rounded-xl px-5 py-2.5 font-display text-[15px] font-bold text-white transition-colors duration-300 active:scale-[0.98] ${
        dark ? 'bg-cw-navy hover:bg-cw-ink' : 'bg-cw-teal hover:bg-cw-teal-dark'
      }`}
    >
      <span>Book your car</span>
      <span className="relative inline-flex w-5 items-center overflow-hidden">
        <span className="transition-transform duration-300 ease-out group-hover:translate-x-1">→</span>
        <span className="absolute bottom-0 left-0 h-px w-0 bg-cw-peach transition-all duration-300 group-hover:w-full" />
      </span>
    </Link>
  )
}

/**
 * "Book your car", the global booking CTA reused on the hero and About page.
 * Garment: teal block whose arrow drives forward along a drawn road line on
 * hover, warming toward peach.
 */
export function BookCta({ large = false }: { large?: boolean }) {
  return (
    <Link
      to="/booking"
      className={`group inline-flex items-center gap-2.5 rounded-xl bg-cw-teal font-display font-bold text-white transition-colors duration-300 hover:bg-cw-teal-dark active:scale-[0.98] ${
        large ? 'px-7 py-4 text-lg' : 'px-5 py-2.5 text-[15px]'
      }`}
    >
      <span>Book your car</span>
      <span className="relative inline-flex w-5 items-center overflow-hidden">
        <span className="transition-transform duration-300 ease-out group-hover:translate-x-1">
          →
        </span>
        <span className="absolute bottom-0 left-0 h-px w-0 bg-cw-peach transition-all duration-300 group-hover:w-full" />
      </span>
    </Link>
  )
}
