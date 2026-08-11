-- ============================================================================
-- 0004 — the real price list: XCG, monthly rates, and length discounts.
--
-- Run with `supabase db push`, or paste into the Supabase SQL editor.
-- Idempotent: safe to re-run (see the guards on the repricing UPDATE).
--
-- WHAT THIS ADDS AND WHY
--
--   cars.monthly_rate       CW rents by the month as well as by the day, at a
--                           flat rate that is not 30 x the daily rate. That is a
--                           second price, not a derived one, so it is a second
--                           column. 0 means "this car is not offered monthly",
--                           which the booking flow reads as such rather than
--                           quoting a free month.
--
--   bookings.rental_type    Which product was sold. A 30-day daily rental and a
--                           monthly rental occupy the car identically and cost
--                           very differently; without this column the CRM cannot
--                           tell them apart after the fact, and neither can the
--                           owner reading a booking six months later.
--
--   bookings.discount_pct   The length discount that applied, and what it took
--   bookings.discount_cents off. Both STORED rather than re-derived: total_price
--                           is struck when the booking is taken, and a tier or a
--                           daily rate that changes later must not silently
--                           restate what a guest was actually charged.
--
-- CURRENCY. Amounts were always integer cents and still are; nothing about the
-- storage changes. What changes is what the numbers MEAN and how they print:
-- the site and the CRM now quote XCG (Caribbean guilder) throughout, formatted
-- in one place, src/lib/money.ts. There is no historical USD data to convert —
-- the placeholder rates below are being replaced wholesale with the real ones,
-- and no real booking has been taken through this database yet.
-- ============================================================================

set search_path = public, extensions;

-- ── cars: the second rate ───────────────────────────────────────────────────
alter table public.cars
  add column if not exists monthly_rate integer not null default 0
    check (monthly_rate >= 0);

comment on column public.cars.monthly_rate is
  'Cents for a ~30-day monthly rental. A flat price, NOT 30 x daily_rate. '
  '0 means this car is not offered on a monthly basis and the booking flow '
  'will not quote one.';

comment on column public.cars.daily_rate is
  'Cents per rental day, in XCG. Length discounts are applied on top of this '
  'by the server (see DISCOUNT_TIERS in src/lib/booking/rental.ts); this column '
  'is the undiscounted list rate.';

-- ── the real price list ─────────────────────────────────────────────────────
-- The rates in 0001 were explicitly placeholders "pending confirmation with
-- Clay". These are the confirmed ones, in XCG.
--
-- GUARDED so a re-run is a no-op rather than a repricing: each row only moves
-- while it still holds the placeholder it is replacing. An owner who edits a
-- rate in the CRM after this migration has run keeps their edit — re-running
-- must never quietly undo a deliberate change.
update public.cars set daily_rate =  6000 where id = 'chevrolet-spark-black' and daily_rate = 3500;
update public.cars set daily_rate =  7000 where id = 'nissan-versa-red'      and daily_rate = 4500;
update public.cars set daily_rate =  7000 where id = 'nissan-versa-silver'   and daily_rate = 4500;
update public.cars set daily_rate =  7000 where id = 'mazda-3-grey'          and daily_rate = 5200;
update public.cars set daily_rate = 10000 where id = 'hyundai-venue-red'     and daily_rate = 5500;

-- Monthly rates guard on 0, i.e. "never set". Same reasoning.
update public.cars set monthly_rate = 160000 where id = 'chevrolet-spark-black' and monthly_rate = 0;
update public.cars set monthly_rate = 190000 where id = 'nissan-versa-red'      and monthly_rate = 0;
update public.cars set monthly_rate = 190000 where id = 'nissan-versa-silver'   and monthly_rate = 0;
update public.cars set monthly_rate = 190000 where id = 'mazda-3-grey'          and monthly_rate = 0;
update public.cars set monthly_rate = 260000 where id = 'hyundai-venue-red'     and monthly_rate = 0;

-- ── bookings: which product, and what came off ──────────────────────────────
alter table public.bookings
  add column if not exists rental_type text not null default 'daily'
    check (rental_type in ('daily', 'monthly'));

alter table public.bookings
  add column if not exists discount_pct integer not null default 0
    check (discount_pct >= 0 and discount_pct <= 100);

alter table public.bookings
  add column if not exists discount_cents integer not null default 0
    check (discount_cents >= 0);

comment on column public.bookings.rental_type is
  'Which product was sold: a per-day rental (with any length discount applied) '
  'or a flat monthly rental. Not derivable from the dates — a 30-day daily '
  'rental and a monthly rental look the same on a calendar.';
comment on column public.bookings.discount_pct is
  'The length-discount tier that applied, 0 if none. Recorded as struck; the '
  'tiers in the app may change without restating what this guest was charged.';
comment on column public.bookings.discount_cents is
  'Cents taken off by that tier. total_price is already net of it, so the '
  'pre-discount figure is total_price + discount_cents.';

-- Existing rows are all daily and all undiscounted, which is what the column
-- defaults already say. Stated rather than assumed:
update public.bookings
   set rental_type = 'daily'
 where rental_type is null;

-- ── keep the public column grant complete ───────────────────────────────────
-- Migration 0003 replaced anon's table-wide SELECT on cars with a column list,
-- so the two internal columns cannot leak. A column ADDED after that grant is
-- not covered by it: without this line the public fleet display would be unable
-- to read the monthly rate it is meant to show.
--
-- monthly_rate is a public price. maintenance_notes and off_road_since remain
-- ungranted, and the check at the bottom still proves it.
grant select (monthly_rate) on public.cars to anon;

-- ── verify the intended end state ───────────────────────────────────────────
do $$
declare
  leaked   text;
  unpriced text;
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

  -- Every car on the road must have both rates, or the booking flow has a
  -- product it cannot price. Fails here rather than at a guest's checkout.
  select string_agg(id, ', ' order by id)
    into unpriced
    from public.cars
   where status = 'available'
     and (daily_rate = 0 or monthly_rate = 0);

  if unpriced is not null then
    raise exception 'cars on the road with a missing rate: %', unpriced;
  end if;
end;
$$;
