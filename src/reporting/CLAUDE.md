# CLAUDE.md — guidance for working in `src/reporting`

This app is the USAT Reporting SPA + Express host. It deliberately mirrors `src/salesforce_merge`.
When extending it, keep the code **simple, transparent, and within the existing conventions**.

## Conventions (match the rest of the repo)
- **Server-side JS:** CommonJS (`require`/`module.exports`), `'use strict';` at the top, `snake_case`
  function names, and a doc-comment header on every file. Follow `server_salesforce_merge_8020.js`
  and `src/salesforce_merge/**` as the reference implementation.
- **Front-end:** plain React `.jsx` (no TypeScript), `react-router-dom`, minimal deps. Only
  browser libraries belong in `web/package.json`; everything Node-side stays in the root
  `package.json`.
- **DB:** read-only through `store/db.js` (shared `mysql2` pool via `utilities/config`). Never write.
- **Auth:** signed-cookie sessions (`auth/session.js`), scrypt user store (`auth/auth_store.js`),
  panel gating (`auth/panel_access.js` + `require_auth.require_panel`). Own cookie
  (`reporting_session`) and env names (`REPORTING_*`) — per-app auth, like every other UI service.

## Architecture in one line
Proxy (`:8000`) → `/reporting` → this server (`:8021`) serves the built SPA **and** `/api/*`, which
reads local MySQL. The SPA is client-side over one `/api/bootstrap` payload.

## Where things live
- `api/routes.js` — all endpoints. Add report endpoints here, panel-gated.
- `store/participation_read.js` — builds the bootstrap payload. **Phase 1 TODO:** finish
  `build_from_mysql()` against the confirmed participation table; until then a fixture is served.
- `web/src/pages/` — one file per report page. `web/src/lib/` — pure data logic (portable).

## Guardrails
- Don't touch the running merge app or the live proxy. New code stays under `src/reporting/` and the
  one root server file.
- Don't add heavy dependencies. The only front-end extras beyond React are `plotly.js-dist-min` and
  `deck.gl` (for the maps).
- Validate server files with `node --check` and run `node --test src/reporting/tests` before shipping.

## Roadmap
See `plans_and_notes/PHASE_PLAN.md` (phases + acceptance) and `STATUS.md` (what's done / next).
