import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PERSISTENCE_DIR = resolve(
  process.cwd(),
  'src/lib/ingestion/persistence',
);

describe('persistence module boundary', () => {
  it('uses server-only rather than the server action directive', () => {
    const files = readdirSync(PERSISTENCE_DIR).filter((name) =>
      name.endsWith('.ts'),
    );

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(
        resolve(PERSISTENCE_DIR, file),
        'utf8',
      ).trimStart();

      expect(source.startsWith("'use server'")).toBe(false);
      expect(source.startsWith('"use server"')).toBe(false);
      expect(source).toContain("import 'server-only';");
    }
  });
});
