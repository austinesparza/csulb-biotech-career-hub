import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');
const healthFile = path.join(root, 'src', 'lib', 'database-release-health.ts');

const migrations = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();

if (migrations.length === 0) {
  console.error('FAIL no executable migrations found');
  process.exit(1);
}

const newest = migrations.at(-1);
const newestName = newest.replace(/^\d+_/, '').replace(/\.sql$/, '');
const source = fs.readFileSync(healthFile, 'utf8');
const declared = source.match(/EXPECTED_PRODUCTION_MIGRATION_NAME\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? null;

if (declared !== newestName) {
  console.error(`FAIL migration release marker is ${declared ?? 'missing'}, but newest migration is ${newestName}`);
  console.error('Update EXPECTED_PRODUCTION_MIGRATION_NAME when adding a migration so production drift remains visible.');
  process.exit(1);
}

console.log(`ok  migration release marker tracks ${newestName}`);
