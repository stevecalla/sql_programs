# Race Results Spreadsheet Converter

Turn any race-results spreadsheet (`.xlsx` or `.csv`) into the fixed **USA Triathlon rankings
template** — entirely in your browser, with a human review step before you download.

> **Privacy:** the conversion runs client-side. Race files contain member PII (DOB, email,
> address); with this tool that data never leaves the machine it's opened on. The web app writes
> nothing to disk, and the CLI/test data folder lives outside the repo (see "Data"), so race data
> is never committed.

## What it does

Drop a file → it auto-maps the columns to the 12-column template and converts → you review the
highlighted cells (values it changed or guessed), fix anything, then download a template-ready file
(**CSV by default**, or Excel) with a filename you compose (Sanction ID · Type · Distance · Race Name).
You can also pull files straight from **Salesforce** or pick a **local folder** of files and work them
as a queue. New to it? The **Try me (fake data)** button on the upload card has two options: *Load
sample data* runs a built-in synthetic (PII-free) file through the whole flow instantly, or
*Download sample file* hands you that file to upload yourself. While you're viewing the sample a
banner makes clear it's fake test data; **Start over** returns to your own upload. The output
always has all 12 columns in order:
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
node src/cli.js convert "<file>"  [-o out] [--format csv|xlsx]   # reformat (xlsx default; csv = one .csv per sheet)
node src/cli.js batch   <folder>  [-o dir] [--format csv|xlsx]   # convert a whole folder
node menu.js                                  # sectioned interactive menu (incl. a Config-wiring check); pauses after each command
                                              # menu item numbers are sequential 1..N (guarded by tests/menu_ids.test.js)

# tests
npm test            # or: node --test tests/*.test.js
```

**Code style:** use `snake_case` for every identifier we define — it's enforced by
`tests/lint_snake_case.test.js`. The only exceptions are `UPPER_SNAKE` constants, DOM element ids,
and library/Node/DOM APIs you can't rename (e.g. `arrayBuffer`). If you call a new camelCase API the
lint flags, prefer an already-allowed equivalent or add the API name to the `ALLOWED` set in that test.
**Adding a new package** (e.g. `xlsx`, `jsforce`) usually introduces such camelCase APIs
(`searchRecords`, `unlinkSync`, `cellDates`, …) — run the lint and allow-list them as part of adding
the dependency.

## Pull from Salesforce (optional)

Instead of getting files from the source by hand, you can pull race-results files straight
from Salesforce. It runs *alongside* the normal flow — the dropzone, Try Me, and convert/review/
download are unchanged. A **toggle** at the top of the **Get Race Results from Salesforce** panel picks the
source:

- **Upload Queue** — `Race Results Doc` files uploaded to Salesforce (the default).
- **Email Queue** — spreadsheet attachments on **Rankings cases** (Email-to-Case). Same date picker;
  a **Status** filter mapped to the case `IsClosed` flag — **Is Not Closed** (default) / **Is Closed** /
  **All** — where only the **not-closed** rows are pre-checked for download. Columns suited to emails
  (`Opened · Modified · Status · Subject · Sender · Sanction · Program · File · Type`), sorted by **Modified,
  newest first** — *Opened* and *Modified* are the **case's** Created / Last-Modified dates (the same dates
  shown in Salesforce's "Queue: Rankings" view). Sanction/Program are shown when the email subject includes
  them and left blank otherwise. Selected files run through the **same** convert/review/download flow.
  CLI: `node src/cli.js sf:list-email [--status not_closed|closed|all] [--test]`.

Either source lets you:

- pick a **From / To** date window (Mountain Time, on Last-modified or Created), defaulting to
  **yesterday → today**. **From** can be any day in **2025-01-01 … today**; **To** is then held to
  **From … From + 14 days** (never past today), so you can position any 14-day window across the range.
  Tick **Any date (latest)** to ignore dates. From/To, List, Reset and the options sit on one compact line.
- choose the search breadth with the **Broaden** checkbox (**on by default**, with a hover tooltip):
  on, it OR's the wider terms (`Race Results Doc` / `Race Results` / `Race` / `Results`) so it also catches
  race-results files **not** titled "Race Results Doc"; uncheck it for the precise `Race Results Doc` term
  only. Results are always deduped by file and filtered to `.xlsx/.xls/.csv`. (CLI equivalent: `--search`.)
- the first time, **sign in inline** (same login as the metrics dashboard — a small form with a
  show/hide password toggle appears in the panel; you stay on the page). One **Sign in / Sign out** button
  (top-right of the panel) toggles the session and reflects the **real session state on load** — so after a
  page refresh while signed in it correctly reads "Sign out" (not "Sign in").
- **List files** — a sortable table (Date / Program / **Sanction** / Owner / File name / **Type**) with a **search box** to
  filter the rows, a count of files found and how many are selected (it **highlights when more files are
  available than selected**, and the **Max files** box itself glows amber to prompt you to raise the cap);
  the **newest 50 are auto-selected** by
  default (raise the **Max files** field, up to **150**), and **Reset** clears the list. The results table is
  **resizable** (drag its bottom edge), and **rows missing a program name or sanction id are highlighted** so
  you can spot incomplete records. Legacy
  **`.xls`** is supported out of the box — SheetJS is **bundled** at `public/vendor/xlsx.full.min.js`
  (committed, like exceljs), so `.xls` reads on any deploy without `npm install`; the server prefers a
  `node_modules/xlsx` copy if present. Only if SheetJS is genuinely unavailable does the app
  **highlight** those rows, tag them with `⚠`, and add a "re-save as `.xlsx`" hint (see
  [`public/vendor/ENABLE_XLS.md`](public/vendor/ENABLE_XLS.md)),
- pick a **folder** (Chrome/Edge native folder picker; other browsers type a path). The folder is
  **remembered** until you choose another. Choose what to do if files already exist (add new only /
  overwrite same names / delete all then add), and
- **Download** the selected files — a prominent **progress bar** shows "Downloading *k* of *N*", with a
  **Cancel** button to stop partway (up to your Max-files limit, hard ceiling **150**). If nothing matches
  the dates, the panel says so. Files download as `program_owner_racetitle_id.ext` (the id is the
  Salesforce ContentVersion Id).

The files then appear in a **Files** tab (just left of Mapping) as a **sortable checklist table**
(# · Program · Owner · File name · **Uploaded → Converted → Downloaded** status). **Click a row** to
load it into the normal converter; convert and download it as usual, and its status updates. Come back
anytime to finish the rest — statuses persist locally so they survive a refresh. Each row also has a
**↻ Reload from disk** button: if you open one of the downloaded files in Excel, fix it and save, click
Reload to re-read the file from the folder and re-convert it — the row drops back to *Converted* so it's
clear the earlier download is now out of date and should be re-downloaded.

Privacy: the server fetches each file from Salesforce **into memory and streams it to the browser —
nothing is written to the server's disk**; the browser saves to the folder you chose. The
`/api/sf/*` endpoints are gated by the **same login as the metrics dashboard** (`mx_session`); the
inline `POST /api/login` sets that session cookie without leaving the page.

Setup: set these in the repo-root `.env` — `SF_PROD_LOGIN_URL`, `SF_PROD_USERNAME`,
`SF_PROD_PASSWORD`, `SF_PROD_SECURITY_TOKEN` (and `SF_DEV_*` for sandbox), plus optional
`SF_API_VERSION`. There's also a CLI:

```
node src/cli.js sf:list --today                          # list today's files (MT) + their Sanction IDs
node src/cli.js sf:list --start 2026-06-01 --end 2026-06-07 --field CreatedDate
node src/cli.js sf:pull --today -o ./downloads --strategy add_new   # download to a folder
node src/cli.js sf:describe Program --field sanction     # confirm an object's field API names (read-only)
node src/cli.js sf:soql "SELECT Id, cfg_Id__c FROM Program LIMIT 5"   # run a guarded read-only SELECT
```

The **Sanction ID** comes from the Program (event) object's `cfg_Id__c` formula field
(`= BLANKVALUE(cfg_Legacy_Id__c, cfg_Autonumber_ID__c)`). It leads the snake_case download name when known
and pre-fills the download filename builder's *Sanction ID* box. If your org names the object/field
differently, set `SF_PROGRAM_OBJECT` / `SF_SANCTION_FIELD` in `.env`.

## Convert files from a folder

On the upload page, the **Convert files from a folder** panel lets you point at a folder on your
computer and work several files at once — without dragging them in one at a time. Click **Choose
folder…**, and the app lists the spreadsheets in it (`.xlsx / .xls / .csv`, top level only) as a
checklist with search + a count. Check the ones you want and click **Load** — they drop into the same
**Files** queue as the Salesforce flow, so you click each row to convert it, download it (CSV or Excel,
your filename), and the Uploaded → Converted → Downloaded status tracks your progress. On Chrome/Edge
the **↻ Reload from disk** button works here too (fix a file in Excel, click Reload, it re-converts).

Everything stays in your browser — **nothing is uploaded**. Chrome/Edge use the native folder picker
(which also enables Reload); other browsers fall back to a standard folder-select that still loads and
converts the files (just without Reload). The headless equivalent is the CLI:
`node src/cli.js batch <folder> [--format csv|xlsx]`.

## End-to-end tests (Playwright — opt-in, run from the CLI)

The `node --test` suite above is dependency-free and checks the engine + that the served
*files* are intact. For a real-browser check of the **served app**, there's a Playwright suite
in `e2e/` (incl. a `try_me` spec). It is **not** part of `npm test` and never enters the locked-down
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
- **Delete rows:** on the **original** (left) table you can remove rows — search to narrow the list,
  then **🗑 Delete N** (in the "Original file" header), or click the **✕** on any single row. Deleted rows
  drop from the converted table and the download; the summary shows a **deleted** count and **↩ Restore**
  brings them all back. (In-session and reversible — your file on disk isn't touched.)
- **Download — format + filename:** the **Download** button opens a small panel with a **CSV
  (default) / Excel .xlsx** toggle and a **filename builder** — Sanction ID · Race Type · Race
  Distance · Race Name — that composes `351003 - Duathlon - Intermediate - Clash Mississippi.csv`
  (blank fields are skipped; a live preview shows the result). For CSV, an optional **"CSV-safe
  times/dates"** checkbox locks the DOB and Recorded Time columns as text so Excel shows them exactly
  as written when the CSV is opened in Excel (it doesn't auto-reformat the time); not needed for the
  `.xlsx` download. The same panel backs the split-by-column download too.
- **Multi-sheet workbooks:** if an uploaded `.xlsx` has more than one sheet, a notice and a
  **sheet tab bar** appear; each sheet is converted independently (its own mapping, flags and
  edits). In the Download panel a **Separate / Combined** toggle appears: *Separate* lists **every
  sheet with its own editable filename** (the Race Type is pre-filled from the tab name when it
  matches — Triathlon/Duathlon/Aquathlon/Aquabike — and you can rename any file); *Combined* stacks
  the selected sheets' rows into one file (single 12-column sheet, tab order).
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
  time). The split **Download** opens the same **CSV / Excel + filename builder** panel, plus a
  **per-group filename** box for each output group (pre-filled `<your name> - <group>`, editable),
  matching the main Download button. For multi-sheet workbooks it also lists the sheets so you can
  run the split across some or all of them at once (the sheet name is appended to each file).
- **Inline remap:** every reformatted column header has a dropdown (in a top header row, so the
  two tables line up) to re-point that field; same controls live in the **Mapping** tab.
- **Highlights:** changed/guessed cells are highlighted; the legend is collapsible, resizable and
  scrollable. Each reason has **Show rows** (filter to just those) and **Approve**; plus
  **Approve all / Unapprove all**. Editing a highlighted cell also clears it.
- **Value mapping:** Category, Gender, State and Member Number list their distinct source values
  (Member Number includes blank-source `1-day` defaults) with per-value reset and bulk set/reset.
- **Download** as **CSV** (default — plain text, ideal for the rankings upload) or **.xlsx**
  (centered cells, comfortable column widths, frozen header row), and **Save mapping** (remembers
  your column + value choices for files with the same headers).
- **Quirky headers handled:** when a workbook has a **title/banner in row 1** and the real column
  headers in row 2 (even with a blank leading column), the converter scores rows by how many match
  known columns and locks onto the true header row automatically.

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
  (Basic Auth — `RACE_RESULTS_CONVERTER_METRICS_USER` / `RACE_RESULTS_CONVERTER_METRICS_PASS`), or the weekly Slack digest.
- **Size / cleanup**: `node src/cli.js metrics:size`, `metrics:cleanup` (keep current + prior
  calendar year), `metrics:purge-test` (delete only test-run rows — see below), and `metrics:purge-all`
  (delete every row — confirms first).
- **Testing in production**: open the app with **`?metrics_test=1`** and every event from that browser
  tab is stamped **`is_test=1`** (the flag sticks for the tab session and tags even the `page_view`).
  When you're done, `node src/cli.js metrics:purge-test` deletes exactly those rows — your real data
  and the Try-Me/demo data are left untouched.
- **Cron**: `utilities/cron_get_slack_race_results_transform/` (digest) and
  `utilities/cron_get_purge_race_results_transform/` (purge) — you set the schedule.

- **Dashboard**: funnel (visit→upload→conversion→download→start-over), activity-by-day
  (visits·uploads·downloads·start-overs — grouped for ≤14 days, auto-stacked beyond), downloads-by-type +
  a Split-by-group panel, a **Try Me vs real activity** chart (demo vs real uploads/conversions/
  downloads) + a **Try Me** KPI card, top users (visits·uploads·downloads·start-overs, timezone + last
  activity), a Start-over KPI card, ↻ Refresh + auto-refresh, dark/light. Data tables carry a leading #
  row-number column and scroll horizontally when narrow. The top-right **Last User Activity** chip and the
  Top Users **Last activity** column reflect real activity only — server-side `dashboard_view` events are
  excluded, so opening the dashboard doesn't bump the date (the **N rows** figure still counts all rows).
- **Events**: page_view, file_uploaded, conversion_completed, download, `split_download_used`,
  manual_remap, mapping_saved, start_over, theme_changed, error, + server-side dashboard_view per /metrics open. Every event also records `page_path` (the URL path viewed) so page_view/dashboard_view are explicit about the page. Events from the **Try me** sample carry `is_demo=1` (real user activity is `0`/NULL), which powers the Try-Me-vs-real chart.
- **Privacy/automation**: the client mutes itself under automated browsers (`navigator.webdriver`)
  unless `window.METRICS_TEST_ALLOW` is set, so the e2e suite never writes to the table. The uploaded
  **file name** rides along on every post-upload event (conversion / download / split / error) for
  traceability (also linkable via `upload_id`).

**Tests**: `tests/metrics_ingest.test.js` + `tests/metrics_retention.test.js` (dep-free units —
whitelist/timestamps, purge-by-year + purge-all + purge-test, plus `tests/metrics_test_flag.test.js` for the is_test/`?metrics_test=1` wiring), `e2e/metrics_beacon.spec.js` (fires when allowed /
muted under automation), and `e2e/metrics_db.spec.js` (browser→MySQL round-trip — events landed with
the right columns incl. file_name, + the table schema; chromium-only, skips with no DB: `npm run e2e:db`).

_Auth & identity:_ the `/metrics` dashboard uses HTTP Basic to sign in, then a signed `mx_session`
cookie (12h expiry) gates `/metrics` + `/api/metrics-report`, with a `/metrics/logout` route —
server-side expiry + revocation on top of Basic (a full sign-out can still need closing the browser).
The anonymous `visitor_id` is stored in BOTH a long-lived first-party cookie and `localStorage`,
restored from whichever survives.

**AI "ask your data" (in progress):** a read-only natural-language->SQL engine over the usage events lives in `src/race_results_transform/metrics/ask/` Now usable from the CLI/menu: `node src/cli.js ask "how many people used the converter last week?" [--provider openai|claude]` (read-only; prints the answer + the SQL). The `/metrics` dashboard also has an **Ask your data** box (model dropdown + answer + the SQL it ran), backed by the auth-gated `POST /api/metrics-ask` (auto-growing composer with model picker, suggested-question chips, markdown answers, auto charts for chartable results, vertically scrollable result tables, collapse/clear results, follow-up threads with a a single scrolling conversation thread (capped with a “see older” expander; model + time per turn; whole-panel show/hide; SQL & follow-up controls are tooltip chips), and an opt-in raw-SQL mode; answers in Mountain Time, grounded on a live metrics snapshot + operator corrections, out-of-scope questions declined). Sign in via a login form (real logout; no cached Basic). Power users can run guarded read-only SQL directly (`node src/cli.js ask:sql "<SELECT ...>"`). Operators can correct an answer in the dashboard so the AI honors it next time (`node src/cli.js ask:corrections` to review, `ask:uncorrect <id>` to drop one). Guided review processes are built in: `node src/cli.js ask:test:corrections` and `ask:test:threads` print step-by-step verification, and `ask:eval` runs review scenarios against the live model and records a report. Every ask is logged to a DB table for review (`node src/cli.js ask:log`), and a `tests/ask_injection.test.js` suite proves the read-only guard blocks SQL/prompt injection. Try the guard: `node src/race_results_transform/metrics/ask/demo_guard.js` (or the guard-demo item under Tests — engine & UI). See `metrics/ASK_DESIGN.md`.

No new dependencies. See `ANALYTICS_PLAN.md` 