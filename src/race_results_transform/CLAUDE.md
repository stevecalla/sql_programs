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
on a dev box or the Linux server via `npm run e2e:install` / `e2e:install:server`, then `npm run e2e`.)

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
  public/            web app: index.html, css/app.css, js/app.js, favicon.svg, vendor/exceljs.min.js
  menu.js            interactive launcher (pauses after each command)
  data_dir.js        data dir via utilities/determineOSPath (…/usat/data on linux/mac; configured
                       uploads path on Windows) + /race_results_transform; CLI + tests only
  package.json       scripts + bin (no deps block — exceljs lives in the root package)
  examples/template/ the target-format template (no PII)
  examples/sample/   SYNTHETIC committed fixtures (fake CSV + xlsx + build_sample.js + goldens) for tests
  e2e/               OPT-IN Playwright browser tests (server-served convert/download/split/combine
                     + theme/clock canaries); dev/CI only, NOT in `npm test`, never in prod install
  tests/             node:test suites (each wrapped in describe(); runnable via menu.js or
                     node --test): engine + lint_snake_case + web_assets (static-asset integrity)
                     + config_wiring (repo-root package.json + .vscode/tasks.json) + sample.test.js
                     (always-on synthetic data) + fixtures.test.js (optional real usat/data tier)
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

## Full-name split

When a source has no First/Last column but a single full-name column (`Name`, `Athlete Name`, …),
`match.auto_map` claims it up front and marks `first_name`/`last_name` with `split:'first'|'last'`
(confidence `split`). `transform.run` derives each via `normalize.split_name` (handles `Last, First`
and `First Middle Last`); `reconcile` skips the pass-through preservation check for these (computed,
not copied).
