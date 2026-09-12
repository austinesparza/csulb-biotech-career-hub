import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/app/layout.tsx', 'utf8');
const styles = readFileSync('src/app/career-hub.css', 'utf8');

describe('responsive mobile layout', () => {
  it('keeps every primary public route available when the desktop navigation is hidden', () => {
    const mobileNav = layout.slice(
      layout.indexOf('<nav className="site-wrap mobile-site-nav"'),
      layout.indexOf('</nav>', layout.indexOf('<nav className="site-wrap mobile-site-nav"')),
    );

    expect(mobileNav).toContain('aria-label="Mobile primary navigation"');
    expect(mobileNav).toContain('href="/internships"');
    expect(mobileNav).toContain('href="/calendar"');
    expect(mobileNav).toContain('href="/eligibility"');
    expect(mobileNav).toContain('href="/companies"');
    expect(mobileNav).toContain('href="/about"');
  });

  it('shows a concise mobile-only viewing note without claiming mobile is unsupported', () => {
    expect(layout).toContain('className="mobile-view-note"');
    expect(layout).toContain('The hub works here');
    expect(styles).toContain('.mobile-site-nav,\n.mobile-view-note { display: none; }');
    expect(styles).toContain('@media (max-width: 700px) {\n  .mobile-view-note {\n    display: block;');
  });

  it('places the authoritative mobile overrides after the desktop refinements', () => {
    const responsiveLayer = styles.indexOf('/* Authoritative responsive layer. Keep this after desktop refinements. */');

    expect(responsiveLayer).toBeGreaterThan(styles.lastIndexOf('/* Rebalanced editorial pages */'));
    expect(styles.slice(responsiveLayer)).toContain('.trust-ledger-inner { grid-template-columns: 1fr; }');
    expect(styles.slice(responsiveLayer)).toContain('.biotech-pathway-grid,\n  .company-directory-grid,\n  .company-filters,\n  .resource-grid { grid-template-columns: 1fr; }');
    expect(styles.slice(responsiveLayer)).toContain('.prepare-hero,\n  .about-hero { grid-template-columns: 1fr; min-height: auto; }');
  });

  it('keeps the detailed calendar usable through horizontal touch scrolling', () => {
    const responsiveLayer = styles.slice(styles.indexOf('/* Authoritative responsive layer. Keep this after desktop refinements. */'));

    expect(responsiveLayer).toContain('.deadline-calendar-scroll {');
    expect(styles).toContain('.deadline-calendar-scroll { overflow-x: auto;');
  });
});
