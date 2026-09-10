import { BlockedUrlError, createUsaJobsFetcher, isBlockedIp, safeFetch } from '../../lib/pipeline/safe-fetch';
import type { Fetcher } from '../../lib/pipeline/worker';

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, detail = '') => {
  if (condition) pass += 1;
  else fail += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${detail}`}`);
};

console.log('=== Address ranges ===\n');
for (const address of [
  '0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254',
  '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1',
  '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1',
]) {
  ok(`blocks ${address}`, isBlockedIp(address));
}
for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
  ok(`allows public ${address}`, !isBlockedIp(address));
}
ok('unparseable address fails closed', isBlockedIp('not-an-ip'));

console.log('\n=== URL checks before network ===\n');
for (const url of [
  'file:///etc/passwd',
  'ftp://example.com/file',
  'https://user:secret@example.com/',
  'http://127.0.0.1/admin',
  'http://169.254.169.254/latest/meta-data/',
  'not a url',
]) {
  let blocked = false;
  try { await safeFetch(url); }
  catch (error) { blocked = error instanceof BlockedUrlError; }
  ok(`rejects ${url}`, blocked);
}

console.log('\n=== USAJOBS credential boundary ===\n');
const usaJobsFetch: Fetcher = createUsaJobsFetcher({ apiKey: 'test-key', registeredEmail: 'officer@example.edu' });
for (const url of [
  'http://data.usajobs.gov/api/Search',
  'https://example.com/api/Search',
  'https://data.usajobs.gov:444/api/Search',
  'https://data.usajobs.gov/other',
]) {
  let blocked = false;
  try { await usaJobsFetch(url, { etag: null, lastModified: null }); }
  catch (error) { blocked = error instanceof BlockedUrlError; }
  ok(`does not send USAJOBS credentials to ${url}`, blocked);
}
for (const credentials of [
  { apiKey: '', registeredEmail: 'officer@example.edu' },
  { apiKey: 'key\ninjected', registeredEmail: 'officer@example.edu' },
  { apiKey: 'test-key', registeredEmail: 'officer@example.edu\r\nX-Evil: yes' },
]) {
  let rejected = false;
  try { createUsaJobsFetcher(credentials); }
  catch { rejected = true; }
  ok('rejects empty or multiline USAJOBS credentials', rejected);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
