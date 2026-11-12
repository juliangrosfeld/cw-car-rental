/**
 * /admin/forgot-password — ask for a password recovery email.
 *
 * Outside the `_shell` guard, like the login page: someone who has forgotten
 * their password is by definition not signed in.
 *
 * THE ANSWER IS ALWAYS THE SAME. After submitting, the page says a link is on
 * its way "if that address has an account", whether or not it does. Telling the
 * two cases apart would let anyone test which emails are admins.
 *
 * There is no sign-up here or anywhere: admins are created with
 * scripts/create-admin.ts. This only resets the password of an account that
 * already exists.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import {
  AuthCard,
  authButtonClass,
  authInputClass,
  authLabelClass,
} from "../../components/admin/auth-card";
import { adminRequestPasswordReset } from "../../lib/api/admin.functions";

export const Route = createFileRoute("/admin/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password | CW back office" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminRequestPasswordReset({ data: { email } });
      setSent(true);
    } catch (cause) {
      // Only a malformed address or a network failure lands here; neither says
      // anything about whether an account exists.
      console.error(cause);
      setError("Could not send the request. Check the address and your connection, then try again.");
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link to="/admin/login" className="underline underline-offset-2 hover:text-white/70">
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthCard footer={back}>
        <h1 className="font-display text-[20px] font-extrabold tracking-tight text-cw-navy">
          Check your email
        </h1>
        <p role="status" className="mt-2 text-[13px] leading-relaxed text-cw-ink/70">
          If that address has an account, a link to set a new password is on its way. It can take
          a minute or two, and it may land in spam.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-cw-ink/70">
          The link works once and expires after a short while. Open it on this device.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard footer={back}>
      <form method="post" onSubmit={handleSubmit}>
        <h1 className="font-display text-[20px] font-extrabold tracking-tight text-cw-navy">
          Forgot password?
        </h1>
        <p className="mt-1 text-[13px] text-cw-ink/60">
          Enter your staff email and we will send a link to set a new password.
        </p>

        <label className={`mt-5 ${authLabelClass}`} htmlFor="email">
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
          className={authInputClass}
        />

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-[13px] text-[#b3261e]">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className={authButtonClass}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  );
}
