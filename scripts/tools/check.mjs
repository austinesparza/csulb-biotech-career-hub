import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(readFileSync('config/ai-tooling.json', 'utf8'));
const checks = [
  ['Scrapling', '.tools/scraping/bin/python', ['-c', `import scrapling; assert scrapling.__version__ == '${config.scrapling.version}'`]],
  ['Graphify', '.tools/graphify/bin/python', ['-c', `import tree_sitter_sql; import importlib.metadata; assert importlib.metadata.version('${config.graphify.package}') == '${config.graphify.version}'`]],
  ['OmniRoute', '.tools/omniroute/node_modules/.bin/omniroute', ['--version']],
];

let failed = false;
for (const [label, command, args] of checks) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status === 0) console.log(`ok  ${label}`);
  else {
    failed = true;
    console.error(`not ok  ${label}: ${(result.stderr || result.stdout || 'not installed').trim()}`);
  }
}
process.exit(failed ? 1 : 0);
