-- Provision the private source-payloads storage bucket.
-- This step is kept in a separate migration so bucket state can be verified
-- independently of the schema tables in 0003.
--
-- Design decisions:
--   public = false       — bucket contents are not accessible to anon or authenticated
--                          without explicit service_role operations.
--   file_size_limit      — 50 MiB (52428800 bytes) per object; sufficient for a
--                          full JSON job-board response while preventing runaway uploads.
--
-- Access model (Phase 1):
--   No RLS policies on storage.objects are created in this migration.
--   service_role bypasses Supabase Storage RLS and is the only principal that
--   reads or writes payload objects in Phase 1 workers.
--   The future admin interface will retrieve payloads through authenticated
--   server-side actions that use a service_role Supabase client after requireOfficer().
--   Direct browser access by officers is not enabled in Phase 1.
--
-- Verification: after applying, confirm in Supabase Dashboard → Storage that the
-- bucket 'source-payloads' is listed as Private with no public access policies.

insert into storage.buckets (id, name, public, file_size_limit)
values ('source-payloads', 'source-payloads', false, 52428800)
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit,
      name            = excluded.name;
