-- Normalize public opportunity metadata after reviewing the currently live source
-- pages. Match on stable company/title text, not generated UUIDs. This migration
-- corrects stale verification flags and fills structured fields that are already
-- explicit in the public source material.

-- MD Anderson: the employer page is live and explicitly includes master's
-- students. It does not state a deadline or Summer 2027 start date.
update public.opportunities o
set status = 'open_verified',
    source_check_result = 'open',
    last_checked_at = now(),
    application_opened_at = date '2026-07-29',
    eligibility_status = 'confirmed',
    graduate_stage = 'msc_any',
    deadline_text = null,
    start_date_text = null,
    public_notes = 'Employer posting does not state a Summer 2027 start date or application deadline; confirm timing before tailoring materials.',
    updated_at = now()
from public.companies c
where c.id = o.company_id
  and c.name = 'MD Anderson Cancer Center'
  and o.title = 'Research Intern - Thoracic/Head & Neck Medical Oncology'
  and o.public_safe
  and o.review_status = 'approved';

-- CAS: the current source is a LinkedIn job listing, not an employer-owned
-- application page. Preserve unknown compensation because the source does not
-- state pay. Capture the explicit degree, methods, and work-authorization text.
update public.opportunities o
set application_type = 'LinkedIn job posting',
    source_check_result = 'open',
    last_checked_at = now(),
    deadline_text = null,
    eligibility = 'Pursuing a degree in bioinformatics, computational biology, biostatistics, or a closely related field',
    work_authorization = 'U.S. work authorization required; no current or future sponsorship',
    job_functions = array['Computational and analysis']::text[],
    methods = array['R', 'Python', 'Linux', 'GitHub']::text[],
    updated_at = now()
from public.companies c
where c.id = o.company_id
  and c.name = 'CAS'
  and o.title = '2027 Bioinformatics Scientist Summer Intern'
  and o.public_safe
  and o.review_status = 'approved';

-- Amgen Process Development: the official posting states continued enrollment,
-- completion of the first master's year before the internship, an Aug. 31, 2026
-- posting date, and U.S. work authorization for the program.
update public.opportunities o
set source_check_result = 'open',
    last_checked_at = now(),
    application_opened_at = date '2026-08-31',
    continued_enrollment_required = true,
    graduate_stage = 'msc_year_2',
    work_authorization = 'Authorized to work in the U.S. during the program; future full-time sponsorship is not guaranteed',
    updated_at = now()
from public.companies c
where c.id = o.company_id
  and c.name = 'Amgen'
  and o.title = 'Grad Intern - Operations Process Development - Summer 2027'
  and o.public_safe
  and o.review_status = 'approved';

-- Current employer pages state Summer 2027 duration/timing for these roles.
update public.opportunities o
set start_date_text = case
      when c.name = 'Amgen'
       and o.title = 'Grad Intern - Operations - Engineering (Summer 2027)'
        then 'Summer 2027 (approximately 13 weeks)'
      when c.name = 'Amgen'
       and o.title = 'Operations Graduate Program - Summer 2027 Internship'
        then 'Summer 2027 (approximately 13 weeks)'
      when c.name = 'Johnson & Johnson'
       and o.title = 'Research & Development Leadership Development Program (RDLDP) - Summer 2027 Internship'
        then 'Summer 2027 (12 weeks)'
      when c.name = 'Johnson & Johnson'
       and o.title = 'Technology 2027 Fall Co-Op'
        then 'June 21-Dec 17, 2027'
      else o.start_date_text
    end,
    updated_at = now()
from public.companies c
where c.id = o.company_id
  and o.public_safe
  and o.review_status = 'approved'
  and (
    (c.name = 'Amgen' and o.title in (
      'Grad Intern - Operations - Engineering (Summer 2027)',
      'Operations Graduate Program - Summer 2027 Internship'
    ))
    or (c.name = 'Johnson & Johnson' and o.title in (
      'Research & Development Leadership Development Program (RDLDP) - Summer 2027 Internship',
      'Technology 2027 Fall Co-Op'
    ))
  );

-- Ginkgo postings are explicitly internships. The Automation Scientist page also
-- states that no college degree is necessary if the candidate has relevant
-- coding, biology, or computational-biology skills.
update public.opportunities o
set application_type = 'Internship',
    eligibility = case
      when o.title = 'Automation Scientist Intern, RAC Operations'
        then 'No college degree necessary; relevant coding, biology, or computational biology skills required'
      else o.eligibility
    end,
    audience_reason = case
      when o.title = 'Automation Scientist Intern, RAC Operations'
        then 'The employer posting does not require a college degree and accepts relevant coding, biology, or computational biology skills.'
      else o.audience_reason
    end,
    eligibility_evidence = case
      when o.title = 'Automation Scientist Intern, RAC Operations'
        then 'The employer posting does not require a college degree and accepts relevant coding, biology, or computational biology skills.'
      else o.eligibility_evidence
    end,
    updated_at = now()
from public.companies c
where c.id = o.company_id
  and c.name = 'Ginkgo Bioworks'
  and o.title in (
    'Software Graduate Intern, Autonomous Lab',
    'Software Intern, Autonomous Lab',
    'Automation Scientist Intern, RAC Operations'
  )
  and o.public_safe
  and o.review_status = 'approved';
