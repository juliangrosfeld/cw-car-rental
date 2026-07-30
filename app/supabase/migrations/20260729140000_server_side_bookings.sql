-- ============================================================================
-- 0002 — move booking writes behind the server, close the anon write path.
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor.
-- Idempotent: safe to re-run.
--
-- WHAT CHANGED AND WHY
-- 0001 let the anon role INSERT into bookings and clients so the browser could
-- submit a booking directly. That left total_price under the customer's
-- control: RLS can pin a status column to a literal, but it cannot express
-- "price must equal daily_rate x days" without trusting the same request that
-- supplies the price. A crafted POST could book any car for $0.
--
-- Booking writes now go through the `submitBooking` server function
-- (src/lib/api/booking.functions.ts → src/lib/booking/availability.server.ts),
-- which reads daily_rate from this database, recomputes the total, and writes
-- with the service role. Its input type has no price field at all. The anon
-- policies below are therefore not merely redundant — leaving them in place
-- would keep the $0 hole open right next to the fixed path.
--
-- After this migration the anon role can do exactly one thing: SELECT cars.
--
-- NOTE ON CLIENT DEDUPLICATION: there is deliberately NO unique index on
-- clients.email. The server reuses an existing guest row when the address
-- matches and otherwise inserts, because a unique constraint would either
-- reject a legitimate booking (one address, several drivers — travel agents,
-- couples) or, with ON CONFLICT DO UPDATE, let each new booking overwrite the
-- previous guest's name and phone. Duplicates are benign and mergeable; a
-- rejected booking is not.
-- ============================================================================

set search_path = public, extensions;

-- ── revoke the anon write path ─────────────────────────────────────────────
drop policy if exists "bookings: anon can request"      on public.bookings;
drop policy if exists "clients: anon can self-register" on public.clients;

revoke insert on public.clients, public.bookings from anon;

-- ── verify the intended end state ──────────────────────────────────────────
-- Fails loudly here rather than silently leaving a hole open. anon must retain
-- exactly one privilege across the four tables: SELECT on cars.
do $$
declare
  leftover text;
begin
  select string_agg(format('%s.%s', table_name, privilege_type), ', ' order by table_name)
    into leftover
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name in ('cars', 'clients', 'bookings', 'payments')
     and not (table_name = 'cars' and privilege_type = 'SELECT');

  if leftover is not null then
    raise exception 'anon still holds unexpected privileges: %', leftover;
  end if;
end;
$$;

-- Same for policies: anon must have no INSERT policy left anywhere.
do $$
declare
  leftover text;
begin
  select string_agg(format('%s on %s', policyname, tablename), ', ')
    into leftover
    from pg_policies
   where schemaname = 'public'
     and cmd = 'INSERT'
     and 'anon' = any(roles);

  if leftover is not null then
    raise exception 'anon still has INSERT policies: %', leftover;
  end if;
end;
$$;
