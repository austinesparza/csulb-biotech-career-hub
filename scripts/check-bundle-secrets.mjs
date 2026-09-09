#!/usr/bin/env node
/**
 * check-bundle-secrets.mjs — fail the build if a server-only secret reached
 * client-side output. This catches the most common Supabase incident: a
 * service_role key exposed through a NEXT_PUBLIC_ var or imported into a
 * client component.
 *
 * Usage: node scripts/check-bundle-secrets.mjs .next/static .next/server/app
 */
import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: check-bundle-secrets.mjs <dir> [dir...]");
  process.exit(2);
}

// Detect the VALUE of known secrets, not just the variable name. Never printed.
const literals = [
  "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "GITHUB_TOKEN",
  "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY", "CRON_SECRET", "TURNSTILE_SECRET_KEY",
]
  .map((name) => [name, process.env[name]])
  .filter(([, value]) => value && value.length >= 16);

// Shape-based detection, so it still works when the env var isn't set at check time.
const patterns = [
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "a JWT (Supabase service_role keys are JWTs)"],
  [/\bsb_secret_[A-Za-z0-9_-]{20,}/g, "a Supabase secret key"],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{20,}/g, "an OpenAI-style secret key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, "an Anthropic-style secret key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, "a GitHub token"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "a private key"],
  [/"type"\s*:\s*"service_account"/g, "a Google service-account JSON"],
];

// The anon key is published by design and is also a JWT. Allow it explicitly.
const allowed = new Set(
  [process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, process.env.SUPABASE_ANON_KEY].filter(Boolean),
);

const findings = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(js|mjs|cjs|json|html|txt|map)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const [name, value] of literals) {
      if (text.includes(value)) findings.push(`${full}: contains the value of ${name}`);
    }
    for (const [pattern, label] of patterns) {
      for (const match of text.match(pattern) ?? []) {
        if (allowed.has(match)) continue;
        findings.push(`${full}: looks like ${label} (${match.slice(0, 8)}...)`);
      }
    }
  }
};

for (const root of roots) {
  if (fs.existsSync(root)) walk(root);
  else console.log(`skip  ${root} (not built)`);
}

if (findings.length) {
  console.error("\nSECRET LEAK - build rejected:\n");
  for (const finding of [...new Set(findings)]) console.error(`  ${finding}`);
  console.error("\nMove the value to a server-only env var. Anything NEXT_PUBLIC_* ships to browsers.\n");
  process.exit(1);
}
console.log("ok    no server-only secrets found in client output");
