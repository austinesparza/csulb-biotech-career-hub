-- Classify who can realistically use each opportunity.
-- This is intentionally independent of relevance_score: a scientifically relevant
-- posting can still be inaccessible to the students served by the club.

do $$ begin
  create type audience_bucket as enum (
    'undergraduate',
    'graduate',
    'mixed',
    'special',
    'adjacent',
    'ineligible',
    'unknown'
  );
exception when duplicate_object then null;
end $$;

alter table opportunities
  add column if not exists audience_bucket audience_bucket not null default 'unknown',
  add column if not exists audience_reason text;

create index if not exists idx_opportunities_audience
  on opportunities(audience_bucket, status, review_status, public_safe);

comment on column opportunities.audience_bucket is
  'Officer-reviewed audience: undergraduate, graduate, mixed, special eligibility, adjacent term/format, ineligible, or unknown.';
comment on column opportunities.audience_reason is
  'Concise evidence-based explanation for the audience classification. Required by the application before approval.';

-- Preserve the existing public contract and append the two audience fields.
-- Ineligible records remain stored for audit/history but can never enter the
-- student-facing public view.
create or replace view public_opportunities as
select o.id, c.name as company_name, o.title, o.posting_url, o.location,
       o.eligibility, o.focus_area, o.deadline, o.deadline_text, o.start_date_text,
       o.paid_status, o.application_type, o.status, o.public_notes,
       o.relevance_score, o.last_checked_at, o.first_seen_at,
       s.name as source_name, o.audience_bucket, o.audience_reason
from opportunities o
join companies c on c.id = o.company_id
left join source_records s on s.id = o.source_record_id and s.public_safe
where o.public_safe and o.review_status = 'approved'
  and o.status in ('open_verified','open_unverified')
  and o.audience_bucket <> 'ineligible';

grant select on public_opportunities to anon, authenticated;
