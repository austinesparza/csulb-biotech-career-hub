-- Curated company context for the reviewed Xaira Therapeutics opportunity.
-- Sources: https://www.xaira.com/, https://www.xaira.com/our-approach,
-- and the official Xaira Greenhouse careers board.
-- Xaira describes an integrated AI drug-discovery model spanning advanced AI,
-- expansive biological data generation, and therapeutic product development.

update public.companies
set website = 'https://www.xaira.com/',
    location = 'South San Francisco, CA; Seattle, WA; London, UK',
    industry_tags = array[
      'AI drug discovery',
      'Computational biology',
      'Protein design',
      'Functional genomics',
      'Therapeutics'
    ],
    description = 'Integrated biotechnology company developing predictive and agentic AI models, large-scale biological data generation, and therapeutics across drug discovery and development.',
    updated_at = now()
where lower(trim(name)) in ('xaira', 'xaira therapeutics');
