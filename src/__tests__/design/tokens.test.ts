import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colors, dimensions } from '../../lib/design/tokens';

const css = fs.readFileSync('src/app/globals.css', 'utf8').toLowerCase();

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)!.map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('design token contract', () => {
  for (const [name, value] of Object.entries(colors)) {
    it(`keeps ${name} synchronized with CSS`, () => {
      expect(css).toContain(value);
    });
  }

  it('uses separate colors for separate dimensions', () => {
    expect(new Set(Object.values(dimensions)).size).toBe(Object.values(dimensions).length);
  });

  it('uses the accessible timing mark for small graphics on paper', () => {
    expect(contrast(colors.goldMark, colors.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(colors.gold, colors.paper)).toBeLessThan(3);
  });

  it('keeps core text colors at AA contrast on paper', () => {
    for (const color of [colors.ink, colors.inkSoft, colors.teal, colors.eligible, colors.restricted]) {
      expect(contrast(color, colors.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
