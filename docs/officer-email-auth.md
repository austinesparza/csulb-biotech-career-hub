# Officer email sign-in

The officer portal uses Supabase's hosted one-time email link as its primary
sign-in method. Password login remains available as a fallback.

This works with the default Supabase email template on the Free plan. Custom
SMTP and a custom template are not required. They can be added later for club
branding and higher-volume delivery.

The application calls `signInWithOtp` with `shouldCreateUser: false`, so this
flow cannot create new accounts. The email link returns to
`/auth/email-link`, where the browser establishes the session, removes tokens
from the address bar, and checks for an active row in the private `officers`
allowlist. Non-officers are signed out.

## Operator test

1. Open `/admin/login`.
2. Enter the email address of an existing active officer.
3. Open only the newest sign-in email.
4. Confirm the browser opens `/admin`.
5. Sign out and confirm `/admin` redirects back to `/admin/login`.

Supabase rate-limits repeated email requests. Wait at least one minute before
requesting another link. Corporate email scanners can consume single-use links,
so use the newest message and open it directly if an older message reports that
it has expired.
