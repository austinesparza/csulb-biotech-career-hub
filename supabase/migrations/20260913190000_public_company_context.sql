-- Surface officer-reviewed company context alongside public opportunities.
-- Company fields are appended to the existing view column order so dependent
-- SETOF functions retain the same relation identity and publication gates.

create or replace view public.public_opportunities as
select o.id, c.name as company_name, o.title, o.posting_url, o.location,
       o.eligibility, o.focus_area, o.deadline, o.deadline_text, o.start_date_text,
       o.paid_status, o.application_type, o.status, o.public_notes,
       o.relevance_score, o.last_checked_at, o.first_seen_at,
       s.name as source_name, o.audience_bucket, o.audience_reason,
       o.scientific_lanes, o.job_functions, o.methods, o.industry_context,
       o.graduate_stage, o.eligibility_status, o.eligibility_evidence,
       o.continued_enrollment_required, o.graduation_window_start,
       o.graduation_window_end, o.work_authorization, o.application_opened_at,
       o.date_basis, o.source_check_result, o.discovery_route,
       c.website as company_website,
       c.location as company_location,
       c.industry_tags as company_industry_tags,
       c.description as company_description
from public.opportunities o
join public.companies c on c.id = o.company_id and c.public_safe
left join public.source_records s on s.id = o.source_record_id and s.public_safe
where o.public_safe and o.review_status = 'approved'
  and o.status in ('open_verified','open_unverified')
  and (
    (o.audience_bucket = 'undergraduate' and o.graduate_stage = 'not_msc')
    or (
      o.audience_bucket in ('graduate', 'mixed')
      and o.graduate_stage in (
        'msc_year_1', 'msc_year_2', 'msc_any',
        'mixed_graduate', 'graduate_unspecified'
      )
    )
  )
  and o.eligibility_status in ('confirmed', 'possible');

grant select on public.public_opportunities to anon, authenticated;

comment on view public.public_opportunities is
  'Officer-approved public opportunities with reviewed company context; publication, audience, and eligibility gates remain enforced.';
