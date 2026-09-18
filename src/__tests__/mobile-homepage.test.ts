import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/app/layout.tsx', 'utf8');
const home = readFileSync('src/app/page.tsx', 'utf8');
const mobileStyles = readFileSync('src/app/mobile-polish.css', 'utf8');
const reductionStyles = readFileSync('src/app/design-reduction.css', 'utf8');

describe('mobile homepage finishing contract', () => {
  it('loads the narrow-screen polish after the core editorial stylesheet', () => {
    const coreIndex = layout.indexOf("import './career-hub-v2.css';");
    const polishIndex = layout.indexOf("import './mobile-polish.css';");

    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(polishIndex).toBeGreaterThan(coreIndex);
  });

  it('uses the concise editorial headline without the rejected directory title', () => {
    expect(home).toContain('Opportunities for what comes next.');
    expect(home).not.toContain('Biotech internships and research opportunities for CSULB students.');
    expect(mobileStyles).toContain('overflow-wrap: normal;');
    expect(mobileStyles).toContain('word-break: normal;');
    expect(mobileStyles).toContain('hyphens: none;');
    expect(reductionStyles).toContain('text-wrap: balance;');
  });

  it('keeps the phone hero compact enough to expose the scientific visual sooner', () => {
    expect(reductionStyles).toContain('@media (max-width: 700px)');
    expect(reductionStyles).toContain('padding-block: 38px;');
    expect(reductionStyles).toContain('width: min(82vw, 330px);');
    expect(reductionStyles).toContain('aspect-ratio: 1;');
  });

  it('keeps the full Career Hub name visible in the mobile masthead', () => {
    expect(layout).toContain('<span className="brand-product">Biotech Career Hub</span>');
    expect(reductionStyles).not.toMatch(/\.brand-product\s*\{\s*display:\s*none;/);
  });

  it('uses the selected scientific imagery to help students understand the fields', () => {
    expect(home).toContain('/brand/hero-epithelial-cells.webp');
    expect(home).toContain('/brand/discipline-cancer.webp');
    expect(home).toContain('/brand/discipline-data-science.webp');
    expect(home).toContain('/brand/zebrafish-vasculature.webp');
    expect(home).toContain('See where the science can take you.');
  });
});
