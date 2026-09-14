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

  it('recognizes the current Johnson & Johnson business name', () => {
    expect(companyLogoPath('Johnson & Johnson Innovative Medicine')).toBe(
      '/brand/logos/johnson-johnson.svg',
    );
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
