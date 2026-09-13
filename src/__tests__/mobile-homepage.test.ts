import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/app/layout.tsx', 'utf8');
const home = readFileSync('src/app/page.tsx', 'utf8');
const mobileStyles = readFileSync('src/app/mobile-polish.css', 'utf8');

describe('mobile homepage finishing contract', () => {
  it('loads the narrow-screen polish after the core editorial stylesheet', () => {
    const coreIndex = layout.indexOf("import './career-hub-v2.css';");
    const polishIndex = layout.indexOf("import './mobile-polish.css';");

    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(polishIndex).toBeGreaterThan(coreIndex);
  });

  it('uses intentional hero line groups instead of allowing a word to split', () => {
    expect(home).toContain('<span className="hero-line">Opportunities</span>');
    expect(home).toContain('<span className="hero-line">for what</span>');
    expect(home).toContain('<span className="hero-line">comes next.</span>');
    expect(mobileStyles).toContain('overflow-wrap: normal;');
    expect(mobileStyles).toContain('word-break: normal;');
    expect(mobileStyles).toContain('hyphens: none;');
    expect(mobileStyles).toContain('white-space: nowrap;');
  });

  it('keeps the phone hero compact enough to expose the scientific visual sooner', () => {
    expect(mobileStyles).toContain('@media (max-width: 520px)');
    expect(mobileStyles).toContain('padding-block: 34px 26px;');
    expect(mobileStyles).toContain('min-height: 300px;');
  });
});
