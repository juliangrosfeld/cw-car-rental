/**
 * Server-only Supabase client for AUTH operations — ANON key, no stored session.
 *
 * This is the third client in the app and each one exists for a different reason:
 *
 *   ./client            anon key, browser + SSR, RLS enforced. Reads the public
 *                       fleet. Has no login and never holds a session.
 *   ./admin.server      SERVICE ROLE key, RLS bypassed. Reads and writes CRM
 *                       data once the caller has already been proven to be an
 *                       admin.
 *   ./auth.server (here) anon key, server only. Talks to GoTrue: sign in with a
 *                       password, refresh an expiring session, resolve an access
 *                       token back to a user.
 *
 * WHY NOT SIGN IN FROM THE BROWSER
 * supabase-js can do `signInWithPassword` client-side and park the session in
 * localStorage, but then the tokens live somewhere JavaScript (and any XSS) can
 * read them, and the server has no way to check the session during SSR. Signing
 * in here instead lets the tokens go straight into httpOnly cookies, which the
 * browser will never hand to script and will attach to every SSR request. See
 * src/lib/auth/admin.server.ts for the cookie side.
 *
 * WHY A FRESH CLIENT EVERY CALL
 * `signInWithPassword` stashes the resulting session on the client instance even
 * with `persistSession: false`. A module-level cached instance would therefore
 * carry one admin's session into the next request on the same warm Function —
 * a real cross-request leak on Vercel. Constructing a client is cheap; do it per
 * call and pass tokens explicitly.
 */
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

export type AppSupabaseAuthClient = SupabaseClient<Database>;

export function supabaseAuthClient(): AppSupabaseAuthClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase auth client is not configured. Set SUPABASE_URL and " +
        "SUPABASE_ANON_KEY (see .env.example).",
    );
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      // There is no OAuth callback in this app; parsing the URL for a session
      // is both useless and a server-side no-op.
      detectSessionInUrl: false,
    },
  });
}
