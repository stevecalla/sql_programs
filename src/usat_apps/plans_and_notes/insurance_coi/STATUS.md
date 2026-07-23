# event_coi — build status

Route: **/insurance/event-coi** (nav group "Insurance"). Module id `event_coi`, panel `event-coi`,
API base `/api/event-coi/*`. Portal field map + limits: `RECON_portal_form_map.md`.

## Done — Phases 1–4

**Phase 1 — UI/UX** (`web/src/modules/event_coi/`): Section.jsx + HolderTable.jsx + RunPanel.jsx +
event_coi.css, registered in `web/src/nav.js`. Collapsible cards (merge's CollapsibleCard), Save/Load/
Clear defaults, Fill/Clear test values (fictional, emails callasteven@gmail.com), holder search/sort/
filter, CSV/Excel export, exact portal wording, inline "Other → specify" boxes, downloadable template
(`web/public/event_coi_template.xlsx`). Field lengths capped to the portal (Sanction 6 digits, State 2,
Zip 7, dates 10, phone 12, etc.). Start button gated on required fields with a live "what's missing".

**Phase 2 — backend + parse** (`modules/event_coi/`): module.js + api.js, registered in
`modules/registry.js`. `store/holder_parse.js` parses CSV + .xlsx server-side with fuzzy header matching
(UI uploads base64 → no multer). `store/validate_request.js` gates a full request.

**Phase 3 — Playwright** : `store/portal_session.js` (login + open form), `store/fill_certificate.js`
(fill one holder; field map verified live on the real form), `run_dry.js` (dry run, no submit; menu 9).

**Phase 4 — submission loop** : server-side, headless, screenshot approval.
- `store/run_control.js` — one logged-in Chromium session; loops holders (open → fill → screenshot →
  approval gate → submit → record); progress + screenshots over SSE. One active run at a time.
- `store/portal_driver.js` — real driver (swappable with a fake for tests).
- `api.js` — `run/start` (validates first), `run/stream` (SSE), `run/approve|approve-all|skip|stop`,
  `run/results`.
- `RunPanel.jsx` — progress, current filled-form screenshot, **Approve / Skip / Approve all remaining /
  Stop**, results log. Success = the portal's `/mvc/FormGenerator/FormSubmitted` page.

**Tests: 18 passing** — `node src/usat_apps/run_tests.js modules/event_coi`
(holder_parse ×8, validate_request ×5, run_control ×5 via a fake driver — no browser needed).

## Production / deployment
- End users need **only a browser**. Playwright + Chromium install **once on the server**
  (`npm i -D @playwright/test && npx playwright install chromium`). Runs headless there.
- Credentials in repo `.env`: `INSURANCE_PORTAL_URL` / `INSURANCE_PORTAL_USER` / `INSURANCE_PORTAL_PW`.

## How to run / test
- `npm run usat_apps_dev_all`; sign in as admin → **Insurance → Event COI**.
- Fill test values → Start submission loop → review the first screenshot → **Approve** (⚠ a real
  submission) or **Approve all remaining**. Test with 1–2 holders on your own email first.
- Unit tests: menu item 8, or `node src/usat_apps/run_tests.js modules/event_coi`.
- Local selector dry run (no submit): menu item 9, or `node src/usat_apps/modules/event_coi/run_dry.js`.

## Possible follow-ups
- Move the run to a dedicated pm2 worker (like salesforce_merge) for parallelism / resilience.
- Persist run results to MySQL + a metrics events table; add custom track events (coi_run_start, etc.).
- Per-field length/format flags on uploaded holders (e.g. State not 2 chars) in the review table.
