import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { companyLogoAsset, companyLogoPath } from '../lib/companyLogos';

const home = readFileSync('src/app/page.tsx', 'utf8');
const directory = readFileSync('src/app/companies/company-directory.tsx', 'utf8');
const board = readFileSync('src/app/internships/board.tsx', 'utf8');
const styles = readFileSync('src/app/career-hub-v2.css', 'utf8');

describe('employer logo presentation', () => {
  it('uses a clean scalable Xaira source and preserves wide-logo fitting', () => {
    expect(companyLogoAsset('Xaira Therapeutics')).toEqual({
      src: '/brand/logos/xaira-therapeutics.svg',
      fit: 'wide',
    });
    expect(companyLogoPath('Xaira')).toBe('/brand/logos/xaira-therapeutics.svg');
    expect(companyLogoPath('Xaira Therapeutics')).not.toContain('.png');
  });

  it('adds real compact marks for historical employers shown in the directory', () => {
    expect(companyLogoAsset('3M')).toEqual({ src: '/brand/logos/3m.svg', fit: 'compact' });
    expect(companyLogoAsset('AbbVie')).toEqual({ src: '/brand/logos/abbvie.svg', fit: 'compact' });
  });

  it('renders the employers currently used by the featured opportunity ledger', () => {
    expect(companyLogoAsset('Pfizer')).toEqual({
      src: '/brand/logos/pfizer.svg',
      fit: 'wide',
    });
    expect(companyLogoAsset('Pfizer Inc.')).toEqual({
      src: '/brand/logos/pfizer.svg',
      fit: 'wide',
    });
    expect(companyLogoAsset('Gilead Sciences, Inc.')).toEqual({
      src: '/brand/logos/gilead-sciences.svg',
      fit: 'wide',
    });
    expect(companyLogoAsset('Catalent Pharma Solutions')).toEqual({
      src: '/brand/logos/catalent.svg',
      fit: 'wide',
    });
  });

  it('covers more high-value historical employers with traceable local marks', () => {
    expect(companyLogoAsset('Fujifilm Diosynth Biotechnologies')).toEqual({
      src: '/brand/logos/fujifilm.svg',
      fit: 'wide',
    });
    expect(companyLogoAsset('Merck & Co.')).toEqual({
      src: '/brand/logos/merck.svg',
      fit: 'compact',
    });
    expect(companyLogoAsset('Genentech')).toEqual({
      src: '/brand/logos/genentech.svg',
      fit: 'wide',
    });
    expect(companyLogoAsset('Thermo Fisher Scientific')).toEqual({
      src: '/brand/logos/thermo-fisher-scientific.svg',
      fit: 'wide',
    });
  });

  it('recognizes the current Johnson & Johnson business name', () => {
    expect(companyLogoPath('Johnson & Johnson Innovative Medicine')).toBe(
      '/brand/logos/johnson-johnson.svg',
    );
  });

  it('shows official marks for the remaining current employers', () => {
    expect(companyLogoAsset('Fred Hutch')).toEqual({
      src: '/brand/logos/fred-hutch.svg',
      fit: 'wide',
    });
    expect(companyLogoAsset('Kite Pharma')).toEqual({
      src: '/brand/logos/kite-pharma.png',
      fit: 'wide',
    });
    expect(companyLogoAsset('Roche')).toEqual({
      src: '/brand/logos/roche.png',
      fit: 'wide',
    });
    expect(companyLogoAsset('Anto Bio')).toEqual({
      src: '/brand/logos/anto-bio.png',
      fit: 'compact',
    });
    expect(companyLogoAsset('Cedars-Sinai')).toEqual({
      src: '/brand/logos/cedars-sinai.png',
      fit: 'wide',
    });
    expect(companyLogoAsset('Elanco')).toEqual({
      src: '/brand/logos/elanco.svg',
      fit: 'compact',
    });
    expect(companyLogoAsset('PBS Biotech')).toEqual({
      src: '/brand/logos/pbs-biotech.png',
      fit: 'wide',
    });
  });

  it('covers every employer in the current public directory', () => {
    const currentEmployers = [
      'Amgen',
      'Anto Bio',
      'CAS',
      'Catalent',
      'Cedars-Sinai',
      'Elanco',
      'Fred Hutch',
      'Genentech',
      'Gilead Sciences',
      'Ginkgo Bioworks',
      'Johnson & Johnson',
      'Kite Pharma',
      'MD Anderson Cancer Center',
      'Merck',
      'PBS Biotech',
      'Pfizer',
      'Roche',
      'Sanofi',
      'Xaira Therapeutics',
    ];

    expect(currentEmployers.filter((name) => !companyLogoAsset(name))).toEqual([]);
  });

  it('opens the directory on current employers so the first view is actionable', () => {
    expect(directory).toContain("useState<DirectoryFilter>('current')");
  });

  it('uses fit metadata in every public employer-mark surface', () => {
    expect(home).toContain('companyLogoAsset(name)');
    expect(home).toContain('logo-${logo.fit}');
    expect(directory).toContain('companyLogoAsset(company.name)');
    expect(directory).toContain('logo-${logo.fit}');
    expect(board).toContain('companyLogoAsset(name)');
    expect(board).toContain('logo-${logo.fit}');
  });

  it('keeps the final responsive layer from stretching or cropping marks', () => {
    const layer = styles.slice(styles.indexOf('/* Authoritative employer-mark presentation.'));
    expect(layer).toContain('object-fit: contain');
    expect(layer).toContain('object-position: left center');
    expect(layer).toContain('.featured-company.logo-compact');
    expect(layer).toContain('.company-directory-card {');
    expect(layer).toContain('min-height: 0');
    expect(layer).toContain('@media (max-width: 700px)');
  });
});
