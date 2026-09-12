import historicalSnapshot from '../../data/historical-opportunity-watch.json';

export const RECRUITING_MONTHS = [
  'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar',
] as const;

export const HISTORICAL_ARCHIVE_SUMMARY = {
  roles: 51,
  datedRoles: 48,
  cycles: 2,
  namedEmployerRecords: 31,
  normalizedEmployers: 30,
} as const;

/** Counts every dated role in the two supplied tracking cycles. */
export const HISTORICAL_ROLE_ACTIVITY = [0, 6, 15, 23, 0, 4, 0, 0] as const;

export type WatchEvidence = 'club archive' | 'broader search';

export interface WatchedEmployer {
  employer: string;
  category: string;
  evidence: WatchEvidence;
  observedMonths: number[];
  cycles: string[];
  programTerms: string[];
  source: string;
}

const ARCHIVE_SUPPLEMENTS = [
  { company: 'LabRoots', careersDomain: 'www.labroots.com', observedMonths: [11], cycles: ['2025'], programTerms: ['Science writing and communications internship'] },
  { company: 'Metrex', careersDomain: 'www.metrex.com', observedMonths: [11], cycles: ['2025'], programTerms: ['Microbiology internship'] },
  { company: 'Orange County Coastkeeper', careersDomain: 'www.coastkeeper.org', observedMonths: [11], cycles: ['2025'], programTerms: ['Marine restoration internship'] },
] as const;

const BROADER_WATCH = [
  ['Guardant Health', 'Cancer diagnostics', 'https://guardanthealth.com/careers/jobs/'],
  ['Foundation Medicine', 'Cancer diagnostics', 'https://careers.foundationmedicine.com/jobs/search'],
  ['GRAIL', 'Early cancer detection', 'https://grail.com/careers/'],
  ['Illumina', 'Sequencing and genomics', 'https://www.illumina.com/company/careers/interns.html'],
  ['Natera', 'Genetic testing', 'https://job-boards.greenhouse.io/natera'],
  ['Exact Sciences', 'Cancer diagnostics', 'https://careers.exactsciences.com/'],
  ['Personalis', 'Cancer genomics', 'https://www.personalis.com/careers/'],
  ['Regeneron', 'Biopharma and genetics', 'https://careers.regeneron.com/en/career-pathways/early-careers/'],
  ['10x Genomics', 'Single-cell and spatial biology', 'https://careers.kula.ai/10xgenomics'],
] as const;

const CATEGORY_BY_EMPLOYER: Record<string, string> = {
  '3M': 'Applied science and manufacturing',
  AbbVie: 'Biopharma',
  Amgen: 'Biopharma and process development',
  'Arcus Biosciences': 'Cancer therapeutics',
  AstraZeneca: 'Biopharma and cell therapy',
  BioMarin: 'Rare disease biotechnology',
  'Bristol Myers Squibb': 'Biopharma and drug discovery',
  'Cedars-Sinai': 'Academic medicine and research',
  Cytokinetics: 'Muscle biology and therapeutics',
  DeciBio: 'Life-science strategy and data',
  'Enthalpy Analytical': 'Environmental laboratory science',
  Fujifilm: 'Bioprocess and manufacturing',
  'GE HealthCare': 'Molecular imaging and diagnostics',
  Genentech: 'Biotechnology and drug discovery',
  Henkel: 'Product development and chemistry',
  'Johnson & Johnson': 'Healthcare and biopharma',
  Labcorp: 'Diagnostics and laboratory science',
  Merck: 'Biopharma',
  'Salk Institute': 'Academic biomedical research',
  Sanofi: 'Biopharma and biomarker science',
  'SCAN Health Plan': 'Healthcare and population health',
  Septerna: 'GPCR drug discovery',
  'Simtra BioPharma Solutions': 'Biopharma manufacturing',
  'Terasaki Institute': 'Biomedical engineering and research',
  'Thermo Fisher Scientific': 'Life-science tools and bioinformatics',
  'Varda Space Industries': 'Pharmaceutical manufacturing',
  'Zymo Research': 'Genomics, microbiome, and research tools',
  LabRoots: 'Science communication',
  Metrex: 'Microbiology and infection prevention',
  'Orange County Coastkeeper': 'Environmental and marine biology',
};

function sourceFromDomain(domain: string | null): string {
  return domain ? `https://${domain}` : '/companies';
}

function archiveItems(): WatchedEmployer[] {
  return [...historicalSnapshot.employers, ...ARCHIVE_SUPPLEMENTS].map((item) => ({
    employer: item.company,
    category: CATEGORY_BY_EMPLOYER[item.company] ?? 'Biotechnology and life sciences',
    evidence: 'club archive' as const,
    observedMonths: [...item.observedMonths],
    cycles: [...item.cycles],
    programTerms: [...item.programTerms],
    source: sourceFromDomain(item.careersDomain),
  }));
}

export const WATCHED_EMPLOYERS: WatchedEmployer[] = [
  ...archiveItems(),
  ...BROADER_WATCH.map(([employer, category, source]) => ({
    employer,
    category,
    evidence: 'broader search' as const,
    observedMonths: [],
    cycles: [],
    programTerms: [],
    source,
  })),
].toSorted((a, b) => a.employer.localeCompare(b.employer));

export function monthName(month: number): string {
  return new Date(2026, month - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}
