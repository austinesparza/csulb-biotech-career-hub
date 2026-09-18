import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function walk(directory, predicate) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target, predicate);
    return predicate(target) ? [target] : [];
  });
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function fail(message) {
  failures.push(message);
}

const requiredDocuments = [
  'README.md',
  'PRODUCT.md',
  'DESIGN.md',
  'HANDOFF.md',
  'SECURITY.md',
  'docs/README.md',
  'docs/current-architecture.md',
  'docs/environment-reference.md',
  'docs/operations-reference.md',
  'docs/documentation-maintenance.md',
  'docs/16-current-system-status.md',
];

for (const file of requiredDocuments) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing required document: ${file}`);
}

const markdownFiles = [
  ...fs.readdirSync(root)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(root, name)),
  ...walk(path.join(root, 'docs'), (file) => file.endsWith('.md')),
];

for (const absoluteFile of markdownFiles) {
  const relativeFile = path.relative(root, absoluteFile);
  const source = fs.readFileSync(absoluteFile, 'utf8');
  const links = source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g);

  for (const match of links) {
    const rawTarget = match[1].trim();
    const fileTarget = rawTarget.split('#')[0];
    if (!fileTarget || /^(https?:|mailto:)/.test(fileTarget)) continue;
    if (fileTarget.startsWith('/')) continue;

    const resolved = path.resolve(path.dirname(absoluteFile), fileTarget);
    if (!fs.existsSync(resolved)) {
      fail(`${relativeFile}: broken local link ${rawTarget}`);
    }
  }
}

const environmentReference = read('docs/environment-reference.md');
const exampleVariables = read('.env.example')
  .split('\n')
  .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
  .filter(Boolean);

for (const variable of exampleVariables) {
  if (!environmentReference.includes(`\`${variable}\``)) {
    fail(`docs/environment-reference.md does not document ${variable}`);
  }
}

function appRouteFromFile(file) {
  const relative = path.relative(path.join(root, 'src/app'), file);
  const route = relative === 'page.tsx'
    ? ''
    : relative.replace(/[/\\]page\.tsx$/, '').replaceAll(path.sep, '/');
  return route ? `/${route}` : '/';
}

const applicationRoutes = walk(path.join(root, 'src/app'), (file) => file.endsWith('page.tsx'))
  .map(appRouteFromFile)
  .filter((route) => !route.startsWith('/auth/'));
const architecture = read('docs/current-architecture.md');

for (const route of applicationRoutes) {
  if (!architecture.includes(`\`${route}\``)) {
    fail(`docs/current-architecture.md does not list application route ${route}`);
  }
}

const vercel = JSON.parse(read('vercel.json'));
const operations = read('docs/operations-reference.md');
for (const cron of vercel.crons ?? []) {
  if (!operations.includes(`\`${cron.path}\``) || !operations.includes(cron.schedule)) {
    fail(`docs/operations-reference.md does not match Vercel cron ${cron.path} (${cron.schedule})`);
  }
}

const historicalRecords = [
  'docs/01-product-brief.md',
  'docs/02-mvp-scope.md',
  'docs/05-ui-plan.md',
  'docs/10-github-issues.md',
  'docs/11-build-plan-risks.md',
  'docs/13-pipeline.md',
  'docs/automated-ingestion-audit.md',
  'docs/automated-ingestion-schema.md',
  'docs/ingestion-core-greenhouse.md',
  'docs/ingestion-persistence-bridge.md',
  'docs/operations-search-and-automation-plan.md',
];

for (const file of historicalRecords) {
  if (!read(file).slice(0, 700).includes('Historical record')) {
    fail(`${file} is missing its Historical record banner`);
  }
}

if (failures.length > 0) {
  console.error(`Documentation check failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Documentation check passed: ${markdownFiles.length} Markdown files, ` +
  `${exampleVariables.length} configured variables, ${applicationRoutes.length} application routes.`,
);
