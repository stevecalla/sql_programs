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
- upload a fixture → Compare card renders → **Download** → opened `.xlsx` has the 12-column template
- **split-by-column** → at least one per-group `.xlsx` downloads (12-column)
- **multi-sheet** → sheet bar appears → **Combined** toggle merges all sheets into one worksheet

Fixtures: the committed `examples/sample/sample_race_results_FAKE.xlsx`, plus a throwaway
2-sheet workbook the spec builds with exceljs (all fake data).

## Watch it run (visible Chrome)

To see the browser instead of running headless (dev machine with a display only — not the
headless Linux server):
```
npm run e2e:headed        # opens Chrome, slowed (E2E_SLOWMO=350ms) so you can follow along
```
Or from `node menu.js` → **Browser E2E tests** → answer **y** to "Watch it run in a visible
Chrome window?". Tune the pace with `E2E_SLOWMO=600 npm run e2e:headed`.
