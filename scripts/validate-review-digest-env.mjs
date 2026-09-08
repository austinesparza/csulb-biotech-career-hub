const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'REVIEW_DIGEST_RECIPIENTS',
  'REVIEW_DIGEST_FROM',
  'REVIEW_DASHBOARD_URL',
];

const missing = required.filter((name) => !String(process.env[name] ?? '').trim());
if (missing.length > 0) {
  console.log(`Notification remains disabled. Missing configuration: ${missing.join(', ')}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'configured=false\n');
} else {
  console.log('Notification configuration is complete.');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'configured=true\n');
}
import { appendFileSync } from 'node:fs';
