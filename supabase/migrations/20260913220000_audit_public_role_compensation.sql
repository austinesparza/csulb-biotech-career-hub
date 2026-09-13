-- Verify compensation fields for currently published roles against their live
-- employer job postings. Match on stable company/title content instead of UUIDs.
-- CAS and MD Anderson remain `unknown` because their current public postings do
-- not state compensation; third-party salary estimates are not sufficient.

update public.opportunities o
set paid_status = 'paid',
    public_notes = case
      when c.name = 'Amgen'
       and o.title = 'Grad Intern - Operations Process Development - Summer 2027'
        then 'Base pay: $35.34-$41.20/hour. Confirm first-year program eligibility before applying.'
      when c.name = 'Amgen'
       and o.title = 'Grad Intern - Operations - Engineering (Summer 2027)'
        then 'Base pay: $35.34-$41.20/hour.'
      when c.name = 'Amgen'
       and o.title = 'Operations Graduate Program - Summer 2027 Internship'
        then 'Base pay: $35.34-$41.83/hour.'
      when c.name = 'Johnson & Johnson'
       and o.title = 'Research & Development Leadership Development Program (RDLDP) - Summer 2027 Internship'
        then 'Anticipated base pay: $34/hour for post-graduate interns; $40.50/hour for post-graduate Robotics/Data Science majors; higher tiers are listed for PhD candidates.'
      when c.name = 'Johnson & Johnson'
       and o.title = 'Technology 2027 Fall Co-Op'
        then 'Anticipated base pay: $34/hour for master''s students. Housing stipend is offered to qualifying interns.'
      when c.name = 'Ginkgo Bioworks'
       and o.title = 'Software Graduate Intern, Autonomous Lab'
        then 'Employer-listed base salary range: $45,100-$63,600; actual pay depends on skills, expertise, and experience.'
      when c.name = 'Ginkgo Bioworks'
       and o.title = 'Software Intern, Autonomous Lab'
        then 'Employer-listed base salary range: $37,700-$53,500; actual pay depends on skills, expertise, and experience.'
      when c.name = 'Ginkgo Bioworks'
       and o.title = 'Automation Scientist Intern, RAC Operations'
        then 'Employer-listed base salary range: $37,700-$53,500; actual pay depends on skills, expertise, and experience.'
      else o.public_notes
    end,
    last_checked_at = now(),
    updated_at = now()
from public.companies c
where c.id = o.company_id
  and o.public_safe
  and o.review_status = 'approved'
  and (
    (c.name = 'Amgen' and o.title in (
      'Grad Intern - Operations Process Development - Summer 2027',
      'Grad Intern - Operations - Engineering (Summer 2027)',
      'Operations Graduate Program - Summer 2027 Internship'
    ))
    or (c.name = 'Johnson & Johnson' and o.title in (
      'Research & Development Leadership Development Program (RDLDP) - Summer 2027 Internship',
      'Technology 2027 Fall Co-Op'
    ))
    or (c.name = 'Ginkgo Bioworks' and o.title in (
      'Software Graduate Intern, Autonomous Lab',
      'Software Intern, Autonomous Lab',
      'Automation Scientist Intern, RAC Operations'
    ))
  );
