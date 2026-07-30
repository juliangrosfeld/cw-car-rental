/**
 * Admin session — httpOnly cookies over Supabase Auth. Server only.
 *
 * THE RULE THIS FILE ENFORCES
 * An admin is a Supabase Auth user whose **app_metadata.role** is `'admin'`.
 * Not user_metadata: a signed-in user can rewrite their own user_metadata with
 * the anon key from the browser, so trusting it would let any registered user
 * promote themselves. app_metadata can only be written with the service role
 * key, which never leaves the server. This is the same test
 * `public.is_admin()` applies inside Postgres (supabase/migrations/…_init.sql),
 * so the app layer and the RLS layer agree on who is an admin by construction.
 *
 * WHERE THE TOKENS LIVE
 * Two httpOnly cookies, written here and readable only by the server:
 *   cw_admin_at  the access token (a short-lived JWT, ~1h)
 *   cw_admin_rt  the refresh token (long-lived, rotates on every use)
 * httpOnly means script cannot read them, so an XSS on the admin pages cannot
 * exfiltrate a session. SameSite=Lax means a cross-site page cannot make the
 * browser attach them to a POST, which is what stops CSRF against the server
 * functions — there is no separate CSRF token because the cookies simply are
 * not sent on cross-site requests.
 *
 * EVERY ADMIN SERVER FUNCTION MUST CALL requireAdmin()
 * Route guards run in the router, and the router runs in the browser, where
 * anyone can skip it. A server function is a public HTTP endpoint: the guard in
 * `src/routes/admin/_shell.tsx` is UX (it redirects instead of showing an empty
 * page), and the requireAdmin() call inside each handler is the actual security
 * boundary. Never add an admin server function that omits it.
 */
import process from "node:process";

import { redirect } from "@tanstack/react-router";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import type { Session, User } from "@supabase/supabase-js";

import { supabaseAuthClient } from "../supabase/auth.server";
import type { AdminIdentity } from "../admin/types";

export type { AdminIdentity };

const ACCESS_COOKIE = "cw_admin_at";
const REFRESH_COOKIE = "cw_admin_rt";

/** 30 days. The refresh token is what keeps Clay signed in between visits; the
 *  access token cookie is deliberately short and simply gets minted again. */
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Where an unauthenticated request to /admin/* lands. */
export const ADMIN_LOGIN_PATH = "/admin/login";

export type SignInResult =
  | { ok: true; admin: AdminIdentity }
  | { ok: false; reason: "bad_credentials" | "not_admin" | "unavailable"; message: string };

/**
 * `secure` must be off on plain-http localhost or the browser silently drops
 * the cookie and login appears to succeed while never sticking. Vercel serves
 * every deployment over https, so production always gets it.
 */
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

function writeSessionCookies(session: Session): void {
  // expires_in is seconds until the access token dies. Shave 30s off so the
  // cookie is gone slightly before the token it holds is worthless, which keeps
  // the refresh path from being entered with a token the API has just rejected.
  const accessMaxAge = Math.max(60, (session.expires_in ?? 3600) - 30);
  setCookie(ACCESS_COOKIE, session.access_token, cookieOptions(accessMaxAge));
  if (session.refresh_token) {
    setCookie(REFRESH_COOKIE, session.refresh_token, cookieOptions(REFRESH_MAX_AGE_SECONDS));
  }
}

export function clearSessionCookies(): void {
  const opts = { path: "/", secure: process.env.NODE_ENV === "production" };
  deleteCookie(ACCESS_COOKIE, opts);
  deleteCookie(REFRESH_COOKIE, opts);
}

/**
 * The single admin test. Returns null for a real, signed-in, perfectly valid
 * user who simply is not an admin — the caller cannot tell the two cases apart,
 * which is intentional.
 */
function toAdminIdentity(user: User | null | undefined): AdminIdentity | null {
  if (!user) return null;
  if (user.app_metadata?.role !== "admin") return null;
  return {
    id: user.id,
    email: user.email ?? "",
    role: "admin",
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

/**
 * Resolve the current request to an admin, or null.
 *
 * The access token is checked with `getUser(jwt)`, which is a round trip to
 * GoTrue rather than a local signature check. That costs a few milliseconds per
 * admin page load and buys the property that matters here: revoking someone's
 * admin role takes effect on their very next request instead of whenever their
 * hour-long JWT happens to expire.
 *
 * If the access cookie is gone but the refresh cookie survives (the common case
 * on any visit more than an hour after the last one) the session is refreshed
 * and both cookies are rewritten, so the admin is not asked to log in again.
 */
export async function readAdminSession(): Promise<AdminIdentity | null> {
  const accessToken = getCookie(ACCESS_COOKIE);
  const refreshToken = getCookie(REFRESH_COOKIE);

  if (!accessToken && !refreshToken) return null;

  const auth = supabaseAuthClient();

  if (accessToken) {
    const { data, error } = await auth.auth.getUser(accessToken);
    if (!error && data.user) {
      const admin = toAdminIdentity(data.user);
      // A valid token belonging to a non-admin is not an error to retry — the
      // cookies are cleared so the browser stops presenting them.
      if (!admin) clearSessionCookies();
      return admin;
    }
    // Fall through to refresh: an expired or already-rotated token is the
    // expected failure here, not an exceptional one.
  }

  if (!refreshToken) {
    clearSessionCookies();
    return null;
  }

  const { data, error } = await auth.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    clearSessionCookies();
    return null;
  }

  const admin = toAdminIdentity(data.user ?? data.session.user);
  if (!admin) {
    clearSessionCookies();
    return null;
  }

  writeSessionCookies(data.session);
  return admin;
}

/**
 * Same as readAdminSession, but throws a redirect to the login page instead of
 * returning null. Call this first in EVERY admin server function.
 *
 * `redirect` thrown from a server function is understood by the router on the
 * client and by the SSR handler on the server, so one call covers both a fresh
 * page load and an in-app navigation.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await readAdminSession();
  if (!admin) {
    throw redirect({ to: ADMIN_LOGIN_PATH });
  }
  return admin;
}

/**
 * Password sign-in. Returns a typed failure rather than throwing, so the login
 * form can render the message in place.
 *
 * A non-admin who supplies correct credentials is signed straight back out and
 * gets `not_admin`: no cookies are written, so a normal Supabase user of this
 * project can never hold an admin session cookie even briefly.
 */
export async function signInAdmin(input: {
  email: string;
  password: string;
}): Promise<SignInResult> {
  const auth = supabaseAuthClient();

  const { data, error } = await auth.auth.signInWithPassword({
    email: input.email.trim().toLowerCase(),
    password: input.password,
  });

  if (error || !data.session) {
    // GoTrue deliberately returns the same "Invalid login credentials" for a
    // wrong password and an unknown address; keep it that way rather than
    // telling an attacker which admin emails exist.
    const status = error?.status ?? 400;
    if (status >= 500) {
      return {
        ok: false,
        reason: "unavailable",
        message: "Could not reach the login service. Try again in a moment.",
      };
    }
    return {
      ok: false,
      reason: "bad_credentials",
      message: "That email and password combination did not work.",
    };
  }

  const admin = toAdminIdentity(data.user ?? data.session.user);
  if (!admin) {
    await auth.auth.signOut();
    return {
      ok: false,
      reason: "not_admin",
      message: "That account exists but is not an admin. Ask for access to the CRM.",
    };
  }

  writeSessionCookies(data.session);
  return { ok: true, admin };
}

/**
 * Sign out. Clears the cookies first — that is what actually ends the session
 * for this browser — then asks GoTrue to revoke the refresh token so a copy
 * captured elsewhere is dead too. A failure to revoke is logged, not surfaced:
 * the local session is already gone and the user must not be left stuck on a
 * page they think is still signed in.
 */
export async function signOutAdmin(): Promise<void> {
  const accessToken = getCookie(ACCESS_COOKIE);
  const refreshToken = getCookie(REFRESH_COOKIE);
  clearSessionCookies();

  if (!accessToken || !refreshToken) return;

  try {
    const auth = supabaseAuthClient();
    await auth.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    await auth.auth.signOut();
  } catch (error) {
    console.error("Admin sign-out: token revocation failed", error);
  }
}
