-- Add four new task_type enum values required by the automated ingestion workflow.
-- These values must be committed before 0003 uses them in constraints or application code.
-- Note: ALTER TYPE … ADD VALUE cannot be used in a transaction before the new value is referenced;
-- keep this migration separate and always apply it before 0003.

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_type' and e.enumlabel = 'source_new'
  ) then
    alter type public.task_type add value 'source_new';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_type' and e.enumlabel = 'source_changed'
  ) then
    alter type public.task_type add value 'source_changed';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_type' and e.enumlabel = 'source_reopened'
  ) then
    alter type public.task_type add value 'source_reopened';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_type' and e.enumlabel = 'source_health'
  ) then
    alter type public.task_type add value 'source_health';
  end if;
end
$$;
