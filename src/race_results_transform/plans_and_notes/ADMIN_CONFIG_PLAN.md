> **STATUS: ✅ BUILT & SHIPPED — candidate for deletion/archival.** Editable config + multi-user management are
> live (see `CLAUDE.md`). The current `/admin` is the blend ops console in `ADMIN_CONSOLE_PLAN.md`, which
> supersedes this doc. Kept for historical context only.

# Plan — editable config + multi-user management from /admin

Goal (per the ask): manage **anything reasonable** from `/admin` — non-secret config **and** users/passwords
for both logins (add users, change passwords). Safe by construction.

## Store
- `admin_overrides.json` in the data dir (`utilities/determineOSPath` → `…/usat/data`), **gitignored**, never
  committed, never logged. Shape:
  ```json
  {
    "session_secret": "<random, auto-generated once>",
    "config": { "slack_default_channel": "", "slack_file_types": "", "sf_program_object": "" },
    "admin_users": [ { "user": "name", "hash": "scrypt$..." } ],
    "app_users":   [ { "user": "name", "hash": "scrypt$..." } ]
  }
  ```
- Passwords are **scrypt-hashed** (`crypto.scryptSync`, per-user random salt), stored as
  `scrypt$<saltB64>$<hashB64>`; verified with `timingSafeEqual`. Plaintext is never stored.

## Auth model (env = always-on fallback, overrides = additive)
- **admin login** valid if `(user,pass)` matches the env `RACE_RESULTS_ADMIN_USER/_PASS` **or** any
  `admin_users` entry. Same for **app login** with the metrics creds + `app_users`.
- The env user can never be removed (it's the recovery account), so you can't lock yourself out.
- **Sessions are signed with `session_secret`, NOT the password** — token = `exp.role.user.HMAC(secret,…)`.
  Decoupling means: changing one user's password doesn't invalidate other sessions, and changing *your own*
  password keeps you logged in (and we re-issue the cookie to be safe). `valid_session` checks HMAC + expiry.
- The overrides file is read fresh on each login/validation (cheap), so **user/password changes take effect
  immediately — no restart**. (Startup-time config like the DB pool still needs a restart; the UI says so.)

## Routes (all `require_admin_auth`)
- `GET  /api/admin-config`      → current non-secret config + **usernames only** (never hashes) for both lists.
- `POST /api/admin-config`      → save non-secret config values.
- `POST /api/admin-user-add`    → `{ scope:'admin'|'app', user, pass }` add/update (hashes pass).
- `POST /api/admin-user-remove` → `{ scope, user }` (guard: can't remove the env user; can't empty admins).
- `POST /api/admin-change-password` → `{ scope, user, pass }`; if it's the **current admin**, re-issue cookie.

## UI (`/admin`)
- A **Config** card that shows, per field, the **value active now + the default**, with the right input
  for each: a **Slack channel dropdown** populated from `GET /api/admin-slack-channels` (the bot's
  `{id,name,is_private}` channels, with a "None — user picks" option; falls back to a text box when Slack
  isn't configured), **file-type checkboxes** (`xlsx,xls,csv,pptx,ppt`; all-checked = default, uncheck to
  restrict), and a text box for the SF program object (blank = default). Save persists; "all/none/blank"
  collapses back to the default (stored as no override).
- **Admin actions** with a one-line description **and a live count** so it's clear what each does before you
  click: **Purge test rows** shows `is_test=1` count (disabled at 0) and confirms with the count; **Backfill
  source** shows the legacy `salesforce` row count (disabled at 0); the two connection tests are read-only.
  Counts come from `/api/admin-status` (`test_rows`, `legacy_source`) and refresh after each action.
- An **Admin users** card + an **App users** card: list usernames, add (user+password), remove, change
  password. Never renders a hash or secret. Inline success/error.

## Safety summary
gitignored store · scrypt hashing · env recovery account · session secret (not password) · last-admin guard ·
booleans-only status endpoint · no secrets in logs or `/api/admin-status`.

## Tests
- `tests/admin_store.test.js` (pure): hash/verify round-trip, wrong-pass fails, add/remove/list, env-user
  fallback, last-admin guard, session_secret bootstrap. Plus `admin_auth.test.js` route assertions.

## Progress
- ✅ `admin/admin_store.js` (scrypt hash/verify, multi-user, config, JSON persistence, session_secret bootstrap)
  + `tests/admin_store.test.js` (5/5 pass).
- ✅ Server: `session_secret`-signed sessions (decoupled from passwords); `/api/login` + the admin sign-in
  validate via `admin_store.valid_login` (env account + stored users); routes `GET/POST /api/admin-config`,
  `POST /api/admin-user-add`, `POST /api/admin-user-remove` (all `require_admin_auth`); non-secret config is
  applied onto `process.env` live via `apply_config_overrides()`.
- ✅ `/admin` UI: **Config** card (text inputs + Save) and **Users** card (admin + app lists, add/remove, set
  password) — usernames only, never hashes; `.env` accounts shown as ".env recovery", not removable.
- ✅ `.gitignore` → `admin_overrides.json`. Docs (CLAUDE + this plan). Route/UI test assertions to add in
  `admin_auth.test.js` on a clean checkout (the OneDrive mount truncated that file here).

> **Test live (server restart needed):** the session-signing key changed (now `session_secret`), so existing
> logins re-prompt once. Verify: sign into `/admin` with the `.env` admin creds → add an admin user → sign out →
> sign in as the new user → change a config value (Save) → confirm it persists in `admin_overrides.json` and that
> the `.env` account still logs in (recovery).
