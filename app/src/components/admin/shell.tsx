/**
 * The CRM chrome: a dark navy rail on the left, the page on the right.
 *
 * WHY A DARK RAIL ON A LIGHT PAGE
 * The public site and the back office share a browser and a brand, and it should
 * take no thought at all to know which one you are looking at. The navy rail is
 * the same navy as the site's headings, used as a full-height ground — instantly
 * "this is the tool", while the working area stays light because that is what
 * dense tables of numbers want.
 *
 * Below `lg` the rail becomes a horizontally scrolling strip along the top: the
 * five sections fit, and a hamburger that hides five links behind a tap is worse
 * than a strip that shows all five.
 */
import { Link, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { adminSignOut } from "../../lib/api/admin.functions";
import type { AdminIdentity } from "../../lib/admin/types";

/* ── icons ───────────────────────────────────────────────────────────────── */
/* Inline 20px stroke glyphs. The public site draws its own SVGs the same way;
   pulling an icon package in for five shapes would not earn its bytes. */

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-[18px] w-[18px] shrink-0",
  "aria-hidden": true,
};

const DashboardIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="3" width="7.5" height="8.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
    <rect x="3" y="14.5" width="7.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" />
  </svg>
);

const BookingsIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    <path d="M8 14h3" />
  </svg>
);

const FleetIcon = () => (
  <svg {...iconProps}>
    <path d="M4.5 16.5v2.2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2.2M21.5 16.5v2.2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2.2" />
    <path d="M2.5 16.5v-4l2-5.2a2 2 0 0 1 1.9-1.3h11.2a2 2 0 0 1 1.9 1.3l2 5.2v4z" />
    <path d="M4.5 12.5h15M6.5 9.5h2M15.5 9.5h2" />
  </svg>
);

const ClientsIcon = () => (
  <svg {...iconProps}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20.5a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M18 20.5a6.6 6.6 0 0 0-2-4.7" />
  </svg>
);

const PaymentsIcon = () => (
  <svg {...iconProps}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 10h19M6 15h4" />
  </svg>
);

const SignOutIcon = () => (
  <svg {...iconProps}>
    <path d="M14.5 3.5h3a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-3" />
    <path d="M10 16.5 14.5 12 10 7.5M14 12H3.5" />
  </svg>
);

/* ── navigation ──────────────────────────────────────────────────────────── */

/** `exact` on the dashboard only: without it, `/admin` would light up on every
 *  child route, since every CRM path starts with it. */
const NAV = [
  { to: "/admin", label: "Dashboard", icon: DashboardIcon, exact: true },
  { to: "/admin/bookings", label: "Bookings", icon: BookingsIcon, exact: false },
  { to: "/admin/fleet", label: "Fleet", icon: FleetIcon, exact: false },
  { to: "/admin/clients", label: "Clients", icon: ClientsIcon, exact: false },
  { to: "/admin/payments", label: "Payments", icon: PaymentsIcon, exact: false },
] as const;

function NavItems({ orientation }: { orientation: "rail" | "strip" }) {
  const base = "flex items-center gap-2.5 rounded-lg text-[13px] font-semibold transition-colors";
  const size = orientation === "rail" ? "px-3 py-2" : "shrink-0 px-3 py-1.5";

  return (
    <>
      {NAV.map(({ to, label, icon: Icon, exact }) => (
        <Link
          key={to}
          to={to}
          activeOptions={{ exact }}
          className={`${base} ${size} text-white/65 hover:bg-white/10 hover:text-white`}
          activeProps={{ className: "!bg-cw-teal !text-white" }}
        >
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </>
  );
}

/* ── sign out ────────────────────────────────────────────────────────────── */

function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await adminSignOut();
      // invalidate() first so no loader can re-run against the dead session and
      // repopulate the cache with data the browser is no longer entitled to.
      await router.invalidate();
      await router.navigate({ to: "/admin/login" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className={`flex items-center gap-2.5 rounded-lg text-[13px] font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 ${
        compact ? "px-2.5 py-1.5" : "px-3 py-2"
      }`}
    >
      <SignOutIcon />
      <span>{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}

/* ── the shell ───────────────────────────────────────────────────────────── */

export default function AdminShell({
  admin,
  title,
  subtitle,
  actions,
  children,
}: {
  admin: AdminIdentity;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[#f4f7f8] text-cw-ink">
      {/* Rail — lg and up */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[212px] flex-col bg-cw-navy px-3 py-4 lg:flex">
        <Link to="/" className="mb-5 flex items-center gap-2.5 px-1">
          <img
            src="/assets/cw-logo-320.png"
            alt=""
            className="h-9 w-9 select-none"
            draggable={false}
          />
          <span className="font-display leading-tight text-white">
            <span className="block text-[14px] font-extrabold tracking-tight">CW</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
              Back office
            </span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5">
          <NavItems orientation="rail" />
        </nav>

        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="truncate px-3 pb-1 text-[11px] text-white/45" title={admin.email}>
            {admin.email}
          </p>
          <SignOutButton />
        </div>
      </aside>

      {/* Strip — below lg */}
      <div className="sticky top-0 z-40 bg-cw-navy lg:hidden">
        <div className="flex items-center justify-between gap-3 px-3 pt-2.5">
          <span className="font-display text-[13px] font-extrabold tracking-tight text-white">
            CW Back office
          </span>
          <SignOutButton compact />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2.5 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <NavItems orientation="strip" />
        </nav>
      </div>

      <div className="lg:pl-[212px]">
        <header className="border-b border-cw-navy/10 bg-white px-4 py-4 md:px-6">
          <div className="mx-auto flex max-w-[1220px] flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-[20px] font-extrabold tracking-tight text-cw-navy md:text-[24px]">
                {title}
              </h1>
              {subtitle && <p className="mt-0.5 text-[13px] text-cw-ink/60">{subtitle}</p>}
            </div>
            {actions}
          </div>
        </header>

        <main className="mx-auto max-w-[1220px] px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
