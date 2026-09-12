import type { PublicOpportunity } from './types';

const UNDERGRAD_SIGNAL = /\bundergraduate\b|\bbachelor(?:'s|s)?\b|\bpost[ -]?baccalaureate\b|\bpostbac\b/i;
const GRADUATE_SIGNAL = /\bgraduate\b|\bmaster(?:'s|s)?\b|\bmsc\b|\bph\.?d\.?\b|\bdoctoral\b/i;

export function opportunityAudienceLabel(opportunity: PublicOpportunity): string {
  const evidence = `${opportunity.eligibility ?? ''} ${opportunity.audience_reason ?? ''}`;
  const mixedEvidence = UNDERGRAD_SIGNAL.test(evidence) && GRADUATE_SIGNAL.test(evidence);

  if (opportunity.audience_bucket === 'mixed' || mixedEvidence) {
    if (/post[ -]?baccalaureate|postbac/i.test(evidence)) {
      return 'Undergraduate, post-baccalaureate, and graduate students';
    }
    return 'Undergraduate and graduate students';
  }
  if (opportunity.audience_bucket === 'undergraduate') return 'Undergraduate students';
  if (opportunity.audience_bucket === 'special') return 'Program-specific eligibility';
  if (opportunity.audience_bucket === 'adjacent') return 'Related student opportunity';
  if (opportunity.audience_bucket === 'ineligible') return 'Outside the current student audience';

  const graduateStages: Partial<Record<PublicOpportunity['graduate_stage'], string>> = {
    msc_year_1: 'First-year master\'s students',
    msc_year_2: 'Second-year master\'s students',
    msc_any: 'Current master\'s students',
    mixed_graduate: 'Master\'s and doctoral students',
    graduate_unspecified: 'Graduate students, year not specified',
    doctoral_only: 'Doctoral students',
  };
  if (opportunity.graduate_stage && graduateStages[opportunity.graduate_stage]) {
    return graduateStages[opportunity.graduate_stage]!;
  }
  if (opportunity.audience_bucket === 'graduate') return 'Graduate students';
  return 'Eligibility not yet classified';
}
