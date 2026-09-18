import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/app/layout.tsx', 'utf8');
const mobileNavigation = readFileSync('src/components/mobile-navigation.tsx', 'utf8');
const styles = readFileSync('src/app/career-hub-v2.css', 'utf8');

describe('responsive navigation stylesheet contract', () => {
  it('loads the versioned stylesheet entry that contains the mobile navigation rules', () => {
    expect(layout).toContain("import './career-hub-v2.css';");
    expect(styles).toContain('.mobile-nav { display: none; }');
  });

  it('shows the compact navigation only below the tablet breakpoint', () => {
    const responsiveLayer = styles.slice(styles.indexOf('/* Authoritative responsive layer.'));

    expect(responsiveLayer).toContain('@media (max-width: 980px) {');
    expect(responsiveLayer).toContain('.mobile-nav { position: relative; display: block; flex: none; }');
    expect(styles).toMatch(/@media \(max-width: 980px\) \{[\s\S]*?\.site-nav \{ display: none; \}/);
  });

  it('closes the mobile menu when a destination is selected', () => {
    expect(layout).toContain('<MobileNavigation />');
    expect(mobileNavigation).toContain("'use client';");
    expect(mobileNavigation).toContain('detailsRef.current.open = false;');
    expect(mobileNavigation).toContain('onNavigate={closeNavigation}');
  });
});
