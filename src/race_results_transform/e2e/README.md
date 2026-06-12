# End-to-end tests (Playwright)

Real-browser smoke of the **served** app: load → convert → download → split-by-column →
combine, plus the "did a bad deploy blank the page" canaries (theme toggle + footer clock).

These are **opt-in dev/CI tooling** — separate from the dependency-free `node --test` suite,
and never installed into the locked-down production engine. The config auto-starts the real
`server_race_results_transform_8018.js` (ngrok off) and drives headless Chromium.

## Install (one time)

Run these from `src/race_results_transform/`:

**Dev machine (macOS / Windows):**
```
npm run e2e:install
# = npm i -D @playwright/test && npx playwright install chromium
```

**Linux server (headless; needs root/sudo for the system libraries):**
```
npm run e2e:install:server
# = npm i -D @playwright/test && npx playwright install --with-deps chromium
```
`--with-deps` apt-installs the shared libraries headless Chromium needs on a bare server.
The config already passes `--no-sandbox`, so it runs even as root.

> These steps need open network access to npm + the Playwright CDN. Do them on a dev box or
> the server where that's allowed — not in the restricted production install path.

## Run

```
npm run e2e            # boots the server + runs the browser tests
```
Override the port if 8018 is busy: `E2E_PORT=8019 npm run e2e`.
If a server is already running on the port, it's reused.

## What it checks (`convert_flow.spec.js`)
- page shell loads (theme button has text, footer clock shows `… MTN`)
- upload a fixture → Compare card renders → **Download** popover → pick **Excel** → opened `.xlsx` has the 12-column template
- **Download defaults to CSV** + the filename builder composes `351003 - Duathlon - Intermediate - Clash Mississippi.csv`
- **split-by-column** → split popover → pick **Excel** → at least one per-group `.xlsx` downloads (12-column)
- **multi-sheet** → sheet bar appears → **Combined** toggle (with Excel) merges all sheets into one worksheet

Fixtures: the committed `examples/sample/sample_race_results_FAKE.xlsx`, plus a throwaway
2-sheet workbook the spec builds with exceljs (all fake data).

## Watch it run (visible Chrome)

To see the browser instead of running headless (dev machine with a display only — not the
headless Linux server):
```
npm run e2e:headed        # opens Chrome, auto-slowed (~1500ms/step) so you can follow along
```
Or from `node menu.js` → **Browser E2E tests** → answer **y** to "Watch it run in a visible
Chrome window?". To change the pace, edit `HEADED_SLOWMO` (ms per step) in `e2e/playwright.config.js` — that works everywhere; the `E2E_SLOWMO` env override only works on bash/macOS/Linux, not Windows `cmd`.

### Step through it manually

`npm run e2e:step` (menu item 17) opens Chrome with the Playwright Inspector and **pauses on every step** — click **Resume** to advance one step at a time. The element about to be clicked gets a red border, and a numbered banner ("Step 3 — …") narrates each action. The plain `npm run e2e:headed` instead auto-advances, holding ~4s per step (`STEP_PAUSE` in `convert_flow.spec.js`).

### What's covered

- **convert_flow.spec.js** — load → convert → download (12-col), split-by-column, multi-sheet Combined, + theme/clock canaries.
- **ui_interactions.spec.js** — theme persistence, CSV input, Approve all, edit-clears-a-flag, value-map override, inline header remap.
- **linking_flow.spec.js** — Link tables mirrors search ON / stays independent OFF.
- **table_view.spec.js** — search filter + clear, header sort (▲/▼ + Reset), legend “Show rows” filter.
- **layout_sheets.spec.js** — layout side/stacked/tabs, sheet-tab data switching, drag-and-drop upload.
- **split_presets.spec.js** — split group-name preset: Save preset (status) then Clear entries.
- **try_me.spec.js** — the "Try me (fake data)" dropdown: both menu paths, *Download sample file* actually downloads the served `/sample/...xlsx` (guards the prod "file wasn't available" 404), *Load sample data* → Compare card, the "sample data" badge shows while viewing, the upload card + Try-me button hide once loaded, and Start over restores them.
- **sf_flow.spec.js** — the "Get Race Results from Salesforce" panel (all `/api/sf/*` + `/api/login` stubbed; File System Access API disabled to force the server-folder fallback): From/To defaults + 14-day cap (From-anchored), inline sign-in + the Sign in/Sign out toggle, list → sort → auto-select → download (with progress) → Files queue table → click a row → convert → download, the 50-default/150-max cap (incl. the amber "raise Max files" glow), search filter, Cancel, and the "no files found" state. Two `.xls` cases: with SheetJS **forced 404** the row is highlighted + a re-save hint shows; with SheetJS **stubbed available** the `.xls` row is *not* flagged and there's no warning. Plus **Reload from disk**: download → open → convert → download (Downloaded), then the per-row **↻** re-reads via the stubbed `/api/sf/folder-file` and drops the row back to Converted.
- **folder_flow.spec.js** — the "Convert files from a folder" panel. Drives the `webkitdirectory` fallback input directly (the native picker can't be scripted): pick 2 files → list/select → **Load** into the SAME Files queue (which shows File name · Modified, not Program/Owner) → open a row → convert → download (Excel) → status reaches Downloaded; plus search-filter + Reset.
- **a11y.spec.js** — axe-core scan (no critical violations) on home + Tables + Mapping, plus the Try-me dropdown (open) and the sample-data badge state.
- **visual.spec.js** — screenshot baselines (chromium only): upload light/dark (now include the Try-me button) + compare card. `npm run e2e:snap` to (re)generate after intended UI changes.
- **mobile.spec.js** — Pixel-5 viewport: no horizontal overflow + convert works (runs in the `mobile` project only).
- **metrics_db.spec.js** — browser→MySQL round-trip: drives the app, asserts the usage events landed with the right columns + the table schema exists. Chromium-only; skips with no DB. `npm run e2e:db`.
- **errors.spec.js** — unreadable file → graceful error, page doesn't blank.
- **helpers.js** — shared step()/highlight()/fixtures (not a test file).

### Cross-browser, mobile, a11y, visual

`npm run e2e` runs every spec on **chromium + firefox + webkit**, plus a phone-sized **mobile** project (`mobile.spec.js`). `npm run e2e:install` now also installs axe-core and the firefox/webkit engines. First time for visual tests, run `npm run e2e:snap` to create the committed PNG baselines under `e2e/visual.spec.js-snapshots/`. Fast path: `npm run e2e:chromium` (chromium only). Scope to one engine any time with `-- --project=firefox`.
