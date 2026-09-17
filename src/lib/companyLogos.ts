export type CompanyLogoFit = 'wide' | 'compact';

export interface CompanyLogoAsset {
  src: string;
  fit: CompanyLogoFit;
}

const COMPANY_LOGOS: Array<[RegExp, CompanyLogoAsset]> = [
  [/^3m$/i, { src: '/brand/logos/3m.svg', fit: 'compact' }],
  [/^abbvie$/i, { src: '/brand/logos/abbvie.svg', fit: 'compact' }],
  [/^pfizer(?:\s+(?:inc\.?|futures))?$/i, { src: '/brand/logos/pfizer.svg', fit: 'wide' }],
  [/^gilead\s+sciences(?:,?\s+inc\.?)?$/i, { src: '/brand/logos/gilead-sciences.svg', fit: 'wide' }],
  [/^catalent(?:\s+(?:inc\.?|pharma\s+solutions))?$/i, { src: '/brand/logos/catalent.svg', fit: 'wide' }],
  [/^fujifilm(?:\s+diosynth\s+biotechnologies|\s+biotechnologies)?$/i, { src: '/brand/logos/fujifilm.svg', fit: 'wide' }],
  [/^merck(?:\s*&\s*co\.)?$/i, { src: '/brand/logos/merck.svg', fit: 'compact' }],
  [/^genentech$/i, { src: '/brand/logos/genentech.svg', fit: 'wide' }],
  [/^thermo\s+fisher\s+scientific$/i, { src: '/brand/logos/thermo-fisher-scientific.svg', fit: 'wide' }],
  [/^johnson\s*(?:&|and)\s*johnson(?:\s+innovative\s+medicine)?$/i, { src: '/brand/logos/johnson-johnson.svg', fit: 'wide' }],
  [/^amgen$/i, { src: '/brand/logos/amgen.svg', fit: 'wide' }],
  [/^ginkgo bioworks$/i, { src: '/brand/logos/ginkgo-bioworks.svg', fit: 'wide' }],
  [/^sanofi$/i, { src: '/brand/logos/sanofi.svg', fit: 'wide' }],
  [/md anderson/i, { src: '/brand/logos/md-anderson.png', fit: 'wide' }],
  [/^cas$/i, { src: '/brand/logos/cas.svg', fit: 'wide' }],
  [/^xaira(?:\s+therapeutics)?$/i, { src: '/brand/logos/xaira-therapeutics.svg', fit: 'wide' }],
  [/^fred\s+hutch(?:inson\s+cancer\s+center)?$/i, { src: '/brand/logos/fred-hutch.svg', fit: 'wide' }],
  [/^kite(?:\s+pharma)?$/i, { src: '/brand/logos/kite-pharma.png', fit: 'wide' }],
  [/^roche$/i, { src: '/brand/logos/roche.png', fit: 'wide' }],
];

export function companyLogoAsset(name: string): CompanyLogoAsset | null {
  return COMPANY_LOGOS.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? null;
}

/** Compatibility helper for callers that only need the local asset path. */
export function companyLogoPath(name: string): string | null {
  return companyLogoAsset(name)?.src ?? null;
}
