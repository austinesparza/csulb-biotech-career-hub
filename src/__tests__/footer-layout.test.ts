import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/app/layout.tsx', 'utf8');
const home = readFileSync('src/app/page.tsx', 'utf8');
const styles = readFileSync('src/app/career-hub-v2.css', 'utf8');
const refinements = readFileSync('src/app/site-refinement.css', 'utf8');

describe('editorial footer containment', () => {
  it('uses a dimensioned footer image instead of an uncontained fill image', () => {
    const footer = layout.slice(layout.indexOf('<footer'), layout.indexOf('</footer>'));

    expect(footer).toContain('className="footer-banner-image"');
    expect(footer).toContain('src="/brand/footer-purkinje-cells.webp"');
    expect(footer).toContain('width={1200}');
    expect(footer).toContain('height={569}');
    expect(footer).not.toMatch(/<Image[^>]*\bfill\b/);
  });

  it('keeps the banner inside the footer stacking context', () => {
    expect(styles).toContain('.site-footer { position: relative; z-index: 0; isolation: isolate; overflow: hidden;');
    expect(styles).toContain('.footer-banner-image { display: block; width: 100%; height: 390px;');
  });

  it('uses the local credited footer image instead of a remote CSS dependency', () => {
    expect(layout).toContain('alt="Cerebellar Purkinje cells expressing fluorescent red proteins"');
    expect(refinements).toContain('.footer-banner-image {\n  opacity: 1;');
    expect(refinements).not.toContain('stiched_fish_blending_high_contrast.png');
  });

  it('compacts the mobile footer without repeating the product title', () => {
    const mobileFooter = refinements.slice(refinements.indexOf('/* Authoritative mobile footer layout.'));
    expect(mobileFooter).toContain('.footer-identity .footer-title');
    expect(mobileFooter).toContain('display: none');
    expect(mobileFooter).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(mobileFooter).toContain('.footer-links > div:last-child');
    expect(mobileFooter).toContain('grid-column: 1 / -1');
  });

  it('does not repeat the footer callout in a second homepage coda', () => {
    expect(home).not.toContain('home-coda');
    expect(styles).not.toContain('.home-coda');
  });
});
