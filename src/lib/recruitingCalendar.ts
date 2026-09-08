export const RECRUITING_MONTHS = [
  'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar',
] as const;

export interface RecruitingWindow {
  employer: string;
  category: string;
  start: number;
  end: number;
  timing: string;
  note: string;
  source: string;
}

export interface WatchedEmployer {
  employer: string;
  category: string;
  cadence: string;
  source: string;
}

/**
 * Past-cycle evidence only. These records help students decide when to start
 * checking, but never imply that a current role is open.
 */
export const RECRUITING_WINDOWS: RecruitingWindow[] = [
  {
    employer: 'AbbVie',
    category: 'Pharma',
    start: 0,
    end: 7,
    timing: 'August to March',
    note: 'Timing varies by role.',
    source: 'https://www.abbvie.com/join-us/internships.html',
  },
  {
    employer: 'Bristol Myers Squibb',
    category: 'Pharma',
    start: 0,
    end: 7,
    timing: 'August to March',
    note: 'The program describes applications as rolling.',
    source: 'https://careers.bms.com/internships-co-ops/',
  },
  {
    employer: 'Johnson & Johnson',
    category: 'Healthcare and pharma',
    start: 0,
    end: 3,
    timing: 'August to November',
    note: 'Past North American internship cycle.',
    source: 'https://www.careers.jnj.com/en/early-career-programs/internships/',
  },
  {
    employer: 'Thomas Jefferson University',
    category: 'Biomedical data science',
    start: 2,
    end: 6,
    timing: 'October to February',
    note: 'The 2027 portal was announced for October; the close date remains unconfirmed.',
    source: 'https://jeffline.jefferson.edu/education/programs/biostatistics_si/',
  },
  {
    employer: 'Genentech / Roche',
    category: 'Oncology and biotech',
    start: 3,
    end: 7,
    timing: 'November to March',
    note: 'General summer-intern timing from the employer FAQ.',
    source: 'https://careers.gene.com/us/en/faq',
  },
  {
    employer: 'Gilead Sciences',
    category: 'Biopharma',
    start: 3,
    end: 7,
    timing: 'Mid-November onward',
    note: 'Close dates vary by role.',
    source: 'https://www.gilead.com/careers/opportunities/early-career-opportunities/gilead-internship-program',
  },
];

export const WATCHED_EMPLOYERS: WatchedEmployer[] = [
  { employer: 'Guardant Health', category: 'Cancer diagnostics', cadence: 'Check weekly, Sep–Feb', source: 'https://guardanthealth.com/careers/jobs/' },
  { employer: 'Foundation Medicine', category: 'Cancer diagnostics', cadence: 'Check weekly, Sep–Feb', source: 'https://careers.foundationmedicine.com/jobs/search' },
  { employer: 'GRAIL', category: 'Early detection', cadence: 'Check weekly, Sep–Feb', source: 'https://grail.com/careers/' },
  { employer: 'Illumina', category: 'Sequencing and genomics', cadence: 'Check weekly from September', source: 'https://www.illumina.com/company/careers/interns.html' },
  { employer: 'Natera', category: 'Genetic testing', cadence: 'Check weekly, Sep–Feb', source: 'https://job-boards.greenhouse.io/natera' },
  { employer: 'Exact Sciences', category: 'Cancer diagnostics', cadence: 'Check weekly, Sep–Feb', source: 'https://careers.exactsciences.com/' },
  { employer: 'Personalis', category: 'Cancer genomics', cadence: 'Check weekly, Sep–Feb', source: 'https://www.personalis.com/careers/' },
  { employer: 'Regeneron', category: 'Pharma and genetics', cadence: 'Watch for the fall wave', source: 'https://careers.regeneron.com/en/career-pathways/early-careers/' },
  { employer: '10x Genomics', category: 'Single-cell and spatial', cadence: 'Check weekly, Sep–Feb', source: 'https://careers.kula.ai/10xgenomics' },
  { employer: 'Merck', category: 'Pharma', cadence: 'Check weekly, Sep–Feb', source: 'https://jobs.merck.com/us/en' },
];
