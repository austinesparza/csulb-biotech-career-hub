import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const helper = path.join(path.dirname(require.resolve('@next/eslint-plugin-next')), 'utils/get-root-dirs.js');
const { getRootDirs } = require(helper) as { getRootDirs(context: {
  cwd: string; settings: { next?: { rootDir?: string | string[] } };
}): string[] };

describe('Next lint root-directory glob compatibility', () => {
  it('preserves default roots, brace globs, and arrays of roots through the installed plugin', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'next-lint-roots-'));
    try {
      for (const directory of ['first', 'second', 'third']) mkdirSync(path.join(root, 'apps', directory), { recursive: true });
      const context = { cwd: root, settings: {} };
      expect(getRootDirs(context)).toEqual([root]);
      const normalized = (roots: string[]) => roots.map(directory => path.resolve(directory)).sort();
      expect(normalized(getRootDirs({ ...context, settings: { next: { rootDir: `${root}/apps/{first,second}` } } })))
        .toEqual([path.join(root, 'apps', 'first'), path.join(root, 'apps', 'second')]);
      expect(normalized(getRootDirs({ ...context, settings: { next: { rootDir: [`${root}/apps/{first,second}`, `${root}/apps/third`] } } })))
        .toEqual(['first', 'second', 'third'].map(directory => path.join(root, 'apps', directory)));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('does not reproduce the reported brace-walker stack overflow', () => {
    const code = `
      const {getRootDirs} = require(${JSON.stringify(helper)});
      try {
        getRootDirs({cwd: process.cwd(), settings: {next: {rootDir: '{'.repeat(4000) + 'x' + '}'.repeat(4000)}}});
      } catch (error) {
        if (error instanceof RangeError) throw error;
      }
    `;
    expect(() => execFileSync(process.execPath, ['-e', code], { timeout: 10_000, stdio: 'pipe' })).not.toThrow();
  });
});
