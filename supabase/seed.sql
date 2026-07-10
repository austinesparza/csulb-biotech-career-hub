-- Seed: canonical source record + starter career paths + demo data.
insert into source_records (name, source_type, owner, access_level, canonical_status, refresh_policy, public_safe, notes)
values
 ('Club Internship Spreadsheet', 'spreadsheet', 'VP of Career Development', 'officers',
  'primary', 'Officer exports CSV and imports monthly. Manual entry only; no automated collection from external sites.', true,
  'The original Google Sheet. Keep as source of record until fully migrated.'),
 ('Student Submissions Form', 'student_submission', 'Webmaster', 'public',
  'active', 'Reviewed as submitted; officer verifies link and details before approval.', true, null),
 ('Manual Officer Entry', 'manual', 'Any officer', 'officers',
  'active', 'Officers paste links they find; each is reviewed like any other record. For sites that prohibit automated access, this is the only entry path.', true, null);

insert into career_paths (name, slug, description, typical_roles, education_notes, sort_order, public_safe) values
 ('Industry & Operations', 'industry-operations', 'Roles at companies across manufacturing, quality, supply chain, and program coordination.', '{Operations Intern,Quality Assurance Intern,Program Coordinator}', 'Bachelor''s degree typically sufficient to start.', 1, true),
 ('Research & Development', 'research-development', 'University and company research roles and the paths that lead to them.', '{Research Assistant,R&D Intern}', 'Research experience and often graduate study.', 2, true),
 ('Business, Regulatory & Communication', 'business-regulatory', 'Business development, regulatory affairs, technical writing, and science communication.', '{Business Analyst Intern,Regulatory Affairs Intern,Technical Writer}', 'Varies widely; internships matter more than specific majors.', 3, true),
 ('Data & Computation', 'data-computation', 'Data analysis and software-adjacent roles.', '{Data Analyst Intern,Informatics Intern}', 'Programming coursework helps; portfolios matter.', 4, true);

-- Demo company + approved posting so the public board renders before first real import.
with c as (
  insert into companies (name, name_normalized, website, location, public_safe)
  values ('Example Biosciences', 'example biosciences', 'https://example.com', 'Long Beach, CA', true)
  returning id
), s as (select id from source_records where name = 'Manual Officer Entry')
insert into opportunities (company_id, source_record_id, title, posting_url, location, eligibility,
  focus_area, deadline, paid_status, application_type, status, review_status, public_safe,
  public_notes, last_checked_at, relevance_score, dedupe_key, family_key)
select c.id, s.id, 'Summer Operations Intern (DEMO ROW — delete after first import)',
  'https://example.com/careers/intern', 'Long Beach, CA', 'Undergraduates, all majors',
  'Operations', current_date + 60, 'paid', 'Online application',
  'open_verified', 'approved', true,
  'Demo record inserted by seed.sql.', now(), 78,
  'example biosciences|summer operations intern demo row delete after first import|https://example.com/careers/intern',
  'example biosciences|operations intern demo row delete after first import'
from c, s;
