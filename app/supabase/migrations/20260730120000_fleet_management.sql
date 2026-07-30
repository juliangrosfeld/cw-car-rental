-- ============================================================================
-- 0003 — fleet management: a car's own standing availability.
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor.
-- Idempotent: safe to re-run.
--
-- WHAT THIS ADDS AND WHY
-- `cars.status` already carries a car's standing availability
-- ('available' | 'maintenance' | 'offline'), which is a DIFFERENT thing from
-- `bookings.prep_status`:
--
--   cars.status           the car itself. Is it on the road at all? Set by the
--                         owner, indefinite, and it applies to every future date
--                         at once. A car in the shop is not rentable to anyone.
--   bookings.prep_status  one reservation's lifecycle (booked → needs prep →
--                         ready → out → returned). Says nothing about the car
--                         outside that rental.
--
-- What was missing is WHY a car is off the road and SINCE WHEN, which is the
-- first thing anyone asks about a car that is not earning. Hence two columns.
--
-- TAKING A CAR OFF THE ROAD NEVER TOUCHES AN EXISTING BOOKING, by construction:
-- nothing in this schema joins cars.status to bookings, and the public booking
-- path filters on `status = 'available'` only when choosing a car for NEW dates
-- (src/lib/booking/availability.server.ts). A guest who already has a rental
-- keeps it, and the handover still has to happen — which is exactly what an
-- owner means by "take it off the road from tomorrow".
-- ============================================================================

set search_path = public, extensions;

alter table public.cars add column if not exists maintenance_notes text;
alter table public.cars add column if not exists off_road_since  timestamptz;

comment on column public.cars.maintenance_notes is
  'INTERNAL. What is wrong with the car, what was done, what it is waiting on. '
  'Never exposed to the anon role — see the column grants below.';
comment on column public.cars.off_road_since is
  'When the car last left "available" status. Written by the app, cleared when '
  'it returns to the road. Not derivable from updated_at, which any edit moves.';

-- One-time backfill for a car that is already off the road. updated_at is the
-- best available approximation of when that happened and may overstate how
-- recent it is; every subsequent transition is stamped exactly by the app.
update public.cars
   set off_road_since = updated_at
 where status <> 'available'
   and off_road_since is null;

-- ── keep the internal columns off the public key ────────────────────────────
-- `cars` is the one table the anon role can read, because the public site needs
-- the fleet. That read is table-wide today, so adding maintenance_notes to this
-- table would publish "brake line leaking, unsafe to rent" to anyone holding the
-- publishable key — which ships in the browser by design.
--
-- The fix is a column-level grant: anon keeps SELECT on exactly the columns the
-- public site displays and holds no privilege at all on the two internal ones.
-- Postgres enforces this in the planner, so it is not a policy that could be
-- mis-edited later — an anon `select *` on cars now fails outright rather than
-- leaking.
--
-- SAFE BECAUSE nothing in the browser queries cars directly: every read in the
-- app goes through a server function using the service role
-- (src/lib/booking/availability.server.ts, src/lib/admin/*.server.ts), and the
-- marketing fleet grid is static content from src/content/brand.ts. If a
-- browser-side `select *` on cars is ever added, it must name its columns.
revoke select on public.cars from anon;
grant select (
  id, model, category, color, daily_rate, transmission, seats, photo_url,
  status, created_at, updated_at
) on public.cars to anon;

-- ── verify the intended end state ──────────────────────────────────────────
-- Fails loudly here rather than silently leaving the notes readable.
do $$
declare
  leaked text;
begin
  select string_agg(column_name, ', ' order by column_name)
    into leaked
    from information_schema.role_column_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name = 'cars'
     and column_name in ('maintenance_notes', 'off_road_since');

  if leaked is not null then
    raise exception 'anon can still read internal car columns: %', leaked;
  end if;
end;
$$;
