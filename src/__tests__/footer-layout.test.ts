import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/app/layout.tsx', 'utf8');
const home = readFileSync('src/app/page.tsx', 'utf8');
const styles = readFileSync('src/app/design-reduction.css', 'utf8');

describe('compact public footer', () => {
  it('does not repeat an oversized marketing banner on task pages', () => {
    const footer = layout.slice(layout.indexOf('<footer'), layout.indexOf('</footer>'));

    expect(footer).toContain('site-footer-compact');
    expect(footer).not.toContain('footer-banner');
    expect(footer).not.toContain('The next question is yours');
  });

  it('does not repeat the club-maintainer line', () => {
    expect(layout).not.toContain('Curated and reviewed by the CSULB Biotechnology Club.');
    expect(layout).toContain('<span>CSULB</span> Biotech Career Hub');
  });

  it('keeps the compact footer responsive', () => {
    expect(styles).toContain('.site-footer-compact .footer-grid');
    expect(styles).toContain('grid-template-columns: 1fr;');
  });

  it('restores the zebrafish story only on the homepage', () => {
    expect(home).toContain('home-zebrafish-coda');
    expect(home).toContain('/brand/zebrafish-vasculature.webp');
    expect(styles).toContain('.home-zebrafish-coda');
  });
});
