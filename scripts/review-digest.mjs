import { pathToFileURL } from 'node:url';

const DAY_MS = 86_400_000;

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function parseRecipients(value) {
  const recipients = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const simpleEmail = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
  if (recipients.length === 0) throw new Error('REVIEW_DIGEST_RECIPIENTS is empty');
  for (const recipient of recipients) {
    if (!simpleEmail.test(recipient) || /[\r\n]/.test(recipient)) {
      throw new Error(`Invalid review digest recipient: ${recipient}`);
    }
  }
  return [...new Set(recipients)];
}

export function safeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function companyName(row) {
  if (Array.isArray(row.companies)) return row.companies[0]?.name ?? 'Unknown company';
  return row.companies?.name ?? 'Unknown company';
}

function deadlineDays(row, now) {
  if (!row.deadline) return null;
  const deadline = Date.parse(`${row.deadline}T23:59:59Z`);
  if (!Number.isFinite(deadline)) return null;
  return Math.ceil((deadline - now.getTime()) / DAY_MS);
}

export function buildReviewDigest(rows, options = {}) {
  const now = options.now ?? new Date();
  const dashboardUrl = safeHttpsUrl(options.dashboardUrl) ?? '';
  const safeRows = Array.isArray(rows) ? rows : [];
  const urgent = safeRows.filter((row) => {
    const days = deadlineDays(row, now);
    return days != null && days >= 0 && days <= 14;
  });
  const graduates = safeRows.filter((row) => ['graduate', 'mixed'].includes(row.audience_bucket));
  const unresolved = safeRows.filter((row) => !row.audience_bucket || row.audience_bucket === 'unknown');
  const restricted = safeRows.filter((row) => ['special', 'adjacent', 'ineligible'].includes(row.audience_bucket));

  const subject = `CSULB Biotech Career Hub: ${safeRows.length} ${safeRows.length === 1 ? 'opportunity' : 'opportunities'} ready for review`;
  const summary = [
    `${safeRows.length} pending review`,
    `${graduates.length} graduate-accessible or mixed`,
    `${urgent.length} deadline${urgent.length === 1 ? '' : 's'} within 14 days`,
    `${unresolved.length} audience classification${unresolved.length === 1 ? '' : 's'} unresolved`,
    `${restricted.length} special, adjacent, or ineligible`,
  ];

  const textRows = safeRows.slice(0, 25).map((row, index) => {
    const deadline = row.deadline ?? row.deadline_text ?? 'unknown';
    return `${index + 1}. ${companyName(row)} | ${row.title}\n` +
      `   Audience: ${row.audience_bucket ?? 'unknown'}${row.audience_reason ? ` | ${row.audience_reason}` : ''}\n` +
      `   Deadline: ${deadline} | Score: ${row.relevance_score ?? 'unknown'}\n` +
      `   Source: ${row.posting_url ?? 'missing'}`;
  });

  const text = [
    'CSULB Biotechnology Club Career Hub',
    'Weekly officer review digest',
    '',
    ...summary.map((item) => `- ${item}`),
    '',
    dashboardUrl ? `Review queue: ${dashboardUrl}` : 'Review queue URL is not configured.',
    '',
    ...textRows,
    safeRows.length > 25 ? `\n${safeRows.length - 25} additional records are in the review queue.` : '',
    '',
    'No record in this digest has been published automatically. An officer must verify the official source and approve it in the review queue.',
  ].filter((line) => line !== '').join('\n');

  const htmlRows = safeRows.slice(0, 25).map((row) => {
    const deadline = row.deadline ?? row.deadline_text ?? 'unknown';
    const sourceUrl = safeHttpsUrl(row.posting_url);
    const source = sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}">Official posting</a>`
      : 'Source missing';
    return `<li style="margin:0 0 16px"><strong>${escapeHtml(companyName(row))}</strong><br>` +
      `${escapeHtml(row.title)}<br>` +
      `<span style="color:#4b5563">Audience: ${escapeHtml(row.audience_bucket ?? 'unknown')}` +
      `${row.audience_reason ? ` | ${escapeHtml(row.audience_reason)}` : ''}<br>` +
      `Deadline: ${escapeHtml(deadline)} | Score: ${escapeHtml(row.relevance_score ?? 'unknown')}</span><br>${source}</li>`;
  }).join('');

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;line-height:1.45">` +
    `<div style="max-width:720px;margin:auto"><p style="color:#087f8c;font-weight:700;margin-bottom:4px">CSULB Biotechnology Club</p>` +
    `<h1 style="font-size:24px;margin-top:0">Weekly Career Hub review</h1>` +
    `<ul>${summary.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` +
    `${dashboardUrl ? `<p><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#07182e;color:white;padding:10px 16px;text-decoration:none;border-radius:5px">Open officer review queue</a></p>` : ''}` +
    `<ol>${htmlRows}</ol>` +
    `${safeRows.length > 25 ? `<p>${safeRows.length - 25} additional records are in the review queue.</p>` : ''}` +
    `<p style="border-left:3px solid #f2a91b;padding-left:12px;color:#4b5563">No record in this digest has been published automatically. An officer must verify the official source and approve it in the review queue.</p>` +
    `</div></body></html>`;

  return { subject, text, html, counts: { total: safeRows.length, urgent: urgent.length, graduates: graduates.length, unresolved: unresolved.length, restricted: restricted.length } };
}

export function createRawMessage({ from, to, subject, text, html }) {
  const boundary = `csulb-review-${Date.now()}`;
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject.replace(/[\r\n]+/g, ' ')}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const body = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n');
  return Buffer.from(body).toString('base64url');
}

async function fetchPendingRows() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error('Supabase URL and service-role key are required');

  const select = [
    'id', 'title', 'posting_url', 'location', 'eligibility', 'focus_area',
    'deadline', 'deadline_text', 'start_date_text', 'relevance_score',
    'audience_bucket', 'audience_reason', 'first_seen_at', 'companies(name)',
  ].join(',');
  const url = new URL('/rest/v1/opportunities', baseUrl);
  url.searchParams.set('select', select);
  url.searchParams.set('status', 'eq.needs_review');
  url.searchParams.set('order', 'relevance_score.desc.nullslast');
  url.searchParams.set('limit', '100');

  const response = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) throw new Error(`Supabase review query failed: ${response.status}`);
  return response.json();
}

async function getGmailAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth client ID, client secret, and refresh token are required');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Gmail token refresh failed: ${response.status}`);
  const token = await response.json();
  if (!token.access_token) throw new Error('Gmail token response had no access token');
  return token.access_token;
}

async function sendDigest(digest) {
  const recipients = parseRecipients(process.env.REVIEW_DIGEST_RECIPIENTS);
  const sender = String(process.env.REVIEW_DIGEST_FROM ?? '').trim();
  if (!sender || /[\r\n]/.test(sender)) throw new Error('REVIEW_DIGEST_FROM is missing or invalid');
  const accessToken = await getGmailAccessToken();
  const raw = createRawMessage({ from: sender, to: recipients, ...digest });
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) throw new Error(`Gmail send failed: ${response.status}`);
}

async function main() {
  const preview = process.argv.includes('--preview');
  const rows = await fetchPendingRows();
  const digest = buildReviewDigest(rows, { dashboardUrl: process.env.REVIEW_DASHBOARD_URL });
  if (preview) {
    process.stdout.write(`${digest.subject}\n\n${digest.text}\n`);
    return;
  }
  if (digest.counts.total === 0) {
    process.stdout.write('No pending review records; no email sent.\n');
    return;
  }
  await sendDigest(digest);
  process.stdout.write(`Review digest sent for ${digest.counts.total} pending records.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
