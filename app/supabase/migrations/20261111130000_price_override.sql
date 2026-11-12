-- ============================================================================
-- 0009 — admin-set custom prices on manual bookings.
--
-- Paste whole into the Supabase SQL editor. Idempotent: safe to re-run.
--
-- An admin taking a booking by hand may now set their own total instead of the
-- price list's. The public booking wizard cannot: its server function has no
-- price field and never writes these columns.
--
-- WHAT THIS ADDS (all nullable, all NULL on every normal booking)
--   bookings.price_override_cents   the custom total the admin typed, in cents.
--                                   NOT NULL means "this booking was priced by
--                                   hand". Always equals total_price at insert.
--   bookings.price_override_note    why, in the admin's words. Optional.
--   bookings.standard_price_cents   what the price list would have charged for
--                                   the same car and dates, captured at the
--                                   moment of booking. Kept so "custom price,
--                                   standard would have been X" stays true
--                                   after the car's rates change.
--
-- total_price is unchanged in meaning: it is still the FINAL total the guest
-- owes, which is what payments, the ledger and every revenue figure read.
-- ============================================================================

set search_path = public, extensions;

alter table public.bookings
  add column if not exists price_override_cents integer,
  add column if not exists price_override_note  text,
  add column if not exists standard_price_cents integer;

comment on column public.bookings.price_override_cents is
  'Custom total set by an admin on a manual booking, in cents. NULL = priced from the price list.';
comment on column public.bookings.price_override_note is
  'Optional reason for the custom price. Internal.';
comment on column public.bookings.standard_price_cents is
  'What the price list would have charged, captured when a custom price was set. NULL otherwise.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'bookings_price_override_positive'
       and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_price_override_positive
      check (price_override_cents is null or price_override_cents > 0);
  end if;

  -- A custom price always records the standard it replaced, and nothing else
  -- carries a standard price.
  if not exists (
    select 1 from pg_constraint
     where conname = 'bookings_price_override_has_standard'
       and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_price_override_has_standard
      check ((price_override_cents is null) = (standard_price_cents is null));
  end if;
end $$;

-- ── verify the intended end state ──────────────────────────────────────────
do $$
declare
  missing text;
begin
  select string_agg(c, ', ') into missing
    from unnest(array['price_override_cents', 'price_override_note', 'standard_price_cents']) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'bookings'
        and column_name = c and is_nullable = 'YES'
   );
  if missing is not null then
    raise exception 'bookings is missing nullable column(s): %', missing;
  end if;
end $$;

notify pgrst, 'reload schema';
