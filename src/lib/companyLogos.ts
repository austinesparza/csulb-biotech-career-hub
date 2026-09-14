export type CompanyLogoFit = 'wide' | 'compact';

export interface CompanyLogoAsset {
  src: string;
  fit: CompanyLogoFit;
}

const COMPANY_LOGOS: Array<[RegExp, CompanyLogoAsset]> = [
  [/^3m$/i, { src: '/brand/logos/3m.svg', fit: 'compact' }],
  [/^abbvie$/i, { src: '/brand/logos/abbvie.svg', fit: 'compact' }],
  [/^fujifilm(?:\s+diosynth\s+biotechnologies|\s+biotechnologies)?$/i, { src: '/brand/logos/fujifilm.svg', fit: 'compact' }],
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
];

export function companyLogoAsset(name: string): CompanyLogoAsset | null {
  return COMPANY_LOGOS.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? null;
}

/** Compatibility helper for callers that only need the local asset path. */
export function companyLogoPath(name: string): string | null {
  return companyLogoAsset(name)?.src ?? null;
}
