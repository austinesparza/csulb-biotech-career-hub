import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/app/layout.tsx', 'utf8');
const home = readFileSync('src/app/page.tsx', 'utf8');
const styles = readFileSync('src/app/career-hub.css', 'utf8');

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

  it('does not repeat the footer callout in a second homepage coda', () => {
    expect(home).not.toContain('home-coda');
    expect(styles).not.toContain('.home-coda');
  });
});
