-- ============================================================================
-- 0010 — after-care email, sent once.
--
-- Paste whole into the Supabase SQL editor. Idempotent: safe to re-run.
--
-- When an admin marks a booking Returned, the guest is sent a thank-you email
-- with a Google review link. It must go out exactly once per booking, however
-- many times the prep pipeline is moved back and forth afterwards.
--
-- WHAT THIS ADDS
--   bookings.aftercare_sent_at   when that email was accepted by the mail
--                                provider. Written ONLY after a successful
--                                send. NULL means "not sent": never returned
--                                yet, email not configured at the time, or the
--                                send failed (and may be retried by marking the
--                                booking Returned again).
-- ============================================================================

set search_path = public, extensions;

alter table public.bookings
  add column if not exists aftercare_sent_at timestamptz;

comment on column public.bookings.aftercare_sent_at is
  'When the after-care (thank you / review) email was successfully sent. NULL = not sent. Set once, never cleared.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'bookings'
       and column_name  = 'aftercare_sent_at'
       and is_nullable  = 'YES'
  ) then
    raise exception 'bookings.aftercare_sent_at is missing or not nullable';
  end if;
end $$;

notify pgrst, 'reload schema';
