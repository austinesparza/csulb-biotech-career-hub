-- Tighten two pre-existing helper-function permissions without changing the
-- officer RLS contract or the intentionally public projection views.

alter function public.set_updated_at()
  set search_path = public, pg_temp;

revoke execute on function public.is_officer() from public, anon;
grant execute on function public.is_officer() to authenticated, service_role;

comment on function public.is_officer() is
  'Returns whether the current authenticated user is an active officer. Anonymous RPC execution is disabled; authenticated execution is required by officer RLS policies.';
