-- ============================================================================
-- 0006 — retire the Hyundai Venue (listing 'hyundai-venue-red').
--
-- Run with `supabase db push`, or paste whole into the Supabase SQL editor.
-- Idempotent: safe to re-run. Once the rows are gone every statement below is a
-- no-op and the verification block still passes.
--
-- DELETE, NOT HIDE, AND WHY THAT IS SAFE HERE
-- The Venue is leaving the fleet for good, not going to the shop, so the
-- standing-availability tool (vehicles.status = 'offline') is the wrong one: it
-- would keep the listing in the CRM and in every fleet count indefinitely.
--
-- A hard delete is only correct while NO booking has ever referenced the car.
-- Bookings are the one thing that points at cars and vehicles (car_id and the
-- composite bookings_vehicle_listing_fkey, both ON DELETE RESTRICT), and a past
-- rental is history the CRM's revenue, client and fleet pages read back. Checked
-- on 2026-09-30 against the live project: zero bookings in the database at all,
-- so nothing is lost.
--
-- The guard below re-checks that at run time rather than trusting the note
-- above. If a booking has appeared since, the migration stops WITHOUT deleting
-- anything — the right move then is to take the vehicle offline instead
-- (vehicles.status = 'offline' from the CRM fleet page), which keeps the
-- history intact. The RESTRICT foreign keys would refuse the delete anyway; the
-- guard just says why in plain words.
--
-- Order matters: vehicles first (vehicles.listing_id references cars, also
-- RESTRICT), then the listing.
--
-- The public site's fleet grid is static content in src/content/brand.ts and
-- drops the Venue in the same change as this file.
-- ============================================================================

set search_path = public, extensions;

do $$
declare
  booked integer;
begin
  select count(*)
    into booked
    from public.bookings b
   where b.car_id = 'hyundai-venue-red'
      or b.vehicle_id in (
           select v.id from public.vehicles v where v.listing_id = 'hyundai-venue-red'
         );

  if booked > 0 then
    raise exception
      'hyundai-venue-red has % booking(s) on record. Not deleting: take its '
      'vehicle offline instead so the rental history survives.', booked;
  end if;
end;
$$;

delete from public.vehicles where listing_id = 'hyundai-venue-red';
delete from public.cars     where id         = 'hyundai-venue-red';

-- ── verify the intended end state ──────────────────────────────────────────
-- The Venue is gone, and the invariants 0005 established still hold for every
-- listing that remains: each is backed by exactly one publicly visible vehicle.
do $$
declare
  leftover  integer;
  unbacked  text;
begin
  select (select count(*) from public.cars     where id         = 'hyundai-venue-red')
       + (select count(*) from public.vehicles where listing_id = 'hyundai-venue-red')
    into leftover;

  if leftover > 0 then
    raise exception 'hyundai-venue-red still has % row(s) in cars/vehicles', leftover;
  end if;

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

  raise notice 'Hyundai Venue retired: % listings remain.',
    (select count(*) from public.cars);
end;
$$;

notify pgrst, 'reload schema';
