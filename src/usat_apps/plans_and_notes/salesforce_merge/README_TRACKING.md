# Usage Tracking — reference (BUILT)

Usage analytics for the merge tool, modeled on the email-queue's `/metrics` stack and reusing the
same shared core (`utilities/analytics/*`). Same data contract; the dashboard is rebuilt in React.

## Architecture (what's reused vs new)

- **Reused, unchanged** — `utilities/analytics/`: `event_ingest` (whitelist + stamp
  `created_at_utc/mtn`), `ensure_table`/`ensure_columns`, `retention` (size/purge), `report_render`.
- **New, app-specific** (`src/salesforce_merge/metrics/`):
  - `metrics_config.js` — `APP='salesforce_merge'`, `TABLE='salesforce_merge_events'`, `KEEP_YEARS`,
    `REPORTING_TZ`, `COLUMNS` whitelist, and an `EVENTS` catalog.
  - `events.js` — `log(event)` (server-side fire-and-forget), `ingest_http(req, actor)` (browser
    ingest; stamps actor from the session + Sandbox/Production `env`/`is_test`, cached 60s), `ensure(pool)`.
  - `metrics_report.js` — `build_report(pool, {days})` → the report contract (`data` + `sections`);
    plus `purge_test` / retention passthroughs.
  - `ask.js` — NL → guarded read-only `SELECT` (Anthropic or OpenAI via `fetch`; no SDK).
- **Table DDL** — `src/queries/create_drop_db_table/query_create_salesforce_merge_events_table.js`
  (append-only; `CREATE TABLE IF NOT EXISTS`). Created lazily on first event / first report load.
- **Client** — `web/src/lib/track.js` (`track` + `trackPanelView/trackFilter/trackSearch/trackExport/
  trackSession`); a per-browser `visitor_id` in `localStorage`, a per-load `session_id`.
- **Dashboard** — `web/src/pages/Metrics.jsx` (+ `components/AskData.jsx`), gated by the `metrics` panel.

## Event catalog (no member PII — actor + panel + pointers + counts/enums only)

| Process | event_name | key fields |
|---|---|---|
| Views | `panel_view` | panel |
| Filters | `filter_run`, `search_run` | panel, view, filter_name |
| Reports | `report_export` | panel, view, export_format (csv/xlsx) |
| Session | `login`, `logout`, `access_change` | actor, role |
| Data builds | `data_build` | mode(scope), outcome, row_count, duration_ms |
| Merge queue | `queue_add`, `queue_bulk_add`, `queue_approve`, `queue_remove` | source_type, set_count |
| Merges | `merge_run` | mode (simulate/execute), set_count, account_count, outcome, duration_ms |
| Restores | `restore_run`, `recreate_run` | mode, set_count, account_count, outcome |
| Errors | `error` | error_type, error_msg |

Dimensions on every row: `actor`, `panel`, `env` (prod/sandbox), `is_test`, `visitor_id`,
`local_hour`, `local_dow`, plus `created_at_utc` / `created_at_mtn`.

## Where events are logged

- **Server-side, authoritative** (from `api/routes.js`, off the action result objects): `data_build`
  (refresh start), `queue_add/queue_bulk_add/queue_approve/queue_remove`, `merge_run`,
  `restore_run`, `recreate_run`. Can't be spoofed or missed by the client.
- **Client-side** (`track.js`): `panel_view` (App route-change effect), `filter_run`/`search_run`/
  `report_export` (centralized in `DataTable`), `login`/`logout`.

Analytics is fire-and-forget: `events.log` and the browser `track` never throw or block a request.

## Test handling (is_test) + retention

The **`metrics_test=1` parameter is the SINGLE driver** of the `is_test` column — not role, not env,
not session (the lesson from the prior app, where a sticky per-session flag caused problems).
`events.resolve_is_test(url_hint)` returns `url_hint ? 1 : 0`, and nothing else sets `is_test`.

The "flag as test" mechanism is entirely the parameter:

- **Browser events:** `track.js` sends `metrics_test:1` whenever `?metrics_test=1` is on the URL OR
  the client toggle is set; the server (`ingest_http`) honours that param.
- **Server-side action logs** (merges/restores/builds/queue): the route reads `metrics_test` off the
  request (`routes.mtest(req)`) and stamps `is_test` from it.
- **The admin toggle** (Metrics page, admin-only, "Flag my activity as test (?metrics_test=1)") is a
  convenience that turns the parameter on for ALL activity: it persists a `localStorage` flag AND
  reflects `?metrics_test=1` in the address bar (`track.setMetricsTest`), and the API client
  (`api.withMetricsTest`) then appends `metrics_test=1` to every request. Turn it off → your activity
  records as real.

`env` (`prod`/`sandbox`, the Sandbox-vs-Production dashboard split) is a separate dimension stamped
from the loaded dataset environment — it does not drive `is_test`. Headline figures EXCLUDE test
rows; Health shows them and they're purgeable (`POST /api/metrics-purge-test`, admin). Retention
keeps the current + prior calendar year (`KEEP_YEARS=2`).

## Endpoints (all gated)

- `POST /api/event` (`require_auth`) — browser ingest, 204.
- `GET /api/metrics-report?days=` (`require_panel('metrics')`) — the dashboard data.
- `POST /api/metrics-purge-test` (`require_admin`).
- `POST /api/metrics-ask` (`require_panel('metrics')`) — needs `ANTHROPIC_API_KEY` or
  `OPENAI_API_KEY` (optional `MERGE_ASK_MODEL`); 501 if no key.

## Tests

`tests/metrics.test.js` — the read-only SQL guard (`ask.assert_safe_select`: injects/clamps `LIMIT`,
blocks non-SELECT, other tables, hidden keywords, multi-statement), the column whitelist, and
`build_report`'s shape via a fake pool.
