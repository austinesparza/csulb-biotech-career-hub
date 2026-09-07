# Weekly officer review notifications

The notification job summarizes records already in the private officer review
queue. It does not discover jobs, approve records, or publish anything.

The club workflow must remain separate from any member's private internship
campaign. Do not import personal GPA, fit scores, interview probabilities,
application status, private notes, or individualized strategy into this system.

## Safety boundary

- The query selects only review-relevant fields. It never reads `private_notes`,
  student application information, or personal candidate scoring.
- The script sends nothing when the queue is empty.
- Recipient addresses are stored only in the protected production environment.
- Missing configuration skips delivery before any Supabase or Gmail request.
- Every public record still requires an officer to open the official source,
  classify the audience, verify public notes, and approve it in `/admin/review`.
- `ineligible` records are stored as `archive_only` with `public_safe=false`.

## Required production configuration

Create a protected GitHub environment named `production`. Add these secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `REVIEW_DIGEST_RECIPIENTS`, a comma-separated list of verified addresses

Add these environment variables:

- `REVIEW_DIGEST_FROM`, the exact Gmail sender identity
- `REVIEW_DASHBOARD_URL`, the production `/admin/review` URL

Do not use the connected personal Gmail account as permanent club infrastructure
without documenting transfer and recovery. A club-owned Google account is the
preferred long-term sender.

## Activation checklist

1. Apply migration `0007_opportunity_audience.sql`.
2. Confirm the production review dashboard works for at least two officers.
3. Verify each recipient address directly. Do not rely on an old website footer.
4. Configure the production environment. Restrict its secrets to the default branch
   and repository administrators; a scheduled job cannot wait for manual environment approval.
5. Run `Weekly officer review digest` manually.
6. Confirm the message contains no private notes and all links are correct.
7. Leave the Monday schedule enabled only after the manual acceptance test passes.

GitHub cron runs at 16:00 UTC, which is 08:00 PST or 09:00 PDT. Exact local-time
delivery would require a timezone-aware scheduler such as Supabase Cron.
