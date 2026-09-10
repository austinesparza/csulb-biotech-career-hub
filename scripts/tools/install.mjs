import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-tooling.json'), 'utf8'));
const python = process.env.PIPELINE_PYTHON || 'python3';

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function venv(name) {
  const dir = path.join('.tools', name);
  const bin = path.join(dir, 'bin', 'python');
  mkdirSync('.tools', { recursive: true });
  run(python, ['-m', 'venv', dir]);
  return bin;
}

const scrapingPython = venv('scraping');
run(scrapingPython, ['-m', 'pip', 'install', '--disable-pip-version-check', `scrapling[fetchers]==${config.scrapling.version}`]);

const graphifyPython = venv('graphify');
run(graphifyPython, ['-m', 'pip', 'install', '--disable-pip-version-check', `${config.graphify.package}[sql]==${config.graphify.version}`]);

run('npm', [
  'install', '--prefix', '.tools/omniroute', '--ignore-scripts', '--no-audit', '--no-fund',
  `omniroute@${config.omniroute.version}`,
]);

if (process.argv.includes('--browser')) {
  run(scrapingPython, ['-m', 'playwright', 'install', 'chromium'], {
    PLAYWRIGHT_BROWSERS_PATH: path.join(root, '.tools', 'browsers'),
  });
} else {
  console.log('Browser binary not installed. Re-run `npm run tools:install -- --browser` to enable JS rendering.');
}
