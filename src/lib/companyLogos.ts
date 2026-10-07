export type CompanyLogoFit = 'wide' | 'compact';

export interface CompanyLogoAsset {
  src: string;
  fit: CompanyLogoFit;
}

const COMPANY_LOGOS: Array<[RegExp, CompanyLogoAsset]> = [
  [/^labcorp$/i, { src: '/brand/logos/labcorp.png', fit: 'wide' }],
  [/^metrex$/i, { src: '/brand/logos/metrex.svg', fit: 'wide' }],
  [/^orange\s+county\s+coastkeeper$/i, { src: '/brand/logos/orange-county-coastkeeper.png', fit: 'wide' }],
  [/^scan\s+health\s+plan$/i, { src: '/brand/logos/scan-health-plan.svg', fit: 'wide' }],
  [/^salk\s+institute$/i, { src: '/brand/logos/salk-institute.png', fit: 'compact' }],
  [/^septerna$/i, { src: '/brand/logos/septerna.png', fit: 'wide' }],
  [/^simtra\s+biopharma\s+solutions$/i, { src: '/brand/logos/simtra-biopharma-solutions.svg', fit: 'wide' }],
  [/^terasaki\s+institute$/i, { src: '/brand/logos/terasaki-institute.png', fit: 'wide' }],
  [/^varda\s+space\s+industries$/i, { src: '/brand/logos/varda-space-industries.svg', fit: 'wide' }],
  [/^zymo\s+research$/i, { src: '/brand/logos/zymo-research.svg', fit: 'compact' }],
  [/^beck['’]?s\s+hybrids$/i, { src: '/brand/logos/becks-hybrids.svg', fit: 'wide' }],
  [/^Beckman\s+Coulter\s+Diagnostics$/i, { src: '/brand/logos/beckman-coulter-diagnostics.svg', fit: 'wide' }],
  [/^BeOne\s+Medicines$/i, { src: '/brand/logos/beone-medicines.svg', fit: 'wide' }],
  [/^Corteva\s+Agriscience$/i, { src: '/brand/logos/corteva-agriscience.png', fit: 'wide' }],
  [/^Keros\s+Therapeutics$/i, { src: '/brand/logos/keros-therapeutics.png', fit: 'wide' }],
  [/^Nanopath$/i, { src: '/brand/logos/nanopath.png', fit: 'wide' }],
  [/^ORISE$/i, { src: '/brand/logos/orise.svg', fit: 'compact' }],
  [/^PSC\s+Biotech$/i, { src: '/brand/logos/psc-biotech.png', fit: 'wide' }],
  [/^STAQ\s+Pharma$/i, { src: '/brand/logos/staq-pharma.png', fit: 'wide' }],
  [/^Arcus\s+Biosciences$/i, { src: '/brand/logos/arcus-biosciences.png', fit: 'wide' }],
  [/^AstraZeneca$/i, { src: '/brand/logos/astrazeneca.png', fit: 'wide' }],
  [/^BioMarin$/i, { src: '/brand/logos/biomarin.svg', fit: 'wide' }],
  [/^bristol\s+m(?:y|ey)ers\s+squibb$/i, { src: '/brand/logos/bristol-myers-squibb.svg', fit: 'wide' }],
  [/^Cytokinetics$/i, { src: '/brand/logos/cytokinetics.png', fit: 'wide' }],
  [/^DeciBio$/i, { src: '/brand/logos/decibio.png', fit: 'wide' }],
  [/^(?:enthalpy\s+analytical|onterris)$/i, { src: '/brand/logos/enthalpy-analytical-onterris.svg', fit: 'wide' }],
  [/^GE\s+HealthCare$/i, { src: '/brand/logos/ge-healthcare.webp', fit: 'wide' }],
  [/^Henkel$/i, { src: '/brand/logos/henkel.svg', fit: 'compact' }],
  [/^LabRoots$/i, { src: '/brand/logos/labroots.png', fit: 'wide' }],
  [/^anto(?:\s+bio(?:sciences)?)?$/i, { src: '/brand/logos/anto-bio.png', fit: 'compact' }],
  [/^3m$/i, { src: '/brand/logos/3m.svg', fit: 'compact' }],
  [/^abbvie$/i, { src: '/brand/logos/abbvie.svg', fit: 'compact' }],
  [/^cedars[-\s]sinai$/i, { src: '/brand/logos/cedars-sinai.png', fit: 'wide' }],
  [/^elanco(?:\s+animal\s+health)?$/i, { src: '/brand/logos/elanco.svg', fit: 'compact' }],
  [/^pfizer(?:\s+(?:inc\.?|futures))?$/i, { src: '/brand/logos/pfizer.svg', fit: 'wide' }],
  [/^gilead\s+sciences(?:,?\s+inc\.?)?$/i, { src: '/brand/logos/gilead-sciences.svg', fit: 'wide' }],
  [/^catalent(?:\s+(?:inc\.?|pharma\s+solutions))?$/i, { src: '/brand/logos/catalent.svg', fit: 'wide' }],
  [/^fujifilm(?:\s+diosynth(?:\s+biotechnologies)?|\s+biotechnologies)?$/i, { src: '/brand/logos/fujifilm.svg', fit: 'wide' }],
  [/^merck(?:\s*&\s*co\.)?$/i, { src: '/brand/logos/merck.svg', fit: 'compact' }],
  [/^genentech$/i, { src: '/brand/logos/genentech.svg', fit: 'wide' }],
  [/^thermo\s+fisher(?:\s+scientific)?$/i, { src: '/brand/logos/thermo-fisher-scientific.svg', fit: 'wide' }],
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
  [/^pbs\s+biotech(?:,?\s+inc\.?)?$/i, { src: '/brand/logos/pbs-biotech.png', fit: 'wide' }],
  [/^boehringer\s+ingelheim$/i, { src: '/brand/logos/boehringer-ingelheim.svg', fit: 'wide' }],
  [/^honorhealth$/i, { src: '/brand/logos/honorhealth.svg', fit: 'wide' }],
  [/^mtf\s+biologics$/i, { src: '/brand/logos/mtf-biologics.png', fit: 'wide' }],
  [/^stryker$/i, { src: '/brand/logos/stryker.png', fit: 'wide' }],
  [/^vertex(?:\s+pharmaceuticals)?$/i, { src: '/brand/logos/vertex-pharmaceuticals.png', fit: 'wide' }],
];

export function companyLogoAsset(name: string): CompanyLogoAsset | null {
  return COMPANY_LOGOS.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? null;
}

/** Compatibility helper for callers that only need the local asset path. */
export function companyLogoPath(name: string): string | null {
  return companyLogoAsset(name)?.src ?? null;
}
