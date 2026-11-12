-- ============================================================================
-- 0011 — one-time admin invite links.
--
-- Paste whole into the Supabase SQL editor. Idempotent: safe to re-run.
--
-- An invite is a link CW's owner can open once to choose their own login email
-- and password for the back office. It is minted out of band with the service
-- role key (scripts/create-admin.ts --invite) and redeemed at /admin/invite.
--
-- WHAT THIS ADDS
--   admin_invites   one row per link. Only the SHA-256 of the token is stored,
--                   so reading this table does not yield a usable link.
--                   used_at is the single-use lock: redeeming a link is one
--                   UPDATE ... WHERE used_at IS NULL, so two simultaneous
--                   attempts cannot both win.
--
-- RLS is on with NO policies: anon and signed-in users can do nothing here.
-- Only the service role (server code) reads or writes it.
-- ============================================================================

set search_path = public, extensions;

create table if not exists public.admin_invites (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by_email text,
  created_at    timestamptz not null default now()
);

comment on table public.admin_invites is
  'One-time links that let someone create an admin login. Service role only; token stored as a SHA-256 hash.';

alter table public.admin_invites enable row level security;

revoke all on public.admin_invites from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'admin_invites'
       and c.relrowsecurity
  ) then
    raise exception 'admin_invites is missing or RLS is not enabled';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'admin_invites'
  ) then
    raise exception 'admin_invites must have no RLS policies';
  end if;
end $$;

notify pgrst, 'reload schema';
