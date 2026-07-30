/**
 * Server-only Supabase client — SERVICE ROLE key, RLS BYPASSED.
 *
 * The `.server.ts` suffix keeps Vite from bundling this into the client. Import
 * it ONLY from server functions and server routes. If this key ever reaches the
 * browser, every RLS policy in the database becomes decorative.
 *
 * Use this for anything the `anon` role is deliberately not allowed to do:
 *   - reading a booking back after the public flow inserts it
 *   - the CRM's reads/writes over bookings, clients and payments
 *   - any write whose values the customer must not control (prices, statuses)
 *
 * Prefer the anon client (./client) whenever RLS already expresses the rule —
 * reaching for the service role is how a policy gets quietly bypassed.
 *
 * Env is read INSIDE the function, never at module scope: the original
 * Cloudflare target binds env per request, and Vercel Functions are fine
 * either way, so per-call reads are correct on both.
 */
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

export type AppSupabaseAdminClient = SupabaseClient<Database>;

let cached: AppSupabaseAdminClient | undefined;

export function supabaseAdmin(): AppSupabaseAdminClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client is not configured. Set SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY (see .env.example). SUPABASE_SERVICE_ROLE_KEY " +
        "must be a server-only environment variable — never prefix it with VITE_.",
    );
  }

  cached = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
