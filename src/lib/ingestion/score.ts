/**
 * Deterministic relevance scoring for automated ingestion candidates (version 1).
 *
 * Rules:
 * - Range: 0–100 (clamped).
 * - Score version is a positive integer, currently 1.
 * - Complete breakdown with explicit positive and negative reasons.
 * - No hidden AI or model calls.
 * - No protected-characteristic inference.
 * - No mutation of manually approved records.
 * - Weights and terms are centralized here and can be revised in a later
 *   score version (increment SCORE_VERSION).
 *
 * Score version history:
 *   v1 (initial): biotechnology relevance, undergrad accessibility, role type,
 *                 SoCal/remote geography, seniority penalty, advanced-degree
 *                 penalty, unrelated-discipline penalty, ambiguous eligibility.
 */

import type { OpportunityClassification, RemoteType, ScoreBreakdown, ScoreReason, UncertaintyFlag } from './types';

// ============================================================
// SCORE VERSION
// Increment this when scoring logic changes.
// relevance_score and relevance_score_version must always be updated together.
// ============================================================

export const SCORE_VERSION = 1;

// ============================================================
// SCORING WEIGHTS
// Centralized so they can be revised without hunting through logic.
// ============================================================

/** Baseline score before any adjustments. */
const BASELINE = 40;

// Positive weights
const W_BIOTECH_TITLE_STRONG = 20;     // strong biotech/life-science signal in title
const W_BIOTECH_TITLE_MODERATE = 10;   // moderate biotech/life-science signal in title
const W_BIOTECH_DEPT = 8;              // biotech/life-science department
const W_UNDERGRAD_EXPLICIT = 15;       // explicit undergrad eligibility
const W_RECENT_GRAD = 8;               // recent-grad language
const W_INTERNSHIP = 15;               // classified as internship
const W_FELLOWSHIP = 12;               // classified as fellowship
const W_RESEARCH = 8;                  // classified as research role
const W_ENTRY_LEVEL = 10;              // classified as entry-level
const W_SOCAL = 12;                    // Southern California location
const W_REMOTE = 10;                   // remote-eligible
const W_HYBRID = 6;                    // hybrid

// Negative weights (stored as negative numbers in reasons)
const W_SENIORITY_STRONG = -25;        // VP, director, principal, staff, head of
const W_SENIORITY_MODERATE = -15;      // senior, lead, manager
const W_ADVANCED_DEGREE = -20;         // PhD, MD, postdoc required
const W_MASTERS_PREFERRED = -8;        // master's preferred / required
const W_UNRELATED_DEPT = -20;          // clearly unrelated department
const W_GRAD_ONLY = -15;               // explicitly restricted to graduate students
const W_NO_URL = -10;                  // no application URL
const W_AMBIGUOUS_ELIGIBILITY = -5;    // eligibility field missing or ambiguous

// ============================================================
// TERM LISTS
// Centralized for revision by officers without touching scoring logic.
// ============================================================

/** Title terms that strongly indicate biotechnology or life-science relevance. */
const BIOTECH_TITLE_STRONG = [
  'biotech', 'biotechnology', 'bioscience', 'life science', 'life sciences',
  'bioinformatics', 'genomics', 'proteomics', 'transcriptomics', 'metabolomics',
  'molecular biology', 'cell biology', 'biochemistry', 'immunology', 'oncology',
  'drug discovery', 'pharmaceutical', 'pharmacology', 'biomanufacturing',
  'bioprocess', 'clinical research', 'clinical trial', 'medical research',
  'neuroscience', 'microbiology', 'virology', 'epidemiology', 'public health',
  'biomedical', 'genetic engineer', 'gene edit', 'crispr', 'stem cell',
  'regenerative', 'sequencing', 'pcr', 'flow cytometry',
];

/** Title terms with moderate biotech/science signal. */
const BIOTECH_TITLE_MODERATE = [
  'research', 'scientist', 'biology', 'chemistry', 'laboratory', 'lab tech',
  'lab assistant', 'research assistant', 'research associate', 'science intern',
  'analytical', 'assay', 'data science', 'biophysics', 'pathology',
  'toxicology', 'quality assurance', 'regulatory affairs',
];

/** Department terms indicating biotech/life-science alignment. */
const BIOTECH_DEPARTMENTS = [
  'research', 'r&d', 'research and development', 'science', 'biology',
  'chemistry', 'bioinformatics', 'genomics', 'clinical', 'medical affairs',
  'regulatory', 'quality', 'manufacturing sciences', 'process development',
  'cell therapy', 'discovery', 'translational', 'preclinical', 'nonclinical',
];

/** Departments that are clearly unrelated to biotech for CSULB Biotech Club members. */
const UNRELATED_DEPARTMENTS = [
  'real estate', 'retail', 'food & beverage', 'food service', 'hospitality',
  'accounting & finance', 'legal', 'human resources', 'hr', 'sales',
  'marketing', 'social media', 'graphic design', 'interior design',
  'customer service', 'call center', 'warehouse', 'supply chain',
];

/** Location terms indicating Southern California accessibility. */
const SOCAL_LOCATIONS = [
  'long beach', 'los angeles', 'la', 'orange county', 'irvine', 'anaheim',
  'carson', 'torrance', 'compton', 'el segundo', 'thousand oaks', 'camarillo',
  'ventura', 'san diego', 'santa ana', 'pomona', 'pasadena', 'burbank',
  'glendale', 'culver city', 'santa monica', 'manhattan beach', 'hawthorne',
  'inglewood', 'gardena', 'cerritos', 'fullerton', 'la jolla', 'san clemente',
  'south bay', 'socal', 'southern california', 'california, usa',
];

/** Eligibility terms indicating undergrad accessibility. */
const UNDERGRAD_TERMS = [
  'undergraduate', 'undergrad', "bachelor's", 'bachelor', 'bs student',
  'ba student', 'junior', 'senior', 'sophomore', 'freshman', 'all majors',
  'current students', 'university students', 'college students',
  'pursuing a degree', 'pursuing a bachelor',
];

/** Eligibility terms indicating recent-graduate accessibility. */
const RECENT_GRAD_TERMS = [
  'recent graduate', 'new grad', 'entry-level', 'entry level',
  '0-1 year', '0-2 year', 'no experience required', 'new graduates',
];

/** Title terms indicating excessive seniority (strong signal). */
const SENIORITY_STRONG = [
  'vice president', 'vp ', 'director', 'head of', 'chief', 'principal',
  'staff engineer', 'distinguished', 'fellow', // "fellow" in seniority context
  'senior director', 'group lead',
];

/** Title terms indicating moderate seniority. */
const SENIORITY_MODERATE = [
  ' senior ', 'sr.', 'sr ', 'lead ', 'manager', ' iv ', ' iii ',
];

/** Credential/degree terms indicating advanced-degree requirement. */
const ADVANCED_DEGREE_REQUIRED = [
  'phd', 'ph.d', 'ph.d.', 'doctorate', 'md/', 'md required', 'm.d.',
  'postdoc', 'post-doc', 'postdoctoral',
];

/** Terms suggesting master's degree is preferred or required. */
const MASTERS_PREFERRED = [
  "master's required", "master's preferred", "ms required", "ms preferred",
  "msc required", "graduate degree required", "graduate students only",
];

/** Terms indicating restriction to graduate students. */
const GRAD_ONLY = [
  'graduate students only', 'graduate students only', 'phd students only',
  'doctoral students only', 'must be enrolled in a graduate program',
];

// ============================================================
// SCORING INPUT
// ============================================================

/** Input to scoreIngestionCandidate — fields derived from NormalizedSourcePosting. */
export interface ScoringInput {
  titleRaw: string | null;
  titleNormalized: string | null;
  locationNormalized: string | null;
  department: string | null;
  departments: string[];
  classification: OpportunityClassification;
  remoteType: RemoteType;
  canonicalUrl: string | null;
  descriptionText: string | null;
  closesAt: string | null;
  uncertaintyFlags: UncertaintyFlag[];
}

// ============================================================
// SCORING FUNCTION
// ============================================================

/**
 * Score an ingestion candidate deterministically.
 *
 * @param input    Normalized posting fields.
 * @param now      Reference time for deadline calculations. Defaults to Date.now().
 * @returns        ScoreBreakdown with clamped total (0–100) and itemized reasons.
 */
export function scoreIngestionCandidate(
  input: ScoringInput,
  now: Date = new Date(),
): ScoreBreakdown {
  let raw = BASELINE;
  const positive: ScoreReason[] = [];
  const negative: ScoreReason[] = [];

  function addPositive(category: string, points: number, reason: string): void {
    raw += points;
    positive.push({ category, points, reason });
  }

  function addNegative(category: string, points: number, reason: string): void {
    // points should be negative
    raw += points;
    negative.push({ category, points, reason });
  }

  const titleLower = (input.titleRaw ?? '').toLowerCase();
  const titleNorm = (input.titleNormalized ?? '').toLowerCase();
  const deptLower = (input.department ?? '').toLowerCase();
  const allDepts = input.departments.map((d) => d.toLowerCase()).join(' ');
  const locationLower = (input.locationNormalized ?? '').toLowerCase();
  const descLower = (input.descriptionText?.slice(0, 2000) ?? '').toLowerCase();
  const eligibility = descLower; // use description as proxy for eligibility

  // --- 1. Biotechnology / life-science relevance ---
  const bioStrong = BIOTECH_TITLE_STRONG.some((t) => titleLower.includes(t));
  const bioModerate = !bioStrong && BIOTECH_TITLE_MODERATE.some((t) => titleLower.includes(t));
  const bioDept = BIOTECH_DEPARTMENTS.some((t) => deptLower.includes(t) || allDepts.includes(t));

  if (bioStrong) {
    addPositive('biotech_relevance', W_BIOTECH_TITLE_STRONG, `strong biotech/life-science signal in title: "${input.titleRaw}"`);
  } else if (bioModerate) {
    addPositive('biotech_relevance', W_BIOTECH_TITLE_MODERATE, `moderate biotech/science signal in title: "${input.titleRaw}"`);
  }
  if (bioDept) {
    addPositive('biotech_relevance', W_BIOTECH_DEPT, `biotech/life-science department: "${input.department ?? input.departments.join(', ')}"`);
  }

  // --- 2. Undergraduate / recent-grad accessibility ---
  const isUndergrad = UNDERGRAD_TERMS.some((t) => eligibility.includes(t));
  const isRecentGrad = !isUndergrad && RECENT_GRAD_TERMS.some((t) => eligibility.includes(t));
  const isGradOnly = GRAD_ONLY.some((t) => eligibility.includes(t));

  if (isUndergrad) {
    addPositive('undergrad_access', W_UNDERGRAD_EXPLICIT, 'explicitly mentions undergraduate eligibility');
  } else if (isRecentGrad) {
    addPositive('undergrad_access', W_RECENT_GRAD, 'recent-graduate or entry-level language in description');
  }
  if (isGradOnly) {
    addNegative('undergrad_access', W_GRAD_ONLY, 'description restricts eligibility to graduate students');
  }

  // --- 3. Role type ---
  if (input.classification === 'internship') {
    addPositive('role_type', W_INTERNSHIP, 'classified as internship');
  } else if (input.classification === 'fellowship') {
    addPositive('role_type', W_FELLOWSHIP, 'classified as fellowship');
  } else if (input.classification === 'research') {
    addPositive('role_type', W_RESEARCH, 'classified as research role');
  } else if (input.classification === 'entry_level') {
    addPositive('role_type', W_ENTRY_LEVEL, 'classified as entry-level role');
  }

  // --- 4. Geographic accessibility ---
  if (input.remoteType === 'remote') {
    addPositive('geography', W_REMOTE, 'remote-eligible position');
  } else if (input.remoteType === 'hybrid') {
    addPositive('geography', W_HYBRID, 'hybrid position');
  } else if (SOCAL_LOCATIONS.some((loc) => locationLower.includes(loc))) {
    addPositive('geography', W_SOCAL, `Southern California location: "${input.locationNormalized}"`);
  }

  // --- 5. Excessive seniority ---
  const isSeniorStrong = SENIORITY_STRONG.some((t) => titleLower.includes(t));
  const isSeniorModerate = !isSeniorStrong && SENIORITY_MODERATE.some((t) => ` ${titleNorm} `.includes(t));

  if (isSeniorStrong) {
    addNegative('seniority', W_SENIORITY_STRONG, `senior-leadership title signal: "${input.titleRaw}"`);
  } else if (isSeniorModerate) {
    addNegative('seniority', W_SENIORITY_MODERATE, `moderate seniority signal in title: "${input.titleRaw}"`);
  }

  // --- 6. Advanced-degree requirements ---
  const needsPhD = ADVANCED_DEGREE_REQUIRED.some((t) => eligibility.includes(t) || titleLower.includes(t));
  const prefersMasters = !needsPhD && MASTERS_PREFERRED.some((t) => eligibility.includes(t));

  if (needsPhD) {
    addNegative('degree_req', W_ADVANCED_DEGREE, 'PhD, MD, or postdoc credential required');
  } else if (prefersMasters) {
    addNegative('degree_req', W_MASTERS_PREFERRED, "master's degree preferred or required");
  }

  // --- 7. Unrelated department ---
  const isUnrelated = UNRELATED_DEPARTMENTS.some((t) => deptLower.includes(t) || allDepts.includes(t));
  if (isUnrelated) {
    addNegative('unrelated_dept', W_UNRELATED_DEPT, `department not relevant to biotech career hub: "${input.department ?? input.departments.join(', ')}"`);
  }

  // --- 8. Ambiguous eligibility ---
  if (
    input.uncertaintyFlags.includes('eligibility_missing') ||
    input.uncertaintyFlags.includes('eligibility_ambiguous')
  ) {
    addNegative('eligibility', W_AMBIGUOUS_ELIGIBILITY, 'eligibility information is missing or ambiguous');
  }

  // --- 9. No application URL ---
  if (!input.canonicalUrl) {
    addNegative('link_quality', W_NO_URL, 'no application URL available');
  }

  const total = Math.max(0, Math.min(100, raw));
  return {
    version: SCORE_VERSION,
    total,
    rawTotal: raw,
    positiveReasons: positive,
    negativeReasons: negative,
  };
}
