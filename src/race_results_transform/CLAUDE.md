# race_results_transform — Project Brief

## What this project does

Reformats a coworker's race-results spreadsheet (`.xlsx`, `.xls`, or `.csv`, any column order /
naming / date-time formatting) into the fixed 12-column **USAT rankings template**:

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
scripts (pm2 name `usat_race_results_transform`, 4G, `--expose-gc`; also step 17/20 of
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
    duplicates.js      find rows whose Member Number repeats across rows (ignores 1-day/blank) — TESTED
    split.js           group row indices by a per-row key (split & download by column) — TESTED
    csv_sniff.js       CSV delimiter detection (comma/semicolon/tab/pipe) + "CSV of a CSV" double-
                       encoding detection; io.csv_to_ir uses it — TESTED
    parse.js           header detection + divider/blank-row skipping
    match.js           column auto-matching (alias scoring + greedy assignment)
    transform.js       apply mapping -> output grid + stats + flags + distinct enum values
    reconcile.js       integrity readout + per-column scorecard
    mapping.js         editable mapping helpers + saved profiles (localStorage / in-mem)
    pipeline.js        convenience wiring (parse -> match -> transform -> reconcile)
    io.js              Excel + CSV <-> IR adapter (exceljs). `flatten_cell` reduces every cell to a
                       plain value — incl. **hyperlink cells** `{ text, hyperlink }` whose `text` may be
                       rich text (a styled email link), so emails read as the address, not "[object
                       Object]" (falls back to the de-mailto'd URL when there's no label).
                       read_to_ir (first sheet) / read_to_irs
                       (every sheet) ; grid_to_buffer / grids_to_buffer (one worksheet per group,
                       names sanitized to <=31 chars, unique); output centered, wide, frozen header.
                       grid_to_csv (header + rows -> RFC-4180 CSV text, CRLF; all cells text so long
                       member #s stay intact) backs the CSV-default downloads + CLI `--format csv`.
                       **Smart CSV read:** `csv_to_ir` uses `csv_sniff` to detect the delimiter
                       (comma/semicolon/tab/pipe — `parse_csv(text, delim)` is now delimiter-aware) and to
                       spot the **"CSV of a CSV" double-encoding** (each row written as ONE quoted field of
                       an inner delimited string — e.g. a semicolon export re-saved as a comma-CSV), which it
                       auto-unwraps into real columns. When it reshapes a file it sets `ir.csv_note` (a short
                       message), which `app.js` surfaces as a small **"ℹ CSV reshaped"** chip in the summary
                       bar (hover for detail); ordinary comma CSVs parse unchanged with no note.
                       Legacy .xls via SheetJS (xls_to_irs/sheetjs_available). The browser build is
                       **bundled** at public/vendor/xlsx.full.min.js (committed, like exceljs.min.js) so
                       .xls works on any deploy WITHOUT npm install (incl. prod with a locked registry);
                       the server's /vendor/xlsx.full.min.js route prefers node_modules/xlsx/dist when
                       present and falls through to the committed copy. App lazy-loads it; the CLI still
                       uses require('xlsx') (node_modules). See public/vendor/ENABLE_XLS.md
    cli.js             scriptable converter (inspect / convert / batch)
    data_dir.js        data dir via utilities/determineOSPath (…/usat/data on linux/mac); CLI + tests only
  public/            web app: index.html, css/app.css, js/app.js, favicon.svg, vendor/exceljs.min.js,
                       sample/sample_race_results_FAKE.xlsx (committed "Try me" static asset)
  sf/                optional Salesforce intake engine + routes (Node-only): sf_naming, sf_dates,
                     sf_config, sf_client (injectable conn), sf_fetch (in-memory, no disk),
                     sf_routes (mount_sf_routes), index. See "Salesforce intake" below.
  menu.js            interactive launcher (pauses after each command); item numbers are sequential
                     1..N in display order, guarded by tests/menu_ids.test.js. The CATALOG (sections/ids/
                     labels/descriptions) is the SINGLE SOURCE OF TRUTH in admin/console_registry.js so
                     menu.js and the /admin Operations panel can't drift; menu keeps its own interactive
                     prompts (handle()).
  admin/             /admin support (Node-only, not lint-scanned): admin_store.js (scrypt users + config
                     overrides), console_registry.js (the 54-command catalog + how the web runs each:
                     run/form/terminal/menu, safety klass, declarative argv+params), console_runner.js
                     (allowlist + argv-assembly + validation + the run/SSE-stream/kill registry; spawns
                     with shell:false — no injection), log_ring.js (in-memory console ring + pm2 jlist).
  metrics/           usage-analytics server modules + the Basic-Auth dashboard view (kept OUT of
                       public/ and src/ so it isn't statically served): metrics_config.js,
                       metrics_report.js, metrics_dashboard.html
  package.json       scripts + bin (no deps block — exceljs lives in the root package)
  plans_and_notes/   CONVENTION: all feature **plan + notes** markdown lives here — ANALYTICS_PLAN.md,
                     EMAIL_QUEUE_PLAN.md, INTAKE_AND_METRICS_PLAN.md, SEARCH_NOTES.md. New feature work
                     gets its plan/notes doc here (NOT scattered at the root or in sf/). CLAUDE.md +
                     README.md stay at the root; e2e/README.md + metrics/ASK_DESIGN.md stay next to their code.
  examples/template/ the target-format template (no PII)
  examples/sample/   SYNTHETIC committed fixtures (fake CSV + xlsx + build_sample.js + goldens) for tests
  e2e/               OPT-IN Playwright browser tests of the served app, sharing
                     helpers.js (narrated step banner + click highlight + fixtures): convert/download/
                     split/combine, theme/CSV/approve/edit/value-map/remap/link/sort/filter/layout/
                     sheet-tabs/drag-drop/split-presets, try-me (demo sample load + badge), + a11y
                     (axe-core), visual snapshots, mobile viewport, error handling; runs on
                     chromium/firefox/webkit + a mobile project.
                     dev/CI only, NOT in `npm test`, never in prod install. (menu.js items 15-21)
  tests/             node:test suites (each wrapped in describe(); runnable via menu.js or
                     node --test): engine + lint_snake_case + web_assets (static-asset integrity)
                     + config_wiring (repo-root package.json + .vscode/tasks.json) + sample.test.js
                     (always-on synthetic data) + fixtures.test.js (optional real usat/data tier)
                     + metrics_ingest + metrics_retention (analytics whitelist/timestamps + purge)
                     + metrics_report (last-activity MTN/dashboard_view + demo-split shape)
                     + try_me (Try-me UI markup + is_demo wiring across DDL/whitelist/client)
                     + sf_naming/sf_dates/sf_client (Salesforce engine, mock conn — no network)
                     + sf_ui (SF panel markup + app.js wiring + source flag across COLUMNS/client/DDL)
                     + menu_ids (menu item numbers stay sequential 1..N)
                     + admin_store/admin_auth (admin login + overrides store + ops-console route gating)
                     + admin_console (console_registry shape + console_runner argv-assembly/guards)
../../server_race_results_transform_8018.js   thin express.static host + ngrok (repo root)
```

## Core architecture

Four generic stages over an intermediate representation (`IR = { sheet_name, rows: Cell[][] }`,
Cell = string|number|Date|null):

1. **parse** — detect the header row; skip blank rows and section-divider rows (e.g. file 1's
   `Alpha Sprint` lines where only one cell is populated). `detect_table(ir, { score_header })`
   prefers the row with the most **template-alias hits** (`match.score_headers`, wired in by
   `pipeline.convert` + the app), so a one-cell **title/banner in row 1** is skipped and the real
   header (often row 2, sometimes after a blank leading column) is chosen; falls back to the
   string-heuristic when no scorer is passed.
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
  A **one-day marker riding along with a real number** is dropped INCLUDING its leading digit `1`,
  so it isn't glued onto the front of the real id: `1-day - 2095126403` → `2095126403` (not
  `12095126403`). Covers `1-day` / `1 day` / `1day` / `1 - day` / `one-day` / `one day` (any case);
  a **stray lone leading `1`** before a 4+ digit run is also dropped even without the word "day"
  (`1 - 2095126403` → `2095126403`), while an internally-dashed id (`2100-074-825` → `2100074825`)
  is left intact. A bare marker with no real number stays `1-day`.
- Gender M/F/NB/Open · DOB `mm/dd/yyyy` · State 2-letter (foreign flagged) ·
  Category Age Group/Elite/Para/Relay/Open · Recorded Time `hh:mm:ss.000`.
- Race statuses (DNS/DNF/DQ/DSQ/DNC/NT) preserved verbatim, flagged `time-status`.
- exceljs reads dates/times as UTC on the 1899-12-30 epoch — normalizers use getUTC*/epoch-diff.

## UI notes (web app)

- Light/dark **theme toggle** (`#themeToggle`); follows OS via `prefers-color-scheme` unless a
  `theme` pref is set (`data-theme` on `<html>`). USAT navy `#15284e` + red `#e4002b`.
- **Try me (fake data)** (`#tryMeBtn` split-button in the upload card; `wire_try_me`/`load_demo` in
  `app.js`). Dropdown with two paths: *Load sample data* fetches the committed synthetic fixture
  (`/sample/sample_race_results_FAKE.xlsx` — a STATIC asset under `public/sample/`, served by
  `express.static`, so it works in an Express deploy AND a pure-static/Cloudflare Pages deploy; NOT a
  dynamic route) and runs it through the normal pipeline in-browser; *Download sample file*
  (`<a download>`) hands the user that file to upload themselves. `examples/sample/build_sample.js`
  writes both the test fixture and this `public/sample/` copy (`public/sample/.gitignore` re-includes
  the `_FAKE` file past the root `*.xlsx` ignore). `S.is_demo` is set for either path (a re-uploaded `*_FAKE.*` file is
  auto-detected via `is_demo_filename`), which stamps `is_demo:1` on the demo's analytics events and
  shows the `#demoBadge` "sample test data" banner. The upload card (and its Try-me button) hides once a
  workbook loads; **Start over** clears `S.is_demo` + the badge and restores it.
- **Download format + filename builder** (shared by BOTH download buttons via `dl_format_html` +
  `dl_builder_html`/`read_builder`/`wire_builder`, `emit_grid`): the popover has a **CSV (default) /
  Excel .xlsx** toggle (`S.dl_format`) and a **filename builder** — Sanction ID · Race Type
  (`RACE_TYPES`) · Race Distance (`RACE_DISTANCES`) · Race Name → `build_base_name` composes
  `351003 - Duathlon - Intermediate - Clash Mississippi`, blanks (and their separators) skipped,
  illegal chars stripped (`clean_part`). `emit_grid` writes CSV via `io.grid_to_csv` or `.xlsx` via
  `io.grids_to_buffer`. Fields persist in `S.dl_fields`. A **CSV-only "CSV-safe times/dates"**
  checkbox (`#dlXsafe` → `S.dl_excel_safe`, off by default, with a hover tooltip "Keep the time/date format when the CSV is opened in Excel") makes `emit_grid` pass
  `excel_safe_cols` (the DOB + Recorded Time column indices) to `io.grid_to_csv`, which wraps those cells
  as an Excel text formula `="value"` so Excel keeps them EXACTLY as written instead of auto-reformatting
  the time/date on open (other CSV tools see the literal `="..."`; no effect on the `.xlsx` download).
- **Multi-sheet**: `io.read_to_irs` yields one IR per non-empty worksheet; `app.js` keeps a
  per-sheet state bundle (mapping/overrides/approvals/edits/computed result) and a **sheet tab
  bar** (`#sheetBar`) switches the active bundle. **Download** always opens the popover
  (`open_download_picker`). Single sheet → one file named from the builder. Multi-sheet → a
  **Separate / Combined** toggle: *Separate* lists each sheet with **its own editable filename**
  (`.dl-fname`, pre-filled from the builder with **Type auto-filled from the tab name** via
  `type_from_sheet` when it matches a dropdown option; untouched rows refresh as you edit the
  builder), each saved via `download_selected`; *Combined* stacks all selected sheets' rows into one
  file (`download_combined`). The CLI writes one `.xlsx` per source sheet, or (with `--format csv`)
  one `.csv` per sheet.
- **Split & download by column** (Mapping tab, `render_split`): pick any *source* header. A mapped
  column offers a **Converted / Original** basis toggle (`S.split_basis`); converted groups by the
  output field value, original groups by the raw cell and lets the user edit a per-value **group
  name** (`S.split_manual`) so values merge (`split.merge_named`). `split.group_by_key` builds the
  distinct groups; the split Download button always opens `open_split_picker` (carrying the same
  format toggle + filename builder PLUS a **per-group editable filename** list — `split_output_labels`
  enumerates the output groups, each `.split-fname` pre-filled `<base> - <group>` and individually
  editable, like the main picker's per-sheet names). The sheet checklist only appears when there's
  **more than one sheet** (a single-sheet list was just noise). `run_split(idxs, checked, manual,
  names)` emits one file per group using the per-group name (or `<base> - <group>`), with the sheet
  name appended when multiple sheets are selected. The inline value list reflects the active sheet.
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
- **Row delete (original table, opt-in `deletable`)**: a per-row ✕ in the table body, plus **Delete N
  shown** + **Restore N** controls rendered in the original **pane-head** (`#origDelCtl`, via the
  TableView's `on_render` hook + `visible_keys()`) — deliberately NOT in the table toolbar, so both
  grids' toolbars stay the same height and the tables keep aligning side by side. Soft-exclude — `S.excluded`
  (per-sheet, mirrored into the active bundle) is a `{ rowIndex: true }` set passed to
  `view.visible_indices` (new 5th arg) so deleted rows are **hidden from BOTH tables** and left out of
  the download (`export_rows` / `kept_rows` skip them), but the transform still runs on the FULL data so
  row indices stay stable and edits/overrides/approvals keep working — no recompute needed (display +
  download only). The summary bar shows a **`N deleted`** chip and the rows count drops accordingly;
  **Restore** clears `S.excluded`. Reversible, in-session; cleared on Start over.
- **Accessibility**: dynamically-rendered form controls carry explicit `aria-label`s (table search,
  header/mapping remap selects, value-map selects+inputs, split-on select, split include checkboxes,
  group-name inputs) — the `e2e/a11y.spec.js` axe scan guards against critical-impact regressions.
- Highlight legend: collapsible + resizable; per-reason **Show rows** (`filter_by_code`) +
  **Approve**; **Approve all / Unapprove all**; value-mapping with per-value reset + bulk set.
- **Duplicate Member Number detection** (`src/duplicates.js`, TESTED): `compute()` runs
  `duplicates.find_duplicates(S.work_rows, memberCol)` on the **converted/normalized** Member Number column
  (so values that only collide after conversion — `USAT-12345` vs `12345` — group together; `1-day`/blank/
  `Valid` placeholders never count) into `S.dup_info`/`S.dup_set`. The summary bar shows a **`N duplicate rows
  · M member #s`** chip (bold = row count); clicking it (`filter_dups`) filters BOTH tables to just those rows
  via `set_filter` (+ the linked-tables mirror; the TableView "Showing only: … ✕" bar clears it). Rows are
  highlighted in both the original and converted tables via a generic `TableView` `row_class(i)` hook →
  `dup-row` (red `--accent-soft` tint + left accent bar; flag cells keep their own highlight). Recomputed
  per-sheet on every remap/value-override.

## Naming & layout

- **Use snake_case for every identifier we define** (functions, vars, object keys) — enforced by
  `tests/lint_snake_case.test.js` (it scans source with comments/strings stripped; allow-list covers
  DOM/library APIs + UPPER_SNAKE constants + DOM element ids). Exceptions: UPPER_SNAKE constants,
  DOM ids (`$('compareCard')`), and library/Node/DOM APIs you can't rename.
- When you call a **new camelCase library/Node/DOM API** (e.g. `statSync`, `arrayBuffer`,
  `byteLength`), the lint will flag it. Either prefer an equivalent already in the allow-list
  (e.g. `fs.readFileSync(f).length` instead of `fs.statSync(f).size`) or add the genuine API name to
  the `ALLOWED` set in `tests/lint_snake_case.test.js`. Run `node --test tests/lint_snake_case.test.js`
  before committing. (DOM ids in `index.html` are auto-allowed — the lint reads `id="…"` values.)
- **Whenever you add a new package or new library APIs** (jsforce, xlsx, …), it usually brings
  camelCase names the lint will flag (e.g. `searchRecords`, `instanceUrl`, `unlinkSync`, `cellDates`).
  Run the snake_case lint and **add those genuine API names to `ALLOWED`** — it's the standard step
  for any new dependency or Node/DOM call. (Note: the lint scans `src/*.js`, `public/js/app.js`,
  `menu.js`, and `tests/*.test.js`; the `sf/` and `metrics/` trees aren't scanned, but their
  test files are.)
- The portable core is in `src/` (browser loads `src/*.js`, served at `/src`).

## Suggested next steps (not done)

- Confirm the canonical Category rule for bare division names with the events team.
- Optional: apply USAT theme to a print/export stylesheet; export/import mapping profiles as JSON.
- **Split auth — app login vs admin login** (built): two independent signed-cookie logins, both HMAC/12h, no
  HTTP Basic. (1) The **app login** (`mx_session` ← `RACE_RESULTS_CONVERTER_METRICS_USER`/`_PASS`, via
  `require_dash_auth` + `POST /api/login`) gates the converter's **Salesforce/Slack intake** (`/api/sf/*`,
  `/api/slack/*`) — the drag-drop converter at `/` stays public static. (2) The **admin login**
  (`admin_session` ← **`RACE_RESULTS_ADMIN_USER`/`RACE_RESULTS_ADMIN_PASS`**, via `require_admin_auth`) gates
  **`/metrics`** (+ all `/api/metrics-*`) **and the new `/admin` hub**. `/metrics/login` + `/admin/login`
  (and `/metrics/logout` + `/admin/logout`) drive the admin cookie. **Fallback:** if the `ADMIN_*` vars
  aren't set, `admin_creds()` falls back to the metrics creds, so an existing deploy keeps working until you
  add them. **`/admin`** (`metrics/admin.html`, served only via the gated route — NOT public static) is a
  config **monitor + control panel**, themed to match `/` (reuses `/css/app.css`, the `rrt_ui_v1` light/dark
  toggle, the live MTN footer clock, the 🏁/⚙️/📊 header style). `GET /api/admin-status` returns booleans only
  (which logins/DB/SF/Slack/ngrok are configured; the Slack channel is a set/unset flag, **never its value**).
  **Admin actions** (gated POSTs, surfaced as buttons): `/api/admin-test-slack` + `/api/admin-test-sf`
  (read-only connection tests), `/api/admin-backfill-source` (legacy `salesforce`→`sf_upload_queue`), and the
  existing `/api/metrics-purge-test`; plus a quick link to the converter in test mode (`/?metrics_test=1`).
  **Editable config + user management** (built): backed by a gitignored `admin_overrides.json`
  (`admin/admin_store.js`) layered over `.env`. Passwords are **scrypt-hashed**; the `.env` creds stay an
  always-on **recovery account** (can't be removed). **Sessions are signed with a stable `session_secret`
  (not the password)**, so changing a password never logs anyone out (existing sessions re-prompt only on the
  one deploy that introduced this). Gated routes: `GET/POST /api/admin-config` (non-secret values — Slack
  default channel, file types, SF object — applied onto `process.env` live), `POST /api/admin-user-add`,
  `POST /api/admin-user-remove`; both logins validate via `admin_store.valid_login(env account + stored users)`.
  The UI lists **usernames only, never hashes**. **Slack channel hide-list (built):** the config key
  `slack_hidden_channels` (a checklist in /admin → Settings) maps onto `process.env.SLACK_HIDDEN_CHANNELS`;
  the end-user `GET /api/slack/channels` HIDES those channels (**empty = show all; newly-invited channels are
  visible by default until explicitly hidden**). A `slack_bot_handle` config (`SLACK_BOT_HANDLE`, blank = the
  bot's own @handle) drives the `/invite` + `/kick` hints in the Slack panel. Every config save stamps
  `config_updated_at`, shown as "Last changed: <MTN>" on the Settings card.
  **Per-user access control (RBAC, built):** each stored user carries a `caps` array — any of **`admin`**
  (the `/admin` hub), **`metrics`** (the `/metrics` dashboard), **`intake`** (the converter SF/Slack/Folder
  pull) — set with checkboxes in /admin → Access. The signed `admin_session` cookie now **carries the
  username**; every gate looks that user's caps up fresh (`caps_for`/`req_caps`): `require_admin_auth` needs
  `admin`, `require_metrics_auth` (which `/metrics` + `/api/metrics-*` now use) needs `metrics`, and
  `require_dash_auth` (intake) needs `intake` (or a legacy `mx_session`). `authenticate()` validates the
  `.env` recovery accounts OR any stored user and returns the username; **the `.env` admin account always has
  all caps and the `.env` converter-metrics account has `metrics` + `intake`** (the dashboard + intake, not
  `/admin`), so you can't lock yourself out. (When no dedicated `RACE_RESULTS_ADMIN_*` is set, that one account
  is also the admin account and gets all caps.) `/api/login` +
  `admin_signin_post` set the cookie with the username; `/api/logout` clears both cookies. Changing the
  signing format means everyone re-logs in once on the deploy that introduces this. **One consolidated
  login panel** (`login_html` + `login_ctx`): the card always shows the form, the "Sign in with an account
  that has <area> access" subtitle, and the sibling-area chips (**Converter** → `/?metrics_test=1`, plus
  **Metrics** and **Admin** → `/…?metrics_test=1`, each skipped on its own page) — so it looks identical
  whether or not you're signed in. When you arrive already
  signed in as an account lacking that area's cap, it ALSO shows an amber "Signed in as X — no <area> access"
  banner + a **Sign out** chip (and any error line). One page, no redirect loop, no dead-end blank form. The **Get-Results panel login (`POST /api/login`) accepts ANY account in the file**: an
  admin account signs in with the admin cookie (reaches `/admin` + `/metrics` + intake), an app account gets the
  app cookie (intake only). **ngrok is a toggle** (`ngrok_enabled` config, default off): /admin → Settings turns
  it on; the server starts the tunnel on (re)start and `create_ngrok_tunnel` returns the public URL, surfaced in
  `/api/admin-status` (`ngrok_url`) + the Maintenance card. **Restart/stop from /admin** via `POST
  /api/admin-restart` + `/api/admin-stop` (pm2 only — replies first, then `pm2 restart|stop`; degrades to a note
  off pm2; `under_pm2` in admin-status gates the buttons). Cross-page links from /admin + /metrics carry
  `?metrics_test=1`. Guards: `tests/admin_store.test.js` + `tests/admin_auth.test.js`.
  **`/admin` is a blend ops console** (left nav rail + a dense "Overview" landing): Overview (health tiles +
  maintenance actions w/ live counts + settings summary + reference), **Operations**, **Logs**, Settings
  (Slack channel dropdown + file-type checkboxes + an Advanced SF-object box), Access (users table + add form),
  and **Reference** (Program object/APIs/DB tables/env/auth). **Operations runs `menu.js` commands from the
  browser**: it reads `GET /api/admin-console/commands` (the `console_registry` web sections), renders each menu
  section with the same labels, and runs an item via `POST /api/admin-console/run {id, params, confirm}` →
  `console_runner` validates params + assembles argv from the registry + `spawn`s with **shell:false** (no
  injection) → output **streams live** over SSE (`GET /api/admin-console/stream/:run_id`, EventSource) into a
  dark console box, with a **Kill** button (`POST /api/admin-console/kill/:run_id`). `run` items run on click;
  `form` items expand inline param inputs (dropdowns/number/text); `terminal`-only items (start server, open
  browser, headed/step e2e, convert/inspect/batch — need a local path or desktop) are **greyed with a note**;
  `destruct` items (purge-all, cleanup) require a typed confirm = the command id. **Logs** shows pm2 stats
  (`GET /api/admin-pm2` → `pm2 jlist`; degrades to "not under pm2" in dev) + a **live console tail**
  (`log_ring` mirrors the server's console into an in-memory ring; `GET /api/admin-logs` + `/api/admin-logs/stream`).
  All endpoints `require_admin_auth`. Guards: `tests/admin_console.test.js` (registry shape + argv-assembly/guards)
  + the ops-console assertions in `tests/admin_auth.test.js`. Plan: `plans_and_notes/ADMIN_CONSOLE_PLAN.md`
  (+ a clickable `admin_console_mockup.html`).
- **Anonymous visitor_id durability** (#6, built): `visitor_id` is written to BOTH a long-lived
  first-party cookie (~2yr, SameSite=Lax) AND `localStorage`, and restored from whichever survives,
  so it persists if one store is cleared. (True cross-device unification would require a
  login/account, which is intentionally avoided.)

## Full-name split

When a source has no First/Last column but a single full-name column (`Name`, `Athlete Name`, …),
`match.auto_map` claims it up front and marks `first_name`/`last_name` with `split:'first'|'last'`
(confidence `split`). `transform.run` derives each via `normalize.split_name` (handles `Last, First`
and `First Middle Last`); `reconcile` skips the pass-through preservation check for these (computed,
not copied).

## Salesforce intake (optional — runs alongside the normal flow)

Pull **Race Results Doc** files straight from Salesforce instead of getting them by hand. Nothing
about the existing dropzone/Try-Me/convert/download flow changes — SF is a second intake that feeds
the SAME engine.

- **Engine** `src/sf/` (Node-only, no DOM; shared by server + CLI + tests, refactored from the
  `salesforce_duplicates` archive script): `sf_naming.js` (snake_case `original_program_owner_versionid.ext`),
  `sf_dates.js` (Mountain-Time today/specific/range filter), `sf_config.js` (`SF_PROD_*`/`SF_DEV_*`,
  `SF_API_VERSION`, `is_test`, **`SF_PROGRAM_OBJECT`**/**`SF_SANCTION_FIELD`** — default `Program`/`cfg_Id__c`),
  `sf_client.js` (jsforce login + SOSL `FIND {Race Results Doc}` →
  ContentVersion (xls/xlsx/csv) → enrich Program via ContentDocumentLink (name) + **Sanction ID** via a
  second query of the Program object's `cfg_Id__c` formula field (`= BLANKVALUE(cfg_Legacy_Id__c,
  cfg_Autonumber_ID__c)`; degrades to blank if the object isn't SOQL-queryable for the connected user)
  + Owner via User → newest first; **connection injected** so it's unit-testable with a mock; also
  exposes read-only `run_soql`/`describe_object` helpers for the `sf:soql`/`sf:describe` CLI discovery
  commands), `sf_fetch.js` (one ContentVersion
  → in-memory Buffer, never written to server disk), `sf_routes.js` (`mount_sf_routes(app, require_auth)`),
  `index.js`. The snake_case download name leads with the Sanction ID when known
  (`351003_program_owner_title_versionid.ext`; blank sanction is simply omitted).
- **Server** (`server_…8018.js`): `mount_sf_routes` registers `GET /api/sf/files`, `GET /api/sf/file/:id`
  (streams bytes in-memory — no server persistence), and the non-Chrome fallback `POST /api/sf/save` +
  `GET /api/sf/folder`. All gated by the SAME `require_dash_auth` (mx_session) as `/metrics`. Lazy-required;
  returns 503 when `SF_*` env is missing (server still boots). Login is **inline**: `POST /api/login`
  (NOT auth-gated) validates the dashboard creds and sets the `mx_session` cookie, returning JSON (no
  redirect) so the panel can sign in in place; `POST /api/logout` clears the same cookie. The old
  `/metrics/login` form-redirect + `/metrics/logout` still exist too.
- **Browser** (`app.js` `wire_sf`/`sf_*`): the **Get Race Results** card on the upload page (its **SF Upload Queue** tab).
  Date filter is a **From / To** pair (`#sfFrom`/`#sfTo`, defaulting to **yesterday → today**, on
  Last-modified/Created), bounded to **`SF_MIN_DATE` (2025-01-01) … today** and capped at a **14-day** span
  (`SF_MAX_RANGE_DAYS`; `sf_apply_range_limits` sets the pickers' min/max + clamps, `sf_range_ok` validates on
  list), with an **Any date (latest)** checkbox (`#sfAnyDate`); `sf_query_params` maps From/To → the server's
  `mode`/`date`/`start`/`end`. On 401 an **inline login** form (`#sfLogin`, `sf_login` → `POST /api/login`,
  with a show/hide password toggle) appears and, on success, retries the list — no redirect, never leaves `/`;
  a single **Sign in / Sign out toggle button** (`#sfLogoutBtn`, styled as a pill top-right of `.sf-head`;
  `sf_toggle_auth` → `sf_show_login` when signed out, `sf_logout` → `POST /api/logout` when signed in;
  label/`aria-pressed` driven by `sf_set_authed`, flipped to true on list/login success and false on 401/logout;
  **on page load** `wire_sf` calls the ungated `GET /api/auth-status` and sets the label, so a refresh while
  signed in shows "Sign out" instead of "Sign in" — the `mx_session` cookie is httpOnly so JS can't read it)
  ends or opens the shared session. The whole control row (From/To, max-14 hint, Any date, **Broaden**, On field,
  Max files, List, Reset) is one tightened wrapping line. The **Broaden** checkbox (`#sfBroaden`, **default ON**, with a hover
  `title` tooltip) sends `search=Race Results Doc,Race Results,Race,Results` to `/api/sf/files`, which the
  server splits into `search_terms` for the SAME OR'd-SOSL + `ContentDocumentId`-dedup path the CLI `--search`
  uses; uncheck it for the precise default term. Folder picker via File System
  Access API on Chrome/Edge else a server-folder path; the chosen folder **persists** (Chrome dir handle in
  IndexedDB `sf_idb_*`, fallback path in localStorage; `sf_restore_folder` on load, write permission
  re-confirmed via `sf_ensure_permission`) until another is picked. Existing-file strategy add_new/replace/
  wipe_all (add_new still loads the existing file's bytes so the row stays openable). Preview table columns are
  Date · Program · **Sanction** · Owner · File name · **Type**, **sortable** by header (`S.sf_sort`, comparator
  reused from `src/sort.js` `compare_text` via `sf_toggle_sort`); the Sanction value (`f.sanction_id`)
  also **pre-fills the download filename builder's Sanction ID** when you open that file from the queue
  (`open_queue_file` → `S.dl_fields.id`, so it leads the converted download name via `build_base_name`) and
  shows as a visible **Sanction readout chip** in the results summary bar (`render_summary`, gated on
  `S.source === 'salesforce' && S.active_sanction`; cleared on Start over). The Sanction ID is
  **Salesforce-only**: `handle_file` (manual upload), a folder-file open, and `clear_all` all blank
  `S.dl_fields.id`, and `open_queue_file` sets it from `it.sanction || ''`, so a previous SF file's
  sanction never carries over into a manual/folder download name. `.xls` reads via SheetJS when it's available — `app.js`
  `read_spreadsheet` routes `.xls` through a lazy `load_sheetjs` (vendor/xlsx.full.min.js, served from
  node_modules/xlsx) → `io.xls_to_irs`. The legacy-`.xls` **warning is conditional**: on first list with an
  `.xls`, `sf_probe_xls` loads SheetJS once and sets `xls_ok`; only when it's genuinely unavailable
  (`xls_ok === false`) does the row get **highlighted** (`sf-xls-row`), the Type cell get the `⚠` tag
  (`sf_type_cell`), and `sf_list_status` append the "re-save as .xlsx" hint (re-rendered when the probe
  settles). If SheetJS is missing, opening still shows the clear `unreadable_message` instead of the raw JSZip
  "end of central directory" error. All rows **auto-selected** (`S.sf_selected` map survives sorting), with a
  found/selected **count** (`#sfCount`) that **flags when more files are available than selected**
  (`.sf-more` — "N more available, raise Max files"; the **Max files** field itself glows amber via
  `.sf-limit-hot` when the cap is below the number available and can still go higher), a **Reset**
  (`sf_reset`, keeps the folder), a prominent
  labeled **progress bar** (`sf_progress`; paced to ~2s via `sf_delay`) with a **Cancel** button (`S.sf_cancel`,
  partial-aware via `sf_download_finish`), a **150-file ceiling** (`SF_MAX_FILES`; auto-selects the newest
  **`SF_DEFAULT_FILES` = 50**, overridable via the **Max files** field), a **show/hide password** toggle on the
  inline login, and a "No files found" indication. The results table is **vertically resizable** (`.sf-table-wrap`
  `resize:vertical`) and **rows missing a program name or sanction id are highlighted** (`.sf-missing-meta`).
  Downloaded files become a **sortable checklist table** in a new **Files** tab (`#filesTab`, left of Mapping;
  `COMPARE_PANELS.files`; `render_queue`) — # · Program · Owner · File name · **Uploaded → Converted →
  Downloaded** status; **clicking a row** opens it (no Open button). Opening runs the normal `on_workbook`
  pipeline with `S.source='salesforce'` (fires `file_uploaded` on first open only; statuses idempotent and
  persisted in localStorage by folder+filename). Reload-fresh on switching; status memory is separate. Each
  row also has a **Reload from disk** button (`.sf-q-reload` → `sf_reload_file`, shown when `sf_can_reload`):
  it re-reads the file's CURRENT bytes — via the saved **dir handle** (`getFileHandle`/`getFile`) on
  Chrome/Edge, or the **server read-back** `GET /api/sf/folder-file` (basename-guarded) on the fallback —
  then re-runs the pipeline and drops the row back to **Uploaded** so Converted re-runs and **Downloaded
  clears** (the prior download is now stale). Picks up edits the user made in Excel; upload-only (drag-drop)
  files have no folder handle so the button is queue-only.
- **The Files queue is source-agnostic** (`build_queue(items, { source, dir, folder, sig })`; `sf_build_queue`
  is a thin wrapper that maps SF downloads into it). `S.queue_source` is `'salesforce'` or `'folder'`;
  `render_queue` shows Program/Owner for SF and **File name · Modified** for a folder; `sf_reload_file`/
  `sf_can_reload` read from `S.queue_dir`/`S.queue_folder`; `open_queue_file` stamps `S.source` from the item.

### Intake tab bar (Get Race Results)
The intake card is titled **"Get Race Results"** and its source switcher is a real **`role="tablist"`**
(`#sfSourceSeg`, `sf_set_source` in `app.js`) with four tabs: **SF Upload Queue · SF Email Queue · From Folder ·
Slack Ironman** (`data-src` = `upload|email|folder|slack`). Each tab has `role="tab"` + `aria-selected` and
controls the shared `#sfPanel` tabpanel (passes the axe `aria-required-children` check). `sf_set_source`
toggles five control-class families — `.sf-upload-only` / `.sf-email-only` / `.sf-folder-only` / `.sf-slack-only`
— plus `.sf-query-only` (the date/List row, hidden for Folder + Slack), `.sf-cap-only` (the **Max** field, shown for
Upload/Email/Folder, hidden only for Slack) and `.sf-dl-server` (the server download controls, hidden for Folder).
**From Folder** folds the local-folder intake **into the same `#sfTable`**
via a folder column set in `sf_columns()` (`File name · Type · Modified`); its control row is a folder picker
(`#sfFolderChoose` / `#sfFolderInput` webkitdirectory fallback, `sf_folder_choose` / `sf_folder_from_input`) + its
own **↺ Reset** (`#sfFolderReset` → `sf_folder_reset`) + the shared **Max** cap (auto-selects the newest N up to the
cap, same as the SF tabs) + a `Folder: <name>` path label reusing the standalone card's styling. Records get a
synthetic `content_version_id` so the shared sort/search/select work unchanged, and its action is a
local **Load selected** (`#sfFolderLoadBtn` → `sf_folder_load`) that reads bytes in-browser and routes them into
the SAME Files queue (`build_queue(... source:'folder')`) — no server, no download. Its control row puts the
folder picker first, then **↺ Reset** (`#sfFolderReset` → `sf_folder_reset`), then the shared **Max** field, then a
`Folder: <name>` label. The **Max** cap auto-selects the newest N files, exactly like the SF tabs (`sf_select_newest`
folder branch). The old **standalone `#folderCard`** ("Convert files from a folder") has been **removed** — the tab
is now the only folder intake; only two small shared helpers survive in `app.js` (`folder_is_spreadsheet`,
`folder_fmt_modified`). **Slack Ironman** is an under-construction placeholder panel (`#sfSlackPanel`,
`.sf-slack-panel`) — no functionality yet.

### Email Queue (a Salesforce source — Email-to-Case)
The **SF Email Queue** tab lists spreadsheet attachments on cases in the
**Rankings** queue. Plan + the verified SOQL chain live in **`plans_and_notes/EMAIL_QUEUE_PLAN.md`**.
- **Engine** `sf/sf_email.js` `list_email_queue_files(conn, opts)` runs the chain
  `Group(Type='Queue', DeveloperName=cfg_Rankings)` → `Case(OwnerId=queue [, IsClosed=false])` →
  `EmailMessage(HasAttachment=true)` → `ContentDocumentLink` → `ContentVersion(IsLatest, ext filter)`,
  dedups by document, and best-effort parses **sanction + program from the email Subject** (`parse_subject`;
  blank/placeholder most of the time) with an OPTIONAL `Program WHERE cfg_Id__c=<parsed>` upgrade. Sender =
  `FromName||FromAddress` (also aliased to `owner_name` so the shared queue/download reuse it). **Opened =
  `Case.CreatedDate`, Modified = `Case.LastModifiedDate`** (matches the SF "Queue: Rankings" list view and the
  date filter); the email's `MessageDate` and the ContentVersion's own dates are also captured on the record
  (`message_date_*`) if we ever switch the columns to those. `SF_RANKINGS_QUEUE` (default `cfg_Rankings`) +
  `SF_EMAIL_SANCTION_RE` configure it. Default table sort = **Modified desc**.
- **Server** `GET /api/sf/email-files` (same `mx_session`; `status=open|all`); download reuses `/api/sf/file/:id`.
- **CLI** `node src/cli.js sf:list-email [--all] [date opts] [--test]` / `sf:pull-email`; menu items 44/45.
- **Browser**: `S.sf_source` ('upload'|'email') drives `sf_columns()` — one shared `#sfTable` whose thead+rows
  are rebuilt per source (Upload: `Date·Program·Sanction·Owner·File·Type`; Email:
  `Opened·Modified·Status·Subject·Sender·Sanction·Program·File·Type`). `#sfEmailStatus` is 3-way, mapped
  straight to Case `IsClosed` — **Is Not Closed (default, `IsClosed=false`)** · Is Closed (`IsClosed=true`)
  · All (no filter) — and `sf_set_source` toggles the controls (`.sf-upload-only`/`.sf-email-only`).
  `sf_select_newest` auto-selects the **newest N of whatever is listed** (the Status filter already narrows the
  list server-side via `IsClosed`), so "Is Closed"/"All" select rows too — earlier the email branch pre-checked
  only not-closed rows, which left the Download button dead at 0 selected when the window held only closed cases.
  Files flow into the SAME Files queue + download as the upload path. Missing program/sanction is NOT flagged for
  email (it's the norm there).

## Local-folder intake (the From Folder tab)

Local-folder intake now lives entirely in the **From Folder tab** of the "Get Race Results" card (the standalone
`#folderCard` was removed; see the **Intake tab bar** section). Pick a folder on your computer, choose the
spreadsheet files in `#sfTable`, and run them through the SAME Files queue (convert / review / download / Reload).
Purely client-side: nothing is uploaded, no server, no Salesforce.
- **Pick**: Chrome/Edge use `showDirectoryPicker` (`sf_folder_choose`); other browsers fall back to a hidden
  `<input type="file" webkitdirectory>` (`sf_folder_from_input` keeps **top-level** files only — rel path
  `folder/file`, depth 1).
- **List/select**: top-level `.xlsx/.xls/.csv` only, rendered in the shared `#sfTable` (File name · Type ·
  Modified) with Select-all + search + a found/selected count; the **Max** field caps the auto-selection.
- **Load**: `sf_folder_load` reads each picked file's bytes (`handle.getFile().arrayBuffer()` or
  `File.arrayBuffer()`) → `build_queue(items, { source: 'folder', dir, folder, sig })`. Events carry
  `source='folder'`. **Start over** / the tab's **↺ Reset** (`sf_folder_reset`) clears it.
- **CLI equivalent**: `node src/cli.js batch <folder> [--format csv|xlsx]` already converts a whole folder
  of files (top-level `.xlsx/.xls/.csv`) — the headless counterpart to this browser flow.
- **CLI**: `node src/cli.js sf:list [--today|--date|--start/--end] [--field] [--limit] [--test]` (lists each
  file's Sanction ID too) and `sf:pull <opts> -o <dir> [--strategy add_new|replace|wipe_all]`. Plus two
  **read-only discovery** commands that log in as the integration user (which can see objects/files a
  personal Workbench login often can't): `sf:describe <Object> [--field <substr>]` (dump an sObject's
  field API names — how we confirmed `Program.cfg_Id__c`) and `sf:soql "<SELECT ...>" [--limit N]` (run a
  single guarded SELECT; non-SELECT is rejected). `sf:list` also takes **`--search "a,b,c"`** to widen recall —
  the terms are OR'd into one SOSL (multi-word phrases quoted), results deduped by `ContentDocumentId`; one term
  keeps the precise default. **See `plans_and_notes/SEARCH_NOTES.md`** for the SOSL/SOQL reference: why we use SOSL (the
  record-share visibility gotcha), the Title-convention finding (no category field), the broadened query, and the
  dedup/IsLatest guards. Menu "Salesforce" section: list today · **list recent** — `sf_list_recent` prompts
  for environment (production / sandbox via `--test`), **search (precise or broad)**, and count · pull.
- **Tests**: `tests/sf_naming.test.js`, `tests/sf_dates.test.js`, `tests/sf_client.test.js` (mock jsforce,
  no network); opt-in `e2e/sf_flow.spec.js` (stubs `/api/sf/*`, forces the server-folder fallback). Live SF
  stays out of CI. No new deps — `jsforce` + `fast-csv` are already in the repo.

## Slack intake (optional — the Slack Ironman tab)

Pull **spreadsheet + PowerPoint attachments out of a Slack channel** for a date range, into the SAME Files
queue. A 4th intake alongside SF + Folder; the existing flow is unchanged. The bot token stays server-side;
file bytes stream **in-memory** to the browser (like `sf_fetch`). No new deps — uses `fetch` + the Web API.

- **Engine** `slack/` (Node-only, injectable transport so it's unit-testable with a mock `conn` — no network),
  mirroring `sf/`: `slack_config.js` (`SLACK_BOT_TOKEN` (xoxb), `SLACK_CHANNEL_ID` optional default,
  `SLACK_CHANNEL_VISIBILITY=auto|public|private`, `SLACK_API_BASE`, `SLACK_FILE_TYPES` default
  `xlsx,xls,csv,pptx,ppt`), `slack_dates.js` (MT From/To → padded Unix-seconds `files.list` window + a
  `created_ms` MT day filter; reuses `sf_dates`), `slack_client.js` (`make_connection`/`slack_call` Bearer
  transport · `auth_test` · `list_member_channels` via `users.conversations` · `channel_info` ·
  `list_channel_files` via `files.list` → ext filter → MT filter → dedupe → newest-first → uploader names;
  records reuse `content_version_id` = Slack file id so the shared UI works unchanged), `slack_fetch.js`
  (`fetch_file_bytes`: `files.info` → `url_private_download` + Bearer → Buffer; guards the HTML-login-page
  case = bot not in channel / bad scope), `slack_naming.js`, `slack_routes.js`, `index.js`.
- **Server**: `mount_slack_routes(app, require_dash_auth)` (same `mx_session` auth; 503 until `SLACK_BOT_TOKEN`
  set; lazy-required). `GET /api/slack/channels` (the bot's channels + its `@handle` for the invite chip),
  `GET /api/slack/files` (validates the channel is one the bot is in), `GET /api/slack/file/:id` (in-memory
  stream), `POST /api/slack/save` (non-Chrome server-folder fallback).
- **Browser** (`app.js`, `S.sf_source === 'slack'`): the **Slack Ironman tab** is self-service — a **Channel
  dropdown auto-populated from `users.conversations`** (`sf_load_channels`) + ↻ Refresh + a `/invite @bot`
  **copy chip** (`sf_render_invite`/`sf_flash_copied`) + always-visible instructions; the pick persists in
  `localStorage` (`rrt_slack_channel`). A **Show: All / Public / Private** filter (`#sfSlackVis`,
  `sf_render_channel_options` filters the cached `S.slack_channels` by `is_private`; choice persists in
  `rrt_slack_vis`) is a browsing aid only — both types read identically once the bot is invited. Columns `Date (MT) · Uploader · File name · Type` (`sf_columns`
  slack branch); date range → `/api/slack/files`; download source-aware (`/api/slack/file/`); files flow into
  the SAME queue tagged `source='slack'`.
- **CLI + menu**: `slack:probe` (read-only: token + bot identity + channels + optional download check),
  `slack:channels` (+ `--json` for the menu pick-list), `slack:list [--channel <id|name>] [date opts]`,
  `slack:pull <opts> -o <dir>`. Menu **"Slack"** section: probe · list channels · list files · pull · run
  tests · **setup & how-to (future-self runbook)**. Plan + runbook: `plans_and_notes/SLACK_INTAKE_PLAN.md`.
- **Tests**: `tests/slack_dates.test.js`, `tests/slack_client.test.js` (mock conn, no network),
  `tests/slack_ui.test.js` (markup + wiring + source + file-types); opt-in `e2e/slack_flow.spec.js` (stubs
  `/api/slack/*`, forces the server-folder fallback). Live Slack stays out of CI.

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
`/metrics` dashboard + `/api/metrics-report` + the `/admin` hub (admin login: `RACE_RESULTS_ADMIN_USER`/`_PASS`, falling back to the metrics creds),
and `/scheduled-slack-race-results-metrics` (cron → `slack_message_api`). Analytics is
fire-and-forget: if the DB is down the converter still serves normally. PII never leaves
the browser — events carry counts/enums + filename only. The client mutes itself under
automated browsers (`navigator.webdriver`) unless `window.METRICS_TEST_ALLOW` is set, so e2e
runs don't pollute the table; the uploaded filename is remembered and attached to every
post-upload event for traceability (plus the `upload_id` correlation). Every event also carries `page_path` (client `location.pathname`+search; server `req.originalUrl` for `dashboard_view`) so we know which page was viewed, not just `page_view`/`dashboard_view`. New columns are migrated onto existing tables via `ensure_columns` **AI "ask your data" (in progress, Step 2 — engine only, not wired to any surface yet):** `metrics/ask/` holds a READ-ONLY natural-language->SQL engine over the events table. `db.js` = read-only mysql2 pool (prefers `ASK_DB_*` creds, else the local analytics config) + a table allowlist (events table only). `sql_guard.js` = hardened guard: strips comments/strings, then allows only a single SELECT/WITH over allowlisted tables, blocks writes/DDL/DoS keywords, and injects/clamps a LIMIT. Ported from the `bot_analyst_chatgpt_like` reference (agentic tool-loop, rich context yaml). Design: `metrics/ASK_DESIGN.md`. Hands-on review: `node metrics/ask/demo_guard.js` (ACCEPT/REJECT + the enforced LIMIT). Menu (under Tests — engine & UI): AI-ask guard/catalog tests + guard demo; also inside "Run ALL". Tests: `tests/ask_db.test.js`, `tests/ask_guard.test.js`. The full brain is now built: `ask/context.js`+`context/events_context.yaml` (grounding: read-only + always-aggregate rules, metric defs from metrics_report), `ask/tools.js` (get_schema/run_query), `ask/providers/{openai,anthropic}.js` (model selectable), `ask/ask.js` = `ask(question,{provider,model})` plan->guard->run->repair-once->answer. Definition questions (meaning of a column/event/metric) are detected (planner replies NO_SQL) and answered straight from the grounding context with no DB query. Surfaces: CLI `ask`/`ask:models`, the menu "AI — ask your data" section, and the **dashboard** ask box (`#ask-panel` on /metrics) backed by auth-gated `POST /api/metrics-ask` + `GET /api/metrics-ask-models` (reuses the `mx_session` auth). Models are centralized in `metrics/ask/models.js`. Every ask (dashboard + CLI) is logged to a MySQL table `race_results_transform_ask_log` (no PII; `surface` col marks dashboard vs cli); view with `node src/cli.js ask:log [--n N]` or the menu. Dashboard ask box: model is remembered (localStorage), results collapse/clear and scroll vertically (sticky header), chartable results auto-render a Chart.js chart (chart/table toggle) from a `chart` hint the model appends and `ask.js` extracts+validates, out-of-scope questions are declined (not substituted), dates render in Mountain Time. A `SQL` toggle runs user-entered read-only SQL straight through the guard (no LLM) via `ask_sql()` / `POST /api/metrics-ask {mode:'sql'}` / `node src/cli.js ask:sql "<SELECT ...>"` (logged with surface `dashboard-sql`/`cli-sql`). Conversational + grounding context flows through an `extra` object on the prompt builders: B1 sends the last few turns (`opts.history`, dashboard keeps a client-side thread + 'New thread' reset) so follow-ups resolve; G1 injects a cached (~5 min) live metrics snapshot built from `build_report` (`metrics/ask/live.js`, orientation only — exact figures still come from SQL); G2 stores operator corrections in `race_results_transform_ask_corrections` (`metrics/ask/corrections.js`), injects recent active ones as grounding, and is written via `POST /api/metrics-ask-correct` (dashboard 'Correct this') or managed with `ask:corrections` / `ask:uncorrect <id>`. Review playbooks are single-sourced in `metrics/ask/test_guide.js` and printed by `ask:test:corrections` / `ask:test:threads` (+ menu items); a gated live-eval harness (`metrics/ask/eval/run_eval.js`, scenarios in `eval/scenarios.js`) runs the scenarios against the real model when keys+DB are present and records a timestamped report under the data dir, via `ask:eval`. `ask_log` now also stores `thread_id` + `asker_id` (shown in `ask:log`). The dashboard sends a stable per-browser `asker_id` + a `thread_id` (localStorage), the server rebuilds a conversation server-side via `ask_log.read_thread()` (survives reload), a scrollable transcript (`#ask-convo`) rehydrates on load through `GET /api/metrics-ask-thread`, and 'New thread' mints a fresh `thread_id`. The conversation is one scrolling thread (`#ask-thread-scroll`): prior turns are bubbles, the active rich answer is pinned at the bottom; each turn is tagged with the model used + a Mountain-Time timestamp. The thread is capped (last 4, with a `▸ See N earlier` expander) to stay lean, the whole ask panel has a show/hide toggle (`#ask-panel-toggle`, persisted), and ask errors show as a prominent ⚠️ warning (`.mx-ask-err`). **Payload-size guard:** the `history` context sent with each ask truncates every answer to 400 chars on BOTH the live (`ask_after`) and the reload/rehydrate (`ask_load_thread`) paths — the visible transcript still renders full text separately via `ask_convo_add`, so "See N earlier" is unaffected — and on the server the auth-gated ask routes (`/api/metrics-ask`, `/api/metrics-ask-correct`) get a **512kb** JSON body (vs the deliberately-tight **16kb** public `/api/event` ingest) plus a JSON error handler that turns an oversized/malformed body into a clean 413/400 JSON response instead of Express's default HTML error page (which an AJAX caller would fail to `JSON.parse` — the "Unexpected token '<'" bug). Guarded by `tests/ask_payload.test.js`. The raw-SQL toggle and the follow-up/new-thread control are pill **chips** with tooltips, inline next to the model picker (the SQL chip lights green when active). Answers render markdown (tables/bold); suggested-question chips seed the box. Ask-box UX: an auto-growing composer textarea (autofocus, Enter=ask · Shift+Enter=newline, grows as the question wraps, x-clear, model dropdown, in-page Sign-out; the question STAYS in the bar and is echoed above the answer; output scrolls horizontally). Answer guardrails: dates/times formatted as Mountain-Time strings via DATE_FORMAT(created_at_mtn, ...) (never UTC); PREFER aggregation but allow a small ORDER BY...LIMIT listing for list/recent/"in a table" requests (no refusals); report only what rows show (no invented clauses; empty = no matching rows); dashboard_view is server-logged so its client fields are NULL by design. Surfaces: CLI `node src/cli.js ask "<q>" [--provider openai|claude]` and a menu "AI — ask your data" section. Offline tests use a mock provider+pool: `tests/ask_context.test.js`, `tests/ask_pipeline.test.js`, `tests/ask_injection.test.js` (SQL+prompt injection), `tests/ask_log.test.js`. Needs OPENAI_API_KEY/MODEL or ANTHROPIC_API_KEY to run live. (CREATE IF NOT EXISTS won't add them). Events: page_view, file_uploaded, conversion_completed, download, split_download_used, manual_remap, mapping_saved, start_over, theme_changed, error, try_me_download, + a server-side dashboard_view per /metrics open (skipped when `x-metrics-test` header is set). Post-upload events also carry `is_demo` (1 for the built-in sample) and `source` — the intake tab: `upload` (manual drag-drop) | `try_me` | `sf_upload_queue` | `sf_email_queue` | `folder` | `slack` (set in `app.js` `track()` from `S.source`/`S.is_demo`; the SF tabs are split via `sf_queue_source()`, replacing the old single `salesforce` value; whitelisted in `metrics_config.COLUMNS` + the client allow-list + DDL + an `ensure_columns` migration). `metrics_report.build_report` adds a **`by_source`** aggregation (uploads/conversions/downloads grouped by source, source NULL excluded) → the dashboard **"Intake by tab"** chart (`chart_source`) + an Ask-data suggestion chip. Legacy `salesforce` rows are relabeled to `sf_upload_queue` by the one-time idempotent `metrics:backfill-source` (CLI + menu; `metrics_report.backfill_source`/`count_source`). Demo/"Try me" activity is flagged with an `is_demo` TINYINT(1) column (1 = built-in sample/fake data, else 0/NULL) — set client-side in `app.js` `track()` when `S.is_demo`, whitelisted in `metrics_config.COLUMNS` + the `public/js/metrics.js` allow-list + the events DDL, and migrated onto existing tables via `ensure_columns` in the server. A second flag `is_test` TINYINT(1) marks **deliberate test runs in production**: opening the app with `?metrics_test=1` sets a per-tab sessionStorage flag and `public/js/metrics.js` passes `baseProps:{is_test:1}` into `UsageMetrics.init`, so the shared client (`utilities/analytics/metrics_client.js`, which now merges `cfg.baseProps` into EVERY event) stamps is_test on all events incl. the auto `page_view`. Cleanup is precise: `retention.purge_test`/`metrics.purge_test` → `DELETE … WHERE is_test = 1` (real + demo rows untouched), exposed as `node src/cli.js metrics:purge-test` and the "purge TEST rows only" menu item. Wired across `metrics_config.COLUMNS` + the client allow-list + DDL + an `ensure_columns` migration like is_demo; guarded by `tests/metrics_test_flag.test.js` + the `purge_test` case in `tests/metrics_retention.test.js`. `metrics_report.build_report` adds a `demo_split` (Uploads/Conversions/Downloads × demo vs real) + a `demo` summary, surfaced as the **Try Me vs real activity** chart (`chart_demo`) and a **Try Me** KPI card on the dashboard. Dashboard: funnel (incl. start-over stage), activity-by-day (visits/uploads/downloads/start-overs; grouped ≤14 days else auto-stacked with datalabels), downloads-by-type + split panel, Try-Me-vs-real chart, top users (visits/uploads/downloads/start-overs + timezone + last activity), a Start-over KPI card, refresh/auto-refresh, dark/light. Data tables have a leading # row-number column and horizontal scroll when narrow. Auto-refresh defaults ON and reloads the report from the DB every 60s (tooltip explains it). Both this server and event_analysis register `SIGINT`/`SIGTERM` `cleanup()` handlers (repo convention) so Ctrl-C cleanly stops them; the server also adds a readline `SIGINT` bridge (Windows/VS Code terminals don't always deliver process-level SIGINT — readline catches the Ctrl-C keystroke directly); `menu.js` launches `node` children WITHOUT a shell on Windows (a cmd.exe wrapper would swallow Ctrl-C) and ignores SIGINT itself so stopping the server returns you to the menu. Every chart has an Expand/PNG/CSV/Table toolbar (same UX as event_analysis, but **live** — served from `/api/metrics-report`, not a generated static file) + a DB-health strip (rows/size/last-data). The
deliberate-test-row count (`health.test_rows` = `SUM(is_test=1)`) shows as a **Test rows** KPI card in the main
stats row (alongside Visits/Uploads/…); the **Last User Activity** chip stays alone in the top-right corner. A
**Purge test** button (`#purgeTest`) sits in the controls row just left of the dark/light toggle — hidden when
`test_rows === 0`, otherwise it confirms then `POST`s the auth-gated `/api/metrics-purge-test`
(→ `metrics_report.purge_test` → `DELETE … WHERE is_test=1`; real + Try-Me/demo rows untouched) and reloads the
report. The header, controls row, and KPI cards all reflow on mobile (≤520px). The ask-box suggestion chips include
an **"Uploads today, in a table"** prompt (`#ask-suggest`) that seeds the existing list/recent ask path (no engine change). The **Last User Activity** chip (`health.latest`) and the Top Users **Last activity** column (`top_users.last_seen`) compute `MAX(created_at_mtn)` over real activity only — `dashboard_view` events are excluded (`MAX(CASE WHEN event_name <> 'dashboard_view' THEN created_at_mtn END)`) so merely opening `/metrics` never bumps the date; the **N rows** figure (`rows_total`) stays unfiltered. CLI: `stats`, `metrics:size`,
`metrics:cleanup`, `metrics:purge-test` (is_test rows only), `metrics:purge-all`. Crons: `utilities/cron_get_slack_race_results_transform/`,
`cron_get_purge_race_results_transform/`. Reuse the core for other pages (e.g. 8016) by
supplying a new config + DDL + report. Verified by `tests/metrics_ingest.test.js` + `tests/metrics_retention.test.js` (dep-free unit tests:
whitelist/timestamps, purge-by-year + purge-all + purge-test) and
`e2e/metrics_db.spec.js` (browser→MySQL round-trip + table-schema check; chromium-only,
auto-skips without a DB — `npm run e2e:db`). Full design + Linux setup