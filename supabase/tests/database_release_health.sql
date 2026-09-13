-- Production migration-drift contract.

do $$
begin
  if to_regprocedure('public.database_release_health(text)') is null then
    raise exception 'database_release_health(text) is missing';
  end if;

  if has_function_privilege('anon', 'public.database_release_health(text)', 'EXECUTE') then
    raise exception 'anon must not execute database_release_health';
  end if;

  if has_function_privilege('authenticated', 'public.database_release_health(text)', 'EXECUTE') then
    raise exception 'authenticated must not execute database_release_health directly';
  end if;

  if not has_function_privilege('service_role', 'public.database_release_health(text)', 'EXECUTE') then
    raise exception 'service_role must execute database_release_health';
  end if;

  if not exists (
    select 1
    from public.database_release_health('database_release_health')
    where expected_applied
      and applied_migration_count > 0
  ) then
    raise exception 'database release health must recognize its own applied migration';
  end if;
end
$$;
