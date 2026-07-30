/**
 * Browser / isomorphic Supabase client — ANON key, RLS enforced.
 *
 * Safe to import from anywhere: components, loaders, server functions. Every
 * query it makes is subject to the Row Level Security policies in
 * supabase/migrations/0001_init.sql, which for the `anon` role means:
 *   - SELECT on cars (the public fleet display)
 *   - INSERT on clients and bookings (the public booking flow)
 *   - nothing else — no reads of bookings/clients/payments, no updates, no deletes
 *
 * Because anon cannot SELECT from bookings or clients, an insert here must NOT
 * chain `.select()` — PostgREST would run a read that RLS denies and the whole
 * call fails. Insert, then confirm out-of-band (see src/lib/supabase/admin.server.ts).
 *
 * ENV — this file reads import.meta.env.VITE_*, but you set SUPABASE_URL and
 * SUPABASE_ANON_KEY (unprefixed) in .env / the Vercel dashboard. vite.config.ts
 * maps the two across via an explicit two-key `define` allowlist, so the app
 * keeps one canonical set of names without a prefix rule wide enough to leak
 * SUPABASE_SERVICE_ROLE_KEY into the browser. See the comment there before
 * changing either side.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

export type AppSupabaseClient = SupabaseClient<Database>;

function readPublicEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (see " +
        ".env.example). These are inlined at BUILD time by vite.config.ts, so on " +
        "Vercel they must exist as Environment Variables before the build runs — " +
        "adding them afterwards requires a redeploy, not just a restart.",
    );
  }
  return { url, anonKey };
}

let cached: AppSupabaseClient | undefined;

/**
 * Lazily constructed so a missing env var throws at first use rather than at
 * module load — a module-scope throw would take down SSR for the whole app,
 * including pages that never touch the database.
 */
export function supabase(): AppSupabaseClient {
  if (!cached) {
    const { url, anonKey } = readPublicEnv();
    cached = createClient<Database>(url, anonKey, {
      auth: {
        // The public site has no login. Skipping session persistence keeps the
        // anon client from writing to localStorage and keeps SSR deterministic.
        // The CRM's admin client will need its own instance with these on.
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cached;
}
