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
vendored `public/vendor/exceljs.min.js`). The npm registry is locked down — do NOT `npm install`.

## Folder structure

```
src/race_results_transform/
  src/               isomorphic core (UMD: require in Node, window.RRT in browser) + the CLI
    schema.js          TEMPLATE_SCHEMA — the ONLY place domain knowledge lives (aliases, rules)
    normalize.js       value normalizers (gender/dob/state/time incl. DNS/DNF, category, member)
    display.js         how a cell renders in the tables (Excel time -> time, not date) — TESTED
    parse.js           header detection + divider/blank-row skipping
    match.js           column auto-matching (alias scoring + greedy assignment)
    transform.js       apply mapping -> output grid + stats + flags + distinct enum values
    reconcile.js       integrity readout + per-column scorecard
    mapping.js         editable mapping helpers + saved profiles (localStorage / in-mem)
    pipeline.js        convenience wiring (parse -> match -> transform -> reconcile)
    io.js              Excel + CSV <-> IR adapter (exceljs); output is centered, wide cols, frozen header
    cli.js             scriptable converter (inspect / convert / batch)
  public/            web app: index.html, css/app.css, js/app.js, favicon.svg, vendor/exceljs.min.js
  menu.js            interactive launcher (pauses after each command)
  data_dir.js        cross-platform data dir via utilities/determineOSPath (usat/data/race_results_transform)
  package.json       scripts + bin (no deps block — exceljs lives in the root package)
  examples/template/ the target-format template (no PII)
  tests/             node:test suites incl. lint_snake_case.test.js
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
- Member #: numeric kept; blank / "Valid" / non-numeric → `1-day` (flagged).
- Gender M/F/NB · DOB `mm/dd/yyyy` · State 2-letter (foreign flagged) ·
  Category Age Group/Elite/Para/Relay · Recorded Time `hh:mm:ss.000`.
- Race statuses (DNS/DNF/DQ/DSQ/DNC/NT) preserved verbatim, flagged `time-status`.
- exceljs reads dates/times as UTC on the 1899-12-30 epoch — normalizers use getUTC*/epoch-diff.

## UI notes (web app)

- Light/dark **theme toggle** (`#themeToggle`); follows OS via `prefers-color-scheme` unless a
  `theme` pref is set (`data-theme` on `<html>`). USAT navy `#15284e` + red `#e4002b`.
- One **Compare** card with tabs (Tables/Mapping/Scorecard/Integrity/Field reference/How it works)
  + summary bar. Layout switch side/stacked/tabs. **Link tables** (default ON) syncs search, sort
  and vertical scroll across both `TableView`s.
- `TableView`: searchable, sortable, frozen header, empty-state, `show_all`, `set_filter`,
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
