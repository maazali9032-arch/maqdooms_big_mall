# Logout and role switching — 12 October 2026

Fixes stale role interfaces requiring a browser reload after logout.

The old shell waited for remote Supabase sign-out before redirecting. Its role guard
also repeatedly rendered a redirect during the transition; the browser test reproduced
an infinite navigation/update loop. The session provider refreshed access asynchronously
instead of clearing it directly from SIGNED_OUT, and profile fetching delayed display
of already verified role access.

## Resulting behaviour

- Logout immediately clears displayed identity, roles, permissions and query/mutation
  caches, invalidates old async access requests and cancels deferred auth loads.
- The shell disappears immediately and the role guard redirects once to Login.
  No full-page reload is used. Direct SIGNED_OUT events clear access synchronously too.
- Login waits for local SDK session removal to finish, preventing an old logout from
  clearing a newly signed-in account. Failed local verification shows a retry action;
  a remote-revocation error with confirmed local removal produces an explicit warning.
- Remote logout HTTP requests have a five-second deadline, including the response body.
  Other login/ERP fetches keep their existing behavior and cancellation signals.
- Auth work is deferred outside synchronous auth callbacks. Invalidated old tokens,
  bootstrap/profile replies and late queries cannot restore the previous role/cache.
  Rejected-token barriers exist only in provider memory; no new stored credentials.
- Verified role access displays before the optional profile-name lookup finishes.
  Password/OAuth completion routes through the existing role-aware home resolver.

Existing roles, permissions, RLS and logout scope are retained. No database, migrations,
configuration, seed, business transactions or production sessions were modified/tested.

## Verification

24 actual-component browser checks use the real SessionProvider, AppShell, AuthPage
and route guards with a synthetic auth transport. Covers slow and failed logout,
local verification/retry, cache clearing/late replies, external sign-out, old-token
replay, canonical SDK-session reads for delayed foreign events, Stock Entry → Counter → Owner switching without reload, slow profile responses,
and logout-only timeout/body/cancellation behavior. No browser errors.

42 existing sidebar/navigation checks pass. TypeScript, scoped ESLint (zero errors,
three warnings) and whitespace checks pass. Vercel-preset production build passes
with patched TanStack server-core 1.169.39. Evidence under SESSION_LOGOUT_*.

Live auth transport/physical devices and automatic deployment confirmation are
separate from this synthetic browser verification. Git publication outcome is recorded
in the permanent Implementation History.
