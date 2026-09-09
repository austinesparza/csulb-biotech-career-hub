import { BlockedUrlError, isBlockedIp, safeFetch } from '../../lib/pipeline/safe-fetch';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
