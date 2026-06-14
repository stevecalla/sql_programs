> **STATUS: ✅ BUILT & SHIPPED — candidate for deletion/archival.** Split auth + the gated `/admin` are live and
> fully documented in `CLAUDE.md` ("Split auth — app login vs admin login"). This plan is kept only for
> historical context; the live behavior (now a full ops console) is described in `ADMIN_CONSOLE_PLAN.md`.

# Plan — split auth + a gated /admin

## Goal
Separate the two audiences:
- **`/` (the converter + its Salesforce/Slack/Folder intake)** keeps the **current app login**
  (`mx_session` cookie ← `RACE_RESULTS_CONVERTER_METRICS_USER` / `_PASS`). Coworkers who pull files sign in
  with this, exactly as today. The drag-drop converter itself stays public static.
- **`/metrics` (analytics dashboard) + a new `/admin` (admin hub)** move behind a **separate admin login**
  (`admin_session` cookie ← **`RACE_RESULTS_ADMIN_USER` / `RACE_RESULTS_ADMIN_PASS`**).

## Why two gates
The intake is a day-to-day staff tool; the analytics + admin surfaces are operator-only. One shared password
meant anyone who could use the intake could also read `/metrics`. Splitting them lets you hand out the app
login broadly while keeping `/metrics` + `/admin` to a small set with the admin password.

## Safety (no lockout while you're away)
`admin_creds()` uses `RACE_RESULTS_ADMIN_USER/_PASS` **if set**, otherwise **falls back to the metrics creds**.
So an existing deploy keeps working unchanged until you add the new vars; the moment you set them, `/metrics`
+ `/admin` require the admin password and the intake still uses the app password.

## Changes
- **Server auth (parallel to the existing block):** `admin_session` cookie + `sign_admin` (HMAC of the admin
  pass) + `valid_admin_session` + `require_admin_auth` (503 if unconfigured, 401 JSON for `/api`, else
  redirect to `/admin/login`).
- **Repoint to `require_admin_auth`:** `/metrics`, `/api/metrics-report`, `/api/metrics-purge-test`,
  `/api/metrics-ask*`, `/api/metrics-ask-models`, `/api/metrics-ask-correct`, `/api/metrics-ask-thread`.
- **Login/out:** `/metrics/login` + `/metrics/logout` now use the admin creds + `admin_session`; new
  `/admin/login` + `/admin/logout` (shared handler, `?next=` redirect). A small `/api/admin-auth-status`
  (ungated) for the page.
- **Unchanged (intake / app login):** `/api/sf/*`, `/api/slack/*`, `/api/login`, `/api/logout`,
  `/api/auth-status` stay on `require_dash_auth` (`mx_session` ← metrics creds).
- **`/admin` page:** `metrics/admin.html` — a gated hub: links to **Metrics dashboard**, the **Converter**,
  the Slack/SF setup runbook, a **Sign out**, and a small **config status** strip (which intake env is set —
  booleans only, never secrets/values, and **no specific channel names**). Served only via
  `app.get('/admin', require_admin_auth, …)` (NOT through the public `express.static('/')`).
- **No hardcoded channels** anywhere: the Slack channel stays user-selected (picker) / optional
  `SLACK_CHANNEL_ID` env; the admin page shows only "Slack token set: yes/no", not a channel.

## Env (add to repo-root `.env`)
```
RACE_RESULTS_ADMIN_USER=<admin login>
RACE_RESULTS_ADMIN_PASS=<admin password>
```
(omit to fall back to the metrics creds for `/metrics` + `/admin`.)

## Tests
- A server-auth test: `/metrics` + `/admin` mounted with `require_admin_auth`; the intake routes + `/api/login`
  still on `require_dash_auth`; `admin_session` cookie + `valid_admin_session` exist; admin creds fall back to
  metrics creds.
- Update `metrics_test_flag.test.js`: the purge route now uses `require_admin_auth`.

## Progress
- ✅ Plan (this doc) → ✅ server auth + repoint (`require_admin_auth`, `admin_session`, `/metrics`+APIs moved,
  `/metrics/login`+`/metrics/logout` use admin creds) → ✅ `/admin` hub page (`metrics/admin.html` +
  `/api/admin-status` booleans-only) + `/admin/login`+`/admin/logout` → ✅ tests (`tests/admin_auth.test.js`
  passes 5/5; `metrics_test_flag` purge assertion updated) + docs.

### Admin-panel scope (per the latest asks)
The panel **monitors + manages**. Built now:
- **Configuration status** card — booleans only (admin/app login, DB, Salesforce, Slack token, Slack
  default-channel-set, ngrok). Never secret values, never a channel name.
- **Admin actions** (gated POSTs, surfaced as buttons): **Test Salesforce** (`/api/admin-test-sf`) +
  **Test Slack** (`/api/admin-test-slack`) read-only connection probes; **Backfill source**
  (`/api/admin-backfill-source`, legacy `salesforce`→`sf_upload_queue`); **Purge test rows** (reuses the
  admin-gated `/api/metrics-purge-test`). Results render inline.
- A **🧪 Converter (test mode)** quick link → `/?metrics_test=1`.
- **Theming:** reuses `/css/app.css` + the shared `rrt_ui_v1` light/dark toggle + the live MTN footer clock
  so `/admin` matches `/` and `/metrics` (header style 🏁 `/` · ⚙️ `/admin` · 📊 `/metrics`).

Still roadmap: editable config *values* from the UI (restart/apply semantics) + the **Slack channel
allow-list** (**kept open for now** — any channel the bot is invited to is available).
