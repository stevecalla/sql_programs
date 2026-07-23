# event_coi — build status

Route: **/insurance/event-coi** (nav group "Insurance"). Module id `event_coi`, panel `event-coi`,
API base `/api/event-coi/*`. Portal field map: `RECON_portal_form_map.md`.

## Done

**Phase 1 — UI/UX** (`web/src/modules/event_coi/`)
- `Section.jsx` + `components/HolderTable.jsx` + `event_coi.css`, registered in `web/src/nav.js`.
- Collapsible cards (reuses merge's `CollapsibleCard`); Save/Load/Clear defaults (localStorage).
- Test tools: Fill / Clear test values (fictional data, emails = callasteven@gmail.com) — hide via
  `SHOW_TEST_TOOLS` in Section.jsx.
- Holder table: search, per-column sort + filter; CSV/Excel export (`lib/exportRows.js`, same approach
  as merge's DataTable).
- Coverage & delivery section with **exact portal wording**; inline "Other → specify" boxes.
- Sanction ID enforced as a 6-digit number. Start button gated on required Step-1 + Step-3 fields
  with a live "what's missing" list.
- Downloadable template: `web/public/event_coi_template.xlsx` (↓ Template button).

**Phase 2 — backend + tests** (`modules/event_coi/`)
- `module.js` (manifest) + `api.js` (`/ping`, `/parse`), registered in `modules/registry.js`.
- `store/holder_parse.js` — server-side CSV + .xlsx parsing with fuzzy header matching (single source
  of truth; the UI uploads base64 and lets this parse — no multer, uses the 5mb JSON limit + root xlsx).
- `store/validate_request.js` — server-side request gate (mirrors the UI gating; used by the Phase-4 run).
- Tests: `tests/holder_parse.test.js` (8) + `tests/validate_request.test.js` (5) = **13 passing**.
- Panel `event-coi` auto-appears in Admin → Users & Access; admins pass automatically.
- Page-view tracking is automatic (platform `panel_view`); custom run events come in Phase 3-4.

## How to run / test
- `npm run usat_apps_dev_all` (API :8022 + web), or `node src/usat_apps/modules/event_coi/menu.js`.
- Tests: menu item 8, or `node src/usat_apps/run_tests.js modules/event_coi`.
- Sign in as admin → open **Insurance → Event COI**. Upload a CSV/.xlsx (try renaming headers to
  `st`, `Postal Code`, `Holder Name`) → parses server-side.

## Next
- **Phase 3** — Playwright runner (login → Race Certificate Request → fill one holder → screenshot,
  no submit; map the success screen). `.env`: INSURANCE_PORTAL_URL / _USER / _PW.
- **Phase 4** — submit + per-record Approve/Skip/Approve-all loop + results log + run-event tracking.
