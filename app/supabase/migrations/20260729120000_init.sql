-- ============================================================================
-- CW car rental — booking + CRM core for Supabase / Postgres.
--
-- Run with `supabase db push`, or paste whole into the Supabase SQL editor.
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP
-- POLICY IF EXISTS before each CREATE POLICY).
--
-- Typed mirror for the app lives in src/lib/supabase/types.ts. THIS FILE IS
-- AUTHORITATIVE — keep that file in sync by hand, or regenerate it with
-- `supabase gen types typescript`.
--
-- CONVENTIONS
--   money       integer CENTS, never numeric/float. 5500 == $55.00. Floats
--               silently lose precision on sums, which is how invoices go wrong.
--   ids         cars reuse the FLEET slugs from src/content/brand.ts so existing
--               frontend keys line up; everything else is a uuid.
--   dates/times real `date` and `time` columns (not text, as under SQLite).
--   time zone   pickup/return are WALL CLOCK time, stored as `timestamp`
--               (without time zone) in the generated *_at columns. Curaçao is
--               AST (UTC-4) year-round with no DST, so wall clock is
--               unambiguous and avoids every tz/DST edge case. Do not switch
--               these to timestamptz without revisiting the exclusion
--               constraint below.
-- ============================================================================

-- Required for the bookings exclusion constraint: lets a GiST index mix a
-- plain-equality column (car_id) with a range column in one constraint.
--
-- Installed into `extensions` (present on every Supabase project) rather than
-- public, which the Supabase security advisor flags. The explicit search_path
-- below then guarantees the gist operator classes resolve when the constraint
-- is created, regardless of the running role's default search_path.
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

-- ── shared trigger: keep updated_at honest ──────────────────────────────────
-- `set search_path` pinned: an unqualified search_path in a trigger function is
-- a privilege-escalation vector and a Supabase advisor warning.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- cars
-- ============================================================================
create table if not exists public.cars (
  id            text primary key,          -- FLEET slug, e.g. 'hyundai-venue-red'
  model         text not null,
  category      text not null,             -- 'SUV' | 'Sedan' | 'Hatchback' (free text)
  color         text not null,
  daily_rate    integer not null check (daily_rate >= 0),   -- cents per rental day
  transmission  text not null default 'Automatic'
                  check (transmission in ('Automatic', 'Manual')),
  seats         integer not null check (seats > 0),
  photo_url     text not null,
  status        text not null default 'available'
                  check (status in ('available', 'maintenance', 'offline')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_cars_status on public.cars (status);

drop trigger if exists trg_cars_updated_at on public.cars;
create trigger trg_cars_updated_at
  before update on public.cars
  for each row execute function public.set_updated_at();

-- ============================================================================
-- clients
--
-- Only name/phone/email are required: a walk-in can be created at the counter
-- before the licence is scanned. Licence validity checks belong in the app.
-- ============================================================================
create table if not exists public.clients (
  id                   uuid primary key default gen_random_uuid(),
  full_name            text not null check (length(trim(full_name)) > 0),
  phone                text not null check (length(trim(phone)) > 0),
  email                text not null check (position('@' in email) > 1),
  license_number       text,
  license_expiry       date,
  date_of_birth        date,
  country_of_residence text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_clients_email on public.clients (lower(email));
create index if not exists idx_clients_phone on public.clients (phone);

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ============================================================================
-- bookings
--
-- A rental occupies the HALF-OPEN interval [pickup, return): the car is back on
-- the morning of the return day, so that slot can start the next rental.
-- Touching endpoints (one returns 10:00, the next picks up 10:00) do NOT
-- collide. This matches the day model in src/components/booking/availability.ts,
-- but at minute precision — two rentals on the same date at different hours are
-- a real conflict that a day-granular check would miss.
-- ============================================================================
create table if not exists public.bookings (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete restrict,
  car_id           text not null references public.cars (id)    on delete restrict,

  pickup_date      date not null,
  pickup_time      time not null,
  return_date      date not null,
  return_time      time not null,

  -- Generated so the exclusion constraint has a single sortable instant to
  -- range over, and so the app can never let the parts drift from the whole.
  -- `date + time -> timestamp` is immutable, which is what makes it indexable.
  pickup_at        timestamp generated always as (pickup_date + pickup_time) stored,
  return_at        timestamp generated always as (return_date + return_time) stored,

  pickup_location  text not null,
  return_location  text not null,
  flight_number    text,

  total_price      integer not null check (total_price >= 0),  -- cents, quoted at booking time

  booking_status   text not null default 'pending'
                     check (booking_status in
                       ('pending', 'confirmed', 'active', 'completed', 'cancelled')),
  payment_status   text not null default 'unpaid'
                     check (payment_status in
                       ('unpaid', 'pending', 'paid', 'refunded')),
  prep_status      text not null default 'booked'
                     check (prep_status in
                       ('booked', 'needs_prep', 'ready', 'out', 'returned')),

  special_requests text,        -- customer-facing; safe to echo back to the guest
  admin_notes      text,        -- INTERNAL ONLY, never send to a guest
  handled_by       text,        -- reserved for multi-admin; no users table yet

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Return must be strictly after pickup, or the range below would be empty
  -- and an empty range never conflicts with anything — silently disabling the
  -- double-booking guard. This check is what keeps that constraint meaningful.
  constraint bookings_return_after_pickup
    check ((return_date + return_time) > (pickup_date + pickup_time))
);

-- ── the double-booking guard ────────────────────────────────────────────────
-- THE reason for moving off D1. SQLite has no exclusion constraints, so this
-- rule previously lived in application code as a guarded INSERT that had to be
-- reproduced correctly at every write site. Here the database enforces it for
-- every writer — the booking form, the CRM, a manual SQL fix at 2am — and a
-- losing concurrent insert fails with SQLSTATE 23P01 (exclusion_violation)
-- rather than quietly double-booking the car.
--
-- '[)' is the half-open bound: back-to-back handover at the same minute is
-- allowed. To require a cleaning buffer instead, widen the range here (e.g.
-- return_at + interval '2 hours') rather than adding an app-layer check.
--
-- The partial WHERE is the whole status vocabulary except 'cancelled':
-- a cancelled booking releases the car, everything else still occupies it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_double_booking'
  ) then
    alter table public.bookings
      add constraint bookings_no_double_booking
      exclude using gist (
        car_id with =,
        tsrange(pickup_at, return_at, '[)') with &&
      ) where (booking_status <> 'cancelled');
  end if;
end;
$$;

create index if not exists idx_bookings_car_dates on public.bookings (car_id, pickup_at, return_at);
create index if not exists idx_bookings_client    on public.bookings (client_id);
create index if not exists idx_bookings_status    on public.bookings (booking_status);
create index if not exists idx_bookings_prep      on public.bookings (prep_status, pickup_date);
create index if not exists idx_bookings_created   on public.bookings (created_at desc);

drop trigger if exists trg_bookings_updated_at on public.bookings;
create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- payments
--
-- A booking can have many payments (deposit, balance, refund). `amount` is
-- signed: positive for a charge, negative for a refund, so sum(amount) is the
-- net take.
-- ============================================================================
create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  booking_id              uuid not null references public.bookings (id) on delete restrict,
  amount                  integer not null,   -- cents, signed
  method                  text not null,      -- 'cash' | 'card' | 'bank_transfer' | 'stripe'
  status                  text not null default 'pending'
                            check (status in ('unpaid', 'pending', 'paid', 'refunded')),
  provider_transaction_id text,
  created_at              timestamptz not null default now()
);

create index if not exists idx_payments_booking on public.payments (booking_id);

-- UNIQUE, unlike the D1 version this replaces: a payment provider retrying a
-- webhook must not be able to record the same transaction twice. Partial, so
-- the many cash/manual payments with no provider id are unaffected.
create unique index if not exists idx_payments_provider_txn
  on public.payments (provider_transaction_id)
  where provider_transaction_id is not null;

-- ============================================================================
-- ADMIN IDENTITY
--
-- Reads the role out of the JWT's app_metadata. app_metadata deliberately, NOT
-- user_metadata: a signed-in user can rewrite their own user_metadata via the
-- client SDK, so trusting it would let anyone promote themselves to admin.
-- app_metadata can only be set with the service role key.
--
-- Grant admin with:
--   select auth.uid();  -- find the user, then from a server-side script:
--   supabase.auth.admin.updateUserById(id, { app_metadata: { role: 'admin' } })
--
-- Replace this with a real admin_users table when the CRM lands; every policy
-- below routes through this one function, so that is a single-file change.
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
--
-- The anon key ships to the browser, so the browser can call PostgREST directly
-- with it. RLS is therefore the ONLY thing standing between a curious visitor
-- and the customer table. Every table is locked by default; each policy below
-- opens exactly one hole.
--
-- Two layers, deliberately:
--   1. GRANTs  — the anon role does not even hold the UPDATE/DELETE privilege,
--                so a policy mistake cannot expose one. Supabase grants broad
--                privileges on public by default; these revokes undo that.
--   2. POLICIES — the row/column-level rules below.
-- ============================================================================
alter table public.cars     enable row level security;
alter table public.clients  enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;

-- Force RLS to apply to the table owner too, so a future SECURITY DEFINER
-- helper cannot accidentally read around it.
--
-- Deliberately NOT applied to `cars`: the owner-run seed INSERT at the bottom of
-- this migration relies on the owner's normal RLS bypass, and there is no
-- owner-facing insert policy on cars. Adding `force` here would make this
-- migration fail on the seed. (service_role is unaffected either way — BYPASSRLS
-- is a role attribute that outranks `force`.)
alter table public.clients  force row level security;
alter table public.bookings force row level security;
alter table public.payments force row level security;

-- ── layer 1: privileges ─────────────────────────────────────────────────────
revoke all on public.cars, public.clients, public.bookings, public.payments
  from anon, authenticated;

-- Public site: read the fleet, create a client + a booking. Nothing else.
grant select on public.cars                        to anon;
grant insert on public.clients, public.bookings    to anon;

-- Signed-in users: the CRM. Policies still gate this on is_admin().
grant select, insert, update, delete
  on public.cars, public.clients, public.bookings, public.payments
  to authenticated;

-- ── layer 2: policies — cars ────────────────────────────────────────────────
drop policy if exists "cars: public read" on public.cars;
create policy "cars: public read"
  on public.cars for select
  to anon, authenticated
  using (true);

drop policy if exists "cars: admin write" on public.cars;
create policy "cars: admin write"
  on public.cars for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── policies — clients ──────────────────────────────────────────────────────
-- Anon may INSERT but has no SELECT: a visitor can submit their details and
-- can never read anyone else's back. Note this means the client SDK cannot
-- chain .select() onto the insert — PostgREST would run a denied read and fail
-- the whole call. Use the service-role client server-side to read the row back.
drop policy if exists "clients: anon can self-register" on public.clients;
create policy "clients: anon can self-register"
  on public.clients for insert
  to anon
  with check (true);

drop policy if exists "clients: admin full access" on public.clients;
create policy "clients: admin full access"
  on public.clients for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── policies — bookings ─────────────────────────────────────────────────────
-- Anon may INSERT a booking REQUEST only. The WITH CHECK pins every status
-- column to its opening value, so a hostile client cannot POST itself a
-- confirmed, paid, ready-to-collect booking — and cannot write the internal
-- admin_notes / handled_by fields at all.
--
-- WHAT THIS STILL DOES NOT STOP: total_price is client-supplied, so a crafted
-- request can book a car for 0. RLS cannot express "price must equal
-- daily_rate x days" without trusting the same input. The durable fix is to
-- take bookings through a server function that recomputes the price and writes
-- with the service role, then drop this anon insert policy entirely.
drop policy if exists "bookings: anon can request" on public.bookings;
create policy "bookings: anon can request"
  on public.bookings for insert
  to anon
  with check (
    booking_status = 'pending'
    and payment_status = 'unpaid'
    and prep_status = 'booked'
    and admin_notes is null
    and handled_by is null
    -- Cannot request a car that is off the road.
    and exists (
      select 1 from public.cars c
      where c.id = car_id and c.status = 'available'
    )
  );

drop policy if exists "bookings: admin full access" on public.bookings;
create policy "bookings: admin full access"
  on public.bookings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── policies — payments ─────────────────────────────────────────────────────
-- No anon access of any kind. Money is admin-only (and, later, a Stripe webhook
-- running with the service role, which bypasses RLS).
drop policy if exists "payments: admin full access" on public.payments;
create policy "payments: admin full access"
  on public.payments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- SEED — the real CW fleet
--
-- Mirrors FLEET in src/content/brand.ts; ids are the FLEET slugs so the
-- existing frontend keys line up with these rows exactly.
--
-- ON CONFLICT DO NOTHING, deliberately: re-running this migration must never
-- clobber a rate or status an admin has since changed in production. Editing a
-- value here does NOT update an existing row — that takes a new migration.
--
-- daily_rate is brand.ts pricePerDay in cents (55 -> 5500). Those prices are
-- placeholders pending confirmation with Clay, per the note in brand.ts.
-- `category` is not in brand.ts; derived from the model.
-- ============================================================================
insert into public.cars (id, model, category, color, daily_rate, transmission, seats, photo_url, status) values
  ('hyundai-venue-red',     'Hyundai Venue',   'SUV',       'Red',    5500, 'Automatic', 5, '/assets/fleet/hyundai-venue-red-900.webp',     'available'),
  ('mazda-3-grey',          'Mazda 3',         'Sedan',     'Grey',   5200, 'Automatic', 5, '/assets/fleet/mazda-3-grey-900.webp',          'available'),
  ('nissan-versa-red',      'Nissan Versa',    'Sedan',     'Red',    4500, 'Automatic', 5, '/assets/fleet/nissan-versa-red-900.webp',      'available'),
  ('nissan-versa-silver',   'Nissan Versa',    'Sedan',     'Silver', 4500, 'Automatic', 5, '/assets/fleet/nissan-versa-silver-900.webp',   'available'),
  ('chevrolet-spark-black', 'Chevrolet Spark', 'Hatchback', 'Black',  3500, 'Automatic', 4, '/assets/fleet/chevrolet-spark-black-900.webp', 'available')
on conflict (id) do nothing;
