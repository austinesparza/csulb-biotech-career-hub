# Officer email sign-in

The officer portal uses a six-digit Supabase email OTP as its primary sign-in
method. Password login remains available as a collapsed recovery fallback.

## Hosted Supabase template

In Supabase, open **Authentication > Email Templates > Magic Link** and replace
the message body with:

```html
<h2>Your CSULB Biotechnology Club sign-in code</h2>
<p>Enter this one-time code in the officer portal:</p>
<p style="font-size: 28px; font-weight: 700; letter-spacing: 0.2em;">
  {{ .Token }}
</p>
<p>This code expires shortly and can be used only once.</p>
<p>If you did not request this code, you can ignore this email.</p>
```

Suggested subject:

```text
Your officer portal sign-in code
```

The application calls `signInWithOtp` with `shouldCreateUser: false`, so this
flow cannot create new accounts. After code verification, the application also
requires an active row in the private `officers` allowlist before granting
access to any officer page. The requested email is retained for ten minutes in
an HTTP-only, same-site cookie so the officer only has to type the code on the
second screen. The cookie is removed after successful sign-in.

## Operator test

1. Open `/admin/login`.
2. Enter the email address of an existing active officer.
3. Use only the newest six-digit code.
4. Confirm the browser opens `/admin`.
5. Sign out and confirm `/admin` redirects back to `/admin/login`.

Supabase rate-limits repeated email requests. Wait at least one minute before
requesting another code.
