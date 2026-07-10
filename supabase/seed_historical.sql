-- Historical archive: past internship cycles, integrated as archive_only.
-- Sources:
--   1. "2024-2025 Internship Repository" blog post (csulbbiotech.com)
--   2. 2025-2026 internship tracking sheet (Google Sheets)
-- Run AFTER 0001_init.sql and seed.sql. Idempotent-ish: companies use
-- on conflict do nothing; re-running may duplicate opportunities, so run once.
--
-- Policy: archive records are review_status='approved' but public_safe=false
-- and status='archive_only', so they never appear on the student board.
-- Their COMPANIES are public_safe=true, which is what populates the
-- "historical record" Company Directory. Unknown-company rows stay private.

insert into source_records (name, source_type, url, owner, access_level, canonical_status, refresh_policy, public_safe, notes) values
 ('2024-2025 Internship Repository (website post)', 'website_page',
  'https://www.csulbbiotech.com/post/2024-2025-internship-repository',
  'Club officers', 'public', 'archived',
  'Frozen historical post; no refresh. Links were live during the 2024-2025 cycle.', true,
  'Curated posting list published on the club website.'),
 ('2025-2026 Internship Tracking Sheet', 'spreadsheet',
  'https://docs.google.com/spreadsheets/d/18d20pJqen1NaGb1cD206znmzlz_V9Fiq',
  'Club officers', 'officers', 'archived',
  'Cycle complete; archived. Manual re-export only.', true,
  'The officer-maintained tracker for the 2025-2026 cycle.');

-- ============ COMPANIES ============
insert into companies (name, name_normalized, location, public_safe) values
 ('Zymo Research', 'zymo research', 'Irvine, CA', true),
 ('LabRoots', 'labroots', null, true),
 ('Genentech', 'genentech', 'South San Francisco, CA', true),
 ('Merck', 'merck', null, true),
 ('Fujifilm Diosynth', 'fujifilm diosynth', null, true),
 ('SCAN Health Plan', 'scan health plan', 'Long Beach, CA', true),
 ('BioMarin', 'biomarin', 'San Rafael, CA', true),
 ('Metrex', 'metrex', null, true),
 ('3M', '3m', 'Maplewood, MN', true),
 ('Sanofi', 'sanofi', 'Cambridge, MA', true),
 ('Johnson and Johnson', 'johnson and johnson', null, true),
 ('Johnson and Johnson Innovative Medicine', 'johnson and johnson innovative medicine', 'San Diego, CA', true),
 ('Varda Space Industries', 'varda space industries', 'El Segundo, CA', true),
 ('Terasaki Institute', 'terasaki institute', 'Los Angeles, CA', true),
 ('Orange County Coastkeeper', 'orange county coastkeeper', 'Costa Mesa, CA', true),
 ('LabCorp', 'labcorp', 'San Diego, CA', true),
 ('Amgen', 'amgen', 'Thousand Oaks, CA', true),
 ('Enthalpy Analytical', 'enthalpy analytical', 'Anaheim, CA', true),
 ('Cedars Sinai', 'cedars sinai', 'Los Angeles, CA', true),
 ('GE Healthcare', 'ge healthcare', null, true),
 ('Salk Institute', 'salk institute', 'La Jolla, CA', true),
 ('AbbVie', 'abbvie', 'North Chicago, IL', true),
 ('Henkel', 'henkel', 'Irvine, CA', true),
 ('DeciBio', 'decibio', 'Los Angeles, CA', true),
 ('Thermo Fisher', 'thermo fisher', 'Pleasanton, CA', true),
 ('Bristol Meyers Squibb', 'bristol meyers squibb', 'Princeton, NJ', true),
 ('Arcus Biosciences', 'arcus biosciences', 'Hayward, CA', true),
 ('Septerna', 'septerna', 'South San Francisco, CA', true),
 ('AstraZeneca', 'astrazeneca', 'Gaithersburg, MD', true),
 ('Cytokinetics', 'cytokinetics', 'South San Francisco, CA', true),
 ('Simtra BioPharma Solutions', 'simtra biopharma solutions', 'Bloomington, IN', true),
 ('Not recorded (LinkedIn posting)', 'not recorded linkedin posting', null, false)
on conflict (name_normalized) do nothing;

-- ============ HELPER ============
create or replace function _hist(
  p_source text, p_company_norm text, p_title text, p_url text,
  p_location text, p_eligibility text, p_focus text,
  p_deadline_text text, p_start text, p_paid paid_status,
  p_app_type text, p_notes text, p_date_added date
) returns void language sql as $$
  insert into opportunities (
    company_id, source_record_id, title, posting_url, location, eligibility,
    focus_area, deadline, deadline_text, start_date_text, paid_status,
    application_type, status, review_status, public_safe, public_notes, date_added,
    last_checked_at
  )
  select c.id, s.id, p_title, p_url, p_location, p_eligibility, p_focus,
         null, p_deadline_text, p_start, p_paid, p_app_type,
         'archive_only', 'approved', false, p_notes, p_date_added, now()
  from companies c, source_records s
  where c.name_normalized = p_company_norm and s.name = p_source
$$;

-- ============ 2024-2025 REPOSITORY (blog post) ============
select _hist('2024-2025 Internship Repository (website post)', 'zymo research', 'Research Intern - RNA Analysis', 'https://app.trinethire.com/companies/22866-zymo-research-corporation/jobs/105750-research-intern-rna-analysis', 'Irvine, CA', null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'zymo research', 'Research Intern - Protein Group', 'https://app.trinethire.com/companies/22866-zymo-research-corporation/jobs/105645-research-intern-protein-group', 'Irvine, CA', null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'zymo research', 'Quality Assurance Intern', 'https://app.trinethire.com/companies/22866-zymo-research-corporation/jobs/105676-quality-assurance-intern', 'Irvine, CA', null, 'Quality Assurance', 'Closed (2024-2025 cycle)', null, 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'zymo research', 'Research Intern - Microbiome', 'https://app.trinethire.com/companies/22866-zymo-research-corporation/jobs/105682-research-intern-microbiome', 'Irvine, CA', null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'labroots', 'Science Communication Research Intern', 'https://www.labroots.com/careers/research-intern', null, null, 'Science Communication', 'Closed (2024-2025 cycle)', null, 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'genentech', '2025 Summer Intern - Molecular Lab Research and Early Development', 'https://careers.gene.com/us/en/job/202501-100645/2025-Summer-Intern-Molecular-Lab-Research-and-Early-Development', 'South San Francisco, CA', null, 'Research & Development', 'Closed (2024-2025 cycle)', 'Summer 2025', 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'genentech', '2025 Summer Intern - Genentech Program Manufacturing', 'https://careers.gene.com/us/en/job/202503-105670/2025-Summer-Intern-Genentech-Program-Manufacturing', 'South San Francisco, CA', null, 'Manufacturing & Operations', 'Closed (2024-2025 cycle)', 'Summer 2025', 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'merck', '2025 University Recruiting - Translational Genome Analytics, Bioinformatics Intern', 'https://jobs.merck.com/us/en/job/MERCUSR311629ENUS/', null, null, 'Data Science & Informatics', 'Closed (2024-2025 cycle)', 'Summer 2025', 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'fujifilm diosynth', 'Process Development Intern', 'https://uscareers-fujifilm.icims.com/jobs/33588/process-development-intern/job', null, null, 'Process Development', 'Closed (2024-2025 cycle)', null, 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'scan health plan', 'Summer Intern Program - Healthcare, Analytics, Strategy or Operations', 'https://recruiting.ultipro.com/SCA1002/JobBoard/1fcd101e-d1c9-3014-a493-a49852a54497/OpportunityDetail?opportunityId=e3b13bc5-8320-4ff4-914d-76267095f725', 'Long Beach, CA', null, 'Business Development', 'Closed (2024-2025 cycle)', 'Summer 2025', 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'biomarin', 'Intern, Cardiovascular Cell Biology', 'https://careers.biomarin.com/job/san-rafael/intern-cardiovascular-cell-biology/5804/75792626976', 'San Rafael, CA', null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', null, null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'metrex', 'Technical Research Intern', 'https://www.linkedin.com/jobs/view/4167484898/', null, null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Summer Intern - Environmental Sustainability', 'https://www.linkedin.com/jobs/view/4174670683/', null, null, 'Environmental & Sustainability', 'Closed (2024-2025 cycle)', 'Summer 2025', 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', '2025 Life Sciences Intern - Chicago', 'https://www.linkedin.com/jobs/view/4123147149/', 'Chicago, IL', null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Intern, Assay Development, Whole Blood Hemostasis', 'https://www.linkedin.com/jobs/view/4160903658/', null, null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Biosciences and Biotechnology Division Undergraduate Student Intern - Summer 2025', 'https://www.linkedin.com/jobs/view/4160902749/', null, 'Undergraduates', 'Research & Development', 'Closed (2024-2025 cycle)', 'Summer 2025', 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Technical Writer Intern', 'https://www.linkedin.com/jobs/view/4133940668/', null, null, 'Science Communication', 'Closed (2024-2025 cycle)', null, 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Summer Intern - Gene Therapy Research', 'https://www.linkedin.com/jobs/view/4127274716/', null, null, 'Research & Development', 'Closed (2024-2025 cycle)', 'Summer 2025', 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Intern, Systems Biology of MSC Differentiation', 'https://www.linkedin.com/jobs/view/4102633578/', null, null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Applications Bioinformatics Intern', 'https://www.linkedin.com/jobs/view/4132850162/', null, null, 'Data Science & Informatics', 'Closed (2024-2025 cycle)', null, 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Translational Sciences Intern', 'https://www.linkedin.com/jobs/view/4128469671/', null, null, 'Clinical Research', 'Closed (2024-2025 cycle)', null, 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Spatial Biology and Microscopy Research Intern', 'https://www.linkedin.com/jobs/view/4131452035/', null, null, 'Research & Development', 'Closed (2024-2025 cycle)', null, 'unknown', 'LinkedIn', null, '2024-11-21');
select _hist('2024-2025 Internship Repository (website post)', 'not recorded linkedin posting', 'Undergrad Intern - Translational Pathology and Computational Imaging (Summer 2025)', 'https://www.linkedin.com/jobs/view/4132428064/', null, 'Undergraduates', 'Data Science & Informatics', 'Closed (2024-2025 cycle)', 'Summer 2025', 'unknown', 'LinkedIn', null, '2024-11-21');

-- ============ 2025-2026 TRACKING SHEET ============
select _hist('2025-2026 Internship Tracking Sheet', '3m', 'R&D Intern (Summer 2026)', 'https://3m.wd1.myworkdayjobs.com/en-US/Search/job/Internship---2026-Undergraduate-and-Master-s-Research---Development-Intern_R01155851', 'Maplewood, MN / Austin, TX', 'Any', 'Research & Development', 'Rolling (cycle complete)', 'Summer 2026, 10-12 weeks', 'paid', 'Workday', 'Housing/transportation stipend provided', '2025-09-23');
select _hist('2025-2026 Internship Tracking Sheet', 'sanofi', 'Biomarker Data Analysis Summer 2026 Intern', 'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers/job/Cambridge-MA/Biomarker-Data-Analysis--Summer-2026-Intern_R2813735', 'Cambridge, MA', 'Any', 'Clinical Research', 'October 25, 2025', 'Summer 2026, 10-12 weeks', 'paid', 'Workday', null, '2025-09-26');
select _hist('2025-2026 Internship Tracking Sheet', 'johnson and johnson', 'J&J Quality and Compliance Internship (Summer 2026)', 'https://www.careers.jnj.com/en/jobs/r-029913/jj-quality-compliance-internship-summer-2026/', 'US, Multiple Locations', 'Junior and above', 'Quality Assurance', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'Company Website', '$23-$51/hr', '2025-09-27');
select _hist('2025-2026 Internship Tracking Sheet', 'varda space industries', 'Pharmaceutical Portfolio Internship', 'https://job-boards.greenhouse.io/vardaspace/jobs/6820820003', 'El Segundo, CA', 'Course/knowledge requirements', 'Data Science & Informatics', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'Greenhouse', null, '2025-09-27');
select _hist('2025-2026 Internship Tracking Sheet', 'terasaki institute', 'Jr. Biomedical Intern', 'https://terasakiinstitute.bamboohr.com/careers/58', 'Los Angeles, CA', 'Junior and above', 'Research & Development', 'Rolling (cycle complete)', 'Year round', 'paid', 'BambooHR', null, '2025-09-27');
select _hist('2025-2026 Internship Tracking Sheet', 'zymo research', 'Computational Sciences Internship', 'https://www.zymoresearch.com/pages/computational-sciences-internship', 'Irvine, CA', 'Any', 'Data Science & Informatics', 'Rolling (cycle complete)', null, 'paid', 'Company Website', '$20-$30/hr', '2025-09-27');
select _hist('2025-2026 Internship Tracking Sheet', 'orange county coastkeeper', 'Intern', 'https://www.coastkeeper.org/internships/', 'Costa Mesa, CA', 'Any', 'Environmental & Sustainability', 'Rolling (cycle complete)', null, 'unpaid', 'Company Website', null, '2025-10-02');
select _hist('2025-2026 Internship Tracking Sheet', 'labcorp', 'Intern - Research and Development - Noninvasive Prenatal Diagnostics', 'https://careers.labcorp.com/global/en/job/2530598', 'San Diego, CA', 'Rising juniors and seniors', 'Research & Development', 'Rolling (cycle complete)', 'From June 1, 2026', 'paid', 'Company Website', '$17-$20/hr', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'amgen', 'Undergrad Intern - Operations - Process Development', 'https://careers.amgen.com/en/job/-/-/87/85540448192', 'Thousand Oaks, CA', 'Any', 'Process Development', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'Company Website', '$24.70-$28.30/hr', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'enthalpy analytical', 'Environmental Lab Intern', 'https://montrose.wd1.myworkdayjobs.com/Enthalpy/job/USA-CA-Orange/Environmental-Lab-Intern_R7464', 'Anaheim, CA', 'Any', 'Environmental & Sustainability', 'October 20, 2025', 'From December 1, 2025', 'paid', 'Workday', '$16.50/hr', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'cedars sinai', 'Research Intern', 'https://careers.cshs.org/job/-/-/252/81047993808', 'Los Angeles, CA', 'Any', 'Research & Development', 'Rolling (cycle complete)', 'Year round', 'unpaid', 'Company Website', 'Academic credit only', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'ge healthcare', 'Co-op Internship: Molecular Imaging Commercial Data Initiatives', 'https://careers.gehealthcare.com/global/en/job/GEVGHLGLOBALR4028984EXTERNALENGLOBAL/', 'Remote, CA', 'Any', 'Data Science & Informatics', 'Rolling (cycle complete)', null, 'paid', 'Company Website', 'Remote opportunity', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'salk institute', 'Summer Undergraduate Research Fellowship', 'https://recruiting2.ultipro.com/SAL1013SIBS/JobBoard/e9f055e1-a105-4f91-9a67-21aea61655fa/OpportunityDetail?opportunityId=8d5f8f6a-57c9-48bf-a143-6116748c7984', 'La Jolla, CA', 'Junior and above', 'Research & Development', 'December 7, 2025', 'From June 8, 2026', 'paid', 'UltiPro', '$17.25/hr', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'abbvie', 'Operations Intern (2026)', 'https://careers.abbvie.com/en/job/2026-operations-intern-in-north-chicago-il-jid-18650', 'North Chicago, IL', 'Rising seniors', 'Manufacturing & Operations', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'Company Website', '$20.30-$36.50/hr', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'henkel', 'Product Development Chemist Intern', 'https://www.linkedin.com/jobs/view/4296474189/', 'Irvine, CA', 'Junior, senior, or recent grad', 'Research & Development', 'Rolling (cycle complete)', 'Jan 2026 - Dec 2026', 'paid', 'LinkedIn', '$24-$27/hr', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'decibio', 'Life Science Summer Analyst', 'https://www.decibio.com/careers/open-positions?gh_jid=8067639002', 'Los Angeles, CA', 'Any', 'Finance & Consulting', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'Company Website', '$1.5k/week', '2025-10-04');
select _hist('2025-2026 Internship Tracking Sheet', 'zymo research', 'Research Intern, Microbiome (2025-2026)', 'https://www.zymoresearch.com/pages/career-research-intern-microbiome', 'Irvine, CA', 'Any', 'Research & Development', 'Rolling (cycle complete)', null, 'paid', 'Company Website', '$20/hr', '2025-10-09');
select _hist('2025-2026 Internship Tracking Sheet', 'zymo research', 'Research Intern - Protein (2025-2026)', 'https://www.zymoresearch.com/pages/careeer-research-intern-protein', 'Tustin, CA', 'Bachelor''s or Master''s in life science', 'Research & Development', 'Rolling (cycle complete)', null, 'paid', 'Company Website', '$20/hr', '2025-10-09');
select _hist('2025-2026 Internship Tracking Sheet', 'thermo fisher', 'Bioinformatics Intern', 'https://jobs.thermofisher.com/global/en/job/R-01328077/Bioinformatics-Intern', 'Pleasanton, CA', 'Enrolled undergrad or master''s in a computational field', 'Data Science & Informatics', 'Rolling (cycle complete)', null, 'paid', 'Company Website', '$14.75-$28.75/hr', '2025-10-09');
select _hist('2025-2026 Internship Tracking Sheet', 'johnson and johnson innovative medicine', 'Immunology Discovery Scientist Intern', 'https://www.careers.jnj.com/en/jobs/r-036755/imm-discovery-scientist-intern/', 'San Diego, CA', 'Min 6 semesters completed, not graduating before internship', 'Research & Development', 'Rolling (cycle complete)', 'May 18 - Sep 18, 2026', 'paid', 'Company Website', null, null);
select _hist('2025-2026 Internship Tracking Sheet', 'amgen', 'Amgen Scholars Program', 'https://amgenscholars.com/', 'Multiple locations', 'Undergraduates', 'Research & Development', 'Cycle complete', 'Summer 2026', 'paid', 'Other', null, null);
select _hist('2025-2026 Internship Tracking Sheet', 'bristol meyers squibb', 'Undergraduate Leads Discovery and Optimization Internship (Summer 2026)', 'https://bristolmyerssquibb.wd5.myworkdayjobs.com/en-US/BMS/job/Summer-2026---Undergraduate-Leads-Discovery-and-Optimization-Internship_R1595508', 'Princeton, NJ', 'Junior and above', 'Research & Development', 'Rolling (cycle complete)', 'June - Aug 2026', 'paid', 'Workday', '$27-$29/hr', '2025-10-18');
select _hist('2025-2026 Internship Tracking Sheet', 'bristol meyers squibb', 'Precision Medicine, BioAnalytical and Translational Sciences Internship (Summer 2026)', 'https://bristolmyerssquibb.wd5.myworkdayjobs.com/en-US/BMS/job/Princeton---NJ---US/Summer-2026---Undergraduate-Precision-Medicine--BioAnalytical-and-Translational-Sciences-Internship_R1595825', 'Princeton, NJ', 'Sophomore and above', 'Clinical Research', 'Rolling (cycle complete)', 'June - Aug 2026', 'paid', 'Workday', '$27-$29/hr', '2025-10-18');
select _hist('2025-2026 Internship Tracking Sheet', 'arcus biosciences', 'In Vivo Pharmacology Intern', 'https://jobs.jobvite.com/arcusbiosciencescareers/job/oXSSyfwZ', 'Hayward, CA', 'Junior and above', 'Research & Development', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'Company Website', '$25/hr', '2026-01-28');
select _hist('2025-2026 Internship Tracking Sheet', 'septerna', 'Summer Research Intern - DMPK (Undergraduate)', 'https://www.linkedin.com/jobs/view/4366426611/', 'South San Francisco, CA', 'Undergraduates', 'Research & Development', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'LinkedIn', '$25/hr', '2026-01-28');
select _hist('2025-2026 Internship Tracking Sheet', 'astrazeneca', 'Biologics Engineering: Cell Therapy R&D Summer Intern', 'https://careers.astrazeneca.com/job/-/-/7684/90909360000', 'Gaithersburg, MD', 'Seniors', 'Research & Development', 'February 3, 2026', 'May 18 - Aug 7, 2026', 'paid', 'Company Website', '$39/hr', '2026-01-28');
select _hist('2025-2026 Internship Tracking Sheet', 'cytokinetics', 'Intern - Pharmacology', 'https://cytokinetics.wd1.myworkdayjobs.com/Cytokinetics/job/South-San-Francisco-California/Intern---Pharmacology_R353-1', 'South San Francisco, CA', 'Rising juniors and seniors', 'Research & Development', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'Workday', '$22-$25/hr', '2026-01-30');
select _hist('2025-2026 Internship Tracking Sheet', 'simtra biopharma solutions', '2026 Summer Internship - Research and Development', 'https://www.linkedin.com/jobs/view/4333931338/', 'Bloomington, IN', 'Undergrad and grad', 'Research & Development', 'Rolling (cycle complete)', 'Summer 2026', 'paid', 'LinkedIn', null, null);

drop function _hist;

-- ============ EVERGREEN RESOURCES (from the sheet) ============
-- These two rows in the sheet are internship databases, not postings.
insert into resources (title, resource_type, url, description, tags, public_safe) values
 ('NSF Internship Database (ETAP)', 'link', 'https://etap.nsf.gov/programs',
  'Searchable database of NSF education and training programs, open to any student.', '{internships,database}', true),
 ('IBP Pathways to Science: Medical and Life Sciences Programs', 'link',
  'https://pathwaystoscience.org/programs.aspx?u=&d=MED-_Medical+%26+Life+Sciences+%28All%29&submit=y',
  'Directory of medical and life science research programs and internships.', '{internships,database}', true);
