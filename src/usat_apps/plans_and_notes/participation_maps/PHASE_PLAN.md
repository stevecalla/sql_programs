# Reporting app — phase plan

Goal: rebuild the participation-maps dashboard as a React SPA (like the Salesforce Merge app),
served behind the `:8000` proxy at `/reporting/participation-maps`, reading local MySQL. Then grow
into an umbrella for more reports.

Each phase is self-contained and reversible. All new code lives in `src/reporting/` + the one root
server file `server_reporting_8021.js`. Nothing touches the running merge app or the live proxy until
the documented go-live step.

## Phase 0 — Skeleton & basics ✅
Folder structure mirroring merge; `server_reporting_8021.js`; auth/store/metrics modules; a blank
React app; `/api/status`; meta files (notes.txt, README, CLAUDE.md, .gitignore, menu.js, these docs).
**Done when** `/reporting` shows a page and `/api/status` returns ok.

## Phase 1 — MySQL data pipe (`/api/bootstrap`) — DONE
`store/db.js` (shared pool) + `store/participation_read.js` + `/api/bootstrap` returning the
`DASH`-shaped payload. `build_from_mysql()` is **live** — it reads the pre-aggregated summary tables
(built by `step_3i`) into per year+month state rows + cross-state flows, with roll-ups computed in JS;
a fixture remains only as an offline fallback. Verified in production: the app boots on the live
payload (`"live participation payload cached from MySQL"`) and the maps/metrics match the standalone
build. Covered by the unit suite (bootstrap auth-gating) and the Playwright e2e suite (renders live).

## Phase 2 — participation-maps page (parity) — shell done, map pending
`web/` SPA with login, routing, and a `ParticipationMaps` page that fetches `/api/bootstrap` and
renders headline KPIs from live data (done). **Remaining:** mount the full interactive dashboard into
`#dashboard-mount` — either (a) port the standalone logic (`computeAgg`, `aggregateFlows`, matrices,
YoY) into `web/src/lib` + Plotly/deck.gl component wrappers, or (b) embed the proven standalone
dashboard, fed by `/api/bootstrap`. **Done when** the page matches the standalone dashboard.

## Phase 3 — auth + metrics + admin (shared model) — implemented
Per-app signed-cookie auth (own `reporting_session` cookie, `REPORTING_*` env), panel gating, admin
user/panel endpoints, best-effort usage analytics to `reporting_events`. See
`METRICS_AND_ADMIN_OVERLAP.md` for how this relates to merge. **Done when** unauthenticated users get
the login screen and authorized roles see the page. (An admin UI page is optional next.)

## Phase 4 — deploy wiring + go-live — prepared, cutover is manual
Root `package.json` `reporting_*` scripts, the `/reporting` proxy line (kept commented), PM2
`usat_reporting`, `DEPLOY_AND_PROXY.md`. **Go-live is a manual one-command step** (uncomment the
proxy route + `pm2 start`) so an agent never restarts the live proxy. **Done when** it's reachable via
the proxy host and health is green.

## Phase 5 — (later) shared shell / more reports
Shared top-nav already in place (`AppShell`). Add reports as new pages/routes under `/reporting`, or
split heavy ones into their own service. Optionally lift shared UI/auth into a package.
