-- ============================================================================
-- 0008 — record when a guest accepted the Terms & Conditions.
--
-- Paste whole into the Supabase SQL editor. Idempotent: safe to re-run.
--
-- WHAT THIS ADDS
--   bookings.accepted_terms_at   the moment the guest ticked "I have read and
--                                accept the Terms & Conditions." on the booking
--                                wizard. Stamped by the SERVER at insert, only
--                                when the request carried the acceptance.
--
-- NULLABLE ON PURPOSE. Bookings made before this existed, and bookings an admin
-- takes by hand (where the guest signs the paper agreement instead), have no
-- online acceptance, and NULL says exactly that.
-- ============================================================================

set search_path = public, extensions;

alter table public.bookings
  add column if not exists accepted_terms_at timestamptz;

comment on column public.bookings.accepted_terms_at is
  'When the guest accepted the Terms & Conditions in the booking wizard. NULL for admin-made and pre-existing bookings.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'bookings'
       and column_name  = 'accepted_terms_at'
       and is_nullable  = 'YES'
  ) then
    raise exception 'bookings.accepted_terms_at is missing or not nullable';
  end if;
end $$;

notify pgrst, 'reload schema';
