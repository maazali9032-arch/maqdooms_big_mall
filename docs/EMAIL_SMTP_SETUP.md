# Staff emails through Resend (custom SMTP for Supabase Auth)

Supabase's built-in email sender is for testing only: it sends a handful of emails per hour.
Password-reset, sign-up confirmation and email-change messages should go through Resend instead.

**No code change and no app environment variable is needed.** The ERP calls Supabase Auth;
Supabase sends the email through whatever SMTP server is set in its dashboard.
**Never put the Resend API key in this repository, in `.env`, or in Vercel.** It is entered only in the
Supabase dashboard.

## 1. Resend (done by the Owner)

1. Create a free account at resend.com. The free plan allows 3,000 emails a month (100 a day).
2. **Domains → Add domain.** Use the shop's own domain, or a subdomain such as `mail.yourdomain.com`.
3. Add the DNS records Resend shows at your domain registrar. These are a DKIM TXT record named
   `resend._domainkey`, plus an MX and an SPF TXT record on the `send` subdomain. Wait until Resend
   shows the domain as **Verified**.
4. Optional but recommended: add a DMARC TXT record at `_dmarc` with the value `v=DMARC1; p=none;`.
5. **API Keys → Create API key.** Permission: *Sending access*, limited to this domain. Copy the key
   (it starts with `re_`). It is shown only once.

## 2. Supabase (live project `tattausfxmlrmxxrheeb`)

### Authentication → Emails → SMTP Settings → Enable custom SMTP

| Field | Value |
|---|---|
| Sender email | an address on the verified domain, e.g. `no-reply@yourdomain.com` |
| Sender name | `Maqdoom's Big Mall` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key (`re_…`) |
| Minimum interval per user | `60` seconds (default) |

Save.

### Authentication → Rate Limits

When custom SMTP is turned on, Supabase starts the email limit at 30 per hour. Raise
**Rate limit for sending emails** to about `100` per hour. That stays within Resend's 100 a day for
normal use.

### Authentication → URL Configuration

- **Site URL:** `https://maqdooms-big-mall.vercel.app`
- **Redirect URLs:** add `https://maqdooms-big-mall.vercel.app/reset-password`
  - Optional, for local testing: `http://localhost:5179/reset-password`

Without the redirect URL, the reset email opens the home page instead of the "Set a new password"
page.

### Authentication → Emails → Templates → Reset Password (optional wording)

- Subject: `Reset your Maqdoom's Big Mall password`
- The body must keep the link variable `{{ .ConfirmationURL }}`, for example:

```html
<p>Someone asked to reset the password for your Maqdoom's Big Mall staff account.</p>
<p><a href="{{ .ConfirmationURL }}">Set a new password</a></p>
<p>If this wasn't you, ignore this email. The link works once and expires soon.</p>
```

## 3. Test

1. Open `https://maqdooms-big-mall.vercel.app/auth` → **Forgot password?** → enter your own staff
   email → **Send reset link**.
2. The email should arrive from your Resend sender. Resend → **Logs** shows it as delivered.
3. The link opens **Set a new password**. Enter a new password (at least 8 characters) twice →
   **Save new password**. You are signed in.
4. Opening the same link again shows "This reset link is not valid any more".

## How the app uses it

- `src/routes/auth.tsx`: **Forgot password?** calls `resetPasswordForEmail` with
  `redirectTo = <site>/reset-password`. It always shows the same message, so nobody can test which
  emails have accounts.
- `src/routes/reset-password.tsx`: reads the session from the email link, then calls
  `updateUser({ password })`. An expired or used link shows a "request a new link" message.
