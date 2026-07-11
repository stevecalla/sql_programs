# METRICS.md — Usage Metrics dashboard (reporting app)

The **Usage Metrics** feature is a self-contained usage-analytics dashboard for the USAT Reporting
app: it records lightweight, PII-free usage events to a `reporting_events` table and renders them on a
`/metrics` page (stat cards, charts, tables) plus an LLM-backed **Ask your data** panel that answers
natural-language questions with a guarded read-only SQL query.

It is confined to the reporting app. It shares **nothing** with `src/salesforce_merge` beyond the
generic analytics helpers under `utilities/analytics/` (retention + report rendering) and the physical
MySQL server. There is **no shared login, no shared table, and no merge-DB coupling** — the merge tool
writes its own `events`/metrics table; reporting writes only `reporting_events` (stamped
`app='reporting'`). A cross-app metrics view could `UNION` the two later by `app`, but nothing does so
today. (Background: `plans_and_notes/METRICS_AND_ADMIN_OVERLAP.md`.)

---

## 1. What the dashboard shows

Page: `web/src/pages/Metrics.jsx` (route `/metrics`, panel `metrics`). Period buttons (Today / 7 / 30 /
90 days / 1 year) drive the `days` window; Refresh + Auto-refresh (60 s) re-pull the report. Admins
also get **Purge test** and a **Flag my activity as test** toggle (see §6).

**Header** — title + "Last user activity" (the newest `ts` in the table, from `health.latest_mtn`).

**Stat cards** (top row) — from the headline counts (all exclude `is_test=1` rows):
- **Visits** — panel/page views; subtext splits new vs returning users.
- **Unique users** — distinct `visitor_id`; subtext = returning count.
- **Filters run** — `filter_run` + `search_run`.
- **Exports** — `report_export` (csv / xlsx).
- **Actors** — distinct signed-in staff (`actor`).
- **Test rows** — `is_test=1` count across the whole table (purgeable).
- **Row count DB** — total rows in `reporting_events` + table size in MB.

**Ask your data** — the LLM Q&A panel (`components/AskData.jsx`); see §5.

**Activity by day** — grouped bar chart (views · filters · exports per calendar day), with a
flip-to-table view and PNG / CSV export (`components/ChartCard.jsx`).

**2×2 chart grid:**
- **Activity by panel** — events per `panel` (with views / filters / exports columns in the table flip).
- **Top filters** — most-used `filter_name` (filter_run + search_run).
- **Exports by view** — `report_export` grouped by `view` + `export_format`.
- **Errors** — table of `error_type` counts (`event_name='error'`).

**Tables:**
- **Most recent active users** — actors ordered by most-recent `ts`.
- **Visitors (anonymous)** — per `visitor_id`: latest actor, visits, events, timezone, device
  (`viewport` → mobile/tablet/desktop), last activity, new/returning tag.
- **Top actors (by events)** — actor leaderboard with filters / exports / last-seen.

The structured payload behind all of this is `report.data` from `metrics_report.build_report()` — see
§4 for its exact shape.

---

## 2. The `reporting_events` schema

Defined + migrated idempotently by `metrics/events.js:ensure()` (CREATE TABLE IF NOT EXISTS, then
`ADD COLUMN IF NOT EXISTS` per flat column, so pre-existing rows are untouched). Table lives in the
shared `usat_sales_db`. Every reporting row is stamped `app='reporting'`.

Base columns:

| Column       | Type                         | Meaning |
|--------------|------------------------------|---------|
| `id`         | BIGINT AUTO_INCREMENT PK     | row id |
| `ts`         | DATETIME (server local time) | event time — **the only time column**; all date grouping uses this (no created_at_utc/mtn pair) |
| `app`        | VARCHAR(32) = `reporting`    | source app; lets a future view union merge + reporting |
| `event_name` | VARCHAR(64)                  | `page_view` \| `panel_view` \| `filter_run` \| `search_run` \| `report_export` \| `login` \| `logout` \| `error` |
| `actor`      | VARCHAR(128) NULL            | signed-in staff username (server-stamped from the session; never trusted from the client) |
| `role`       | VARCHAR(32) NULL             | actor's role at event time |
| `panel`      | VARCHAR(64) NULL             | app section: `participation-maps` \| `metrics` \| `admin` \| `reference` |
| `is_test`    | TINYINT = 0                  | 1 = deliberately flagged test activity (`?metrics_test=1`); excluded from all headline figures |
| `meta`       | JSON NULL                    | catch-all blob for anything not flattened (e.g. `session_id`, `page_path`, `theme`) |

Flat analytics columns (added by `EXTRA_COLUMNS`):

| Column          | Type          | Meaning |
|-----------------|---------------|---------|
| `view`          | VARCHAR(96)   | route/view within a panel (e.g. `/`, `/metrics`) |
| `filter_name`   | VARCHAR(96)   | which filter/search ran (for `filter_run`/`search_run`) |
| `export_format` | VARCHAR(16)   | `csv` \| `xlsx` (for `report_export`) |
| `visitor_id`    | VARCHAR(64)   | anonymous per-browser id (localStorage `reporting_vid`); indexed `ix_visitor` |
| `is_returning`  | TINYINT       | 1 if this browser has been seen before |
| `client_tz`     | VARCHAR(64)   | IANA timezone from the browser (e.g. `America/Denver`) — the "location" proxy |
| `viewport`      | VARCHAR(8)    | `sm` (mobile) \| `md` (tablet) \| `lg` (desktop) |
| `local_hour`    | TINYINT       | client-local hour 0–23 |
| `local_dow`     | TINYINT       | client-local day of week (0 = Sunday) |
| `duration_ms`   | INT           | optional operation duration |
| `row_count`     | INT           | optional result-row count for the action |
| `error_type`    | VARCHAR(64)   | error classification (for `event_name='error'`) |

No PII: only usernames (already known to the app), enums, counts, coarse timezone/viewport, and an
opaque visitor UUID. No IPs, names, emails, or free text about people.

---

## 3. How events get logged

Client → server → DB, best-effort (a logging failure must never break a page):

1. **`web/src/lib/track.js`** (browser). Pure helper `panelForPath(pathname)` maps a route to its
   panel key (`/` → `participation-maps`, `/metrics` → `metrics`, `/admin` → `admin`, `/reference` →
   `reference`; unknown → path minus leading slash). Trackers (`trackPanelView`, `trackFilter`,
   `trackSearch`, `trackExport`, `trackSession`) call `track(event_name, fields)`, which fires a
   fire-and-forget `keepalive` `POST /api/event` with `event_name` + a `meta()` bundle
   (visitor_id, is_returning, client_tz, viewport, local_hour/dow, session_id, page_path, theme). It
   never throws. The `metrics_test` flag (from `?metrics_test=1` or the persisted admin toggle) is the
   single thing that opts a row into `is_test`.
2. **`POST /api/event`** (`api/routes.js`, `require_auth`). Passes the request to
   `events.ingest_http(req, req.user, req.role)` and always replies `204`. The server stamps the
   authoritative `actor`/`role` from the session — the client cannot set them. `is_test` comes only
   from `?metrics_test=1` / the body flag.
3. **`metrics/events.js:ingest_http` → `log`**. Whitelists the flat columns, spills the rest into
   `meta` JSON, calls `ensure(pool)` (first-write table create/migrate), and inserts. `log()` swallows
   all errors.

---

## 4. `metrics/metrics_report.js` — the report contract

`build_report(pool, { days })` (default `days=7`) aggregates the last N days and returns the shared
report contract: `{ title, range, sections: [...human lines...], data: {...} }`.

**Headline window** excludes test rows:
`WHERE app='reporting' AND ts >= (NOW() - INTERVAL <days> DAY) AND (is_test IS NULL OR is_test = 0)`.
The `health` block, by contrast, reads the **whole** table (so test rows are still counted + reported
+ purgeable).

`data` keys: `days`, `panel_views`, `unique_users`, `repeat_users`, `actors`, `filters_run`,
`exports`, `by_panel[]`, `exports_by_view[]`, `top_filters[]`, `top_operators[]`, `by_day[]`,
`errors[]`, `recent_active_users[]`, `visitors[]`, and `health { rows, test_rows, mb, latest_mtn }`.

Other exports: `report_text(pool, opts)` (renders the contract to text), `size(pool)` (table MB + row
range — computed directly, since the generic `retention.size()` assumes `created_at_*` columns that
`reporting_events` lacks), `purge_test(pool)` and `purge_all(pool)` (delegate to the table-agnostic
`utilities/analytics/retention` core), plus `TABLE` / `APP` constants.

---

## 5. Ask your data (LLM) + key gating

`metrics/ask.js` turns a natural-language question into **one** guarded read-only SQL query over
`reporting_events`, runs it, and summarizes the rows in 1–2 sentences. It also supports a raw-SQL mode
(the `</> SQL` toggle), conversation history, a model picker, and "correct this" feedback notes.

**Env vars it reads:**
- `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` — presence of either enables the feature and populates
  the model list (Claude Haiku/Sonnet, GPT-4o-mini/4o).
- `REPORTING_ASK_MODEL` — optional default model id.
- `REPORTING_ASK_CORRECTIONS_FILE` — optional override for where correction notes are stored (defaults
  to `metrics_ask_corrections.json` under the reporting data dir).

**Graceful gating (no key configured):** `list_models()` returns `{ models: [], default: null }`, and
`ask()` throws an error with `code === 'NO_AI_KEY'`. The route `POST /api/metrics-ask` maps that code
to **HTTP 501**, and `AskData.jsx` shows a disabled placeholder with a "set ANTHROPIC_API_KEY or
OPENAI_API_KEY" hint. No key is required for the rest of the dashboard.

**Read-only guard (`assert_safe_select`, exported + unit-tested):** strips comments/strings, then
enforces a single statement (no `;` mid-query), a `SELECT`/`WITH` prefix, no blocked write/DDL keywords
(insert/update/delete/drop/alter/truncate/…), only the `reporting_events` table in FROM/JOIN, and a
`LIMIT` capped at `MAX_LIMIT` (500). It runs before any DB hit.

---

## 6. Endpoints + auth gating

All under `api/routes.js`. Panel gating via `require_panel('metrics')`; admin actions via
`require_admin`.

| Method + path                  | Gate                  | Purpose |
|--------------------------------|-----------------------|---------|
| `POST /api/event`              | `require_auth`        | ingest a browser usage event (always 204) |
| `GET  /api/metrics-report`     | `require_panel('metrics')` | build_report for `?days=N` |
| `POST /api/metrics-purge-test` | `require_admin`       | delete `is_test=1` rows |
| `GET  /api/metrics-ask-models` | `require_panel('metrics')` | list available LLM models (empty w/o key) |
| `POST /api/metrics-ask`        | `require_panel('metrics')` | NL question / raw SQL → guarded read-only result (**501** if no key) |
| `POST /api/metrics-ask-correct`| `require_panel('metrics')` | save a "correct this" note |

`is_test` is never client-trusted: the server sets it only from `?metrics_test=1` (or the body flag).
`actor`/`role` are always taken from the signed-cookie session.

---

## 7. Chart.js CDN dependency

`components/ChartCard.jsx` uses the **global `window.Chart`** (Chart.js) plus the
`ChartDataLabels` plugin, loaded from a CDN `<script>` in `web/index.html` — deliberately **not**
bundled (keeps `web/package.json` lean, per the app's "no heavy front-end deps" guardrail). If the
CDN script is absent, charts silently no-op (the code guards on `window.Chart`); the table-flip views
and the rest of the page still work.

---

## 8. Deploy / enable checklist

1. **Rebuild the web SPA** so the `/metrics` page + trackers ship: build `web/` (the app's usual
   `npm --prefix src/reporting/web run build`).
2. **Restart the reporting server** so the new routes in `api/routes.js` are mounted. On first request
   `events.ensure()` creates/migrates the `reporting_events` table automatically (no manual DDL).
3. **Grant the `metrics` panel** to the users who should see the dashboard (admin → panel access).
4. **(Optional) enable Ask your data:** set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` (optionally
   `REPORTING_ASK_MODEL`) in the repo-root `.env` and restart. Without a key the dashboard works fully;
   only the Ask panel is disabled (501).
5. **Verify:** hit `GET /api/metrics-report?days=7` (should return `{ ok: true, report }`), open
   `/metrics`, and confirm the Chart.js CDN loads.

Everything above lives under `src/reporting/`. No merge-app files, no merge DB tables, no shared login.

---

## 9. Tests

`tests/metrics.test.js` (node:test, no real DB, no API key):
- `build_report` against a stubbed pool — asserts the full report contract, every block, and that the
  headline windows carry the `is_test` exclusion while `health` counts the whole table.
- `ask.js` key-gating — `list_models()` empty and `ask()` rejects `NO_AI_KEY` with no key; plus the
  `assert_safe_select` guard rejecting non-SELECT / multi-statement / write / other-table SQL.
- `track.js` — the pure `panelForPath` mapping.

Run: `node --test src/reporting/tests/metrics.test.js` (or `node --test 'src/reporting/tests/*.test.js'`
for the whole suite). The React components (`Metrics.jsx`, `ChartCard.jsx`, `AskData.jsx`) require a
browser/Chart.js and are not unit-tested here.
