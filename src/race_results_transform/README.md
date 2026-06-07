# Race Results Spreadsheet Converter

Turn any race-results spreadsheet (`.xlsx` or `.csv`) into the fixed **USA Triathlon rankings
template** — entirely in your browser, with a human review step before you download.

> **Privacy:** the conversion runs client-side. Race files contain member PII (DOB, email,
> address); with this tool that data never leaves the machine it's opened on. The web app writes
> nothing to disk, and the CLI/test data folder lives outside the repo (see "Data"), so race data
> is never committed.

## What it does

Drop a file → it auto-maps the columns to the 12-column template and converts → you review the
highlighted cells (values it changed or guessed), fix anything, then download a template-ready
`.xlsx`. The output always has all 12 columns in order:
`Member Number, Last Name, First Name, Gender, DOB, Email, Address, City, State, Zip, Category,
Recorded Time` — even when the source was missing some. Per the template, only **Address** is
optional.

Value rules: when there's no separate First/Last column but a single full **Name** column, it's
split into First + Last (handling `Last, First` and `First Middle Last`); Member # kept if numeric (text around a number is trimmed, e.g. `USAT-12345` → `12345`), else `1-day`; Gender → M/F/NB/Open; DOB → `mm/dd/yyyy`;
State → 2-letter (foreign flagged); Category → Age Group / Elite / Para / Relay / Open; Recorded Time →
`hh:mm:ss.000` (finish time only, never a split); race statuses (DNS/DNF/DQ…) are preserved.

## Run it

```
# web app — static host on port 8018 (the transform still runs in the browser)
node ../../server_race_results_transform_8018.js        # http://localhost:8018/
#   is_test_ngrok=true also opens a public ngrok URL when NGROK_AUTHTOKEN is set
#   (reads the repo-root .env). Set is_test_ngrok=false for local-only.

# from the repo root — standard npm scripts (same pattern as the other servers)
npm run race_results_transform_server      # = node server_race_results_transform_8018.js
npm run pm2_start_race_results_transform   # pm2-managed as usat_race_results_transform (4G, --expose-gc)
#   also starts as step 16 of 16 in:  npm run pm2_run_all_servers
#   manage it:  npm run pm2_logs_race_results_transform | stop_… | restart_… | delete_… | show_…

# command line
node src/cli.js inspect "<file>.xlsx|.csv"    # show headers + auto-mapping, no write
node src/cli.js convert "<file>"  [-o out]    # write a reformatted .xlsx (one sheet per source sheet)
node src/cli.js batch   <folder>  [-o dir]    # convert a whole folder
node menu.js                                  # sectioned interactive menu (incl. a Config-wiring check); pauses after each command
                                              # menu item numbers are sequential 1..N (guarded by tests/menu_ids.test.js)

# tests
npm test            # or: node --test tests/*.test.js
```

## End-to-end tests (Playwright — opt-in, run from the CLI)

The `node --test` suite above is dependency-free and checks the engine + that the served
*files* are intact. For a real-browser check of the **served app**, there's a Playwright suite
in `e2e/` (10 spec files). It is **not** part of `npm test` and never enters the locked-down
production install. It runs every functional spec on **chromium, firefox and webkit**, plus a
phone-sized **mobile** project, and adds accessibility, visual-snapshot, and error-handling
coverage:

- **convert_flow / ui_interactions / linking_flow / table_view / layout_sheets / split_presets** —
  load → convert → download, split-by-column, multi-sheet Combined, theme persistence, CSV input,
  approve-all, edit-clears-a-flag, value-map override, inline header remap, link-tables sync,
  search/sort/flag-filter, layout switch, sheet-tab data, drag-and-drop, split presets.
- **a11y.spec.js** — axe-core scan (no critical violations) on home / Tables / Mapping.
- **visual.spec.js** — screenshot baselines (chromium only): upload light/dark + compare card.
- **mobile.spec.js** — Pixel-5 viewport: no horizontal overflow + convert works.
- **errors.spec.js** — an unreadable file warns and the page survives.

```
# one-time install (open npm + Playwright CDN access) — adds axe-core + 3 browser engines
npm run e2e:install              # dev machine (macOS/Windows)
npm run e2e:install:server       # Linux server: adds --with-deps for system libs (root/sudo)

# run (auto-starts server_race_results_transform_8018.js)
npm run e2e                      # all browsers; E2E_PORT=8019 npm run e2e to use another port
npm run e2e:chromium             # fast path — chromium only
npm run e2e:headed               # visible Chrome, slowed + narrated (banner per step)
npm run e2e:step                 # Inspector: PAUSE on every step, click Resume to advance
npm run e2e:snap                 # (re)generate the visual baselines after intended UI changes
```
The config passes `--no-sandbox` so chromium also runs headless as root on the Linux server.
Visual baselines live in `e2e/visual.spec.js-snapshots/` and are committed. All the spec files
share `e2e/helpers.js` (narrated step banner + click highlighting + fixtures). See `e2e/README.md`.

## The app at a glance

- A light/dark **theme toggle** (top-right). It follows your OS setting until you pick one.
- One **Compare** card with tabs: **Tables · Mapping · Scorecard · Integrity · Field reference ·
  How it works**, plus a summary bar (score %, file name, flagged-value count, skipped rows).
- **Multi-sheet workbooks:** if an uploaded `.xlsx` has more than one sheet, a notice and a
  **sheet tab bar** appear; each sheet is converted independently (its own mapping, flags and
  edits). **Download** opens a checklist with a **Separate / Combined** toggle: *Separate* saves
  each selected sheet as its own `.xlsx`; *Combined* stacks the selected sheets' rows into one
  `.xlsx` (single 12-column sheet, tab order).
- **Tables** side-by-side / stacked / tabs (switcher, remembered). Each table is searchable and
  sortable (case-insensitive), with a frozen header row and a friendly empty-state. **Link tables** (on by default)
  syncs search, sort, vertical scroll and the "Show rows" filter across both.
- **Split & download by column:** in the **Mapping** tab, pick any column from your *original*
  file (including extras not in the template) and save a **separate `.xlsx` per value** — only
  that value’s rows, full 12-column template. Mapped fields default to grouping by the converted
  value (value-mapping merges apply); switch the **Converted / Original value** toggle to group by
  the raw values and **define your own groups** (give two values the same group name to combine
  them). Extra columns always group by their raw value. The group field is a **pick-or-type box** —
  it autocompletes and offers a dropdown of the group names you've already made (leave it blank for
  its own file). A small toolbar gives **Clear entries · Save preset · Forget preset · Auto-save**
  (auto-save on by default; presets are remembered per file-layout + column and re-applied next
  time). For multi-sheet workbooks the **Download** button opens a sheet picker so you can run the
  split across some or all sheets at once — each sheet’s groups download as their own files.
- **Inline remap:** every reformatted column header has a dropdown (in a top header row, so the
  two tables line up) to re-point that field; same controls live in the **Mapping** tab.
- **Highlights:** changed/guessed cells are highlighted; the legend is collapsible, resizable and
  scrollable. Each reason has **Show rows** (filter to just those) and **Approve**; plus
  **Approve all / Unapprove all**. Editing a highlighted cell also clears it.
- **Value mapping:** Category, Gender, State and Member Number list their distinct source values
  (Member Number includes blank-source `1-day` defaults) with per-value reset and bulk set/reset.
- **Download .xlsx** (centered cells, comfortable column widths, frozen header row) and
  **Save mapping** (remembers your column + value choices for files with the same headers).

## Data

The **web app writes nothing to disk** — it converts in memory and downloads through the browser,
so it has no data folder. Only the **CLI and fixture tests** use a data directory, resolved by
`utilities/determineOSPath` (the same per-machine location the repo's other tools use) under a
`race_results_transform/` subfolder, created automatically on first use:

```
<determineOSPath()>/race_results_transform/
  inputs/    source files to convert (put your files here for the CLI / fixture tests)
  outputs/   reformatted .xlsx the CLI writes
  expected/  golden snapshots for the fixture tests
```

`determineOSPath()` returns `…/usat/data/` on Linux/Mac; on **Windows** it currently resolves to
the configured uploads path (`C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/`). Either way
it's outside the repo, so race data is never committed.

For regression testing **without** that folder, a committed **synthetic** fixture lives in
`examples/sample/` (clearly-fake data — fake names, `@example.com` emails). `tests/sample.test.js`
converts it and checks committed golden snapshots, so `node --test tests/*.test.js` passes on any
clone / CI. `tests/fixtures.test.js` is the optional real-data tier (skips when the data dir is empty).

## Architecture

A small **isomorphic core** in `src/` (pure, no-DOM modules) runs identically in the browser, the
CLI (`src/cli.js`), and the tests — so what you test on the command line is exactly what the
browser does. Excel/CSV I/O uses `exceljs` (declared in the repo-root `package.json`). All domain
knowledge lives in `src/schema.js` (column aliases) and `src/normalize.js` (value rules) — to
teach the tool a new file layout, add an alias or tweak a normalizer.

## Usage analytics (anonymous) + Slack digest + dashboard

The served app records **anonymous** usage events (counts/enums + the filename — never
member data) to the local MySQL table `race_results_transform_events`. It is built on a
reusable core in `utilities/analytics/` (ingest / ensure-table / retention / browser
client / report render); the 8018 server **auto-creates the table at startup**
(`CREATE TABLE IF NOT EXISTS`).

- **Capture**: `public/js/metrics.js` → `POST /api/event` via `navigator.sendBeacon`
  (non-blocking; honors `METRICS_OFF` + Do-Not-Track).
- **See it**: `node src/cli.js stats [--days 7]`, the dashboard at `/metrics`
  (Basic Auth — `RACE_RESULTS_CONVERTER_METRICS_DASH_USER` / `RACE_RESULTS_CONVERTER_METRICS_DASH_PASS`), or the weekly Slack digest.
- **Size / cleanup**: `node src/cli.js metrics:size`, `metrics:cleanup` (keep current + prior
  calendar year), and `metrics:purge-all` (delete every row — confirms first; for clearing test data).
- **Cron**: `utilities/cron_get_slack_race_results_transform/` (digest) and
  `utilities/cron_get_purge_race_results_transform/` (purge) — you set the schedule.

- **Dashboard**: funnel (visit→upload→conversion→download→start-over), activity-by-day
  (visits·uploads·downloads·start-overs — grouped for ≤14 days, auto-stacked beyond), downloads-by-type +
  a Split-by-group panel, top users (visits·uploads·downloads·start-overs, timezone + last activity), a
  Start-over KPI card, ↻ Refresh + auto-refresh, dark/light. Data tables carry a leading # row-number
  column and scroll horizontally when narrow.
- **Events**: page_view, file_uploaded, conversion_completed, download, `split_download_used`,
  manual_remap, mapping_saved, start_over, theme_changed, error, + server-side dashboard_view per /metrics open. Every event also records `page_path` (the URL path viewed) so page_view/dashboard_view are explicit about the page.
- **Privacy/automation**: the client mutes itself under automated browsers (`navigator.webdriver`)
  unless `window.METRICS_TEST_ALLOW` is set, so the e2e suite never writes to the table. The uploaded
  **file name** rides along on every post-upload event (conversion / download / split / error) for
  traceability (also linkable via `upload_id`).

**Tests**: `tests/metrics_ingest.test.js` + `tests/metrics_retention.test.js` (dep-free units —
whitelist/timestamps, purge-by-year + purge-all), `e2e/metrics_beacon.spec.js` (fires when allowed /
muted under automation), and `e2e/metrics_db.spec.js` (browser→MySQL round-trip — events landed with
the right columns incl. file_name, + the table schema; chromium-only, skips with no DB: `npm run e2e:db`).

_Auth & identity:_ the `/metrics` dashboard uses HTTP Basic to sign in, then a signed `mx_session`
cookie (12h expiry) gates `/metrics` + `/api/metrics-report`, with a `/metrics/logout` route —
server-side expiry + revocation on top of Basic (a full sign-out can still need closing the browser).
The anonymous `visitor_id` is stored in BOTH a long-lived first-party cookie and `localStorage`,
restored from whichever survives.

**AI "ask your data" (in progress):** a read-only natural-language->SQL engine over the usage events lives in `src/race_results_transform/metrics/ask/` (engine only so far — guard + read-only DB layer; CLI/dashboard surfaces come later). Try the guard: `node src/race_results_transform/metrics/ask/demo_guard.js` (or the guard-demo item under Tests — engine & UI). See `metrics/ASK_DESIGN.md`.

No new dependencies. See `ANALYTICS_PLAN.md` 