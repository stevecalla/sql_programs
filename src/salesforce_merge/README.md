# Salesforce Merge tool

Web admin tool to review duplicate accounts and (later) initiate Salesforce merges, keep history,
and restore. Sits on top of the read-only `salesforce_duplicates` pipeline. Server lives at the
repo root: `server_salesforce_merge_8020.js` (port 8020). Planning docs: `plans_and_notes/`.

**Status: Phase 1 — read-only review pages (on the Phase 0 foundation).** No Salesforce calls, no writes. The dashboard reads
the existing `salesforce_duplicate_*` tables in `usat_sales_db`.

## Structure

```
server_salesforce_merge_8020.js   (repo root)  Express host: JSON API + serves the React build
src/salesforce_merge/
  auth/        session.js · auth_store.js · require_auth.js   (signed-cookie auth, .env admin)
  store/       db.js (shared MySQL pool) · duplicates_read.js (read existing duplicate tables)
  api/         routes.js  (/api/status, /api/login, /api/logout, /api/me, /api/dashboard)
  web/         Vite + React app -> builds to web/dist/, which the server serves
  plans_and_notes/   plan, mockups, execution reference, apex
```

## Setup

Add to the repo-root `.env`:

```
MERGE_ADMIN_USER=youradmin
MERGE_ADMIN_PASS=somethingstrong
# optional; auto-generated + persisted if omitted:
# MERGE_SESSION_SECRET=...
# optional public tunnel (off by default; Cloudflare fronts prod). Needs NGROK_AUTHTOKEN:
# MERGE_NGROK=true
```

The server logs one line per request, and prints a startup banner with the local URLs + ngrok
status (same pattern as the 8018/8019 servers).

The MySQL connection reuses the repo's existing `LOCAL_MYSQL_*` settings (via
`utilities/config` → `local_usat_sales_db_config`). No new DB config needed.

## Run (dev) — one command

From the repo root (one-time: `npm install` at root for nodemon/concurrently, and
`npm install` inside `src/salesforce_merge/web` for the React deps):

```
npm run salesforce_merge_dev_all
```

This starts BOTH the backend (Express :8020, auto-restart via nodemon) and the React dev server
(Vite :5173, hot reload). Then open **http://localhost:5173** and sign in with the MERGE_ADMIN_*
creds. Ctrl-C stops both.

Prefer separate terminals? `npm run salesforce_merge_dev` (backend) and
`npm run salesforce_merge_web` (front-end).

## Two ports / two modes (why 8020 also works)

- **Dev:** Vite serves the UI on **:5173** and proxies `/api` → **:8020** (the Express API).
  Use :5173 — it has hot reload. Two processes.
- **Built (single port):** `cd src/salesforce_merge/web && npm run build`, then
  `npm run salesforce_merge_server` — Express serves the built UI **and** the API together on
  **:8020**. Use :8020. One process, no hot reload (rebuild to see changes). This is the
  production-style path the proxy will front.

## Troubleshooting

- **Login returns HTTP 500 on :5173** → the backend isn't running. Vite's proxy returns 500 when
  it can't reach `:8020`. Start the backend (or use `salesforce_merge_dev_all`). Verify with
  http://localhost:8020/api/status (should return JSON).
- **`login configured: false` in the server log** → `MERGE_ADMIN_USER` / `MERGE_ADMIN_PASS`
  aren't being read from the repo-root `.env`.

## Testing

- **Unit tests** (node:test, no DB/Salesforce needed): `npm run salesforce_merge_test`
  — covers auth (session sign/verify, valid_user), the API routes (status/login/me + the
  dashboard auth gate, via a real `create_app()` boot), and `duplicates_read` (injected fake query).
- **E2E smoke** (Playwright, stubs `/api/*`): one-time `npx playwright install chromium` +
  `npm run salesforce_merge_build`, then `npm run salesforce_merge_e2e` — login → dashboard renders
  → dark-mode toggle.

## Menu

`npm run salesforce_merge_menu` (or `node src/salesforce_merge/menu.js`) — an interactive launcher
mirroring the duplicates menu: RUN (dev / build / server), TESTING (unit / e2e), OPEN (dev/built
UI, API status), and PM2 (start/stop/restart/logs).

## Run (production-style: one server)

```
cd src/salesforce_merge/web && npm install && npm run build   # emits web/dist/
node server_salesforce_merge_8020.js                          # serves the built app at :8020
```

Open http://localhost:8020. Later: add `'/merge': { target: 'http://127.0.0.1:8020', health: '/api/status' }`
to `proxy_routes.js` to front it through the proxy.

## What Phase 0 does

- Signed-cookie login (admin from `.env`).
- Dashboard with real counts (total accounts, accounts with merge IDs, clusters, duplicate pairs,
  merge-ID buckets) read **only** from the existing duplicate tables.
- Nav shell with the Sandbox⇄Production toggle (cosmetic for now).
- Shared `DataTable` (search + sort) component.

## What Phase 1 adds (review pages — read-only)

Three server-paged review pages over the existing duplicate tables (no Salesforce calls):

- **Duplicates** (`/duplicates`, `GET /api/duplicates`) — consolidated clusters with size, signal,
  confidence tier, merge-ID presence, best score. Searchable, sortable, paged.
- **Merge-ID review** (`/merge-id`, `GET /api/merge-id`) — reconciles Salesforce merge IDs against
  the duplicates we found: bucket cards (in_both / sf_only / multi_signal / …), duplicate-pair
  totals (exact/fuzzy/nickname), and a per-account table with an "in our duplicates?" column and a
  bucket filter.
- **All accounts** (`/accounts`, `GET /api/accounts`) — browse the snapshot, search by name/ID/member
  number, filter to "has merge ID".

Server-side paging/search/sort lives in `store/reviews_read.js` (whitelisted sort columns, bound
search params, `LIMIT/OFFSET`, totals) — safe for the ~700k-row snapshot. `DataTable` gained a
server `fetcher` mode (pager + remote sort/search) alongside its in-memory mode.

Nothing here can change Salesforce. Next phases: dry-run preview, then sandboxed execute + history,
then restore. See `plans_and_notes/README_MERGE_TOOL.md`.
