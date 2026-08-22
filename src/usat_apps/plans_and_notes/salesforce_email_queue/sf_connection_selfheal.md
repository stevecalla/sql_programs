# Email Queue — Salesforce connection self-heal (prod 502 fix)

**Date:** 2026-08-21 · branch `refactor/sf_email_queue_v2`

## Symptom

On prod (`usat-app.kidderwise.org/salesforce/email-queue`) the queue picker was empty and the SF-backed
endpoints returned **502 (Bad Gateway)**: `/queues`, `/statuses`, `/case-fields`, `/org-wide-emails`.
A `pm2 restart usat_apps` fixed it temporarily, then it came back hours later.

## Root cause

The email queue **cached its Salesforce connection (`_conn`) and never re-authenticated**. When the OAuth
token expired (hours), every SF call on the cached connection threw, and the handler's `err()` helper
returns **HTTP 502** (`res.status(502)…`). So the failure surfaced as a 502 with no crash and nothing in
`error.log`. Merge kept working because it re-auths on every call; the chatbot works because it uses its own
connection.

**Why it appeared now when it "worked before":** the bug was always in the code — the app just used to
restart often enough (deploys + crashes → 132 lifetime restarts) that the cached connection was replaced
with a fresh login before its token could expire. Once the app ran **stable for 9+ hours** with no restart,
the connection outlived its token for the first time and the latent bug fired. (A shorter Salesforce session
timeout would have the same effect.) It was **not** caused by the Aug-19 chatbot/panel deploy, and **not** the
retired `:8019` server.

### Diagnostic notes (so this isn't re-chased)

- `err()` in `modules/salesforce_email_queue/api.js` returns **502**, not 500 — a Salesforce error there
  looks like a gateway error, and Cloudflare masks the JSON body with its own 502 page.
- The requests **do** reach `usat_apps` (logged), no crash, empty `error.log`. It's a swallowed SF error.
- `proxy_routes.js` routes `/api/salesforce-email-queue/*` through the `/` catch-all to `:8022`. The retired
  `:8019` email server does NOT serve these routes and is not in the proxy — red herring.
- Tell: **SF-touching** email endpoints 502 while **non-SF** ones (`/config`, `/corrections`, `/ai/models`)
  return 200, and the chatbot's own `/queues` works. That isolates it to the email queue's cached connection.

## Fix A — self-healing connection in the shared SF client

`services/salesforce/index.js` gained a managed connection layer:
- **Cache per (role, env)** with a **TTL** (`SF_CONN_TTL_MS`, default 15 min) — `conn_for()` refreshes before
  the token can age out. This alone fixes the observed bug for every consumer.
- **`run(opts, fn)`** — runs an SF op and, on a session-expired error (`is_session_error`: `INVALID_SESSION_ID`,
  401, invalid_grant, etc.), drops the cached connection, re-auths once, and retries once.
- **Concurrency dedupe** — a burst hitting an expired connection triggers one login, not many.
- Exports: `conn_for, invalidate, invalidate_all, run, is_session_error, CONN_TTL_MS`.

Email queue migrated (`modules/salesforce_email_queue/api.js`):
- `get_conn` / `get_conn_write` delegate to `sf.conn_for()` (TTL refresh).
- Idempotent reads wrapped with `sf.run()`: queues, statuses, case-fields, org-wide-emails, status-counts, thread.
- **Sends are TTL-only, NOT wrapped in `run()`** — retrying a send could double-send.
- Env switch calls `sf.invalidate_all()`.

**Gotcha that bit us:** the email queue imports `require('./sf')`, a **re-export shim**
(`modules/salesforce_email_queue/sf/index.js`), not `services/salesforce` directly. New functions must be
re-exported through that shim too, or you get `sf.run is not a function`. (Fixed — the shim now re-exports
`conn_for/invalidate/invalidate_all/run/is_session_error`.)

## Fix B — front-end queue staleness

A restricted user saw the full queue list until a hard refresh. The server always filters `/queues` by role;
the SPA store just wasn't re-fetching on a soft login. Fixed: `store.syncUser(user)` re-fetches the
access-filtered list and drops the prior selection when the signed-in user changes; wired in
`EmailQueueRail.jsx` via the `user` prop (`useEffect(() => store.syncUser(user), [user])`). Visibility only —
never a server-side hole.

## Files changed

`services/salesforce/index.js`, `modules/salesforce_email_queue/api.js`,
`modules/salesforce_email_queue/sf/index.js`, `web/src/modules/salesforce_email_queue/lib/store.js`,
`web/src/modules/salesforce_email_queue/EmailQueueRail.jsx`.

## Verification

Unit test against the real shared-client code passed 10/10: reconnect-on-expiry retries and succeeds, a
non-session error does NOT retry (no double-run), TTL caching reuses within window, `invalidate_all` forces a
fresh login. Local: restart `:8022` + reload → 502s gone, queue loads.

## Deploy

Merge to `main` → on prod `git pull` + build + `pm2 restart usat_apps`. Tuning knob: `SF_CONN_TTL_MS`
(default 900000). After deploy the token-expiry 502 should not recur; the TTL bounds any residual case.

## Follow-ups

- **Phase 2:** migrate chatbot, knowledge-admin, and merge onto the same managed layer. Merge currently
  re-auths on every call (wasteful of the SF login budget); moving it to cache+self-heal improves it.
- `usat_apps` heap was ~97% during this — separate, worth a look so it isn't a second instability source.
- Console noise seen while debugging — "Unchecked runtime.lastError … bfcache", "listener indicated an
  asynchronous response … message channel closed", `[TargetingRulesDataService]`, WebPush — are all **browser
  extension** messages, not app errors.
