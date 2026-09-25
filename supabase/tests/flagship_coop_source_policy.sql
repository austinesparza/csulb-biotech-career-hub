\set ON_ERROR_STOP on

begin;

do $$
declare
  v_record uuid;
  v_source uuid;
begin
  insert into public.source_records (name, source_type)
  values ('Flagship policy test', 'website_page')
  returning id into v_record;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, source_identifier,
    careers_url, terms_reviewed, terms_review_date, robots_reviewed
  ) values (
    v_record, 'Flagship policy test', 'greenhouse', 'fspco-op012325',
    'https://job-boards.greenhouse.io/fspco-op012325', true, current_date, true
  ) returning id into v_source;

  begin
    update public.job_sources set enabled = true where id = v_source;
    raise exception 'Northeastern-only board was enabled through source_identifier';
  exception when check_violation then
    null;
  end;

  update public.job_sources
  set source_identifier = 'alias', config_json = '{"boardToken":"fspco-op012325"}'::jsonb
  where id = v_source;
  begin
    update public.job_sources set enabled = true where id = v_source;
    raise exception 'Northeastern-only board was enabled through config_json';
  exception when check_violation then
    null;
  end;

  update public.job_sources
  set source_identifier = 'different-employer', config_json = '{}'::jsonb, enabled = true
  where id = v_source;
  if not exists (select 1 from public.job_sources where id = v_source and enabled) then
    raise exception 'unrelated Greenhouse board was blocked';
  end if;
end $$;

rollback;
