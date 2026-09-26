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

console.log('\n=== Redirect evidence ===\n');
{
  const realFetch = globalThis.fetch;
  const hops: Record<string, Response> = {
    'https://8.8.8.8/jobs/R-1': new Response(null, { status: 301, headers: { location: '/en/jobs/R-1' } }),
    'https://8.8.8.8/en/jobs/R-1': new Response('<h1>Role</h1>', { status: 200, headers: { 'content-type': 'text/html' } }),
  };
  globalThis.fetch = (async (input: string | URL) => hops[String(input)] ?? new Response('', { status: 500 })) as typeof fetch;
  try {
    const result = await safeFetch('https://8.8.8.8/jobs/R-1');
    const redirects = 'body' in result ? result.redirects ?? [] : [];
    ok('records each redirect hop with status and resolved location',
      redirects.length === 1 && redirects[0].status === 301 && redirects[0].location === 'https://8.8.8.8/en/jobs/R-1');
    ok('reports the final URL and content type', result.finalUrl === 'https://8.8.8.8/en/jobs/R-1'
      && 'body' in result && result.contentType === 'text/html');
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('\n=== Reviewed origin boundary ===\n');
{
  const realFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    requested.push(String(input));
    return new Response(null, { status: 302, headers: { location: 'https://1.1.1.1/jobs/other' } });
  }) as typeof fetch;
  try {
    let blocked = false;
    try { await safeFetch('https://8.8.8.8/jobs/R-1', { restrictOrigin: 'https://8.8.8.8' }); }
    catch (error) { blocked = error instanceof BlockedUrlError; }
    ok('a reviewed origin does not follow a redirect to another host', blocked && requested.length === 1,
      JSON.stringify(requested));
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
