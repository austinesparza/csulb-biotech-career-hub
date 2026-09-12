const COMPANY_LOGOS: Array<[RegExp, string]> = [
  [/^johnson\s*(?:&|and)\s*johnson$/i, '/brand/logos/johnson-johnson.svg'],
  [/^amgen$/i, '/brand/logos/amgen.svg'],
  [/^ginkgo bioworks$/i, '/brand/logos/ginkgo-bioworks.svg'],
  [/^sanofi$/i, '/brand/logos/sanofi.svg'],
  [/md anderson/i, '/brand/logos/md-anderson.png'],
  [/^cas$/i, '/brand/logos/cas.svg'],
];

export function companyLogoPath(name: string): string | null {
  return COMPANY_LOGOS.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? null;
}
