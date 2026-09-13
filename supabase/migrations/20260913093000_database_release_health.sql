-- Production migration-drift visibility for the officer operations dashboard.
-- This exposes migration metadata only to the service role and never applies DDL.

create or replace function public.database_release_health(
  p_expected_migration_name text
)
returns table (
  expected_migration_name text,
  expected_applied boolean,
  latest_applied_name text,
  applied_migration_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_expected_migration_name is null
     or trim(p_expected_migration_name) = ''
     or char_length(p_expected_migration_name) > 200 then
    raise exception 'database_release_health: expected migration name is required';
  end if;

  return query
  select
    trim(p_expected_migration_name),
    exists (
      select 1
      from supabase_migrations.schema_migrations sm
      where sm.name = trim(p_expected_migration_name)
    ),
    (
      select sm.name
      from supabase_migrations.schema_migrations sm
      order by sm.version desc
      limit 1
    ),
    (
      select count(*)::bigint
      from supabase_migrations.schema_migrations sm
    );
end;
$$;

revoke execute on function public.database_release_health(text) from public, anon, authenticated;
grant execute on function public.database_release_health(text) to service_role;

comment on function public.database_release_health(text) is
  'Service-role-only migration drift check used by the officer operations dashboard. It reports whether the application-required migration has been applied and never changes schema state.';
