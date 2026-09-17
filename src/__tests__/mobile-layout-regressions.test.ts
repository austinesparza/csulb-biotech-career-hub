import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync('src/app/page.tsx', 'utf8');
const planner = readFileSync('src/app/calendar/deadline-planner.tsx', 'utf8');
const styles = readFileSync('src/app/design-reduction.css', 'utf8');

describe('mobile layout regressions', () => {
  it('stacks featured opportunity content instead of restoring desktop columns', () => {
    expect(home).toContain('className="featured-role"');
    expect(styles).toContain('"company arrow"');
    expect(styles).toContain('"role arrow"');
    expect(styles).toContain('"deadline arrow"');
    expect(styles).toContain('grid-area: deadline;');
  });

  it('gives the zebrafish call to action enough vertical room on phones', () => {
    expect(styles).toContain('min-height: 240px;');
    expect(styles).toContain('aspect-ratio: 16 / 10;');
    expect(styles).toContain('object-fit: contain;');
  });

  it('uses a mobile agenda instead of a clipped seven-column month grid', () => {
    expect(planner).toContain('className="deadline-agenda"');
    expect(planner).toContain('className="deadline-agenda-month"');
    expect(styles).toContain('.deadline-calendar-scroll {\n    display: none;');
    expect(styles).toContain('.deadline-agenda {\n    display: grid;');
  });
});
