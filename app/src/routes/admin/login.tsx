/**
 * /admin/login — the only unauthenticated page under /admin.
 *
 * It sits OUTSIDE the `_shell` layout route on purpose. `_shell` carries the
 * "must be an admin" guard, so a login page nested inside it would redirect to
 * itself forever.
 *
 * The password never touches localStorage or any client-side Supabase session:
 * it is posted to the `adminSignIn` server function, which signs in server-side
 * and puts the resulting tokens in httpOnly cookies. See
 * src/lib/auth/admin.server.ts for why.
 */
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { adminSignIn, fetchAdminSession } from "../../lib/api/admin.functions";

interface LoginSearch {
  /** Where to land after signing in. Validated before use — see safeRedirect. */
  redirect?: string;
}

export const Route = createFileRoute("/admin/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  // An admin who is already signed in should never be shown a login form.
  beforeLoad: async ({ search }) => {
    const { admin } = await fetchAdminSession();
    if (admin) {
      throw redirect({ to: safeRedirect(search.redirect) });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in | CW back office" },
      // Belt and braces with the Disallow in robots.txt. The CRM must not be
      // indexed, and a stray link from anywhere should not leak referrers.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LoginPage,
});

/**
 * The CRM sections a post-login redirect is allowed to land on.
 *
 * `?redirect=` comes out of the URL, so it is attacker-controlled: a link to
 * /admin/login?redirect=https://evil.example would otherwise bounce a
 * freshly-signed-in admin off-site — an open redirect, and a convincing one,
 * since the journey starts on the real domain.
 *
 * Matching against an allowlist rather than sanitising the string ("must start
 * with a slash, but not two slashes, and not a backslash, and not…") makes the
 * whole class of bypass impossible instead of merely unlikely, and it gives
 * TanStack a literal union it can type-check the navigation against. The cost is
 * that a query string on the original URL is dropped; no CRM route depends on
 * one yet, and when one does it belongs in this list explicitly.
 */
const ADMIN_ROUTES = [
  "/admin",
  "/admin/bookings",
  "/admin/fleet",
  "/admin/clients",
  "/admin/payments",
] as const;

type AdminRoute = (typeof ADMIN_ROUTES)[number];

function safeRedirect(target: string | undefined): AdminRoute {
  if (ADMIN_ROUTES.includes(target as AdminRoute)) return target as AdminRoute;
  // A deep link to one booking (/admin/bookings/<uuid>) cannot be a literal in
  // the list above, and dropping it entirely would send someone following a
  // shared link back to the dashboard. Collapsing it to the section it belongs
  // to keeps the allowlist a list of literals — the property that makes an open
  // redirect impossible here — while landing them one click away.
  if (target?.startsWith("/admin/bookings/")) return "/admin/bookings";
  return "/admin";
}

function LoginPage() {
  const router = useRouter();
  const search = Route.useSearch();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const result = await adminSignIn({ data: { email, password } });
      if (!result.ok) {
        setError(result.message);
        setPassword("");
        return;
      }
      // The session now lives in cookies the router has not seen. invalidate()
      // makes the guard on /admin re-run against it instead of a cached "no".
      await router.invalidate();
      await router.navigate({ to: safeRedirect(search.redirect) });
    } catch (cause) {
      console.error(cause);
      setError("Something went wrong signing in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-cw-navy px-5 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex rounded-xl bg-white px-3 py-2">
            <img
              src="/assets/cw-logo-lockup-480.png"
              alt=""
              className="h-9 w-auto select-none"
              draggable={false}
            />
          </span>
          <span className="font-display text-[11px] font-semibold uppercase leading-tight tracking-[0.16em] text-white/55">
            Back office
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
        >
          <h1 className="font-display text-[20px] font-extrabold tracking-tight text-cw-navy">
            Sign in
          </h1>
          <p className="mt-1 text-[13px] text-cw-ink/60">
            Staff access only. Bookings, fleet and payments live behind here.
          </p>

          <label className="mt-5 block text-[12px] font-semibold text-cw-ink/70" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-cw-navy/15 bg-white px-3 py-2.5 text-[14px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20"
          />

          <label className="mt-4 block text-[12px] font-semibold text-cw-ink/70" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-cw-navy/15 bg-white px-3 py-2.5 text-[14px] text-cw-ink outline-none transition-colors focus:border-cw-teal focus:ring-2 focus:ring-cw-teal/20"
          />

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-[13px] text-[#b3261e]"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-cw-teal px-4 py-2.5 font-display text-[14px] font-bold text-white transition-colors hover:bg-cw-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-[12px] text-white/45">
          <a href="/" className="underline underline-offset-2 hover:text-white/70">
            Back to cwcarrental.com
          </a>
        </p>
      </div>
    </main>
  );
}
