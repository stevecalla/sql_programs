# race_results_transform — Project Brief

## What this project does

Reformats a coworker's race-results spreadsheet (`.xlsx` or `.csv`, any column order / naming /
date-time formatting) into the fixed 12-column **USAT rankings template**:

```
Member Number | Last Name | First Name | Gender | DOB | Email |
Address | City | State | Zip | Category | Recorded Time
```

Runs as a static browser app (drop → review → download) and a CLI, sharing one isomorphic core.
The transform happens entirely client-side — uploaded files contain member PII, so nothing is
sent to a server, and example/generated data lives outside the repo.

## How to run

```
node ../../server_race_results_transform_8018.js     # web app at http://localhost:8018/
#   is_test_ngrok=true -> also prints a public ngrok URL when NGROK_AUTHTOKEN is set
#   (server loads the repo-root .env via __dirname; ngrok failure is non-fatal).
node src/cli.js inspect|convert|batch <file|folder>  # CLI
node menu.js                                         # sectioned menu; pauses after each command
node --test tests/*.test.js                          # tests (node:test, no deps)
```

Excel/CSV I/O uses **exceljs** (declared in the repo-root `package.json`; the browser uses the
vendored `public/vendor/exceljs.min.js`). The npm registry is locked down — do NOT `npm install`
for the engine. (The opt-in `e2e/` Playwright suite is the one exception: install it deliberately
on a dev box or the Linux server via `npm run e2e:install` / `e2e:install:server`, then `npm run e2e`.
The suite (functional specs across chromium/firefox/webkit + a mobile project, plus a11y/visual/
mobile/error specs) installs axe-core + all three engines via `e2e:install`. `npm run e2e:chromium`
is the fast path, `npm run e2e:headed` / `e2e:step` watch or pause it, and `npm run e2e:snap`
refreshes the committed visual baselines in `e2e/visual.spec.js-snapshots/`.)

Wired into the monorepo like the other servers: repo-root `package.json` has the standard
`race_results_transform_server` + `pm2_start/logs/stop/delete/show/restart_race_results_transform`
scripts (pm2 name `usat_race_results_transform`, 4G, `--expose-gc`; also step 16/16 of
`pm2_run_all_servers`), and `.vscode/tasks.json` has the `16 RACE RESULTS TRANSFORM (logs/shell)` +
`Race Results Transform (split)` tasks (group `grp-race-results-transform`). `tests/config_wiring.test.js`
asserts all of this stays in place (skips when run outside the monorepo).

## Folder structure

```
src/race_results_transform/
  src/               isomorphic core (UMD: require in Node, window.RRT in browser) + the CLI
    schema.js          TEMPLATE_SCHEMA — the ONLY place domain knowledge lives (aliases, rules)
    normalize.js       value normalizers (gender/dob/state/time incl. DNS/DNF, category, member)
    display.js         how a cell renders in the tables (Excel time -> time, not date) — TESTED
    sort.js            table-sort comparator (case/accent-insensitive, natural numbers) — TESTED
    view_logic.js      pure TableView helpers: search index, visible-row filtering, render cap — TESTED
    split.js           group row indices by a per-row key (split & download by column) — TESTED
    parse.js           header detection + divider/blank-row skipping
    match.js           column auto-matching (alias scoring + greedy assignment)
    transform.js       apply mapping -> output grid + stats + flags + distinct enum values
    reconcile.js       integrity readout + per-column scorecard
    mapping.js         editable mapping helpers + saved profiles (localStorage / in-mem)
    pipeline.js        convenience wiring (parse -> match -> transform -> reconcile)
    io.js              Excel + CSV <-> IR adapter (exceljs). read_to_ir (first sheet) / read_to_irs
                       (every sheet) ; grid_to_buffer / grids_to_buffer (one worksheet per group,
                       names sanitized to <=31 chars, unique); output centered, wide, frozen header
    cli.js             scriptable converter (inspect / convert / batch)
    data_dir.js        data dir via utilities/determineOSPath (…/usat/data on linux/mac); CLI + tests only
  public/            web app: index.html, css/app.css, js/app.js, favicon.svg, vendor/exceljs.min.js
  menu.js            interactive launcher (pauses after each command); item numbers are sequential
                     1..N in display order, guarded by tests/menu_ids.test.js
  metrics/           usage-analytics server modules + the Basic-Auth dashboard view (kept OUT of
                       public/ and src/ so it isn't statically served): metrics_config.js,
                       metrics_report.js, metrics_dashboard.html
  package.json       scripts + bin (no deps block — exceljs lives in the root package)
  examples/template/ the target-format template (no PII)
  examples/sample/   SYNTHETIC committed fixtures (fake CSV + xlsx + build_sample.js + goldens) for tests
  e2e/               OPT-IN Playwright browser tests (10 spec files) of the served app, sharing
                     helpers.js (narrated step banner + click highlight + fixtures): convert/download/
                     split/combine, theme/CSV/approve/edit/value-map/remap/link/sort/filter/layout/
                     sheet-tabs/drag-drop/split-presets, + a11y (axe-core), visual snapshots, mobile
                     viewport, error handling; runs on chromium/firefox/webkit + a mobile project.
                     dev/CI only, NOT in `npm test`, never in prod install. (menu.js items 15-21)
  tests/             node:test suites (each wrapped in describe(); runnable via menu.js or
                     node --test): engine + lint_snake_case + web_assets (static-asset integrity)
                     + config_wiring (repo-root package.json + .vscode/tasks.json) + sample.test.js
                     (always-on synthetic data) + fixtures.test.js (optional real usat/data tier)
                     + metrics_ingest + metrics_retention (analytics whitelist/timestamps + purge)
                     + menu_ids (menu item numbers stay sequential 1..N)
../../server_race_results_transform_8018.js   thin express.static host + ngrok (repo root)
```

## Core architecture

Four generic stages over an intermediate representation (`IR = { sheet_name, rows: Cell[][] }`,
Cell = string|number|Date|null):

1. **parse** — detect the header row; skip blank rows and section-divider rows (e.g. file 1's
   `Alpha Sprint` lines where only one cell is populated).
2. **match** — normalize headers, score against each column's `aliases`
   (exact > startsWith > contains > token-overlap), greedy one-to-one. The finish-time column is
   special: split columns (Leg/Bike/Swim/T1/T2 — `SPLIT_KEYWORDS`) can never become Recorded Time.
3. **transform** — per row, per template column: mapped source value → user value-override →
   normalizer. Collects per-column stats, per-cell review flags, and the distinct enum values.
4. **reconcile** — column ledger, row tie-out, pass-through checksum (Name/Email/Zip), scorecard.

To support a new quirky file: add an alias in `src/schema.js` or tweak a normalizer in
`src/normalize.js`. Nothing else should change.

## Key rules

- Output ALWAYS has all 12 columns in order; only **Address** is optional.
- Member #: clean numeric kept (separators stripped); number embedded in text is trimmed out
  (`USAT-12345` → `12345`, flagged `member-trimmed`); blank / "Valid" / no usable number → `1-day`.
- Gender M/F/NB/Open · DOB `mm/dd/yyyy` · State 2-letter (foreign flagged) ·
  Category Age Group/Elite/Para/Relay/Open · Recorded Time `hh:mm:ss.000`.
- Race statuses (DNS/DNF/DQ/DSQ/DNC/NT) preserved verbatim, flagged `time-status`.
- exceljs reads dates/times as UTC on the 1899-12-30 epoch — normalizers use getUTC*/epoch-diff.

## UI notes (web app)

- Light/dark **theme toggle** (`#themeToggle`); follows OS via `prefers-color-scheme` unless a
  `theme` pref is set (`data-theme` on `<html>`). USAT navy `#15284e` + red `#e4002b`.
- **Multi-sheet**: `io.read_to_irs` yields one IR per non-empty worksheet; `app.js` keeps a
  per-sheet state bundle (mapping/overrides/approvals/edits/computed result) and a **sheet tab
  bar** (`#sheetBar`) switches the active bundle. In the web app **Download** opens a checklist
  (`open_download_picker`) and each selected sheet saves as its own single-sheet `.xlsx`
  (`download_one_sheet` -> `io.grids_to_buffer` with one group). Single sheet / CSV = direct
  one-file download (the popover also offers a **Separate / Combined** toggle — Combined stacks all
  selected sheets' rows into one worksheet via `download_combined`). The CLI still writes one
  workbook with one tab per source sheet.
- **Split & download by column** (Mapping tab, `render_split`): pick any *source* header. A mapped
  column offers a **Converted / Original** basis toggle (`S.split_basis`); converted groups by the
  output field value, original groups by the raw cell and lets the user edit a per-value **group
  name** (`S.split_manual`) so values merge (`split.merge_named`). `split.group_by_key` builds the
  distinct groups; each -> its own single-sheet `.xlsx` via `io.grids_to_buffer` (`download_groups`).
  Multi-sheet: the split Download button opens a sheet picker (`open_split_picker`) and `run_split`
  emits one file per group for each chosen sheet (filename includes the sheet name). The inline
  value list reflects the active sheet.
- **Group-name helpers** (`SPLIT_FEATURES` flags at the top of `app.js`, each independently
  revertable). `group_picker`: each Original-value field is a pick-or-type box (empty, with the raw
  value as placeholder; `manual_name` falls back to the raw value so a blank box = its own file) +
  a `<datalist id="split-groups">` of the group names you've typed (`S.split_manual`) → dropdown +
  autocomplete, still free-text for new groups. `remember_grouping`: persists value→group per
  `signature|column` in prefs (`split_groups`), loaded once per key (`S.split_loaded_key`) so
  **Clear entries** doesn't reload it. A preset toolbar exposes **Clear entries** (reset boxes, keep
  preset), **Save preset**, **Forget preset**, and an **Auto-save** toggle (`get_pref('split_autosave')`,
  default on — when off, type freely and Save preset manually). Flip either flag to `false` to
  disable; `git checkout public/js/app.js public/css/app.css` reverts everything.
- One **Compare** card with tabs (Tables/Mapping/Scorecard/Integrity/Field reference/How it works)
  + summary bar. Layout switch side/stacked/tabs. **Link tables** (default ON) syncs search, sort
  and vertical scroll across both `TableView`s.
- `TableView`: searchable, sortable (comparator is `src/sort.js` — case/accent-insensitive,
  natural-number ordering — so the browser sort is unit-tested), frozen header, empty-state,
  `show_all`, `set_filter`,
  two-row header (control row of remap selects on top so the two tables align), `on_search`/
  `on_sort`/`set_query`/`set_order` hooks for linking.
- **Accessibility**: dynamically-rendered form controls carry explicit `aria-label`s (table search,
  header/mapping remap selects, value-map selects+inputs, split-on select, split include checkboxes,
  group-name inputs) — the `e2e/a11y.spec.js` axe scan guards against critical-impact regressions.
- Highlight legend: collapsible + resizable; per-reason **Show rows** (`filter_by_code`) +
  **Approve**; **Approve all / Unapprove all**; value-mapping with per-value reset + bulk set.

## Naming & layout

- Identifiers are **snake_case**, enforced by `tests/lint_snake_case.test.js` (it scans source
  with comments/strings stripped; allow-list covers DOM/library APIs + UPPER_SNAKE constants +
  DOM element ids). Exceptions: UPPER_SNAKE constants, DOM ids (`$('compareCard')`), library APIs.
- The portable core is in `src/` (browser loads `src/*.js`, served at `/src`).

## Suggested next steps (not done)

- Confirm the canonical Category rule for bare division names with the events team.
- Optional: apply USAT theme to a print/export stylesheet; export/import mapping profiles as JSON.
- **Metrics dashboard auth**: `/metrics` uses HTTP Basic Auth, which has NO server-side
  session/expiry — the browser caches the credentials per origin until it closes. Potential
  improvement: add a signed, time-limited token (configurable expiry) for a real timeout.
- **Anonymous visitor_id durability**: the analytics `visitor_id` lives in `localStorage`
  (durable across restarts, but lost on clear-site-data / incognito / a different browser or
  device). Potential improvement: also write it to a long-lived first-party cookie and restore
  from whichever survives, to reduce false "new user" counts. (True cross-device unification
  would require a login/account, which is intentionally avoided.)

## Full-name split

When a source has no First/Last column but a single full-name column (`Name`, `Athlete Name`, …),
`match.auto_map` claims it up front and marks `first_name`/`last_name` with `split:'first'|'last'`
(confidence `split`). `transform.run` derives each via `normalize.split_name` (handles `Last, First`
and `First Middle Last`); `reconcile` skips the pass-through preservation check for these (computed,
not copied).

## Usage analytics (anonymous)

Built on a reusable core in `utilities/analytics/` (page-agnostic): `event_ingest.js`
(`make_event_ingest` — whitelist + stamp `created_at_utc`/`created_at_mtn` + insert),
`ensure_table.js`, `retention.js` (`size`, `purge_keep_years`), `metrics_client.js`
(browser `UsageMetrics`, served at `/analytics/metrics_client.js`), `report_render.js`
(report contract → Slack blocks / text / dashboard JSON). Per-app inputs live here:
`metrics_config.js` (table `race_results_transform_events`, app id, KEEP_YEARS=2, column
whitelist), DDL in `src/queries/create_drop_db_table/query_create_race_results_transform_events_table.js`,
aggregation in `metrics_report.js`, and `public/js/metrics.js` (thin init).

Server (`server_race_results_transform_8018.js`): best-effort mysql2/promise pool via
`local_usat_sales_db_config()`, `ensure_table` at startup, `POST /api/event` ingest,
`/metrics` dashboard + `/api/metrics-report` (Basic Auth: `RACE_RESULTS_CONVERTER_METRICS_DASH_USER`/`_PASS`),
and `/scheduled-slack-race-results-metrics` (cron → `slack_message_api`). Analytics is
fire-and-forget: if the DB is down the converter still serves normally. PII never leaves
the browser — events carry counts/enums + filename only. The client mutes itself under
automated browsers (`navigator.webdriver`) unless `window.METRICS_TEST_ALLOW` is set, so e2e
runs don't pollute the table; the uploaded filename is remembered and attached to every
post-upload event for traceability (plus the `upload_id` correlation). Every event also carries `page_path` (client `location.pathname`+search; server `req.originalUrl` for `dashboard_view`) so we know which page was viewed, not just `page_view`/`dashboard_view`. New columns are migrated onto existing tables via `ensure_columns` (CREATE IF NOT EXISTS won't add them). Events: page_view, file_uploaded, conversion_completed, download, split_download_used, manual_remap, mapping_saved, start_over, theme_changed, error, + a server-side dashboard_view per /metrics open (skipped when `x-metrics-test` header is set). Dashboard: funnel (incl. start-over stage), activity-by-day (visits/uploads/downloads/start-overs; grouped ≤14 days else auto-stacked with datalabels), downloads-by-type + split panel, top users (visits/uploads/downloads/start-overs + timezone + last activity), a Start-over KPI card, refresh/auto-refresh, dark/light. Data tables have a leading # row-number column and horizontal scroll when narrow. Auto-refresh defaults ON and reloads the report from the DB every 60s (tooltip explains it). Both this server and event_analysis register `SIGINT`/`SIGTERM` `cleanup()` handlers (repo convention) so Ctrl-C cleanly stops them; the server also adds a readline `SIGINT` bridge (Windows/VS Code terminals don't always deliver process-level SIGINT — readline catches the Ctrl-C keystroke directly); `menu.js` launches `node` children WITHOUT a shell on Windows (a cmd.exe wrapper would swallow Ctrl-C) and ignores SIGINT itself so stopping the server returns you to the menu. Every chart has an Expand/PNG/CSV/Table toolbar (same UX as event_analysis, but **live** — served from `/api/metrics-report`, not a generated static file) + a DB-health strip (rows/size/last-data). CLI: `stats`, `metrics:size`,
`metrics:cleanup`, `metrics:purge-all`. Crons: `utilities/cron_get_slack_race_results_transform/`,
`cron_get_purge_race_results_transform/`. Reuse the core for other pages (e.g. 8016) by
supplying a new config + DDL + report. Verified by `tests/metrics_ingest.test.js` + `tests/metrics_retention.test.js` (dep-free unit tests:
whitelist/timestamps, purge-by-year + purge-all) and
`e2e/metrics_db.spec.js` (browser→MySQL round-trip + table-schema check; chromium-only,
auto-skips without a DB — `npm run e2e:db`). Full design + Linux setup