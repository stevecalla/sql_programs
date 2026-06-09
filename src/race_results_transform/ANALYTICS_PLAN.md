# Usage Analytics + Slack Digest — Plan (no code yet)

Goal: see how much the race_results_transform app is used, store it in the existing
local MySQL, and get a recurring Slack summary + a CLI command + a small dashboard —
**reusing the repo's current patterns** so it's easy to maintain. No new frameworks,
no third-party trackers, **no new npm dependencies, no external license**.

## Plan at a glance

| Area | Decision |
|---|---|
| What | Anonymous usage analytics for the race_results_transform app → MySQL → Slack digest + CLI + dashboard |
| Privacy | Counts/enums + filename only; **never** cell/header/member data. Anonymous `visitor_id` (no names), no IP, no geo |
| DB | Existing local sales DB via `local_usat_sales_db_config()`; table `race_results_transform_events`; auto-creates (`CREATE TABLE IF NOT EXISTS`) at startup |
| Timestamps | `created_at_utc` + `created_at_mtn` (repo convention) + user-local `event_at_local`/`client_tz`/`local_hour`/`local_dow` |
| Capture | `public/js/metrics.js` → `navigator.sendBeacon('/api/event')`; non-blocking, **zero page impact**; honors DNT + `METRICS_OFF` |
| Tracked | visits (new vs repeat), uploads, conversions, downloads (single/separate/combined/split), upload→download completion, auto-map accuracy, flag rates, errors, time-of-day |
| Ingest | `POST /api/event` on `server_race_results_transform_8018.js`; whitelist + insert |
| Reporting | One shared aggregation → **Slack digest** (cron→route→`sendSlackMessage`) + **CLI `stats`** + **Basic-Auth dashboard** |
| Slack cron | We ship `cron_get_slack_race_results_transform/` (mirrors `cron_get_slack_membership_base`); **you own the schedule** |
| CLI | `node src/cli.js stats` · `metrics:size` · `metrics:cleanup` · `metrics:purge-test` (+ menu items) |
| Test runs in prod | Open with `?metrics_test=1` → every event stamped `is_test=1` (sticky per tab, tags `page_view` too) → delete just those with `metrics:purge-test` (`DELETE … WHERE is_test=1`; real + demo data untouched) |
| Dashboard | `http://localhost:8018/metrics` (or ngrok), **HTTP Basic Auth + signed `mx_session` cookie (12h expiry, `/metrics/logout`)**, read-only Chart.js page |
| Cron setup | **You add** the crontab lines on the server (we ship `run_script.sh`); recommended: digest Mon 8:00a, purge Sun 2:30a MTN |
| Retention | Keep current + prior calendar year, **purge only (no scrub)**; **automatic** purge cron + CLI `metrics:size` / `metrics:cleanup` |
| Growth | Bounded (~2 yrs of rows); tiny — likely single-digit MB |
| Reusable | Generic core in `utilities/analytics/` (ingest, ensure-table, retention, client, render); other pages (event-analysis 8016) adopt later via per-app config |
| Dependencies | **None new** — only mysql2 + Slack helper + express, already in repo. No license |
| Size | ~900–1,100 LOC (~half boilerplate); ~330 of it is the reusable core, written once |
| Conventions | Mirror existing files for cron / Slack / DB / DDL / dotenv / OS detection; deviations flagged |
| Open (TBD) | Slack cadence + channel/webhook; `_daily` rollup (later) |

## Principle #0 — privacy (non-negotiable)
The app processes member PII entirely client-side. Analytics events carry **counts,
enums, and the uploaded file's name** — never sheet contents, headers, cell values,
emails, or member numbers. Each event is a small hand-built JSON of allow-listed
fields. Users are distinguished only by an **anonymous** id (no names, no IP).

---

## 1. Data model — `race_results_transform_events` (local sales DB)

- Lives in the existing local DB via `local_usat_sales_db_config()`
  (`LOCAL_USAT_SALES_DB`). No new schema/DB.
- DDL in a query-file like `query_create_auto_renew_table.js`:
  `src/queries/create_drop_db_table/query_create_race_results_transform_events_table.js`
  exporting `query_create_race_results_transform_events_table(TABLE_NAME)`.
- Append-only, so DDL uses `CREATE TABLE IF NOT EXISTS` (NOT drop/recreate), run once
  by a small `step_0_init` using the same `dst.execute(TABLE_STRUCTURE)` helper.

### Columns
Identity / session
- `id` BIGINT PK AUTO_INCREMENT
- `created_at_utc` DATETIME — canonical instant, generated like your other tables (`UTC_TIMESTAMP()`)
- `created_at_mtn` DATETIME — same instant in Mountain time (`CONVERT_TZ(UTC_TIMESTAMP(),'UTC','America/Denver')`); calendar/day/week buckets group on this directly — matches the repo convention
- `session_id` CHAR(36) — random per page load
- `visitor_id` CHAR(36) — **anonymous, persistent per-browser id (cookie + localStorage)**; the "which user, not who" key
- `is_returning` TINYINT(1) — new vs repeat (localStorage first-seen flag)
- `upload_id` CHAR(36) NULL — **correlation id**: minted when a file is loaded; stamped on the upload event AND every download/split event from that load → join "upload → download" for a completion/abandonment funnel
- `event_name` VARCHAR(40) — page_view / file_uploaded / conversion_completed / download / split_download_used / mapping_saved / mapping_loaded / manual_remap / value_override / error / start_over / theme_changed / dashboard_view
- `page_path` VARCHAR(255) — **which page the event came from** (`location.pathname`+search on the client; `req.originalUrl` for the server-side `dashboard_view`). Makes `page_view`/`dashboard_view` explicit about the actual URL viewed.

File + conversion
- `file_name` VARCHAR(255) NULL — raw filename (for user support; retention-purged)
- `file_name_hash` CHAR(64) NULL — salted hash → dedupe re-uploads even if renamed
- `file_type` VARCHAR(8) NULL — xlsx / csv
- `sheet_count` `row_count` `col_count` `size_bytes` INT NULL
- `cols_matched` `cols_unmatched` INT NULL
- `scorecard_band` VARCHAR(16) NULL · `scorecard_pct` DECIMAL(5,2) NULL · `flag_count` INT NULL
- `target_key` VARCHAR(24) NULL — template key for manual_remap (never the raw header)

Download kind (maps 1:1 to app.js handlers)
- `download_mode` VARCHAR(12) NULL — `single` (download_single) / `separate` (download_one_sheet) / `combined` (download_combined) / `split` (run_split)
- `file_out_count` INT NULL — files produced (1 for single/combined, N for separate/split)
- `selected_count` INT NULL — sheets or groups picked
- `split_basis` VARCHAR(12) NULL — converted / original

Time-of-day + environment
- `event_at_local` DATETIME NULL — the user's **local wall-clock time** at the event (as they saw it); paired with `client_tz` it's unambiguous. Stored for reference/support, not for cross-user aggregation.
- `client_tz` VARCHAR(40) NULL (IANA, e.g. America/Denver) · `local_hour` TINYINT NULL (0–23) · `local_dow` TINYINT NULL (0–6)
- `app_version` VARCHAR(20) NULL · `engine` VARCHAR(12) NULL · `viewport` VARCHAR(8) NULL · `theme` VARCHAR(8) NULL
- `error_type` VARCHAR(40) NULL — enum, no payload

NOT collected: geolocation, IP (raw or hashed), names, any cell/header data.

---

## 2. Capture (browser → server)
Performance: **zero page impact** — `navigator.sendBeacon('/api/event', json)` is
non-blocking / fire-and-forget, no new browser libraries are loaded, and the DB write
is server-side off the user's path. Fallback: `fetch(..., {keepalive:true})`.

New `public/js/metrics.js` (UMD like the other modules, `window.RRT.metrics`):
- `track(event_name, props)` builds a payload from a **hard allow-list** (only the
  columns above) so a future caller can't leak a value by accident.
- Mints `visitor_id` once (cookie + localStorage, restored from whichever survives) + `is_returning`; mints `upload_id` per file load.
- Gated by `METRICS_OFF` flag and honors `navigator.doNotTrack`.
- One-line UI/README notice: anonymous usage counts + filename; no member data leaves the browser.

Wire `track(...)` into existing app.js handlers only (no new flows): init →
`page_view`; `handle_file` → `file_uploaded` (+ mint upload_id); after convert →
`conversion_completed`; `download_single`/`download_one_sheet`/`download_combined` →
`download` (with mode); `run_split` → `split_download_used`; `save_profile` → `mapping_saved`;
inline remap / value override → `manual_remap`/`value_override`; `handle_file` catch → `error`.

---

## 3. Ingest (server → MySQL — existing convention)
Add routes to the existing app server `server_race_results_transform_8018.js` (no new server):
- `POST /api/event` → `express.json()` → **whitelist + type-coerce** → insert using the
  existing pattern (`dotenv`, `mysql2/promise`, `local_usat_sales_db_config()`,
  parameterised `INSERT INTO ... VALUES (?, ...)` like `flush_batch()` in
  `step_1_transfer_data_usat_to_local.js`). One shared pool created at server start.
  Rejects unknown fields; responds 204 fast (fire-and-forget).
- **Idempotent / zero-touch on Linux**: the server runs the query-file DDL
  (`CREATE TABLE IF NOT EXISTS`) **once at startup**, so the table is created
  automatically on first boot in production — no manual step. A `step_0_init`
  script is also provided to run it standalone if preferred. Same
  `local_usat_sales_db_config()` + `mysql2/promise` path as the other DB builds,
  so it behaves identically on mac/Windows/Linux.

---

## 4. Time zones / time-of-day handling
Three timestamps, each with a clear job (matches the repo's `created_at_*` convention):
- `created_at_utc` = canonical instant (ordering, dedupe). DST-free.
- `created_at_mtn` = same instant in Mountain/HQ time. **Calendar volume** charts
  ("uploads Tuesday / this week") just `GROUP BY DATE(created_at_mtn)` — no JS tz math,
  consistent with your other tables. (Your queries already use `CONVERT_TZ` to
  America/Denver, so the MySQL tz tables are loaded.)
- `event_at_local` + `client_tz` = the **user's** own wall clock (they may not be in MTN),
  for human reference/support only — never aggregated.
- **Time-of-day trend** ("what part of *their* day") → `GROUP BY local_hour` (+ `local_dow`),
  the user-local integers. Do NOT use created_at_mtn for this (HQ time ≠ the user's time)
  and do NOT use UTC (it smears morning/evening across zones).

---

## 5. Shared aggregation + the three readers
Factor all aggregation into ONE module (e.g. `src/metrics_report.js`) — single source
of truth used by the Slack digest, the CLI, and the dashboard.

- **CLI**: `node src/cli.js stats [--days 7]` (+ menu item) prints uploads/downloads,
  download-mode breakdown, new vs repeat, by day & hour, completion rate (upload→download
  via `upload_id`), top files, top columns needing manual fixes.
- **Slack digest** (existing cron→route→sendSlackMessage convention): deliver
  `utilities/cron_get_slack_race_results_transform/{script.js, run_script.sh}` built to
  mirror `cron_get_slack_membership_base` exactly — `run_script.sh` is the same
  OS-user-detecting wrapper (steve-calla / usat-server / calla) that node-runs
  `script.js`, and `script.js` `fetch()`es `http://localhost:8018/scheduled-slack-race-results-metrics`.
  That route runs `metrics_report` and posts Slack **blocks** via `sendSlackMessage(text,
  webhook_url, channel, blocks)` (webhook from env). **You own the cron schedule**
  (crontab/pm2); we only ship the cron_get files + the route. Channel/cadence: **TBD**.
- **Dashboard**: read-only HTML page on the 8018 server rendering `metrics_report`
  (+ a couple of Chart.js charts). Auth: **HTTP Basic Auth** (shared secret in `.env`)
  over ngrok TLS — NOT a URL-param password (those leak via logs/history/referer).

---

## 5a. CLI commands (added to `cli.js` + a `menu.js` item each)
| Command | What it does |
|---|---|
| `node src/cli.js stats [--days 7]` | Prints the same summary as the Slack digest: visits + new/repeat, uploads, conversions, downloads by mode, completion %, auto-map accuracy, top files, top manual-fix columns, flags, time-of-day. |
| `node src/cli.js metrics:size` | Table size (MB), row count, date range, rows per year. |
| `node src/cli.js metrics:cleanup` | Shows which rows/years would be purged (keep current + prior year), confirms, then purges. |

## 5b. Dashboard (read-only, on the 8018 server)
- **URL**: `http://localhost:8018/metrics` locally, or the server's ngrok URL.
- **Access**: **HTTP Basic Auth** — the browser prompts for user/pass from `.env`
  (`RACE_RESULTS_CONVERTER_METRICS_USER` / `RACE_RESULTS_CONVERTER_METRICS_PASS`); over ngrok TLS so creds aren't sent in clear.
  NOT a URL-param password.
- **What it is**: one self-contained HTML page (Chart.js via CDN) that fetches a
  Basic-Auth-protected JSON endpoint (`GET /api/metrics-report?days=30`, returns the shared
  report contract) and renders, read-only + mobile-friendly:
  - KPI cards: visits · unique users (new/repeat) · uploads · conversions · downloads · completion %
  - uploads & downloads over time (line, by MTN day)
  - download-mode breakdown (single / separate / combined / split)
  - time-of-day (by `local_hour`) + busiest days
  - auto-map accuracy, top columns needing a manual fix, top files, flag-code counts
  - date-range selector (7 / 30 / 90 / this year)

## 5c. Cron jobs — YOU add these on the server
We ship `run_script.sh` + `script.js` for each job (mirroring `cron_get_slack_membership_base`).
You add the schedule via `crontab -e` and mirror it in `utilities/cron_job_notes/cron_jobs.txt`
(repo convention). Server time = MTN. Recommended:
```
RACE_METRICS_SLACK_PATH=/home/usat-server/development/usat/sql_programs/utilities/cron_get_slack_race_results_transform/run_script.sh
RACE_METRICS_PURGE_PATH=/home/usat-server/development/usat/sql_programs/utilities/cron_get_purge_race_results_transform/run_script.sh

00 08 * * 1 $RACE_METRICS_SLACK_PATH   # weekly usage digest — Monday 8:00a MTN
30 02 * * 0 $RACE_METRICS_PURGE_PATH   # purge old years — Sunday 2:30a MTN
```
Cadence/channel for the digest is yours to choose; the purge can run weekly (it only acts at
the calendar-year boundary). The CLI `metrics:cleanup` does the same purge on demand.

## 6. Retention + cleanup
Keep **the current and prior calendar year**; purge anything older. **No scrub** — full
rows (incl. `file_name`) are kept for the whole window. Bounded growth: the table holds
at most ~2 calendar years of rows (e.g. in June 2026 it keeps 2025 + 2026; on 2027-01-01,
2025 ages out). `RETENTION_KEEP_YEARS = 2` (current + prior) is the one config constant.

Purge rule — keyed off `created_at_mtn` so it follows the reporting/HQ calendar year:
```sql
DELETE FROM race_results_transform_events
 WHERE YEAR(created_at_mtn) < YEAR(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','America/Denver')) - 1;
```

Runs two ways, both calling the SAME shared retention helper (so they can't drift):
- **Automatic (primary):** ship `utilities/cron_get_purge_race_results_transform/{script.js,
  run_script.sh}` (mirrors the existing cron wrapper); you set the schedule. Idempotent —
  safe to run daily.
- **CLI (on demand):**
  - `node src/cli.js metrics:size` — table size (MB), rows, date range, rows per year
    (via `information_schema.tables` + `GROUP BY YEAR(created_at_mtn)`).
  - `node src/cli.js metrics:cleanup` — prints what would be purged (rows/years), confirms
    with the existing `ask()` prompt, then purges. (+ menu items.)

One-line UI/README notice (see §2).

## 7. Testing (existing suites)
- Node: unit-test the server's field whitelist/coercion (rejects unknown keys, drops
  PII-shaped fields) with a mocked pool — pure function, no DB in CI.
- E2E: assert the app fires a beacon to `/api/event` on upload/convert/download via
  `page.route('**/api/event')` (no real DB).
- Keep `/api/event` + digest route out of the dependency-free `npm test` DB path
  (guarded like the other DB scripts).

---

## 8. Build order (when you say go)
*Generic core first (in `utilities/analytics/`), then the race_results consumer.*
1. **Core**: `utilities/analytics/{event_ingest.js, ensure_table.js, retention.js, metrics_client.js, report_render.js}` (the reusable, page-agnostic infra).
2. **Table**: `query_create_race_results_transform_events_table.js` DDL; server calls `ensure_table` at startup (auto-creates; `step_0_init` also provided).
3. **Capture**: `public/js/metrics.js` (thin `init()` over `metrics_client`) + `POST /api/event` on 8018 via `make_event_ingest`; wire `track()` into app.js handlers; confirm rows land.
4. **Report**: `src/metrics_report.js` (app-specific aggregation → report contract) + CLI `stats` + menu item.
5. **Slack digest**: `/scheduled-slack-race-results-metrics` route + `cron_get_slack_race_results_transform` job (you set schedule/channel).
6. **Retention**: `purge_keep_years` wired to an **automatic** `cron_get_purge_race_results_transform` job + CLI `metrics:size` / `metrics:cleanup` + menu items.
7. **Dashboard**: Basic-Auth route + Chart.js page (renders the report contract).
8. **Tests + docs**: whitelist unit test + e2e beacon capture; README/CLAUDE.

---

## Example output (Slack digest = CLI `stats` = dashboard summary)
All three readers render the SAME `metrics_report` aggregation. Mock weekly digest:

```
:bar_chart:  Race Results Transform — Weekly Usage  (Jun 1–7 2026, MTN)

Usage
• 38 visits · 12 unique users (5 new, 7 returning)
• 27 files uploaded · 23 conversions · 22 downloaded
• Completion rate: 22/27 uploads → download (81%)

Downloads (24)
• 16 single · 4 combined · 3 separate (avg 3 sheets) · 1 split (avg 5 groups)

Files & data
• avg 142 rows / 11 cols · xlsx 21, csv 6
• top files: BoulderSprint_results.xlsx (4), MtnStateChamps.xlsx (3)

Mapping quality
• auto-map accuracy: 92% of columns matched without a manual fix
• most-fixed columns: Category (6×), Recorded Time (3×)   ← candidates for new schema.js aliases
• top flags: member-nonnumeric (41), state-review (9), category-assumed (5)

When (user-local time)
• busiest: Tue & Wed, 9am–12pm local
• 3 errors (unreadable_file 2, unsupported_type 1)
```

CLI prints the same as plain text: `node src/cli.js stats --days 7`.

## Code footprint (estimate)
~900–1,100 lines total, but roughly half is boilerplate (the standard cron wrapper,
dashboard HTML, tests). Core logic is ~500 lines. No new dependencies.

Reusable = generic core (write once, every page reuses). App = race_results-specific.

| File | ~LOC | Kind | Notes |
|---|---|---|---|
| `utilities/analytics/event_ingest.js` | 70 | Reusable | `make_event_ingest({pool,table,columns})` → express handler; whitelist + stamp created_at_* + insert |
| `utilities/analytics/ensure_table.js` | 20 | Reusable | runs a passed DDL `CREATE TABLE IF NOT EXISTS` at startup |
| `utilities/analytics/retention.js` | 60 | Reusable | `size()` + `purge_keep_years()` (cron + CLI share it) |
| `utilities/analytics/metrics_client.js` | 110 | Reusable | browser `track()`/`init({app,endpoint,allowList})` + visitor/session/upload ids |
| `utilities/analytics/report_render.js` | 70 | Reusable | report contract → Slack blocks / text / dashboard JSON |
| `query_create_race_results_transform_events_table.js` | 50 | App | DDL column list |
| `public/js/metrics.js` | 20 | App | thin `init()` over the shared client + the app's allow-list |
| app.js `track()` wiring | 25 | App | small calls in existing handlers |
| `/api/event` mount on 8018 (via `make_event_ingest`) | 20 | App | + startup `ensure_table` |
| `src/metrics_report.js` | 180 | App | app-specific aggregation → report contract |
| `/scheduled-slack-race-results-metrics` route | 50 | App | report → `sendSlackMessage` blocks |
| `cron_get_slack_race_results_transform/` (script + run_script.sh) | 20 + 55 | App | mirrors the membership cron |
| `cron_get_purge_race_results_transform/` (script + run_script.sh) | 15 + 55 | App | auto purge; calls `retention.purge_keep_years` |
| CLI `stats` + `metrics:size` + `metrics:cleanup` + menu items | 70 | App | reuse report_render + retention |
| Dashboard route + HTML page (Chart.js via CDN) | 150 | App | renders the report contract |
| Tests (whitelist unit + e2e beacon capture) | 100 | App | |
| README / CLAUDE docs | 40 | App | |

## Cross-platform + production (Linux) readiness
- **Auto-creates its table**: `CREATE TABLE IF NOT EXISTS` runs at server startup, so
  deploying to the Linux box needs no manual DB step — first boot makes the table.
- Uses the same `local_usat_sales_db_config()` + `mysql2/promise` pattern as the other
  DB builds → identical behavior on mac/Windows/Linux; no native modules, no new deps.
- The cron `run_script.sh` uses the same OS-user detection (steve-calla / usat-server /
  calla) as the existing jobs, so it runs unchanged in production.
- `metrics.js` is browser JS (cross-platform by nature); `dotenv` path + `determineOSPath`
  follow repo conventions.

## Reusable across pages (analytics core)
Designed so any page (e.g. the event-analysis app on 8016) can adopt the same machinery
later by supplying a small config — the boilerplate is generic; only the schema and the
aggregation are app-specific.

**Generic core** — lives in `utilities/analytics/` (shared like the other utilities):
- `event_ingest.js` — `make_event_ingest({ pool, table, columns })` → an express handler
  that whitelists to `columns`, stamps `created_at_utc` / `created_at_mtn`, and inserts.
  Any server mounts it at its own `/api/event`.
- `ensure_table.js` — runs a passed DDL (`CREATE TABLE IF NOT EXISTS`) at startup.
- `retention.js` — `size(pool, table)` + `purge_keep_years(pool, table, years)` (purge keys
  off `YEAR(created_at_mtn)`; identical for every app). Used by BOTH the cron and the CLI.
- `metrics_client.js` — browser `track(event, props)` served as a static asset;
  `init({ app, endpoint, allowList })` so each page sends its own `app` id + fields.
- `report_render.js` — turns a standard "report contract" (sections of label→value) into
  Slack blocks / plain text / dashboard JSON, so Slack + CLI + dashboard rendering is shared.

**Per-app inputs** (the only things a new page writes):
- a DDL query-file with its columns (`query_create_<app>_events_table.js`)
- a field allow-list + an `app` id
- an app-specific `<app>_report.js` that aggregates its table → the report contract
- its `cron_get_slack_<app>` + `cron_get_purge_<app>` dirs (copy the wrappers) + its routes

`race_results_transform` is the **first consumer**. event-analysis (8016) can later wire up
by providing only those per-app inputs — no shared code rewritten. We build ONLY the core +
the race_results consumer now; nothing for other pages. (Note: an `event_metrics` table
already exists under `src/queries/create_drop_db_table/` — a possible future unify point.)

Per-app table (not one shared table): each page has different events/columns, and per-domain
tables match the repo convention; the shared CORE is table-name-parameterized so it stays DRY.

## Conventions — mirror these existing files (consistency rule)
Before writing each piece, open the closest existing example and match its structure,
naming, and error handling. Only deviate where no precedent exists, and flag it in a
code comment + here.

| New piece | Mirror this existing file/pattern |
|---|---|
| Slack cron job | `utilities/cron_get_slack_membership_base/{script.js, run_script.sh}` |
| Slack send | `utilities/slack_messaging/slack_message_api.js` → `sendSlackMessage(msg, url, channel, blocks)` |
| Local DB pool/config | `utilities/connectionLocalDB.js` + `utilities/config.js` (`local_usat_sales_db_config()`) |
| Table create + batched insert | `src/auto_renew/step_1_transfer_data_usat_to_local.js` (`create_target_table`, `flush_batch`, BATCH_SIZE) |
| DDL query-file | `src/queries/create_drop_db_table/query_create_auto_renew_table.js` |
| SQL query files | `src/queries/<domain>/...` |
| dotenv path | `dotenv.config({ path: "../../.env" })` |
| timer / logging | `utilities/timer.js`, `utilities/generateLogFile.js` |
| OS detection | `utilities/determineOSPath.js` (`determineOSUser`) |
| Browser module style | UMD `window.RRT.*` like existing `public/js` + `src/*.js` |
| Express route style | the existing servers (`server_*_80xx.js`) |
| Naming | snake_case identifiers + table names (matches repo + lint) |

Deliberate deviations (no exact precedent): events table is **append-only**
(`CREATE TABLE IF NOT EXISTS`, not the extract jobs' drop/recreate); `public/js/metrics.js`
client beacon is new but follows the UMD module convention; dashboard auth reuses any
existing server auth pattern if one exists (checked at build), else HTTP Basic Auth.

## Decisions (locked)
1. **DB**: reuse local sales DB via `local_usat_sales_db_config()`; no new schema. ✅
2. **Server**: all routes on `server_race_results_transform_8018.js`; no new server. ✅
3. **Identity**: anonymous `visitor_id` only (no names / self-identify). ✅
4. **File name**: stored (+ salted hash); kept for current+prior year (no scrub). ✅
5. **Completion**: `upload_id` correlation (upload→download funnel). ✅
6. **Download kind**: `download_mode` single/separate/combined/split + counts. ✅
7. **Time zones**: `created_at_utc` + `created_at_mtn` (repo convention) + user-local fields; calendar buckets `GROUP BY DATE(created_at_mtn)`, time-of-day by `local_hour`. ✅
8. **Geo**: DROPPED — no IP geolocation, no MaxMind license, no new dependency.
   `client_tz` gives a loose region for free. ✅
9. **IP / ip_hash**: not collected at all. ✅
10. **Dashboard**: read-only on 8018, **Basic Auth** (not URL password). ✅
11. **Retention**: keep current + prior calendar year, purge only (no scrub); **runs automatically via cron** + CLI `metrics:size`/`metrics:cleanup` on demand (shared helper). ✅
12. **Opt-out**: honor DNT + `METRICS_OFF`, on by default otherwise. ✅
13. **Performance**: zero page impact (sendBeacon, no client libs, server-side write). ✅
14. **Dependencies**: none new — only mysql2 + the Slack helper + express, all already in repo. ✅

15. **Cron schedule**: owned by you (crontab/pm2); we ship only the `cron_get_*` files + route. ✅
16. **Consistency**: mirror the existing reference files above wherever a clear pattern exists. ✅
17. **Reusable core**: generic analytics infra in `utilities/analytics/` (ingest, ensure-table, retention, client, render) + per-app config, so other pages (event-analysis 8016) can adopt it later. ✅

### Still TBD (not blocking the build)
- Slack cadence + which channel/webhook.
- `REPORTING_TZ` value (default America/Denver).
- Rollup table `_daily` — add later only if the digest query gets heavy.

---

# Linux server setup (what YOU do)  — status: BUILT ✅

The code is built and the dep-free tests pass. To run it in production:

1. **Pull the code.** **No npm install needed** — analytics uses mysql2 + express + the
   Slack helper, all already in the repo (geo was dropped → no new packages, no license).
2. **Env (repo-root `.env`):** all DB vars already exist (`LOCAL_HOST`, `LOCAL_MYSQL_USER`,
   `LOCAL_MYSQL_PASSWORD`, `LOCAL_USAT_SALES_DB`). Add:
   - `SLACK_WEBHOOK_RACE_RESULTS_CONVERTER_URL=<webhook>` — optional; falls back to
     `SLACK_WEBHOOK_STEVE_CALLA_USAT_URL` so the digest works immediately for testing.
   - `RACE_RESULTS_CONVERTER_METRICS_USER=<user>` and `RACE_RESULTS_CONVERTER_METRICS_PASS=<pass>` — dashboard Basic Auth
     (the dashboard returns 503 until these are set — never wide open).
   - optional `METRICS_OFF=true` to disable analytics entirely.
3. **Restart the 8018 server** (pm2). On boot it auto-creates the table
   (`CREATE TABLE IF NOT EXISTS race_results_transform_events`). Look for the log line
   `[analytics] events table ready (race_results_transform_events)`.
4. **Add the two cron lines** (`crontab -e`, and mirror in `utilities/cron_job_notes/cron_jobs.txt`):
   ```
   RACE_METRICS_SLACK_PATH=/home/usat-server/development/usat/sql_programs/utilities/cron_get_slack_race_results_transform/run_script.sh
   RACE_METRICS_PURGE_PATH=/home/usat-server/development/usat/sql_programs/utilities/cron_get_purge_race_results_transform/run_script.sh

   00 08 * * 1 $RACE_METRICS_SLACK_PATH   # weekly usage digest — Monday 8:00a MTN
   30 02 * * 0 $RACE_METRICS_PURGE_PATH   # purge old years — Sunday 2:30a MTN
   ```
5. **Review / smoke test:**
   - Open the app, run a convert + download. Then `node src/cli.js stats --days 1` → counts.
   - `node src/cli.js metrics:size` → table size / rows per year.
   - Visit `https://<your-host>/metrics` (Basic Auth) → the dashboard (period selector:
     Today / 7 / 30 / 90 days / 1 year).
   - Fire the digest once: `curl localhost:8018/scheduled-slack-race-results-metrics`
     (or run `utilities/cron_get_slack_race_results_transform/run_script.sh`).
   - Dry-run a purge with preview: `node src/cli.js metrics:cleanup` (asks before deleting).
   - **Full check (DB round-trip):** `npm run e2e:db` — drives the app and confirms the
     events landed in MySQL with the right columns and that the table was created.

## Files delivered
- Core: `utilities/analytics/{event_ingest,ensure_table,retention,metrics_client,report_render}.js`
- Table DDL: `src/queries/create_drop_db_table/query_create_race_results_transform_events_table.js`
- App config + aggregation: `src/race_results_transform/metrics/{metrics_config.js, metrics_report.js}`
- Client init: `public/js/metrics.js` (+ index.html script tags); track() wired into app.js
- Server: ingest + dashboard + report + digest routes in `server_race_results_transform_8018.js`
  (+ `race_results_slack_channel` added to `utilities/slack_messaging/slack_message_api.js`)
- Dashboard page: `src/race_results_transform/metrics/metrics_dashboard.html` (gated; not under public/)
- CLI: `stats` / `metrics:size` / `metrics:cleanup` in `src/cli.js` (+ menu.js "Usage analytics" items)
- Crons: `utilities/cron_get_slack_race_results_transform/`, `utilities/cron_get_purge_race_results_transform/`
- Tests: `tests/metrics_ingest.test.js` (dep-free) + `e2e/metrics_beacon.spec.js` (beacon fires)
  + `e2e/metrics_db.spec.js`

---

# Phase A enhancements — BUILT (#1–5)
- **#1 split download metric**: event renamed `split_used` → **`split_download_used`** (clearer); dashboard "Split-by-group downloads" panel (count, avg groups, converted/original basis); the Slack/CLI report gains a split line.
- **#2 funnel**: `metrics_report.funnel` (Visits → Uploads → Conversions → Downloads → **Start over**) + a funnel bar chart on the dashboard. Activity-by-day adds a **start-overs** series and switches **grouped→stacked when >14 days** are shown (datalabels inside bars). A **Start over** KPI card sits in the cards row.
- **#3 refresh**: dashboard header **↻ Refresh** button + **Auto** toggle (60s, off by default).
- **#4 top users**: now show **Visits / Uploads / Downloads / Start over** per-user counts + **Location (client_tz)** + **Last activity** (`MAX(created_at_mtn)` over real activity only — `dashboard_view` excluded) columns (location = timezone proxy; no IP/geo). Leading **#** row-number column; table scrolls horizontally when narrow.
- **#5 dashboard views**: server logs a `dashboard_view` event on each `/metrics` open (skipped when the `x-metrics-test` header is present, so e2e never pollutes).
- **Also**: track `start_over` (Clear/Start-over click) and `theme_changed` (light/dark preference, carries `theme`).
- Tests: `metrics_dashboard.spec.js` asserts the new panels/columns (incl. Visits/Uploads/Downloads/Start over headers + the # row-number column); `metrics_db.spec.js` round-trip now verifies `theme_changed` + `start_over` land; filename rides on every post-upload event. No schema change (reuses existing columns).

## Phase A polish — BUILT (dashboard)
- **Chart toolbar** on every chart (same toolbar UX as event_analysis, but **live/server-API** —
  not a static generated file; see note below): **⤢ Expand**
  (modal w/ enlarged image), **⬇ PNG** (`chart.toBase64Image()`), **⬇ CSV** (chart data), **⇄ Table**
  (flip canvas ↔ data table). Each chart registers `{title, headers, rows}` for table/CSV.
- **DB health**: top-right **Last data: <created_at_mtn> MTN**; second-row right shows **N rows · X MB**
  (whole-table COUNT + information_schema size).
- **Header layout**: row 1 = title + last-data + dark/light; row 2 = period buttons + Refresh + Auto-refresh.
- **Sparse data**: Activity-by-day is now grouped **bars** (was a line — a single day showed only a dot).
- **NOTE**: the running 8018 server caches `metrics_report`; **restart it** after these changes or the
  dashboard shows the old shape (empty funnel, wrong download count).
- Tests: `metrics_dashboard.spec.js` asserts the 4-button toolbar on each chart + health + 2-row header.

## Phase A fixes (dashboard polish round 2)
- **Last-data timezone fix**: was showing UTC (19:33) — `created_at_mtn` was being re-converted via JS `toISOString()`. Now formatted in SQL (`DATE_FORMAT … '%b %e, %Y %l:%i %p'`) so it's true MTN, 12-hour + AM/PM, labeled "Last User Activity" + " MTN".
- **Header**: "Last User Activity" chip (dim label above a prominent value) in the right corner; theme toggle kept as icon **+ text**, both styled as matching chips; light/dark + mobile via theme tokens + flex-wrap.
- **Chart data values**: `chartjs-plugin-datalabels` shows values on every bar; the **PNG export and Expand modal use the same image** (offscreen canvas with a solid `--card` background) so they're identical and include the **chart title, legend/keys, and value labels**.
- **Top users**: now a **full-width** panel; cells `nowrap` with horizontal scroll; **full visitor_id** shown (no longer truncated).
- Tests: `metrics_dashboard.spec.js` asserts the toolbar (4 buttons × 4 charts), health strip, last-activity label, 2-row header, theme text.

## Last User Activity excludes dashboard views
- The top-right **Last User Activity** chip (`health.latest`) and the Top Users **Last activity**
  column (`top_users.last_seen`) now compute `MAX(created_at_mtn)` over **real activity only**,
  excluding the server-side `dashboard_view` events that fire on each `/metrics` open
  (`MAX(CASE WHEN event_name <> 'dashboard_view' THEN created_at_mtn END)` in `metrics_report.js`).
  So simply opening the dashboard no longer bumps the "last activity" date — it reflects page
  views, uploads, conversions, downloads, split downloads, start-overs, etc. The **N rows** health
  figure (`rows_total`) stays unfiltered — it's a DB-size metric, not an activity metric.
  (The Top Users query already filtered `visitor_id IS NOT NULL`, and `dashboard_view` rows carry a
  NULL `visitor_id`, so that column was effectively unaffected — the change just makes the intent
  explicit and consistent with the chip.)

## "Try me (fake data)" + the is_demo flag — BUILT
- **App** (`/`): a **Try me** split-button on the upload card (`#tryMeBtn`, `wire_try_me`/`load_demo`
  in `public/js/app.js`) with two paths — *Load sample data* fetches the committed synthetic fixture
  (`/sample/sample_race_results_FAKE.xlsx`) and runs it through the normal pipeline in-browser, and
  *Download sample file* (`<a download>`) gives the user that file to upload themselves. The file is a
  **committed static asset** at `public/sample/sample_race_results_FAKE.xlsx` (served by
  `express.static`, NOT a dynamic route) so it works identically in an Express deploy and a
  pure-static / Cloudflare Pages deploy of `public/`. `examples/sample/build_sample.js` writes both
  the test fixture and this web copy; a `public/sample/.gitignore` re-includes the `_FAKE` file past
  the repo-root `*.xlsx` ignore. (An earlier version served it via a dynamic `/sample` route reaching
  into `examples/`, which 404'd in production deploys that didn't run Express or ship `examples/`.)
  `S.is_demo` is set for either path (and auto-detected for a re-uploaded `*_FAKE.*` file via
  `is_demo_filename`), a `#demoBadge` "sample test data" banner shows while viewing, and the upload
  card (with the Try-me button) hides once a workbook loads; **Start over** clears `S.is_demo`, hides
  the badge, and restores the button.
- **Flag**: a new `is_demo TINYINT(1)` column (1 = built-in sample / fake data, else 0/NULL). Wired
  end-to-end: events DDL (`query_create_race_results_transform_events_table.js`), server whitelist
  (`metrics_config.COLUMNS`), browser allow-list (`public/js/metrics.js`), and `ensure_columns`
  migration in the server (so existing tables gain it). `app.js` `track()` stamps `is_demo:1` on the
  demo session's events; the initial `page_view` and real uploads stay `0`/NULL.
- **Chart/card**: `metrics_report.build_report` adds a `demo_split` (Uploads / Conversions / Downloads
  split by `is_demo`) + a `demo` summary. The dashboard renders a **Try Me vs real activity** grouped
  bar (`chart_demo`, demo vs real) with the standard Expand/PNG/CSV/Table toolbar, plus a **Try Me**
  KPI card (sample upload count).
- **Tests**: `tests/metrics_report.test.js` asserts the report issues the `is_demo` split query and
  returns the `demo_split` shape; `tests/try_me.test.js` asserts the `is_demo` column is wired across
  DDL + server whitelist + client allow-list and that the Try-me markup/loader exist; the dashboard
  e2e count moves to 5 charts and `e2e/try_me.spec.js` (opt-in) drives the load-sample flow + badge.

## `source` flag (manual vs Try Me vs Salesforce) — BUILT
- A `source VARCHAR(16)` column records where a converted file came from: `upload` (manual drop/
  picker), `try_me` (built-in sample), or `salesforce` (the SF intake queue). Wired end-to-end like
  `is_demo`: DDL + `metrics_config.COLUMNS` + `public/js/metrics.js` allow-list + `app.js` `track()`
  (`props.source = S.source || (S.is_demo ? 'try_me' : 'upload')`) + an `ensure_columns` migration in
  the server. `is_demo` stays orthogonal (1 only for the sample).
- Salesforce files flow the normal funnel: opening a queue file fires `file_uploaded` (first open
  only) → auto `conversion_completed` → `download`, all stamped `source='salesforce'`. No new event
  names beyond the existing funnel (the SF "download to folder" is not a funnel event).
- A future "by source" dashboard breakdown can `GROUP BY source` (left as an optional follow-up; the
  column + stamping are in place now).
