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
  auth/        session.js · auth_store.js · panel_access.js · require_auth.js   (signed-cookie auth, file-backed users + .env recovery, per-panel access)
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
# optional second always-valid recovery admin (e.g. for testing):
# MERGE_TEST_USER=tester
# MERGE_TEST_PASS=somethingstrong
# optional; auto-generated + persisted if omitted:
# MERGE_SESSION_SECRET=...
# optional public tunnel (off by default; Cloudflare fronts prod). Needs NGROK_AUTHTOKEN:
# MERGE_NGROK=true
```

`MERGE_ADMIN_*` and `MERGE_TEST_*` are **`.env` recovery accounts** (always valid, role `admin`,
can't be removed — so you can't lock yourself out). Additional logins are managed at runtime, not in
`.env` (see **Users & access** below).

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

## Users & access (Admin page)

Modeled on the email-queue's Access pane. Two layers:

- **Logins.** `.env` recovery accounts (`MERGE_ADMIN_*`, `MERGE_TEST_*`, role `admin`, always valid,
  not removable) plus **stored users** kept in a gitignored `auth.json` OUTSIDE the repo
  (`<determineOSPath()>/usat_salesforce_merge/auth.json`, override `MERGE_USERS_FILE`) with
  scrypt-hashed passwords. Manage them on the **Admin** page (`/admin`, admin-only) or from the CLI:
  `node src/salesforce_merge/admin.js add|list|passwd|remove|access` (also menu items 18–22).
- **Panel access.** Each non-admin user is governed by a panel allow-list (`panel_access.json`,
  override `MERGE_PANEL_ACCESS_FILE`): a general **default** (out of the box: every panel except
  Metrics) plus optional **per-user overrides** (grant Metrics, or restrict to a subset). Admins
  always see every panel. The **Admin** page itself is gated by the `admin` role, never grantable via
  panel access. Enforced in two places: the nav hides panels a user can't reach, and the API routes
  return **403** for a disallowed panel (so it's real, not cosmetic). `GET /api/me` returns the
  caller's `panels` array for the nav.

Endpoints (all admin-gated): `GET/POST /api/admin/users`, `POST /api/admin/users/remove`,
`GET/POST /api/admin/panel-access`.

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

Nothing here can change Salesforce.
## Tuning panel (criteria what-if)

The **Tuning** page (rail group "Analyze") reviews the duplicate-criteria **sweep**: it shows the
baseline funnel, a selected profile's funnel with deltas, and a sortable table of every profile's
clusters by signal (exact / fuzzy / nickname / multi) plus duplicate-account totals. Data comes
read-only from `salesforce_duplicate_sweep_profile` (`/api/tuning`).

To populate it, run the sweep from the **Process** page ("Run tuning sweep") — replay-only over the
snapshot already loaded (no Salesforce fetch, no change to the shared snapshot). See
`../salesforce_duplicates/plans_and_notes/README_TUNING.md`.

## Merge Admin (Phase 2 — review + stage merges)

The **Merge Admin** page (rail group "Operate", `/merge-admin`) reviews candidate merges and stages
them in a queue. Read-only against Salesforce — nothing here executes a merge (Phase 3).

- **Data source** (top panel) — pick what to review:
  - **Accounts with merge ids** (default) — distinct Salesforce merge ids from
    `salesforce_duplicate_merge_id_review` (`GET /api/merge-groups`); each entry is the set of
    accounts sharing one merge id.
  - **Duplicate groups** — the consolidated clusters (`GET /api/duplicates`), with the same
    has/none **Merge ID** and **Membership #** filters as the Duplicates page.
- **Master survivor rule** — `Salesforce Id = merge id, else oldest` (default) or
  `most child records`. The master is auto-picked per the rule and can be overridden by clicking a
  radio. The rail paginates ("Prev/Next") over the full result set.
- **Accounts table** — two selection columns: **Master** (the survivor, radio) and **Merge** (a
  checkbox per losing account). Field survivorship, impact, and child-record counts update from the
  selection. Detail is a read-only live Salesforce fetch (snapshot fallback); child counts load
  asynchronously via `GET /api/cluster/children` (auto-discovered child relationships).
- **Merge queue** — "Add to merge queue" persists the set (survivor + losers + provenance + rule) to
  the new `salesforce_merge_queue` table via `POST /api/merge-queue` (`GET` to list,
  `DELETE /api/merge-queue/:id` to remove). The queue is staging only; **Process queue** is disabled
  until Phase 3 (write chokepoint, pre-merge snapshot, typed confirm).

`store/merge_queue.js` owns the queue table (create-if-missing + add/list/remove, injectable
executor). `store/cluster_detail.js` takes a `kind` (`merge_id` | `group`) so detail/children/preview
work for either source. The Caveats card documents the SFMC/external-system gap and how a Salesforce
`Database.merge` actually runs.

### Bulk queueing (merge-id source)

On the **Accounts with merge ids** source, the rail has a checkbox per group plus a "Page" select-all and
(when a filter is active) a "Select all N matching" option. **Add selected** queues every chosen group in
one batched call: the survivor is the merge id itself (no Salesforce fetch needed), losers are the rest,
and groups without a clear survivor are skipped and reported. Backed by `reviews.resolve_merge_groups`
(pure DB), `merge_queue.add_many` (dedupe-aware), and `POST /api/merge-queue/bulk` (capped at 1000). Bulk
is merge-id-only because that survivor is unambiguous; Duplicate groups still queue one at a time.

### Queue now stores the merge *decision* (not just intent)

`salesforce_merge_queue` gained `survivor_name`, `field_overrides` (JSON `{ field: winningAccountId }`),
and `child_counts` (JSON `{ total, by: { object: n } }`, captured at queue time). "Add to merge queue"
persists the reviewer's per-field overrides and the child-record counts alongside the survivor + losers,
so the queue holds an *auditable, executable* merge instruction rather than just a list of clusters.
`merge_queue.list()` parses these JSON columns back to objects (and fills the survivor name via a
snapshot join). `merge_queue.add_many` (bulk) carries them through too. Columns are added with
create-if-missing + idempotent `ALTER` migrations, so existing tables upgrade in place.

Planned Phase 3 flow (agreed): **dry-run is the first step of "Process queue."** Processing will
(1) re-resolve each selected entry against fresh Salesforce data, honoring the stored overrides, and
**save a version** (the frozen plan + a pre-merge snapshot of current field values), (2) re-validate /
flag drift, then (3) execute `Database.merge`. The heavy pre-merge snapshot (restore baseline) lives in
its own Phase 3 table, NOT the queue — the queue stays the intent+decision record.

### Queue approval + status lifecycle (Phase 2 close)

The queue is a status-driven ledger, never auto-cleared: `queued → approved → (Phase 3) processing →
done / failed → restored`. In Merge Admin:

- **Approve selected** moves the selected `queued` rows to `approved` (`POST /api/merge-queue/approve`,
  `set_status` — only queued rows transition). This is the human go-ahead; it is a local status write,
  not a Salesforce write. Execution stays Phase 3.
- A **status filter** (default `queued`; also approved / done / failed / all) drives `GET
  /api/merge-queue?status=` and the panel view. The count chip reflects the active status.
- The **✕ removes a set only while it is `queued`** (`DELETE … WHERE id = ? AND status = 'queued'`);
  approved/done rows are kept for audit + restore.
- Re-queue guard widened: a set is blocked from being added again while `queued` **or** `approved`
  (a `done` set can be re-queued later).

Phase 3 will process `approved` rows: re-run the dry-run on fresh data, write a pre-merge snapshot,
execute `Database.merge`, log history, and support best-effort restore. The redundant per-cluster
"Preview merge (dry-run)" button was removed — the live detail already previews, and authoritative
validation moves into Phase-3 processing.

## Phase 3 — Process merges (safe mode, no writes yet)

The **Process Merges** page (Operate rail, `/merge-process`) reads the **approved** queue and runs the
execution pipeline, but **safe mode is on by default — no Salesforce writes happen**. Each selected set
is re-validated against fresh data, backed up to a pre-merge snapshot, and recorded as `simulated`.

- **Environment/org alignment guard.** Queue entries are stamped with the `environment` (and `org_id`
  when known) they were built from. `merge_execute.verify_alignment` compares that to the currently
  loaded dataset's environment and the connected org id; a mismatch is **skipped** (a Sandbox-built set
  can't run against Production, or vice-versa). Drifted sets (a record changed/removed since approval)
  are skipped too.
- **Pre-merge snapshot** (`salesforce_merge_premerge_snapshot`) — full record state for survivor +
  losers, written before any merge (restore baseline). **History** (`salesforce_merge_history`) — one
  row per processed entry (result simulated/skipped/failed/done, env, org, snapshot flag, reason).
- **Safety model.** Single chokepoint `store/merge_execute.js`; `MERGE_ENABLE_EXECUTION` env flag
  (default false → safe mode); the real `Database.merge` (Phase 3b) is intentionally NOT implemented, so
  even with the flag on it records `failed` ("endpoint not configured") rather than risk a write.
  Endpoints: `GET /api/merge/status`, `POST /api/merge/process`, `GET /api/merge/history`.
- **Shared tables.** The Merge Admin table refinements (sticky headers, centered cells, etc.) were
  lifted from `.mergeadmin`-scoped CSS to a shared `.mtbl` class; both Merge Admin and Process Merges
  wrap in `.mtbl`, so their tables look and behave identically.

To enable real execution later (Phase 3b): deploy an Apex `Database.merge` REST endpoint, provide a
write-enabled least-privilege Salesforce user, wire it into the chokepoint, then flip
`MERGE_ENABLE_EXECUTION` (sandbox first) behind the typed confirm. Phase 4 = best-effort restore from
the snapshot.
