import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PERSISTENCE_DIR = '/home/runner/work/csulb-biotech-career-hub/csulb-biotech-career-hub/src/lib/ingestion/persistence';

describe('persistence module boundary', () => {
  it('does not mark persistence modules as server actions', () => {
    const files = readdirSync(PERSISTENCE_DIR).filter((name) => name.endsWith('.ts'));

    for (const file of files) {
      const source = readFileSync(join(PERSISTENCE_DIR, file), 'utf8').trimStart();
      expect(source.startsWith("'use server'") || source.startsWith('"use server"')).toBe(false);
      expect(source.startsWith("import 'server-only';") || source.startsWith('import "server-only";')).toBe(true);
    }
  });
});
