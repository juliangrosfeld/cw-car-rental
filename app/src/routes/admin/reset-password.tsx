/**
 * /admin/reset-password — where the emailed recovery link lands.
 *
 * HOW THE LINK WORKS. Supabase verifies the one-time token in the email, then
 * redirects here with a short-lived recovery session in the URL FRAGMENT:
 *
 *   /admin/reset-password#access_token=…&refresh_token=…&type=recovery
 *
 * A fragment is never sent to a server, so this page reads it in the browser,
 * removes it from the address bar straight away (so it is not left in history
 * or picked up by a screenshot), and holds the two tokens in memory only. They
 * go to the server once, together with the new password.
 *
 * A link that is expired or already used arrives as `#error=…` instead, and the
 * page says so and points back to the request form.
 *
 * Setting the password does NOT sign anyone in. It ends on a link to the login
 * page, where the new password goes through the normal admin check.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import {
  AuthCard,
  authButtonClass,
  authInputClass,
  authLabelClass,
} from "../../components/admin/auth-card";
import { adminCompletePasswordReset } from "../../lib/api/admin.functions";
import { ADMIN_PASSWORD_MIN_LENGTH } from "../../lib/auth/password-policy";

export const Route = createFileRoute("/admin/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password | CW back office" },
      { name: "robots", content: "noindex, nofollow" },
      // The recovery tokens are in this page's URL for a moment; never send it
      // to another site as a referrer.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ResetPasswordPage,
});

type Link_ =
  | { state: "reading" }
  | { state: "invalid" }
  | { state: "ready"; accessToken: string; refreshToken: string };

function ResetPasswordPage() {
  const [link, setLink] = useState<Link_>({ state: "reading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    // Out of the address bar and the history entry before anything else.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (accessToken && refreshToken && params.get("type") === "recovery") {
      setLink({ state: "ready", accessToken, refreshToken });
    } else {
      setLink({ state: "invalid" });
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || link.state !== "ready") return;
    if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await adminCompletePasswordReset({
        data: { accessToken: link.accessToken, refreshToken: link.refreshToken, password },
      });
      if (result.ok) {
        setDone(true);
        return;
      }
      if (result.reason === "link_invalid") {
        setLink({ state: "invalid" });
        return;
      }
      setError(result.message);
    } catch (cause) {
      console.error(cause);
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link to="/admin/login" className="underline underline-offset-2 hover:text-white/70">
      Back to sign in
    </Link>
  );
  const heading = "font-display text-[20px] font-extrabold tracking-tight text-cw-navy";

  if (done) {
    return (
      <AuthCard>
        <h1 className={heading}>Password changed</h1>
        <p role="status" className="mt-2 text-[13px] leading-relaxed text-cw-ink/70">
          Your new password is set. Sign in with it to get back to the back office.
        </p>
        <Link to="/admin/login" className={`block text-center ${authButtonClass}`}>
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  if (link.state === "reading") {
    return (
      <AuthCard footer={back}>
        <p className="text-[13px] text-cw-ink/60">Checking your reset link…</p>
      </AuthCard>
    );
  }

  if (link.state === "invalid") {
    return (
      <AuthCard footer={back}>
        <h1 className={heading}>This link no longer works</h1>
        <p role="alert" className="mt-2 text-[13px] leading-relaxed text-cw-ink/70">
          Reset links work once and expire after a short while. Request a new one and open it on
          this device.
        </p>
        <Link to="/admin/forgot-password" className={`block text-center ${authButtonClass}`}>
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard footer={back}>
      <form method="post" onSubmit={handleSubmit}>
        <h1 className={heading}>Set a new password</h1>
        <p className="mt-1 text-[13px] text-cw-ink/60">
          At least {ADMIN_PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.
        </p>

        <label className={`mt-5 ${authLabelClass}`} htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={ADMIN_PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={authInputClass}
        />

        <label className={`mt-4 ${authLabelClass}`} htmlFor="confirm-password">
          Repeat it
        </label>
        <input
          id="confirm-password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={authInputClass}
        />

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-[13px] text-[#b3261e]">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className={authButtonClass}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    </AuthCard>
  );
}
