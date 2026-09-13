-- Flagship's first production review happened before PR #79 corrected the
-- co-op audience classifier. Eight scientifically relevant co-ops were rejected
-- while the machine evidence incorrectly labeled their audience `adjacent`.
--
-- Reopen only that bounded historical cohort. The predicate requires the
-- original governed source, the pre-fix rejected source_new decision, a still-
-- open source posting, and the old adjacent audience value. Nothing is
-- published here; every record returns to officer review.

with affected as (
  select
    o.id as opportunity_id,
    sp.id as source_posting_id,
    sp.external_posting_id,
    case sp.external_posting_id
      when '8781861002' then 'mixed'::public.audience_bucket
      when '8783751002' then 'mixed'::public.audience_bucket
      when '8786276002' then 'mixed'::public.audience_bucket
      when '8790041002' then 'undergraduate'::public.audience_bucket
      when '8769080002' then 'graduate'::public.audience_bucket
      else 'unknown'::public.audience_bucket
    end as corrected_audience_bucket,
    case sp.external_posting_id
      when '8781861002' then 'msc_any'::public.graduate_stage
      when '8783751002' then 'msc_any'::public.graduate_stage
      when '8786276002' then 'msc_any'::public.graduate_stage
      when '8790041002' then 'not_msc'::public.graduate_stage
      when '8769080002' then 'msc_any'::public.graduate_stage
      else 'unknown'::public.graduate_stage
    end as corrected_graduate_stage,
    case sp.external_posting_id
      when '8781861002' then 'Official Flagship posting explicitly accepts students enrolled in a B.S. or M.S. program.'
      when '8783751002' then 'Official Flagship posting explicitly accepts students enrolled in a B.S. or M.S. program.'
      when '8786276002' then 'Official Flagship posting explicitly accepts students pursuing a BS or MS in a relevant bioscience field.'
      when '8790041002' then 'Official Flagship posting explicitly targets students currently pursuing an undergraduate degree in a relevant bioscience field.'
      when '8769080002' then 'Official Flagship posting explicitly requires enrollment in a master''s degree program in computer science, machine learning, or a related field.'
      else 'Degree level is not explicit in the authoritative posting; officer verification is required.'
    end as corrected_audience_reason
  from public.job_sources js
  join public.source_postings sp
    on sp.job_source_id = js.id
  join public.opportunity_source_links osl
    on osl.source_posting_id = sp.id
   and osl.is_primary
  join public.opportunities o
    on o.id = osl.opportunity_id
  join public.review_tasks rt
    on rt.entity_table = 'source_postings'
   and rt.entity_id = sp.id
   and rt.task_type = 'source_new'
  where js.source_identifier = 'fspco-op012325'
    and sp.external_posting_id in (
      '8781861002',
      '8783751002',
      '8786276002',
      '8790041002',
      '8766460002',
      '8766387002',
      '8769080002',
      '8783960002'
    )
    and sp.current_status in ('open', 'reopened')
    and coalesce(sp.relevance_score, 0) >= 35
    and o.status = 'not_relevant'
    and o.review_status = 'rejected'
    and not o.public_safe
    and rt.status = 'dismissed'
    and rt.resolved_at < '2026-09-13T18:52:50Z'::timestamptz
    and rt.decision_json ->> 'decision' = 'reject'
    and rt.decision_json ->> 'target_status' = 'not_relevant'
    and rt.decision_json ->> 'audience_bucket' = 'adjacent'
), reopened as (
  update public.opportunities o
  set status = 'needs_review',
      review_status = 'pending',
      public_safe = false,
      audience_bucket = a.corrected_audience_bucket,
      audience_reason = a.corrected_audience_reason,
      graduate_stage = a.corrected_graduate_stage,
      eligibility_status = case
        when a.corrected_audience_bucket in ('undergraduate', 'graduate', 'mixed')
          then 'possible'::public.eligibility_status
        else 'unknown'::public.eligibility_status
      end,
      private_notes = concat_ws(
        E'\n',
        nullif(o.private_notes, ''),
        'Reopened automatically after the co-op audience-classification defect fixed in PR #79. Previous rejection is retained in the resolved source_new task audit trail; officer review is still required.'
      )
  from affected a
  where o.id = a.opportunity_id
  returning a.source_posting_id
)
insert into public.review_tasks(
  task_type,
  entity_table,
  entity_id,
  status,
  priority,
  due_date,
  notes
)
select
  'source_reopened',
  'source_postings',
  r.source_posting_id,
  'open',
  90,
  current_date,
  '[audience_classifier_repair] Candidate was rejected before PR #79 corrected co-op audience classification. Re-evaluate the live authoritative posting; no publication state was changed.'
from reopened r
on conflict do nothing;
