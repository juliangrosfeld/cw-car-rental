-- ============================================================================
-- 0007 — driver's license photos.
--
-- Run with `supabase db push`, or paste whole into the Supabase SQL editor.
-- Idempotent: safe to re-run. Every statement is guarded, and the verification
-- block at the end re-checks the end state on every run.
--
-- WHAT THIS ADDS
--   clients.license_photo_path   the Storage object key of the guest's license
--                                photo, inside the bucket below. license_number
--                                and license_expiry already exist (0001) and
--                                are now written by the booking wizard too.
--   storage bucket license-photos   PRIVATE. These are ID documents.
--
-- WHY THERE ARE NO storage.objects POLICIES
-- The browser never gets standing access to this bucket, not even INSERT. The
-- booking server function mints a one-time SIGNED UPLOAD URL for a path it
-- chose itself (createSignedUploadUrl, service role), and the browser uploads
-- with that token. Signed uploads are authorised by the token, not by RLS, so
-- with RLS on and zero policies:
--   anon / authenticated   cannot list, read, overwrite or delete anything;
--   service role           (server only) reads them for the CRM.
-- A public bucket, or an anon INSERT policy, would have let anyone on the
-- internet fill the bucket or, worse, read other guests' licenses.
--
-- The bucket-level limits are the second fence: images only, 10 MB max, both
-- enforced by Storage itself on every upload, signed or not.
-- ============================================================================

set search_path = public, extensions;

alter table public.clients
  add column if not exists license_photo_path text;

comment on column public.clients.license_photo_path is
  'Object key in the private license-photos Storage bucket. Read via a signed URL from the server; never public.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'license-photos',
  'license-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── verify the intended end state ──────────────────────────────────────────
do $$
declare
  bucket_public boolean;
  open_policies text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'clients'
       and column_name  = 'license_photo_path'
  ) then
    raise exception 'clients.license_photo_path is missing';
  end if;

  select public into bucket_public from storage.buckets where id = 'license-photos';
  if bucket_public is null then
    raise exception 'storage bucket license-photos is missing';
  end if;
  if bucket_public then
    raise exception 'storage bucket license-photos is PUBLIC; it must be private';
  end if;

  -- Any policy on storage.objects that mentions this bucket would reopen what
  -- the header says is closed. Fail loudly rather than ship a hole.
  select string_agg(policyname, ', ')
    into open_policies
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%license-photos%';

  if open_policies is not null then
    raise exception 'storage.objects has policies touching license-photos: %', open_policies;
  end if;
end;
$$;
