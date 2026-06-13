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
    io.js              Excel + CSV <-> IR adapter (exceljs). `flatten_cell` reduces every cell to a
                       plain value — incl. **hyperlink cells** `{ text, hyperlink }` whose `text` may be
                       rich text (a styled email link), so emails read as the address, not "[object
                       Object]" (falls back to the de-mailto'd URL when there's no label).
                       read_to_ir (first sheet) / read_to_irs
                       (every sheet) ; grid_to_buffer / grids_to_buffer (one worksheet per group,
                       names sanitized to <=31 chars, unique); output centered, wide, frozen header.
                       grid_to_csv (header + rows -> RFC-4180 CSV text, CRLF; all cells text so long
                       member #s stay intact) backs the CSV-default downloads + CLI `--format csv`.
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
                     1..N in display order, guarded by tests/menu_ids.test.js
  metrics/           usage-analytics server modules + the Basic-Auth dashboard view (kept OUT of
                       public/ and src/ so it isn't statically served): metrics_config.js,
                       metrics_report.js, metrics_dashboard.html
  package.json       scripts + bin (no deps block — exceljs lives in the root package)
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
- **Metrics dashboard auth** (#7 + N2, built): a **login form** (`GET/POST /metrics/login`) validates the configured user/pass and sets a signed `mx_session` cookie (HMAC of `_PASS`, 12h TTL) — the cookie is the ONLY gate (no HTTP Basic), so `/metrics/logout` **truly** logs out (next visit redirects to the login form). API routes return 401 when unauthenticated; the page redirects to login.
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
- **Browser** (`app.js` `wire_sf`/`sf_*`): a **Get Race Results from Salesforce** panel on the upload page.
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

## Local-folder intake (Convert files from a folder)

A second local intake (`#folderCard`, `wire_folder`/`folder_*` in `app.js`) — pick a folder on your
computer, choose the spreadsheet files, and run them through the SAME Files queue (convert / review /
download / Reload). Purely client-side: nothing is uploaded, no server, no Salesforce.
- **Pick**: Chrome/Edge use `showDirectoryPicker` (dir handle → Reload works); other browsers fall back to a
  hidden `<input type="file" webkitdirectory>` (`folder_from_input` keeps **top-level** files only — rel path
  `folder/file`, depth 1 — and gets bytes but no handle, so Reload is disabled there).
- **List/select**: top-level `.xlsx/.xls/.csv` only, rendered as a checklist (File name · Type · Modified)
  reusing the SF `sf-table`/`sf-count`/`sf-search` styles, with Select-all + search + a found/selected count.
- **Load**: `folder_load` reads each picked file's bytes (`handle.getFile().arrayBuffer()` or
  `File.arrayBuffer()`) → `build_queue(items, { source: 'folder', dir, folder, sig })`. Events carry
  `source='folder'`. **Start over** clears it (`folder_reset`).
- **CLI equivalent**: `node src/cli.js batch <folder> [--format csv|xlsx]` already converts a whole folder
  of files (top-level `.xlsx/.xls/.csv`) — the headless counterpart to this browser flow.
- **CLI**: `node src/cli.js sf:list [--today|--date|--start/--end] [--field] [--limit] [--test]` (lists each
  file's Sanction ID too) and `sf:pull <opts> -o <dir> [--strategy add_new|replace|wipe_all]`. Plus two
  **read-only discovery** commands that log in as the integration user (which can see objects/files a
  personal Workbench login often can't): `sf:describe <Object> [--field <substr>]` (dump an sObject's
  field API names — how we confirmed `Program.cfg_Id__c`) and `sf:soql "<SELECT ...>" [--limit N]` (run a
  single guarded SELECT; non-SELECT is rejected). `sf:list` also takes **`--search "a,b,c"`** to widen recall —
  the terms are OR'd into one SOSL (multi-word phrases quoted), results deduped by `ContentDocumentId`; one term
  keeps the precise default. **See `sf/SEARCH_NOTES.md`** for the SOSL/SOQL reference: why we use SOSL (the
  record-share visibility gotcha), the Title-convention finding (no category field), the broadened query, and the
  dedup/IsLatest guards. Menu "Salesforce" section: list today · **list recent** — `sf_list_recent` prompts
  for environment (production / sandbox via `--test`), **search (precise or broad)**, and count · pull.
- **Tests**: `tests/sf_naming.test.js`, `tests/sf_dates.test.js`, `tests/sf_client.test.js` (mock jsforce,
  no network); opt-in `e2e/sf_flow.spec.js` (stubs `/api/sf/*`, forces the server-folder fallback). Live SF
  stays out of CI. No new deps — `jsforce` + `fast-csv` are already in the repo.

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
`/metrics` dashboard + `/api/metrics-report` (Basic Auth: `RACE_RESULTS_CONVERTER_METRICS_USER`/`_PASS`),
and `/scheduled-slack-race-results-metrics` (cron → `slack_message_api`). Analytics is
fire-and-forget: if the DB is down the converter still serves normally. PII never leaves
the browser — events carry counts/enums + filename only. The client mutes itself under
automated browsers (`navigator.webdriver`) unless `window.METRICS_TEST_ALLOW` is set, so e2e
runs don't pollute the table; the uploaded filename is remembered and attached to every
post-upload event for traceability (plus the `upload_id` correlation). Every event also carries `page_path` (client `location.pathname`+search; server `req.originalUrl` for `dashboard_view`) so we know which page was viewed, not just `page_view`/`dashboard_view`. New columns are migrated onto existing tables via `ensure_columns` **AI "ask your data" (in progress, Step 2 — engine only, not wired to any surface yet):** `metrics/ask/` holds a READ-ONLY natural-language->SQL engine over the events table. `db.js` = read-only mysql2 pool (prefers `ASK_DB_*` creds, else the local analytics config) + a table allowlist (events table only). `sql_guard.js` = hardened guard: strips comments/strings, then allows only a single SELECT/WITH over allowlisted tables, blocks writes/DDL/DoS keywords, and injects/clamps a LIMIT. Ported from the `bot_analyst_chatgpt_like` reference (agentic tool-loop, rich context yaml). Design: `metrics/ASK_DESIGN.md`. Hands-on review: `node metrics/ask/demo_guard.js` (ACCEPT/REJECT + the enforced LIMIT). Menu (under Tests — engine & UI): AI-ask guard/catalog tests + guard demo; also inside "Run ALL". Tests: `tests/ask_db.test.js`, `tests/ask_guard.test.js`. The full brain is now built: `ask/context.js`+`context/events_context.yaml` (grounding: read-only + always-aggregate rules, metric defs from metrics_report), `ask/tools.js` (get_schema/run_query), `ask/providers/{openai,anthropic}.js` (model selectable), `ask/ask.js` = `ask(question,{provider,model})` plan->guard->run->repair-once->answer. Definition questions (meaning of a column/event/metric) are detected (planner replies NO_SQL) and answered straight from the grounding context with no DB query. Surfaces: CLI `ask`/`ask:models`, the menu "AI — ask your data" section, and the **dashboard** ask box (`#ask-panel` on /metrics) backed by auth-gated `POST /api/metrics-ask` + `GET /api/metrics-ask-models` (reuses the `mx_session` auth). Models are centralized in `metrics/ask/models.js`. Every ask (dashboard + CLI) is logged to a MySQL table `race_results_transform_ask_log` (no PII; `surface` col marks dashboard vs cli); view with `node src/cli.js ask:log [--n N]` or the menu. Dashboard ask box: model is remembered (localStorage), results collapse/clear and scroll vertically (sticky header), chartable results auto-render a Chart.js chart (chart/table toggle) from a `chart` hint the model appends and `ask.js` extracts+validates, out-of-scope questions are declined (not substituted), dates render in Mountain Time. A `SQL` toggle runs user-entered read-only SQL straight through the guard (no LLM) via `ask_sql()` / `POST /api/metrics-ask {mode:'sql'}` / `node src/cli.js ask:sql "<SELECT ...>"` (logged with surface `dashboard-sql`/`cli-sql`). Conversational + grounding context flows through an `extra` object on the prompt builders: B1 sends the last few turns (`opts.history`, dashboard keeps a client-side thread + 'New thread' reset) so follow-ups resolve; G1 injects a cached (~5 min) live metrics snapshot built from `build_report` (`metrics/ask/live.js`, orientation only — exact figures still come from SQL); G2 stores operator corrections in `race_results_transform_ask_corrections` (`metrics/ask/corrections.js`), injects recent active ones as grounding, and is written via `POST /api/metrics-ask-correct` (dashboard 'Correct this') or managed with `ask:corrections` / `ask:uncorrect <id>`. Review playbooks are single-sourced in `metrics/ask/test_guide.js` and printed by `ask:test:corrections` / `ask:test:threads` (+ menu items); a gated live-eval harness (`metrics/ask/eval/run_eval.js`, scenarios in `eval/scenarios.js`) runs the scenarios against the real model when keys+DB are present and records a timestamped report under the data dir, via `ask:eval`. `ask_log` now also stores `thread_id` + `asker_id` (shown in `ask:log`). The dashboard sends a stable per-browser `asker_id` + a `thread_id` (localStorage), the server rebuilds a conversation server-side via `ask_log.read_thread()` (survives reload), a scrollable transcript (`#ask-convo`) rehydrates on load through `GET /api/metrics-ask-thread`, and 'New thread' mints a fresh `thread_id`. The conversation is one scrolling thread (`#ask-thread-scroll`): prior turns are bubbles, the active rich answer is pinned at the bottom; each turn is tagged with the model used + a Mountain-Time timestamp. The thread is capped (last 4, with a `▸ See N earlier` expander) to stay lean, the whole ask panel has a show/hide toggle (`#ask-panel-toggle`, persisted), and ask errors show as a prominent ⚠️ warning (`.mx-ask-err`). **Payload-size guard:** the `history` context sent with each ask truncates every answer to 400 chars on BOTH the live (`ask_after`) and the reload/rehydrate (`ask_load_thread`) paths — the visible transcript still renders full text separately via `ask_convo_add`, so "See N earlier" is unaffected — and on the server the auth-gated ask routes (`/api/metrics-ask`, `/api/metrics-ask-correct`) get a **512kb** JSON body (vs the deliberately-tight **16kb** public `/api/event` ingest) plus a JSON error handler that turns an oversized/malformed body into a clean 413/400 JSON response instead of Express's default HTML error page (which an AJAX caller would fail to `JSON.parse` — the "Unexpected token '<'" bug). Guarded by `tests/ask_payload.test.js`. The raw-SQL toggle and the follow-up/new-thread control are pill **chips** with tooltips, inline next to the model picker (the SQL chip lights green when active). Answers render markdown (tables/bold); suggested-question chips seed the box. Ask-box UX: an auto-growing composer textarea (autofocus, Enter=ask · Shift+Enter=newline, grows as the question wraps, x-clear, model dropdown, in-page Sign-out; the question STAYS in the bar and is echoed above the answer; output scrolls horizontally). Answer guardrails: dates/times formatted as Mountain-Time strings via DATE_FORMAT(created_at_mtn, ...) (never UTC); PREFER aggregation but allow a small ORDER BY...LIMIT listing for list/recent/"in a table" requests (no refusals); report only what rows show (no invented clauses; empty = no matching rows); dashboard_view is server-logged so its client fields are NULL by design. Surfaces: CLI `node src/cli.js ask "<q>" [--provider openai|claude]` and a menu "AI — ask your data" section. Offline tests use a mock provider+pool: `tests/ask_context.test.js`, `tests/ask_pipeline.test.js`, `tests/ask_injection.test.js` (SQL+prompt injection), `tests/ask_log.test.js`. Needs OPENAI_API_KEY/MODEL or ANTHROPIC_API_KEY to run live. (CREATE IF NOT EXISTS won't add them). Events: page_view, file_uploaded, conversion_completed, download, split_download_used, manual_remap, mapping_saved, start_over, theme_changed, error, try_me_download, + a server-side dashboard_view per /metrics open (skipped when `x-metrics-test` header is set). Post-upload events also carry `is_demo` (1 for the built-in sample) and `source` ('upload' | 'try_me' | 'salesforce' | 'folder' — set in `app.js` `track()` from `S.source`/`S.is_demo`; whitelisted in `metrics_config.COLUMNS` + the client allow-list + DDL + an `ensure_columns` migration). Demo/"Try me" activity is flagged with an `is_demo` TINYINT(1) column (1 = built-in sample/fake data, else 0/NULL) — set client-side in `app.js` `track()` when `S.is_demo`, whitelisted in `metrics_config.COLUMNS` + the `public/js/metrics.js` allow-list + the events DDL, and migrated onto existing tables via `ensure_columns` in the server. A second flag `is_test` TINYINT(1) marks **deliberate test runs in production**: opening the app with `?metrics_test=1` sets a per-tab sessionStorage flag and `public/js/metrics.js` passes `baseProps:{is_test:1}` into `UsageMetrics.init`, so the shared client (`utilities/analytics/metrics_client.js`, which now merges `cfg.baseProps` into EVERY event) stamps is_test on all events incl. the auto `page_view`. Cleanup is precise: `retention.purge_test`/`metrics.purge_test` → `DELETE … WHERE is_test = 1` (real + demo rows untouched), exposed as `node src/cli.js metrics:purge-test` and the "purge TEST rows only" menu item. Wired across `metrics_config.COLUMNS` + the client allow-list + DDL + an `ensure_columns` migration like is_demo; guarded by `tests/metrics_test_flag.test.js` + the `purge_test` case in `tests/metrics_retention.test.js`. `metrics_report.build_report` adds a `demo_split` (Uploads/Conversions/Downloads × demo vs real) + a `demo` summary, surfaced as the **Try Me vs real activity** chart (`chart_demo`) and a **Try Me** KPI card on the dashboard. Dashboard: funnel (incl. start-over stage), activity-by-day (visits/uploads/downloads/start-overs; grouped ≤14 days else auto-stacked with datalabels), downloads-by-type + split panel, Try-Me-vs-real chart, top users (visits/uploads/downloads/start-overs + timezone + last activity), a Start-over KPI card, refresh/auto-refresh, dark/light. Data tables have a leading # row-number column and horizontal scroll when narrow. Auto-refresh defaults ON and reloads the report from the DB every 60s (tooltip explains it). Both this server and event_analysis register `SIGINT`/`SIGTERM` `cleanup()` handlers (repo convention) so Ctrl-C cleanly stops them; the server also adds a readline `SIGINT` bridge (Windows/VS Code terminals don't always deliver process-level SIGINT — readline catches the Ctrl-C keystroke directly); `menu.js` launches `node` children WITHOUT a shell on Windows (a cmd.exe wrapper would swallow Ctrl-C) and ignores SIGINT itself so stopping the server returns you to the menu. Every chart has an Expand/PNG/CSV/Table toolbar (same UX as event_analysis, but **live** — served from `/api/metrics-report`, not a generated static file) + a DB-health strip (rows/size/last-data). The **Last User Activity** chip (`health.latest`) and the Top Users **Last activity** column (`top_users.last_seen`) compute `MAX(created_at_mtn)` over real activity only — `dashboard_view` events are excluded (`MAX(CASE WHEN event_name <> 'dashboard_view' THEN created_at_mtn END)`) so merely opening `/metrics` never bumps the date; the **N rows** figure (`rows_total`) stays unfiltered. CLI: `stats`, `metrics:size`,
`metrics:cleanup`, `metrics:purge-test` (is_test rows only), `metrics:purge-all`. Crons: `utilities/cron_get_slack_race_results_transform/`,
`cron_get_purge_race_results_transform/`. Reuse the core for other pages (e.g. 8016) by
supplying a new config + DDL + report. Verified by `tests/metrics_ingest.test.js` + `tests/metrics_retention.test.js` (dep-free unit tests:
whitelist/timestamps, purge-by-year + purge-all + purge-test) and
`e2e/metrics_db.spec.js` (browser→MySQL round-trip + table-schema check; chromium-only,
auto-skips without a DB — `npm run e2e:db`). Full design + Linux setup