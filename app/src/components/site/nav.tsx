import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'

/**
 * Fixed nav. Over the landing hero it starts transparent with white text and
 * eases into solid navy once the atmosphere scrolls away (a real transition,
 * not a hard cut). Inner pages start solid.
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
      // The landing hero is a 400vh pinned track: stay transparent for the
      // whole camera journey, go navy as the hero releases (~300vh scrolled).
      const heroEnd = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches
        ? window.innerHeight * 0.7
        : window.innerHeight * 2.85
      setScrolled(window.scrollY > heroEnd)
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
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-500 ${
        solid ? 'bg-cw-navy/95 shadow-[0_8px_30px_rgba(2,48,71,0.25)] backdrop-blur-md' : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex h-[72px] max-w-[1160px] items-center justify-between px-5 md:px-8">
        <Link to="/" aria-label="CW, home" className="flex items-center gap-3">
          {/* The CW mark, used as-is: never stretched, recolored, or redrawn. */}
          <img
            src="/assets/cw-logo-320.png"
            alt="CW"
            className="h-11 w-11 select-none"
            draggable={false}
          />
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <NavLink to="/" label="Home" current={pathname === '/'} />
          <NavLink to="/about" label="About" current={pathname === '/about'} />
          <NavLink to="/booking" label="Booking" current={pathname === '/booking'} />
          <BookCta />
        </div>

        <button
          type="button"
          className="relative flex h-11 w-11 items-center justify-center md:hidden"
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <span
            className={`absolute h-0.5 w-6 rounded bg-white transition-transform duration-300 ${
              open ? 'rotate-45' : '-translate-y-1.5'
            }`}
          />
          <span
            className={`absolute h-0.5 w-6 rounded bg-white transition-transform duration-300 ${
              open ? '-rotate-45' : 'translate-y-1.5'
            }`}
          />
        </button>
      </nav>

      {/* Mobile menu */}
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-400 md:hidden ${
          open ? 'grid-rows-[1fr] bg-cw-navy/95 backdrop-blur-md' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0">
          <div className="flex flex-col gap-1 px-5 pb-6 pt-2">
            <MobileLink to="/" label="Home" />
            <MobileLink to="/about" label="About" />
            <MobileLink to="/booking" label="Booking" />
            <div className="pt-3">
              <BookCta />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

function NavLink({ to, label, current }: { to: string; label: string; current: boolean }) {
  return (
    <Link
      to={to}
      className="group relative font-display text-[15px] font-semibold tracking-wide text-white"
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

function MobileLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="rounded-xl px-3 py-3 font-display text-lg font-semibold text-white active:bg-white/10"
    >
      {label}
    </Link>
  )
}

/**
 * "Book your car", the global booking CTA. Garment: teal block whose arrow
 * drives forward along a drawn road line on hover, warming toward peach.
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
