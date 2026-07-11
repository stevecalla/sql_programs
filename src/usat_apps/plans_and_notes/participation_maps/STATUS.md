# STATUS — reporting app

Snapshot of what's built and what's next.

## Phase 1 — live MySQL (written, needs a validation run)
`store/participation_read.js` now has a real `build_from_mysql()` that aggregates
`all_participation_data_with_membership_match` into the full payload; `store/participation_agg.js`
ports the POC's 36-metric roll-up (`build_year`); `store/mapmeta.json` holds the static map metadata.
Field logic + values are documented in `FIELD_MAPPING.md` and shown on the app's Reference page.
`tests/agg.test.js` unit-tests the roll-up (no DB).

To turn it on and validate (on the box with the DB):
1. `REPORTING_STRICT_DB=1 node server_reporting_8021.js` — surfaces any column-name mismatch instead
   of silently falling back to the fixture. Fix any column names flagged (dev schema may differ).
2. Open the app; the header badge should flip to green "live". Spot-check a couple states.
3. Note: the dev MySQL is an OLDER snapshot, so it won't match the POC's CA 33,236 / US 292,675 — that
   validation is against the current data. The logic is what's being checked.
4. `npm run reporting_test` runs the agg unit test + API smoke tests.

## Native front end (in progress — task 47)
Shell (header/dark mode/refresh/logout/footer/siderail), native Plotly choropleth + KPIs, native
Reference/Admin/Metrics pages are done. Remaining native components: Month selector, map styles
(pins / YoY / deck.gl flows), and the tabs (Top, Region, Region matrix, State matrix, State flows,
Events). These consume `rawByYM` / `odByYM` / `eventsByYear`, which the live query already produces.

## Done (files created, syntax-checked)

**Server + API (`node --check` passes on all):**
- `server_reporting_8021.js` — Express host mirroring the merge server (port 8021).
- `src/reporting/api/routes.js` — status / login / logout / me / event / metrics-report / bootstrap /
  admin(users + panel-access).
- `src/reporting/auth/*` — session (own `reporting_session` cookie), scrypt user store
  (`REPORTING_*` env), panel access, require_auth/admin/panel.
- `src/reporting/store/db.js` — shared MySQL pool. `store/participation_read.js` — bootstrap builder
  (fixture fallback). `store/make_fixture.js` — seed helper.
- `src/reporting/metrics/events.js` — best-effort analytics to `reporting_events`.
- `src/reporting/data_dir.js`, `menu.js`.

**Web SPA (`src/reporting/web/`):** Vite config, index.html, favicon, `main.jsx`, `App.jsx` (auth
gate + routing), `AppShell` (top nav), `Login`, `ParticipationMaps` (fetches `/api/bootstrap`, shows
live headline KPIs), `lib/api.js`, `lib/compute.js`, `styles.css`.

**Meta/docs:** README.md, notes.txt, CLAUDE.md, .gitignore, plans_and_notes/{PHASE_PLAN,
METRICS_AND_ADMIN_OVERLAP, DEPLOY_AND_PROXY, README_REPORTING, STATUS}.

**Proxy:** a commented `/reporting` line added to `utilities/proxy/proxy_routes.js` (off until go-live).

## Needs your machine (can't be done from the agent env)
1. **`npm install && build`** the web app: `cd src/reporting/web && npm install && npm run build`.
   (First install pulls react, react-router, plotly.js-dist-min, deck.gl.)
2. **MySQL parity** — finish `store/participation_read.js` `build_from_mysql()` against the real
   participation table, and validate: **CA 33,236; US 292,675**, flow + travel grand totals.
   Until then, seed the fixture so the app runs:
   `node src/reporting/store/make_fixture.js "<path>/usat_participation_dashboard_LATEST.html"`.
3. **Go-live** — add the `reporting_*` scripts (DEPLOY_AND_PROXY.md), `pm2 start`, uncomment the
   proxy line, reload the proxy.

## Next code increments (in priority order)
1. **Phase 1 SQL** — the participation aggregation queries (the one genuinely new logic). Gate the
   whole thing; everything downstream already expects the `DASH` shape.
2. **Phase 2 map** — mount the full dashboard into `#dashboard-mount` (port logic to `web/src/lib` +
   Plotly/deck.gl wrappers, or embed the proven standalone dashboard fed by `/api/bootstrap`).
3. **Admin page** (optional) — a small React `/admin` view over the existing `/api/admin/*` endpoints.

## Guardrails honored
- All new code under `src/reporting/` + the one root server file.
- Merge app and live proxy untouched (proxy line is commented; no pm2 changes made).
- Conventions matched: CommonJS server, `'use strict';`, snake_case, doc headers, plain `.jsx`,
  minimal `web/package.json`, per-app auth.
