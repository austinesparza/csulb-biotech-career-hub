-- Curated company context for the reviewed Xaira Therapeutics opportunity.
-- Source: https://www.xaira.com/ and https://www.xaira.com/our-approach
-- Xaira describes an integrated AI drug-discovery model spanning advanced AI,
-- large-scale biological data generation, and therapeutic product development.

update public.companies
set website = 'https://www.xaira.com/',
    location = 'South San Francisco, CA; Seattle, WA; London, UK',
    industry_tags = array[
      'AI drug discovery',
      'Protein design',
      'Functional genomics',
      'Therapeutics'
    ],
    description = 'Integrated biotechnology company using advanced AI, large-scale biological data generation, and therapeutic development to discover and design new medicines.',
    updated_at = now()
where lower(trim(name)) in ('xaira', 'xaira therapeutics');
