# SECURITY.md — CSULB Biotech Career Hub

Two audiences: officers who maintain the resource, and anyone reporting a problem.

## Report a vulnerability

Email csubiotechclub@gmail.com with "SECURITY" in the subject. Please don't open a public
issue. We're a student club, not a security team — expect a reply in days, not hours.

## What we protect

In rough order of what would actually hurt:

1. **The club Google account.** It can send mail as the club. Compromise means phishing
   students who trust us.
2. **Submitter contact details.** Names and emails people gave us voluntarily. Never
   published, never sent to a model provider, never in the public workbook.
3. **Deploy and database credentials.** Not because the data is sensitive — it's public
   job postings — but because they're a foothold.
4. **The integrity of published records.** A wrong eligibility rule costs a student weeks.
   This is the risk unique to us, and it's why evidence binding exists.

## Credential lifecycle

Officers graduate every year. This is the most likely way we get breached, and it is
entirely preventable.

| Credential | Where it lives | Rotate |
|---|---|---|
| Club Google account | Vault + hardware key or TOTP (never SMS) | Every officer transition |
| Supabase `service_role` | Vercel server-side env + GitHub environment secret | Every transition, or immediately on suspicion |
| Supabase `anon` | Public by design; in the client bundle | Only if the project is rotated |
| Vercel deploy | Vercel Git integration | Prefer OIDC over a long-lived token if available |
| LLM provider keys | The worker's environment ONLY | Every transition |

**Offboarding checklist.** Do this the same week an officer steps down, not when someone
remembers. Put it in the same calendar entry as the officer transition.

- [ ] Remove from the GitHub org and from any repo collaborator list
- [ ] Remove from the Supabase project and deactivate their `officers` row (`is_active = false`)
- [ ] Remove from Vercel
- [ ] Remove their vault access
- [ ] Rotate every credential in the table above that they could have read
- [ ] Change the club Google account password and re-enroll the second factor
- [ ] Confirm no personal Google account retains delegated access

## Rules that don't change

- **`service_role` never leaves a server-side environment.** Anything prefixed
  `NEXT_PUBLIC_` ships to every browser. `scripts/check-bundle-secrets.mjs` fails the
  build if a secret reaches client output; do not skip it.
- **RLS is on for every table, denying by default.** `tests/security/rls.test.ts`
  proves the anonymous key cannot read submissions, officers, or drafts. A new table
  without RLS fails CI.
- **The extraction worker holds LLM keys and nothing else.** No Supabase service key,
  no GitHub token, no Google credentials. If it's compromised, the damage is model spend.
- **AI never approves or publishes.** It extracts and formats; an officer approves.
- **Every published field carries a verbatim source quote.** `lib/evidence.ts` verifies
  the quote is a literal substring. Unverified extractions go to a human, not to students.
- **Actions are pinned to commit SHAs.** The March 2026 LiteLLM compromise entered
  through a build consuming a dependency from a mutable tag.
- **New dependencies wait out a cooldown.** `renovate.json` enforces 3 days generally,
  14 days for fast-moving AI infrastructure. The malicious LiteLLM packages were live
  about 40 minutes.

## Enable these in the GitHub and Supabase UIs

Not expressible in code, and worth ten minutes:

- GitHub → Settings → Code security: **secret scanning + push protection** (blocks the
  commit before the secret lands), Dependabot alerts, private vulnerability reporting
- GitHub → Settings → Actions: restrict to selected actions; default `GITHUB_TOKEN`
  permissions read-only
- GitHub → branch protection on `main`: require the `security` workflow to pass,
  require one review, no force-push
- Supabase: enable **point-in-time recovery**; restrict network access if your plan
  supports it; turn on MFA for every project member
- Vercel: enable deployment protection for previews so drafts aren't publicly indexable
- Cloudflare Turnstile on the submission form; rate limit at the edge

## If something goes wrong

1. **Rotate first, investigate second.** Credentials are cheap; a live foothold isn't.
2. Revoke the credential at the provider — don't just change the env var, since the old
   value may still be valid.
3. Check Supabase logs for reads of `submissions` outside your officer accounts.
4. If submitter contact details were exposed, tell the affected people plainly. They
   gave us that information voluntarily.
5. If a published record is wrong, correct the workbook and re-publish. The release id
   in the site footer is a content hash — an id that doesn't match `dist/release.json`
   means something changed outside the pipeline.
6. Write down what happened in this file's history. The next officers won't have context.
