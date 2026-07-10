# Reporting UI/UX tests (Playwright)

Browser-driven UX suite for the reporting SPA — **separate** from the code-based unit tests
(`npm run reporting_test`). Mirrors the merge tool's `src/salesforce_merge/e2e/` layout.

Its job is to automate the manual "reload and check the map renders / no red error overlay" loop:
it loads every map view and the Opportunity flows and **fails on any render or console error**.

## One-time setup

```
npm i -D @playwright/test        # already in the repo-root package.json
npx playwright install chromium  # the browser binary
```

Set a valid reporting login (used once by `auth.setup.js`, then reused via a saved session):

```
# PowerShell
$env:E2E_USER="you"; $env:E2E_PASS="yourpass"
# bash
export E2E_USER=you E2E_PASS=yourpass
```

## Run

```
npm run reporting_e2e        # headless
npm run reporting_e2e_ui     # interactive runner (watch / step / time-travel)
```

It targets the dev server at `http://localhost:5174` (override with `E2E_BASE_URL`) and starts
`reporting_dev_all` if it isn't already running. Also available from the menu: `npm run reporting_menu`
→ TESTING → "UI/UX tests (Playwright)".

## What's covered

- `smoke.spec.js` — each Plotly view (Heatmap / Pins / YoY / Regions / Opportunity) loads with no error
  overlay and no console/runtime errors.
- `opportunity.spec.js` — on-map key, band modes (National-relative / Statistical / Absolute), the
  collapsible state card, the collapsible key, and the ranking tab.

## Notes / hardening

- Assertions are **structural** (presence/behaviour), not exact numbers, so they hold against live data.
- Selectors use visible text/roles. If a label changes, the matching test breaks by design — or add
  `data-testid` attributes to the map-view tabs / key / ribbon for sturdier selectors.
- **Flows** (deck.gl/WebGL) is intentionally not in the smoke loop — it's flakier headless; the config
  already passes swiftshader flags if you add Flows coverage later.
- For a fully DB-free/deterministic run (like the merge suite), capture one `participation_bootstrap.json`
  and stub `/api/*`; today it runs against the live dev data.
