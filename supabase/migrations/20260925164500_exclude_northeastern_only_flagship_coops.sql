-- The employer's Flagship Pioneering Co-Op Program board explicitly limits
-- every posting on this board to current Northeastern University students.
-- Preserve previously recorded postings and decisions, but clear ineligible
-- drafts and their tasks from the CSULB officer queue. This does not affect
-- other Flagship company boards with different hiring rules.

do $$
begin
  if exists (
    select 1 from public.job_sources
    where source_kind = 'greenhouse'
      and source_identifier = 'fspco-op012325'
      and (enabled or automatic_scheduling_paused_at is null)
  ) then
    raise exception 'Flagship co-op source must be disabled and paused before queue cleanup';
  end if;
  if exists (
    select 1 from public.opportunities
    where posting_url like 'https://job-boards.greenhouse.io/fspco-op012325/%'
      and public_safe and review_status = 'approved'
      and status in ('open_verified', 'open_unverified')
  ) then
    raise exception 'Public Flagship co-op records require individual correction before cleanup';
  end if;
end $$;

-- Keep the known restricted board disabled even if its policy checkboxes are
-- accidentally marked complete. Include the configured token override used by
-- the Greenhouse connector, not just the source_identifier column.
alter table public.job_sources
  add constraint job_sources_no_northeastern_only_flagship_coop
  check (
    not enabled or source_kind <> 'greenhouse' or (
      source_identifier is distinct from 'fspco-op012325'
      and config_json ->> 'boardToken' is distinct from 'fspco-op012325'
    )
  );

update public.opportunities
set status = 'archive_only',
    review_status = 'rejected',
    public_safe = false,
    audience_bucket = 'special',
    audience_reason = 'Only current Northeastern University Co-Op students may apply through the Flagship Pioneering Co-Op Program board.',
    eligibility_status = 'not_eligible',
    eligibility_evidence = 'Official Flagship co-op board and individual posting: current Northeastern University Co-Op students only.',
    private_notes = concat_ws(
      E'\n', nullif(private_notes, ''),
      '2026-09-25 source-policy cleanup: archived outside the CSULB board because the official Flagship Pioneering Co-Op Program is limited to Northeastern University students. Prior review decisions and source observations retained.'
    )
where posting_url like 'https://job-boards.greenhouse.io/fspco-op012325/%'
  and status = 'needs_review'
  and review_status = 'pending'
  and not public_safe;

update public.review_tasks rt
set status = 'dismissed',
    resolved_at = now(),
    notes = concat_ws(
      E'\n', nullif(rt.notes, ''),
      '2026-09-25 source-policy cleanup: Northeastern-only Flagship co-op board; candidate retained outside CSULB review.'
    ),
    decision_json = coalesce(rt.decision_json, '{}'::jsonb) || jsonb_build_object(
      'decision', 'source_policy_exclusion',
      'source_identifier', 'fspco-op012325',
      'evidence_url', 'https://job-boards.greenhouse.io/fspco-op012325',
      'reason', 'Current Northeastern University Co-Op students only; source disabled and paused.'
    )
where rt.status in ('open', 'in_progress')
  and (
    (rt.entity_table = 'source_postings' and rt.entity_id in (
      select sp.id from public.source_postings sp
      join public.job_sources js on js.id = sp.job_source_id
      where js.source_kind = 'greenhouse' and js.source_identifier = 'fspco-op012325'
    ))
    or (rt.entity_table = 'opportunities' and rt.entity_id in (
      select o.id from public.opportunities o
      where o.posting_url like 'https://job-boards.greenhouse.io/fspco-op012325/%'
        and not o.public_safe
    ))
  );
