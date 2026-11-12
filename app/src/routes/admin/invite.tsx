/**
 * /admin/invite — where a one-time invite link lands.
 *
 *   /admin/invite#token=…
 *
 * The token is in the URL FRAGMENT, which is never sent to a server. This page
 * reads it in the browser, removes it from the address bar straight away, and
 * holds it in memory only. It goes to the server with the chosen email and
 * password. See src/lib/auth/invite.server.ts for the rules.
 *
 * Creating the login does NOT sign anyone in. It ends on a link to the login
 * page, where the new account goes through the normal admin check.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  AuthCard,
  authButtonClass,
  authInputClass,
  authLabelClass,
} from "../../components/admin/auth-card";
import { adminAcceptInvite, adminCheckInvite } from "../../lib/api/admin.functions";
import { ADMIN_PASSWORD_MIN_LENGTH } from "../../lib/auth/password-policy";

export const Route = createFileRoute("/admin/invite")({
  head: () => ({
    meta: [
      { title: "Create your login | CW back office" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: InvitePage,
});

type Invite = { state: "reading" } | { state: "invalid" } | { state: "ready"; token: string };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function InvitePage() {
  const [invite, setInvite] = useState<Invite>({ state: "reading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The token survives a re-run of the effect (React strict mode runs it twice
  // in development) even though the fragment is stripped on the first pass.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let run = 0;
    function readLink() {
      if (window.location.hash) {
        tokenRef.current = new URLSearchParams(window.location.hash.replace(/^#/, "")).get(
          "token",
        );
        // Out of the address bar and the history entry before anything else.
        window.history.replaceState(null, "", window.location.pathname);
      }
      const token = tokenRef.current;
      const mine = ++run;
      if (!token || !TOKEN_PATTERN.test(token)) {
        setInvite({ state: "invalid" });
        return;
      }
      setInvite({ state: "reading" });
      adminCheckInvite({ data: { token } })
        .then((result) => {
          if (!active || mine !== run) return;
          setInvite(result.valid ? { state: "ready", token } : { state: "invalid" });
        })
        .catch((cause) => {
          console.error(cause);
          if (active && mine === run) setInvite({ state: "invalid" });
        });
    }
    // A link pasted into a tab already on this page only changes the fragment,
    // which does not reload the page, so read it again when that happens.
    function onHashChange() {
      if (window.location.hash) readLink();
    }
    readLink();
    window.addEventListener("hashchange", onHashChange);
    return () => {
      active = false;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || invite.state !== "ready") return;
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
      const result = await adminAcceptInvite({
        data: { token: invite.token, email, password },
      });
      if (result.ok) {
        setDone(true);
        return;
      }
      if (result.reason === "link_invalid") {
        setInvite({ state: "invalid" });
        return;
      }
      setError(result.message);
    } catch (cause) {
      console.error(cause);
      setError("Something went wrong. Check the email address and try again.");
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link to="/admin/login" className="underline underline-offset-2 hover:text-white/70">
      Already have a login? Sign in
    </Link>
  );
  const heading = "font-display text-[20px] font-extrabold tracking-tight text-cw-navy";

  if (done) {
    return (
      <AuthCard>
        <h1 className={heading}>Your login is ready</h1>
        <p role="status" className="mt-2 text-[13px] leading-relaxed text-cw-ink/70">
          Sign in with the email address and password you just chose.
        </p>
        <Link to="/admin/login" className={`block text-center ${authButtonClass}`}>
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  if (invite.state === "reading") {
    return (
      <AuthCard footer={back}>
        <p className="text-[13px] text-cw-ink/60">Checking your invite link…</p>
      </AuthCard>
    );
  }

  if (invite.state === "invalid") {
    return (
      <AuthCard footer={back}>
        <h1 className={heading}>This link no longer works</h1>
        <p role="alert" className="mt-2 text-[13px] leading-relaxed text-cw-ink/70">
          Invite links work once and expire after a few days. Ask for a new one, and open the whole
          link exactly as it was sent.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard footer={back}>
      <form method="post" onSubmit={handleSubmit}>
        <h1 className={heading}>Create your login</h1>
        <p className="mt-1 text-[13px] text-cw-ink/60">
          Choose the email address and password you will use to sign in to the back office.
        </p>

        <label className={`mt-5 ${authLabelClass}`} htmlFor="invite-email">
          Email address
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={authInputClass}
        />

        <label className={`mt-4 ${authLabelClass}`} htmlFor="invite-password">
          Password
        </label>
        <input
          id="invite-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={ADMIN_PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={authInputClass}
        />
        <p className="mt-1.5 text-[12px] text-cw-ink/55">
          At least {ADMIN_PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.
        </p>

        <label className={`mt-4 ${authLabelClass}`} htmlFor="invite-confirm">
          Repeat the password
        </label>
        <input
          id="invite-confirm"
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
          {busy ? "Creating…" : "Create login"}
        </button>
      </form>
    </AuthCard>
  );
}
