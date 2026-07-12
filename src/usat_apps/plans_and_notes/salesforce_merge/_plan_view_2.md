# Build Plan — Port salesforce_merge into usat_apps (6 phases)

**Planning only. No code.** Fold the standalone **salesforce_merge** app (`server_salesforce_merge_8020.js`)
into the usat_apps platform as the **`merge`** module — reusing the platform shell (rail, top-nav, auth,
theme, metrics) while keeping **all** the merge domain code. Then, as a second step, break the
destructive/long-running work out to an isolated server-side worker. Companion to
`PARTICIPATION_MAPS_PORT_PLAN.md`. Reviewed 2026-07-12.

## Decisions locked (2026-07-12)

| Decision | Choice |
|---|---|
| **Rail** | **Drill-in replace** — clicking Salesforce → Merge *replaces* the platform rail with merge's own rail (a "‹ USAT Apps" back link returns). One rail at a time; merge gets full width. Not side-by-side, not an overlay. |
| **Architecture** | **Fold in the UI + reads + auth** as a module first (writes inline), **then isolate the writes** — **merge + restore** move to a **separate worker process** (`salesforce_merge_worker`, :8021). Refresh already runs out-of-process; its own worker is a later follow-up. Two-step rollout (below). |
| **Sequencing** | **Port first, isolate second.** Phases 1–2 port the whole app (writes inline, dev-only). Phase 3 breaks the writes out. Prod stays on **8020** until the breakout is verified. |
| **Admin** | **Not ported.** Platform Admin → Users & access owns users; merge is gated on the `merge` panel. |
| **API namespace** | `/api/salesforce-merge/*`. |

Still open (recommendations at the end): metrics table, merge-history handling.

## Implementation status — as built (2026-07-12)

Phases 1–2 are in and **Phase 3 (worker breakout) is implemented** (verified by a minimal smoke path).
This table is the source of truth for what actually shipped; the phase sections below remain the design.

| Area | Status | As built |
|---|---|---|
| Phase 1 — backend module | ✅ Done | `modules/salesforce_merge/{module.js, api.js, store/*}`; `/api/salesforce-merge/*`; gated on the `merge` panel |
| Phase 2 — frontend drill-in | ✅ Done | `web/.../salesforce_merge/{Section.jsx, MergeRail.jsx, pages/*, components/*}`; nested routes under `/salesforce/merge` |
| Phase 3 — write worker | ✅ Implemented | `src/salesforce_merge_worker/loop.js` + `server_salesforce_merge_worker_8021.js` — a **full Express server mirroring the fleet** (create_app/start_server, ngrok off, request log, clean SIGTERM/SIGINT, EADDRINUSE), not just a `/health` stub. Endpoints enqueue; the worker claims + runs; the UI polls by exact `run_id`. |
| Job queue | ✅ On `salesforce_merge_run` (no new table) | Added a `queued` status + `claimed_by`, `claimed_at`, `cancel_requested`, `params`, `result`. Claim/cancel helpers live in **`store/merge_run.js`** (`enqueue`, `claim_next`, `request_cancel`, `is_cancelled`, `set_result`) — **not** a separate `claim.js`. |
| Cancellation | ✅ DB-backed | `cancel_requested` column (spans web + worker; the original in-memory Set only worked single-process) |
| Result parity | ✅ | The worker stores the executor's own summary object on the run row (`set_result`), so the UI shows the same counts as the pre-worker synchronous version |
| Multi-worker | ✅ Built in | Atomic claim + per-process token; scale via pm2 cluster — `pm2_start_salesforce_merge_worker_cluster` (`-i 2`). Autorestart ON. Cancel still works (DB-coordinated). |
| Tests | ✅ | `src/salesforce_merge_worker/smoke.js` (enqueue→claim→run→done→result parity) and `worker_down_test.js` (stays `queued` when 8021 is down, drains when it returns). Scripts: `salesforce_merge_worker_smoke`, `salesforce_merge_worker_down_test`. |
| **`created_at_mtn` / `created_at_utc`** | ✅ New | Added as the **last columns** on **run, queue, history, premerge_snapshot** — event-table convention (app-written Denver + UTC wall-clock via `store/timestamps.js`). Migration: `src/queries/create_drop_db_table/alter_salesforce_merge_timestamps.js` (also auto-applied on boot via `ensure_table`). **`salesforce_merge_events` is not a code table** — nothing to alter (see Open decisions). |
| **Module menu** | ✅ New | `modules/salesforce_merge/menu.js` — worker start/stop/logs/cluster, smoke + worker-down tests, DB migrations, status/open. Ported like the participation-maps menu; wired into the platform menu **MODULES → item 28**. No admin/users (platform owns auth). |
| **"No worker online" banner** | ✅ New | `GET /api/salesforce-merge/worker/health` (platform proxies :8021 with a short timeout) + `WorkerBanner.jsx` (polls every 15s, renders a scoped banner while the worker is down) so a queued-but-not-running job is visible. |
| Fleet wiring | ✅ New | Worker added to `pm2_run_all_servers`; `restart_ / stop_ / pm2_logs_salesforce_merge_worker` scripts; `.vscode/tasks.json` group **20 SALESFORCE MERGE WORKER** (logs/shell/split) + **All Logs (23 groups)**. |
| **Phase 5 — tests** | ✅ Done | 17 files under `modules/salesforce_merge/tests/` (98 tests): 15 ported clean, `api.test.js` rebuilt around the module mount + panel gate, new `worker_queue.test.js` (Phase-3 enqueue/claim/cancel/result). Playwright `e2e/salesforce_merge/smoke.spec.js` (drill-in rail, dashboard, no-worker banner) wired into the platform suite. **Full platform suite: 125 tests green.** Test menus added (platform + module). |

**Worker-down behavior:** a merge never *fails* when :8021 is offline — it's accepted and sits `queued` until a worker claims it (a silent hang), which is exactly what the banner surfaces.

**Not yet done:** Phase 4 (metrics fold-in), Phase 6 (retire 8020), optional SF API-usage card, the stamp-actor field, and the External Client App.

## Feasibility — the slot is already reserved

| Signal | Where |
|---|---|
| Backend module slot | `modules/registry.js` — `// merge, // (Phase 5) port src/salesforce_merge as a module here` |
| Rail item already present | `web/src/nav.js` — Salesforce group → `{ label:'Merge', path:'/salesforce/merge', panel:'merge', Component: ComingSoon }` |
| Panel gate already named | `panel: 'merge'` |
| Metrics already aligned | merge already uses the shared analytics core (`metrics_config.js`, dual `created_at_*`) |

Merge is bigger than participation-maps: **~60 API endpoints, 13 pages, ~15 store modules, ~18 tests**.

## "Excluding adm users" = reuse the platform, drop merge's own plumbing

The **admin does not port.**

| Merge brings today | Fate |
|---|---|
| `auth/*` (auth_store, session, require_auth, panel_access), `admin.js` CLI | **Drop** — platform provides auth/session/access |
| `pages/Login.jsx`, `pages/Admin.jsx` + `/api/admin/*` | **Drop** — platform Login + Admin own this |
| `TopNav`, `SideRail`, `UserMenu`, `ThemeToggle`, `FooterClock` | **Drop** — platform shell |
| `/api/status`, `/api/login`, `/api/logout`, `/api/me` | **Drop** — platform endpoints |
| `/api/event`, `/api/metrics-report`, `/api/metrics-purge-test`, `/api/metrics-ask*` | **Drop the endpoints** — usage flows through platform `track.js` |
| **~50 domain endpoints** (dashboard, dataset, tuning, runs, refresh, duplicates, cluster, merge-groups, merge-queue, merge/*, merge-id, accounts) | **Keep** — re-namespaced `/api/salesforce-merge/*` |
| **All `store/*`** | **Keep** (Phase 3 splits it web-safe vs worker-only) |
| **11 domain pages** + domain components (Funnels, ClusterModal, DataTable, StatCard, DatasetStamp, EnvSwitch, HeaderRefresh) | **Keep** |
| `menu.js` (refresh/ETL ops) | **Keep** — contribute to the usat_apps Ops menu |

## Naming (fixed for the whole port)

| Thing | Value |
|---|---|
| Module id (URL + panel) | `merge` |
| Backend module folder | `src/usat_apps/modules/salesforce_merge/` |
| Backend web routes | `/api/salesforce-merge/*` |
| Panel key | `merge` |
| Nav group | `Salesforce` |
| Front-end folder | `web/src/modules/salesforce_merge/` |
| Worker folder (Phase 3) | `src/salesforce_merge_worker/` (mirrors `src/salesforce_duplicates/`) |
| Worker process (Phase 3) | `server_salesforce_merge_worker_8021.js` (repo root) → pm2 `salesforce_merge_worker`; handles kind `merge` + `restore` |
| Worker health port | `8021` (freed by the `/reporting` retirement) |
| Job / progress tables | **Reuse** `salesforce_merge_queue` (work) + `salesforce_merge_run` (progress) — **no new table**; add a `queued` status + `claimed_by` / `claimed_at` to `salesforce_merge_run` |
| Refresh isolation | Deferred — refresh already delegates to `salesforce_duplicates` (8017); a `salesforce_refresh_worker` is a later follow-up |

---

## Architecture — folded-in UI, isolated write worker (end state)

The web tier (usat_apps monolith, 8022) hosts the merge **module**: all reads, previews, and the UI. In the
**end state** it **never opens a Salesforce write connection** — every merge/restore is a **job** a separate
**worker process** (`salesforce_merge_worker`, :8021) performs, **triggered by the user**. One repo, one `.env`,
two pm2 processes (web + worker). (Refresh already runs out-of-process as a spawned CLI — see below.)

**Rollout order (why we don't build the worker on day one):**

- **Step 1 (Phases 1–2, dev only):** port the app with writes **inline** (execute/restore/refresh run in the request, guarded by `MERGE_ENABLE_EXECUTION`). This proves the fold-in — UI, auth, reads, writes — against known-good behavior, fast. Prod merge traffic stays on 8020.
- **Step 2 (Phase 3):** flip writes to the worker + job queue. A self-contained refactor you diff against the just-ported version. Only after this is verified do you retire 8020 (Phase 6) — so the monolith **never runs destructive SF writes in production**.

**End-state job flow** (user-triggered; reuses `salesforce_merge_run`):

1. User clicks **Process** (or Restore) → `POST /api/salesforce-merge/merge/process` inserts a `queued` row in `salesforce_merge_run` (kind, mode, ids, `created_by`) and returns immediately — no write in the request.
2. `salesforce_merge_worker` (pm2; entry `server_salesforce_merge_worker_8021.js`) atomically **claims** the queued run, runs the existing `merge_execute` / `merge_restore`, writes **progress** back to that same run row, sets `done`/`error`. Guarded by `MERGE_ENABLE_EXECUTION`.
3. UI polls `GET /api/salesforce-merge/merge/progress|status` → reads `salesforce_merge_run` (already wired). Cancel = set the cancel flag, which the worker checks between sets.

**Why the isolation matters:** a bad merge run can't take the web tier down, and a web deploy can't kill an
in-flight merge.

### The big Salesforce data pull (≈700K records) is already its own process

`refresh_runner.js` doesn't pull records itself — it **spawns the existing detection CLIs**
(`src/salesforce_duplicates/step_1_find_duplicates.js`, `sweep_duplicates.js`) as **child processes** and
parses their `[STEP]` stdout for progress. So the heavy 700K-record pull already runs **out-of-process**
today, memory-isolated from the app; the fold-in changes nothing about how it runs. Three tiers of isolation:

| Tier | Runs | Holds the risk |
|---|---|---|
| Web (usat_apps 8022) | UI, reads, enqueue | nothing heavy |
| Worker(s) | claim jobs, spawn + monitor | orchestration only |
| Child process (spawned CLI) | the actual 700K SF pull + detection | all the memory/time |

**This round:** refresh stays as-is — it already runs out-of-process (the web spawns the `salesforce_duplicates`
CLIs). Giving it its own `salesforce_refresh_worker` (so a long pull can't even share the web process that
spawns it) is a **later follow-up**, not Phase 3. `src/salesforce_duplicates/` stays in the repo — the ETL the
pull depends on, same as participation kept `src/participation_data`.

---

## Target folder structure (end state, after Phase 3)

```
repo root/
  server_usat_apps_8022.js            # platform web server (unchanged) — hosts the merge MODULE (UI + reads + writes*)
  server_salesforce_merge_worker_8021.js  # Phase 3 — pm2 "salesforce_merge_worker" — runs merge + restore jobs (tiny /health :8021)

  src/usat_apps/
    modules/
      registry.js                     # uncomment `merge`
      salesforce_merge/
        module.js                     # manifest: id 'merge', group 'Salesforce', panels, mount()=web routes, menu(), warm()
        api.js                        # WEB routes /api/salesforce-merge/* (Phase 1: calls writes inline; Phase 3: enqueues)
        menu.js                       # ops/ETL items (trigger a refresh, etc.)
        store/
          # ---- web-safe (reads & compute) ----
          salesforce_read.js          # jsforce READ connection
          duplicates_read.js
          reviews_read.js
          cluster_detail.js
          merge_preview.js            # preview/compute a proposed merge (no write)
          merge_control.js
          merge_history.js
          merge_snapshot.js
          tuning_read.js
          merge_queue.js              # "proposed merges awaiting approval" domain table (unchanged)
          # ---- write/long-running (Phase 1: called by api.js; Phase 3: worker-only) ----
          salesforce_write.js         # jsforce WRITE connection (merge/undelete)
          merge_execute.js            # destructive SF merge
          merge_restore.js            # destructive SF undelete/restore
          merge_run.js                # orchestrates a run of approved merges
          refresh_runner.js           # orchestrates the pull — SPAWNS src/salesforce_duplicates CLIs as child processes
        tests/                        # ported no-DB unit tests
        (db -> ../../../store/db, data_dir -> ../../../data_dir : reused, not copied)

    web/src/modules/salesforce_merge/
      Section.jsx                     # module entry — renders the DRILL-IN rail + nested routes /salesforce/merge/*
      MergeRail.jsx                   # merge's own sub-rail with a "‹ USAT Apps" back link (replaces platform rail)
      pages/                          # Dashboard, Duplicates, MergeId, AllAccounts, GetDuplicates,
                                      #   SelectMerges, MergeProcess, Restore, Tuning, Metrics, Reference
      components/                     # Funnels, ClusterModal, DataTable, StatCard, DatasetStamp, EnvSwitch, HeaderRefresh
      lib/                            # merge-specific compute (theme/track/api come from the platform)
    web/src/modules/registry.js       # register { id:'merge', path:'/salesforce/merge', panel:'merge', Component: lazy(Section) }

  src/queries/create_drop_db_table/
    alter_salesforce_merge_run_phase3.js  # Phase 3 — ADD status 'queued' + claimed_by/claimed_at (NO new table; reuse merge_run + merge_queue)

  src/salesforce_duplicates/          # KEEP — detection CLIs the refresh SPAWNS (the actual 700K SF pull); ETL dep, like participation_data

  src/salesforce_merge_worker/        # Phase 3 — the worker, mirrors src/salesforce_duplicates/
    loop.js                           #   poll -> claim a queued salesforce_merge_run -> dispatch by kind -> progress
    claim.js                          #   atomic claim / cancel / progress helpers (reuse salesforce_merge_run)
```

Reused, not duplicated: `store/db.js`, `data_dir.js`, `auth/require_auth.js` + panel gate, `metrics/*`,
`web/src/lib/{api,track,theme}.js`, `web/src/{shell components, pages/Login, nav.js}`.

`*` writes-inline is a **dev-only interim** (Phases 1–2). Phase 3 makes `api.js` import only the web-safe
`store/` modules; `salesforce_write.js` + execute/restore/run/refresh become reachable **only** from the worker.

---

## Resilience — keep one crash from being an outage

The single-process risk (one crash affecting all web modules) is addressed at four levels — most already in place:

| Level | Move | Effect |
|---|---|---|
| Have it | pm2 auto-restart + `max-memory-restart` | A crash is a ~1–2s self-healing blip, not an outage |
| Add (small) | Process-level `uncaughtException` / `unhandledRejection` handlers (log + clean exit → pm2 restarts), an Express error-handling middleware, a `/health` endpoint | Most errors return 500s instead of crashing the process; clean recovery; pm2 sees health |
| Add (strong) | **pm2 cluster mode — 2+ web instances** behind pm2's balancer | A crash never leaves zero instances up — kills "one crash takes everything down" for the web tier |
| Planned | Worker isolation (Phase 3) — merge/restore/refresh off the web process; the 700K pull in a child process | The riskiest, heaviest code can't crash the web tier at all |

Land the **small** + **strong** rows as a short workstream alongside Phase 3 — they're independent of the port
and can ship any time. Residual: a leak in *shared* code can still cycle all instances; watch memory, and if a
module proves a chronic risk, push its heavy part out-of-process (the same lever as merge).

---

## Phase 1 — Backend module (writes INLINE, dev interim)

| # | Step | Detail |
|---|---|---|
| 1 | Copy `store/*` into the module | Repoint `require('./db')` → `../../../store/db`; `data_dir` → `../../../data_dir` |
| 2 | Build `api.js` from the ~50 domain handlers | Re-namespace `/api/salesforce-merge/*`; wrap with `require_panel('merge')`. Writes still call `merge_execute`/`restore`/`refresh` **inline**, guarded by `MERGE_ENABLE_EXECUTION` |
| 3 | Drop auth/admin/status/login/metrics handlers | Platform owns them |
| 4 | Write `module.js` | id `merge`, group `Salesforce`, `panels:[{key:'merge',label:'Merge'}]`, `mount → api.js`, `menu()`, `warm()` |
| 5 | Register | Uncomment `merge` in `modules/registry.js` |
| 6 | Verify | Boot usat_apps; reads return data; a guarded merge runs end-to-end in a **sandbox org**; non-`merge` user blocked |

## Phase 2 — Frontend (drill-in rail + pages) → full parity

| # | Step | Detail |
|---|---|---|
| 1 | Copy 11 pages + domain components | fetch URLs → `/api/salesforce-merge/*`; imports → platform `../../lib/{api,track,theme}.js` |
| 2 | `Section.jsx` + `MergeRail.jsx` | **Drill-in replace**: on `/salesforce/merge/*`, render merge's own rail (with "‹ USAT Apps" back link) in place of the platform rail; nested routes for the 11 pages |
| 3 | Drop shell dupes | Login, Admin, TopNav, SideRail, UserMenu, ThemeToggle, FooterClock — use platform |
| 4 | Register + wire nav | `web/src/modules/registry.js`; point the Salesforce → Merge nav item at the Section (drop `ComingSoon`) |
| 5 | Web deps | Verify merge's chart libs are in `web/package.json`; add if missing |
| 6 | **Verify full parity** | Enter Merge (rail swaps), walk the wizard (Get duplicates → Select → Process), Restore, Tuning, EnvSwitch dev/prod, back link returns. **This is the go/no-go for the fold-in.** |

## Phase 3 — Break the writes out to a worker (the isolation)

_Only after Phase 2 parity is signed off. **Reuses the existing tables** — no new schema beyond a `queued` status + two claim columns on `salesforce_merge_run`. The Architecture and Folder-structure sections above are aligned to this._

### Decisions (this round)

- **User-triggered, not an auto-sweep.** The worker never decides on its own to merge approved sets. Work starts only when a user clicks *Process* (or *Restore*), which inserts one `queued` `salesforce_merge_run`. "Always-on" only means the worker process stays up polling for those **user-created** runs (no cold start) — it is an **executor**, not a sweeper or scheduler.
- **Reuse tables, don't add.** `salesforce_merge_queue`'s own schema comment already reserves the lifecycle `queued → approved → processing → done/failed → restored` for Phase 3. `salesforce_merge_run` already holds `kind` (merge/restore), `mode` (simulate/execute), `status`, live progress (`completed_ops`/`total_ops`/`current_label`), `created_by`, timestamps — and the UI already polls it. **Only change:** add a `queued` status (the "go" signal) plus `claimed_by` / `claimed_at` columns to `salesforce_merge_run`. No new table.
- **One worker for merge + restore.** Both are Salesforce-write execution and share `salesforce_write`; restore is just `kind='restore'`. So a single `salesforce_merge_worker` covers both — no separate `salesforce_restore_worker`. Refresh stays out of scope (it already delegates to `salesforce_duplicates` 8017).
- **Fleet naming convention** (mirrors `salesforce_duplicates`): worker code in `src/salesforce_merge_worker/`; entry `server_salesforce_merge_worker_8021.js` at repo root; pm2 name `salesforce_merge_worker`; tiny `/health` on port **8021** (freed by the `/reporting` retirement) so it appears in Ops/pm2 like every other service.
- **Multi-worker built in from day one.** The coordination is core, not a retrofit: every run is claimed atomically — `UPDATE salesforce_merge_run SET status='running', claimed_by=? WHERE status='queued' … LIMIT 1` — with `claimed_by`/`claimed_at`, so any number of `salesforce_merge_worker` pm2 instances can run side by side without ever double-claiming. Scaling is a **config change** (pm2 `instances`), never a code change. The instance *count* is the only knob: start at 1 for merges (row-lock safety — see the caution), raise it deliberately; refresh/restore can run alongside merges freely.
- **Scheduler deferred** (not this phase). The always-on worker is the right host later: a timer that inserts a `queued` `salesforce_merge_run` at the scheduled time — the same path the button uses. Seam designed now, built later.

### What the worker *is*

A plain Node process (no Express beyond the optional `/health` route). On boot it opens the shared DB pool and runs a **poll loop**: each tick it atomically claims one `queued` run, dispatches by `kind` to the existing `merge_execute` / `merge_restore`, streams progress into `salesforce_merge_run`, honors the cancel flag + `MERGE_ENABLE_EXECUTION`, then loops. Graceful shutdown on SIGTERM (finish the in-flight set, then exit) so pm2 restarts are safe. ~150 lines; it reuses the module's execution code rather than reimplementing it.

### Steps

| # | Step | Detail |
|---|---|---|
| 1 | Schema tweak (no new table) | Add `queued` to `salesforce_merge_run.status`; add `claimed_by VARCHAR(64)`, `claimed_at DATETIME` for the multi-worker claim |
| 2 | Worker folder | `src/salesforce_merge_worker/` — `loop.js` (poll + dispatch), `claim.js` (atomic claim / cancel / progress helpers). Imports the module's `merge_execute` / `merge_restore` / `salesforce_write` / `merge_run` (cross-tree require) |
| 3 | Entry + pm2 | `server_salesforce_merge_worker_8021.js` (repo root) boots the loop + a tiny `/health` on 8021; add `pm2_start_*` / `stop_*` scripts to `package.json` mirroring the other services |
| 4 | Flip endpoints to enqueue | `/merge/process`, `/merge/restore` → insert a `queued` `salesforce_merge_run` (params: ids, mode, env, created_by) instead of running inline; `/merge/progress` + `/merge/status` already read `merge_run`; `/merge/cancel` sets the cancel flag the worker checks |
| 5 | Guard the boundary | `api.js` stops importing `salesforce_write` / `merge_execute` / `merge_restore` — those become **worker-only** |
| 6 | Multi-worker toggle | pm2 `instances` (default 1); document the SF-lock caution before scaling merges > 1 |
| 7 | Verify | Start `salesforce_merge_worker`; click Process → a `queued` run appears → worker claims + runs (sandbox / `MERGE_ENABLE_EXECUTION=0` dry-run) → UI progress bar moves → cancel works → run ends `done` |

### Concurrency — two users at once

Each *Process* click creates its **own** `queued` run, stamped with `created_by`. With the default **single worker**, runs execute one at a time in FIFO order: user B's run waits behind user A's, and each user sees their own run's progress (others see “a merge run is in progress, started by A”). That serialization is deliberate — it sidesteps Salesforce row-lock contention entirely. Overlapping work is further guarded at the queue (`salesforce_merge_queue` dedups the same survivor/source, and `merge_execute` skips accounts already merged/gone). Concurrent runs only become possible if you scale to multiple workers — see the caution below.

### Salesforce concurrency caution (multi-worker)

The API **permits** concurrent workers within the org's concurrent-request and daily-call limits, **but merges that touch related or overlapping records can throw `UNABLE_TO_LOCK_ROW` when run in parallel.** So multi-worker is safe **across kinds** (a merge + a restore at once) and for **non-overlapping account sets** — but naive parallel merging of related clusters is not. Default to **one** merge worker; scale only by sharding non-overlapping survivors, and lean on the existing retry/error handling in `merge_execute`.

## Phase 4 — Metrics continuity

| # | Step | Detail |
|---|---|---|
| 1 | New usage → platform `track.js` | Tagged `panel:'merge'` → `usat_apps_events` |
| 2 | `salesforce_merge_events` history | **Archive** (rec.) or backfill into `usat_apps_events` |
| 3 | Funnel domain card (optional) | Keep merge's Funnels as a `merge`-scoped view on the platform Metrics dashboard |

## Phase 5 — Tests

Port merge's **no-DB unit tests** (~18 files) into `modules/salesforce_merge/tests/`, **plus new tests for the
worker claim/dispatch** (stub the SF write) and the `queued` → `running` → `done` transitions on
`salesforce_merge_run`. Skip tests that duplicate platform auth. Wire into `usat_apps_test`.

## Phase 6 — Retire standalone merge (8020) — ONLY after Phase 3 is verified

Mirror the `/reporting` retirement runbook: parity check → `pm2 stop/delete salesforce_merge` → remove
`salesforce_merge_*` scripts from `package.json` + `.vscode` → un-proxy `/merge` → delete
`server_salesforce_merge_8020.js` + `src/salesforce_merge/` → retire `MERGE_*` **auth** env vars (**keep the
`SF_*` credentials** — the worker needs them) → drop/keep `salesforce_merge_events`. Reversible until the delete.

---

## Salesforce connection & the future External Client App — no barrier

**Today:** `store/salesforce_read.js` + `salesforce_write.js` use **jsforce username/password + security token**
(`conn.login(user, pass+token)`), toggled per org by the EnvSwitch via `SF_DEV_*` / `SF_PROD_*` (separate read
vs. `SF_*_WRITE_*` creds).

| Layer | Authenticates | Where it lives | Touched by the fold-in? |
|---|---|---|---|
| Platform login (session / future MS SSO) | the human | platform shell | **Yes** — merge drops its own login |
| Salesforce API connection (jsforce → SF) | the server to Salesforce | merge module (`store/salesforce_*.js` + `SF_*` env) | **No** — moves in unchanged (worker uses it) |

Creating a Salesforce **External Client App** (OAuth) later is **orthogonal** — nothing here blocks it. Steps
in the appendix.

---

## Salesforce identity, permissions & API visibility

### Who Salesforce thinks is acting

Today merge connects with a **shared integration (service) account** (`SF_*_USERNAME` + password/token), so
Salesforce sees *that one account* on every merge — not the usat_apps user who clicked. The real actor is
tracked **inside usat_apps** (`created_by` on the queue/run/history rows) and tool access is gated by the
`merge` panel. So permission enforcement is at the **app layer**, and Salesforce applies the **service
account's** object permissions.

| Model | SF sees the real user? | SF enforces per-user perms? | Cost |
|---|---|---|---|
| **Service account (today)** | No — one integration user | No — service account's perms; app gates access | Simplest; no per-user SF login |
| **Stamp the actor (recommended add)** | Traceable — write `created_by` into the merge record / notes / a custom field | No | Tiny; keeps the service account |
| Per-user SF OAuth (future) | Yes — each user connects their own SF identity; merges run as them | Yes — SF audit + permissions per user | Every user needs an SF login + one-time consent; auth-code flow through the proxy (see the appendix) |

**Recommendation:** keep the service account and **stamp the acting usat_apps user** into the merge record
(already stamped in our tables; optionally mirror into an SF field/notes for SF-side traceability). Move to
per-user OAuth only if you need Salesforce itself to enforce each user's permissions or to show the real user
in SF's audit trail.

**Which option an External Client App gives you** — the app itself doesn't decide; the **OAuth flow** does. The recommended **JWT bearer** flow is still the *service account* (rows 1–2): Salesforce sees one integration user, just certificate-authenticated instead of password. Only the **authorization-code (per-user login)** flow gives you row 3. So setting up the External App the recommended way keeps you on **service account + stamp the actor**.

**"Stamp the actor" = a physical custom field**, the same mechanism as merge's existing `STAMP_FIELDS` (the optional "was merged" flag + date an admin creates in Salesforce, checked via `/api/merge/stamp-fields`). Add one more — e.g. `Merged_By__c` — and write the usat_apps username to it during the merge, alongside the was-merged stamps.

### Pull Salesforce API usage into the app

Salesforce exposes its own API consumption, and we can surface it in this app — both read-only and cheap:

- **Limits API** — `GET /services/data/vXX.0/limits` returns `DailyApiRequests: { Max, Remaining }`
  (jsforce: `conn.limits()`). A small read endpoint (`/api/salesforce-merge/sf-limits`) can return used/remaining
  for a dashboard or Ops card (“SF API today: 12,340 / 100,000”).
- **Per-response header** — every SF call returns `Sforce-Limit-Info: api-usage=used/max`. Reading it before/after
  a run and diffing gives **API calls per merge run**, which we can store on `salesforce_merge_run` (e.g. an
  `api_calls` column) and show in history.

Suggested: a live **SF API usage** card (Limits API) on the merge dashboard, plus optional per-run call counts.
Build alongside Phase 3 or as a fast follow.

---

## Open decisions (recommendations)

1. **Metrics table:** new merge usage → shared `usat_apps_events` tagged `panel:merge` (**rec.**), or keep `salesforce_merge_events`?
2. **Merge history:** archive `salesforce_merge_events` (**rec.**) or backfill into `usat_apps_events`?
3. **Salesforce identity:** service account + stamp actor (**rec.**), or per-user OAuth (SF-side audit/permissions)?

## Scope note

Largest of the ports (≈3× participation-maps). The only genuinely new code in Phase 3 is the worker
(`src/salesforce_merge_worker/`) + two columns on `salesforce_merge_run` — no new table. Everything else is
copy → repoint imports → re-namespace routes → drop the shell/auth dupes → register.

---

## Appendix — Create the Salesforce External Client App (OPTIONAL — NOT part of the port)

_Not required to fold merge in. The port ships with today's username/password + token auth. Do this **later**
as a security upgrade (removes stored SF passwords from `.env`). Recommended flow: **JWT bearer**,
server-to-server, no redirect URI._

### A. Salesforce side (per org — Dev and Prod)
1. Setup → App Manager → **New External Client App** (or Connected App if the org predates ECAs).
2. Enable OAuth. Scopes: `api` (+ `refresh_token, offline_access` if you want refresh).
3. Enable **"Use digital signatures"** and upload the public cert (x509) — turns on the JWT bearer flow. No callback needed for JWT.
4. Save; copy the **Consumer Key** (= `client_id`).
5. OAuth policies → **Admin pre-authorized**; permit the integration user's profile / perm-set (skips consent).
6. Confirm that user has the perms merge needs: Account read + merge/delete + undelete.

### B. Server side (once)
1. Keypair (repeat for prod): `openssl req -x509 -newkey rsa:2048 -keyout sf_jwt_dev.key -out sf_jwt_dev.crt -days 3650 -nodes -subj "/CN=usat-merge-dev"`. Upload the `.crt`; keep the `.key` server-only.
2. Env, mirroring DEV/PROD: `SF_DEV_CLIENT_ID`, `SF_DEV_JWT_USER`, `SF_DEV_JWT_KEY_PATH` (+ `SF_PROD_*`). Replace `SF_*_PASSWORD` / `SF_*_SECURITY_TOKEN` after cutover; keep old until verified.
3. Mint a signed JWT (`aud`=login URL, `iss`=client_id, `sub`=integration user, `exp` ≤ 3 min), POST to `<loginUrl>/services/oauth2/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` → `access_token` + `instance_url`.
4. `new jsforce.Connection({ instanceUrl, accessToken })`. Rest of read/write unchanged.

### C. Where it plugs in (blast radius = 2 files + 1 helper)
- Confined to `store/salesforce_read.js` + `salesforce_write.js` + one new `sf_token.js`. No route/page/platform change. EnvSwitch untouched.

### D. Rollback / safety
- Keep username/password creds until verified; a `SF_AUTH_MODE=jwt|password` flag gives a one-line fallback.
- Payoff: removes plaintext SF passwords from the environment.

**Sequencing:** port first (Phases 1–6) with existing auth; introduce the External Client App any time after —
ideally right after fold-in, when the SF creds consolidate into the single usat_apps `.env` (8022).
