import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReviewDigest,
  buildSyntheticTestRow,
  createRawMessage,
  escapeHtml,
  parseRecipients,
  safeHttpsUrl,
  supabaseSecretHeaders,
} from './review-digest.mjs';

test('synthetic test row is unmistakably non-production data', () => {
  const row = buildSyntheticTestRow(new Date('2026-09-08T12:00:00Z'));
  assert.equal(row.id, 'synthetic-gmail-test');
  assert.equal(row.audience_bucket, 'graduate');
  assert.match(row.title, /Synthetic/);
  assert.match(row.eligibility, /only to verify private officer email delivery/);
  assert.equal(row.first_seen_at, '2026-09-08T00:00:00Z');
});

test('recipient parsing rejects header injection and removes duplicates', () => {
  assert.deepEqual(parseRecipients('reviewer@example.edu, reviewer@example.edu, club@example.org'), [
    'reviewer@example.edu', 'club@example.org',
  ]);
  assert.throws(() => parseRecipients('club@example.org\nBcc: attacker@example.org'));
  assert.throws(() => parseRecipients(''));
});

test('digest counts graduate, urgent, unresolved, and restricted records', () => {
  const rows = [
    {
      title: 'Graduate Genomics Intern', posting_url: 'https://example.org/job/1', deadline: '2026-09-14',
      relevance_score: 90, audience_bucket: 'graduate', audience_reason: 'Master students explicitly eligible',
      companies: { name: 'Example Bio' },
    },
    {
      title: '<script>Unresolved</script>', posting_url: null, deadline: null,
      relevance_score: 50, audience_bucket: 'unknown', audience_reason: null,
      companies: { name: 'Example Lab' },
    },
    {
      title: 'Restricted program', posting_url: 'https://example.org/job/3', deadline: '2026-10-30',
      relevance_score: 75, audience_bucket: 'special', audience_reason: 'Institution-specific enrollment requirement',
      companies: { name: 'Example Institute' },
    },
  ];
  const digest = buildReviewDigest(rows, { now: new Date('2026-09-07T12:00:00Z'), dashboardUrl: 'https://example.org/admin/review' });
  assert.deepEqual(digest.counts, { total: 3, submissions: 0, urgent: 1, graduates: 1, unresolved: 1, restricted: 1 });
  assert.match(digest.subject, /3 opportunities ready for review/);
  assert.doesNotMatch(digest.html, /<script>/);
  assert.match(digest.html, /&lt;script&gt;Unresolved&lt;\/script&gt;/);
});

test('digest labels public submissions without exposing contact details', () => {
  const digest = buildReviewDigest([{
    origin: 'submission', title: 'Submitted role', posting_url: 'https://example.org/role',
    audience_bucket: 'unknown', companies: { name: 'Example Bio' }, submitter_email: 'private@example.org',
  }]);
  assert.equal(digest.counts.submissions, 1);
  assert.match(digest.subject, /1 items ready for review/);
  assert.match(digest.text, /\[SUBMISSION\]/);
  assert.doesNotMatch(digest.text + digest.html, /private@example\.org/);
});

test('raw email is base64url MIME without injected subject lines', () => {
  const raw = createRawMessage({
    from: 'Career Hub <sender@example.org>',
    to: ['reviewer@example.edu'],
    subject: 'Review\nBcc: attacker@example.org',
    text: 'Plain',
    html: '<p>HTML</p>',
  });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /Subject: Review Bcc: attacker@example.org/);
  assert.doesNotMatch(decoded, /\r\nBcc:/);
});

test('escapeHtml escapes every dangerous delimiter used by the digest', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#039;');
});

test('email links accept HTTPS only', () => {
  assert.equal(safeHttpsUrl('https://example.org/job/1'), 'https://example.org/job/1');
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsUrl('http://example.org/job/1'), null);
  const digest = buildReviewDigest([{ title: 'Unsafe link', posting_url: 'javascript:alert(1)', companies: { name: 'Example' } }]);
  assert.doesNotMatch(digest.html, /javascript:/i);
});

test('Supabase secret key uses only the apikey header', () => {
  const headers = supabaseSecretHeaders('sb_secret_test-value');
  assert.deepEqual(headers, { apikey: 'sb_secret_test-value' });
  assert.equal('Authorization' in headers, false);
  assert.throws(() => supabaseSecretHeaders('eyJlegacy-service-role'));
  assert.throws(() => supabaseSecretHeaders(''));
});
