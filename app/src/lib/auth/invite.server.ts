/**
 * One-time admin invite links. Server only.
 *
 * An invite lets its holder create ONE admin account with an email and password
 * of their choosing. This is the only code path in the app that can grant
 * admin, so it is deliberately narrow:
 *
 *   - Links are minted out of band, by `scripts/create-admin.ts --invite`, on a
 *     machine holding the service role key. Nothing in the app can create one.
 *   - The token is 32 random bytes. Only its SHA-256 is stored, so a read of
 *     the admin_invites table does not yield a working link.
 *   - A link works once and expires. Redeeming it is a single conditional
 *     UPDATE, so two simultaneous attempts cannot both succeed.
 *   - Whoever holds an unused link can become an admin. Send it privately.
 *
 * Creating the account does not sign anyone in: the page ends on a link to
 * /admin/login, which is the path that checks the admin role.
 */
import { createHash } from "node:crypto";

import { supabaseAdmin } from "../supabase/admin.server";
import { clearSessionCookies } from "./admin.server";
import { ADMIN_PASSWORD_MIN_LENGTH } from "./password-policy";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** True when the link is known, unused and not expired. Tells the page whether
 *  to show the form or the "no longer works" message. */
export async function isAdminInviteValid(token: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("admin_invites")
    .select("id")
    .eq("token_hash", hashInviteToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) {
    console.error(`[auth] invite lookup failed: ${error.message}`);
    return false;
  }
  return data !== null;
}

export type AcceptInviteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "link_invalid" | "email_taken" | "weak_password" | "unavailable";
      message: string;
    };

export async function acceptAdminInvite(input: {
  token: string;
  email: string;
  password: string;
}): Promise<AcceptInviteResult> {
  if (input.password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: "weak_password",
      message: `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`,
    };
  }

  const db = supabaseAdmin();
  const email = input.email.trim().toLowerCase();

  // Claim first, create second. The claim is the lock: it matches only an
  // unused, unexpired row, so a second request with the same link finds nothing.
  const claim = await db
    .from("admin_invites")
    .update({ used_at: new Date().toISOString(), used_by_email: email })
    .eq("token_hash", hashInviteToken(input.token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (claim.error) {
    console.error(`[auth] invite claim failed: ${claim.error.message}`);
    return {
      ok: false,
      reason: "unavailable",
      message: "Could not reach the login service. Try again in a moment.",
    };
  }
  if (!claim.data) {
    return {
      ok: false,
      reason: "link_invalid",
      message: "This invite link has expired or was already used.",
    };
  }

  const { error } = await db.auth.admin.createUser({
    email,
    password: input.password,
    // The invite was delivered privately to this person; there is no second
    // inbox round trip, and an unconfirmed user cannot sign in with a password.
    email_confirm: true,
    app_metadata: { role: "admin" },
  });

  if (!error) {
    clearSessionCookies();
    return { ok: true };
  }

  // No account was created, so hand the link back for another attempt.
  const release = await db
    .from("admin_invites")
    .update({ used_at: null, used_by_email: null })
    .eq("id", claim.data.id);
  if (release.error) {
    console.error(`[auth] could not release invite after a failed signup: ${release.error.message}`);
  }

  const status = error.status ?? 400;
  if (status >= 500) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Could not reach the login service. Try again in a moment.",
    };
  }
  if (/already|registered|exists/i.test(error.message)) {
    return {
      ok: false,
      reason: "email_taken",
      message:
        "There is already a login with that email address. Use another address, or use “Forgot password?” on the sign-in page.",
    };
  }
  if (/password/i.test(error.message)) {
    return { ok: false, reason: "weak_password", message: error.message };
  }
  console.error(`[auth] invite signup failed: status=${status} ${error.message}`);
  return { ok: false, reason: "unavailable", message: "Could not create the login. Try again." };
}
