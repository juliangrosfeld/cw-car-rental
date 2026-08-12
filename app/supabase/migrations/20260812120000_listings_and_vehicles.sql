-- ============================================================================
-- 0005 — split the fleet into LISTINGS and VEHICLES.
--
-- Run with `supabase db push`, or paste whole into the Supabase SQL editor.
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded inserts / DROP … IF
-- EXISTS before each CREATE).
--
-- ⚠ THIS MIGRATION AND ITS DEPLOY GO TOGETHER. It DROPS cars.status,
-- cars.maintenance_notes and cars.off_road_since (their data moves to
-- `vehicles` first). The currently deployed app filters on `cars.status`, so
-- running this against production before the matching deploy makes the booking
-- page 400 on every availability query. Apply it in the same window as the
-- deploy, migration first, code immediately after.
--
-- ⚠ 0001–0004 MUST NOT BE RE-RUN AFTER THIS ONE. They were idempotent against
-- the schema of their own day; 0004's verification block reads cars.status,
-- which no longer exists. This file supersedes them.
--
-- WHAT CHANGED AND WHY
--
-- `cars` conflated two different things that were the same thing only by
-- accident of CW owning exactly one of each model:
--
--   THE LISTING    what a guest browses and books against. A model, a
--                  category, a photo, a daily rate and a monthly rate.
--   THE VEHICLE    a physical car in the yard. A plate, a colour, a state of
--                  repair, and a key that exactly one guest can hold at a time.
--
-- They come apart the moment CW owns two of anything. A second Chevrolet Spark
-- is not a second listing — a guest booking "the Spark" does not care which of
-- the two they get, and publishing both would advertise a choice that is not
-- being offered. But it IS a second key: the two can be rented to two guests
-- over the same week, which the old schema could not express at all.
--
-- The correctness consequence is the whole point of this migration and it cuts
-- both ways:
--
--   · the double-booking guard was on car_id, i.e. on the LISTING. With two
--     Sparks that rejects a legitimate second booking — two physical cars, one
--     of them idle, and the database says no. It moves to vehicle_id below.
--   · availability was "is this row free?", i.e. also on the listing. With two
--     Sparks that hides a bookable car. It becomes "does ANY vehicle under this
--     listing have the dates free?" in src/lib/booking/availability.server.ts.
--
-- WHAT DID NOT CHANGE
--   · `cars.id` is still the FLEET slug. Every existing booking, URL and admin
--     link keeps working, and the public site renders exactly as before.
--   · `cars.color` stays on the LISTING. It is the colour in the listing's
--     photo — what the site says the car looks like — and is deliberately not
--     the same field as `vehicles.color`, which is what is actually parked
--     outside. For the five original cars they agree; for the hidden grey Spark
--     they do not, which is precisely the case worth being able to state.
--   · bookings keep `car_id`. It is the listing the guest booked, and it is now
--     held consistent with the assigned vehicle by a composite foreign key
--     rather than by hope — see bookings_vehicle_listing_fkey below.
-- ============================================================================

set search_path = public, extensions;

-- ============================================================================
-- cars → the listing level
-- ============================================================================

-- Copy a listing shows a guest. Nullable: the public site renders FLEET from
-- src/content/brand.ts today, so this starts empty and is filled in from the
-- CRM rather than being invented here.
alter table public.cars add column if not exists description text;

comment on table public.cars is
  'A LISTING: what a guest browses and books against. The physical cars that '
  'back it are rows in public.vehicles. Do not add a per-car fact here — plate, '
  'colour, condition and availability all belong to a vehicle.';
comment on column public.cars.color is
  'The colour shown in this listing''s photo, i.e. what the site says the car '
  'looks like. NOT the colour of the unit a guest is handed — that is '
  'vehicles.color, and the two legitimately differ when a listing is backed by '
  'more than one car.';
comment on column public.cars.description is
  'Guest-facing copy for the listing. Public: the anon column grant at the '
  'bottom of this file includes it.';

-- ============================================================================
-- vehicles — the physical unit
-- ============================================================================
create table if not exists public.vehicles (
  id                   uuid primary key default gen_random_uuid(),
  listing_id           text not null references public.cars (id) on delete restrict,

  -- NULLABLE, deliberately. The five cars this migration inherits have real
  -- plates that are not recorded anywhere in this repo, and a migration has no
  -- business inventing them: 'CW-0001' printed in the CRM would read as fact.
  -- Null means "not on file yet"; the fleet page says so and offers the box.
  plate_number         text,
  color                text not null,

  -- Whether this unit is the one the listing shows the world. A listing's
  -- photo is of one specific car; the others are interchangeable backups that
  -- exist as capacity, not as choices. This flag never affects whether a
  -- listing is bookable — see the note on auto-assignment below.
  is_publicly_visible  boolean not null default true,

  -- Standing availability, moved here from cars.status: it is a fact about a
  -- physical car ("this one is in the shop"), never about a listing.
  status               text not null default 'available'
                         check (status in ('available', 'maintenance', 'offline')),
  maintenance_notes    text,
  off_road_since       timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Redundant against the primary key, and required: Postgres will only accept
  -- a composite foreign key that references a uniquely-constrained column list,
  -- and bookings_vehicle_listing_fkey below points at exactly this pair.
  constraint vehicles_id_listing_key unique (id, listing_id)
);

comment on table public.vehicles is
  'A PHYSICAL car. Exactly one guest can hold its keys at a time, which is why '
  'the double-booking exclusion constraint keys on vehicle_id and not on the '
  'listing.';
comment on column public.vehicles.plate_number is
  'Null means not on file, not "no plate". Unique among the vehicles that have '
  'one, case- and space-insensitively.';
comment on column public.vehicles.is_publicly_visible is
  'True for the unit whose photo the listing shows. False for a backup that '
  'exists as capacity. Public availability counts BOTH — see '
  'src/lib/booking/availability.server.ts.';
comment on column public.vehicles.maintenance_notes is
  'INTERNAL. What is wrong with this car. The anon role holds no privilege on '
  'this table at all, which is what keeps it off the public site.';
comment on column public.vehicles.off_road_since is
  'When this vehicle last left "available". Stamped by the app on the '
  'transition, cleared when it returns — not derivable from updated_at, which '
  'any edit moves.';

create index if not exists idx_vehicles_listing on public.vehicles (listing_id);
create index if not exists idx_vehicles_status  on public.vehicles (status);

-- Two cars cannot wear one plate. Partial and normalised: the many vehicles
-- with no plate on file are unaffected, and 'A 12345' cannot be entered twice
-- with different spacing.
create unique index if not exists idx_vehicles_plate
  on public.vehicles (upper(regexp_replace(plate_number, '[^A-Za-z0-9]', '', 'g')))
  where plate_number is not null;

drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

-- ── migrate the existing fleet ──────────────────────────────────────────────
-- Each of the five cars becomes one visible vehicle under its own listing,
-- carrying its colour and its whole standing-availability state across. Nothing
-- is lost: this INSERT runs before the columns are dropped, and the DO block at
-- the bottom refuses to let the migration finish if any listing ended up
-- without a vehicle.
--
-- Guarded on "this listing has no vehicles yet" rather than ON CONFLICT: a
-- re-run must not manufacture a second copy of every car.
insert into public.vehicles (
  listing_id, plate_number, color, is_publicly_visible,
  status, maintenance_notes, off_road_since
)
select c.id, null, c.color, true, c.status, c.maintenance_notes, c.off_road_since
  from public.cars c
 where not exists (select 1 from public.vehicles v where v.listing_id = c.id);

-- ── the sixth car ───────────────────────────────────────────────────────────
-- A grey Chevrolet Spark, backing the existing Spark listing and hidden from
-- the public site. This is the row that makes the whole split load-bearing:
-- from today the Spark listing can take two simultaneous rentals, and the
-- second guest is handed a car whose colour was never advertised.
--
-- No plate for the same reason as above. Status 'available' — it is a working
-- car, it simply is not the one in the photograph.
insert into public.vehicles (listing_id, color, is_publicly_visible, status)
select 'chevrolet-spark-black', 'Grey', false, 'available'
 where exists (select 1 from public.cars where id = 'chevrolet-spark-black')
   and not exists (
     select 1 from public.vehicles
      where listing_id = 'chevrolet-spark-black' and color = 'Grey'
   );

-- ============================================================================
-- bookings — which physical car was assigned
-- ============================================================================
alter table public.bookings add column if not exists vehicle_id uuid;

comment on column public.bookings.vehicle_id is
  'The physical car this rental holds. Assigned when the booking is taken '
  '(visible unit first, then a backup) or chosen by hand in the CRM. The '
  'listing is bookings.car_id, kept in step with this by '
  'bookings_vehicle_listing_fkey.';

-- Backfill: every existing booking was taken against a listing that had exactly
-- one car, and after the insert above that car is the visible vehicle.
update public.bookings b
   set vehicle_id = v.id
  from public.vehicles v
 where v.listing_id = b.car_id
   and v.is_publicly_visible
   and b.vehicle_id is null;

-- Fail loudly rather than leaving a booking with no car. `set not null` would
-- report this too, but not which rows or why.
do $$
declare
  orphaned integer;
begin
  select count(*) into orphaned from public.bookings where vehicle_id is null;
  if orphaned > 0 then
    raise exception
      '% booking(s) could not be matched to a vehicle. Every listing needs a '
      'publicly visible vehicle before this migration can proceed.', orphaned;
  end if;
end;
$$;

alter table public.bookings alter column vehicle_id set not null;

-- ── keep the listing and the vehicle in agreement ───────────────────────────
-- bookings carries BOTH car_id (the listing that was sold) and vehicle_id (the
-- car that was handed over), which is a denormalisation and therefore a place
-- two truths could drift apart. This composite FK makes the drift
-- unrepresentable: the pair must exist together in `vehicles`, so a booking can
-- never point at a Spark listing and a Venue key.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_vehicle_listing_fkey'
  ) then
    alter table public.bookings
      add constraint bookings_vehicle_listing_fkey
      foreign key (vehicle_id, car_id)
      references public.vehicles (id, listing_id)
      on delete restrict;
  end if;
end;
$$;

-- ============================================================================
-- THE DOUBLE-BOOKING GUARD, MOVED TO THE VEHICLE
--
-- This is the correctness fix the rest of the migration exists to make
-- possible. On car_id the constraint answered "is this LISTING taken?", which
-- is now the wrong question in both directions:
--
--   FALSE POSITIVE  two guests booking the Spark for the same week is fine —
--                   there are two Sparks. The old constraint rejected the
--                   second one.
--   The real rule   one physical car, one guest, at a time. Unchanged, and now
--                   actually expressed.
--
-- Everything else about it is deliberately identical: '[)' so a same-minute
-- handover is legal, and the partial WHERE so a cancelled booking releases the
-- car. The app still treats SQLSTATE 23P01 as the authority on who won a race —
-- see the assignment loop in src/lib/booking/availability.server.ts, which
-- retries against the next vehicle rather than pre-checking harder.
-- ============================================================================
alter table public.bookings drop constraint if exists bookings_no_double_booking;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_double_booking_vehicle'
  ) then
    alter table public.bookings
      add constraint bookings_no_double_booking_vehicle
      exclude using gist (
        vehicle_id with =,
        tsrange(pickup_at, return_at, '[)') with &&
      ) where (booking_status <> 'cancelled');
  end if;
end;
$$;

create index if not exists idx_bookings_vehicle_dates
  on public.bookings (vehicle_id, pickup_at, return_at);

-- ============================================================================
-- drop what has moved
--
-- Run only after the INSERT above has copied all three into `vehicles`. Kept in
-- this file rather than deferred to a later "cleanup" migration on purpose: a
-- car's status living in two places for a release is exactly how the two get
-- edited independently and stop agreeing.
-- ============================================================================
alter table public.cars drop column if exists status;
alter table public.cars drop column if exists maintenance_notes;
alter table public.cars drop column if exists off_road_since;

-- ============================================================================
-- ROW LEVEL SECURITY — vehicles
--
-- The anon role gets NOTHING here, not even a column grant. `cars` is
-- anon-readable because the public site needs the fleet; `vehicles` carries
-- plate numbers, maintenance notes, and the existence of units CW has chosen
-- not to advertise. None of that has a public reader: every vehicle read in the
-- app goes through a server function using the service role.
-- ============================================================================
alter table public.vehicles enable row level security;
alter table public.vehicles force row level security;

revoke all on public.vehicles from anon, authenticated;
grant select, insert, update, delete on public.vehicles to authenticated;

drop policy if exists "vehicles: admin full access" on public.vehicles;
create policy "vehicles: admin full access"
  on public.vehicles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── keep the public column grant on cars complete ───────────────────────────
-- 0003 replaced anon's table-wide SELECT on cars with a column list, so a
-- column added after it is not covered. `description` is guest-facing copy and
-- belongs on that list. The grant on `status` disappeared with the column.
grant select (description) on public.cars to anon;

-- ============================================================================
-- verify the intended end state
--
-- Everything below is a property this migration is supposed to have
-- established. Each one fails the run rather than leaving the database in a
-- shape the app quietly mis-reads.
-- ============================================================================
do $$
declare
  listing_count   integer;
  vehicle_count   integer;
  hidden_count    integer;
  unbacked        text;
  mismatched      integer;
  leaked          text;
begin
  select count(*) into listing_count from public.cars;
  select count(*) into vehicle_count from public.vehicles;
  select count(*) into hidden_count  from public.vehicles where not is_publicly_visible;

  -- 1. Every listing is backed by at least one physical car. A listing with no
  --    vehicle is unbookable and invisible in every availability query, which
  --    would look like the car simply vanishing from the site.
  select string_agg(c.id, ', ' order by c.id)
    into unbacked
    from public.cars c
   where not exists (select 1 from public.vehicles v where v.listing_id = c.id);

  if unbacked is not null then
    raise exception 'listings with no vehicle: %', unbacked;
  end if;

  -- 2. Every listing has exactly one publicly visible unit — the one in the
  --    photo. Two would make "prefer the visible one" ambiguous; none would
  --    make it undefined.
  select string_agg(c.id, ', ' order by c.id)
    into unbacked
    from public.cars c
   where (
     select count(*) from public.vehicles v
      where v.listing_id = c.id and v.is_publicly_visible
   ) <> 1;

  if unbacked is not null then
    raise exception
      'listings without exactly one publicly visible vehicle: %', unbacked;
  end if;

  -- 3. No booking's listing disagrees with its assigned vehicle. The composite
  --    FK enforces this going forward; this proves the backfill did too.
  select count(*)
    into mismatched
    from public.bookings b
    join public.vehicles v on v.id = b.vehicle_id
   where v.listing_id <> b.car_id;

  if mismatched > 0 then
    raise exception '% booking(s) point at a vehicle from another listing', mismatched;
  end if;

  -- 4. The guard is on the vehicle, and the old listing-level one is gone.
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_double_booking_vehicle'
  ) then
    raise exception 'the vehicle-level double-booking constraint was not created';
  end if;
  if exists (
    select 1 from pg_constraint where conname = 'bookings_no_double_booking'
  ) then
    raise exception 'the old listing-level double-booking constraint is still in place';
  end if;

  -- 5. Nothing about a physical car is readable with the publishable key.
  select string_agg(distinct privilege_type, ', ')
    into leaked
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name = 'vehicles';

  if leaked is not null then
    raise exception 'anon holds privileges on vehicles: %', leaked;
  end if;

  select string_agg(column_name, ', ' order by column_name)
    into leaked
    from information_schema.role_column_grants
   where grantee = 'anon'
     and table_schema = 'public'
     and table_name = 'vehicles';

  if leaked is not null then
    raise exception 'anon holds column privileges on vehicles: %', leaked;
  end if;

  raise notice
    'listings/vehicles split applied: % listings, % vehicles (% hidden).',
    listing_count, vehicle_count, hidden_count;
end;
$$;

-- PostgREST caches the schema, and every read in this app goes through it. The
-- cache is normally refreshed by Supabase's own DDL event trigger; asking
-- explicitly costs nothing and removes the "the table exists but the API 404s"
-- minute that otherwise follows a migration like this one.
notify pgrst, 'reload schema';
