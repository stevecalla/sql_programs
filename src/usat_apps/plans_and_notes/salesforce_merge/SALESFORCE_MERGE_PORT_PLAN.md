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
| **Architecture** | **Fold in the UI + reads + auth** as a module first (writes inline), **then isolate the writes** — merge/restore/refresh move to a **separate worker process**. Two-step rollout (below). |
| **Sequencing** | **Port first, isolate second.** Phases 1–2 port the whole app (writes inline, dev-only). Phase 3 breaks the writes out. Prod stays on **8020** until the breakout is verified. |
| **Admin** | **Not ported.** Platform Admin → Users & access owns users; merge is gated on the `merge` panel. |
| **API namespace** | `/api/salesforce-merge/*`. |

Still open (recommendations at the end): metrics table, merge-history handling.

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
| Worker process (Phase 3) | `worker_salesforce_merge.js` → pm2 name `merge_worker` (execute/restore) |
| Refresh worker (Phase 3) | `worker_salesforce_refresh.js` → pm2 name `refresh_worker` (spawns the detection CLIs / the 700K pull) |
| Detection CLIs (kept ETL dep) | `src/salesforce_duplicates/step_1_find_duplicates.js`, `sweep_duplicates.js` |
| Execution-jobs table (Phase 3) | `merge_jobs` |

---

## Architecture — folded-in UI, isolated write/refresh worker (end state)

The web tier (usat_apps monolith, 8022) hosts the merge **module**: all reads, previews, and the UI. In the
**end state** it **never opens a Salesforce write connection** — every destructive or long-running action is a
**job** a separate **worker process** performs. One repo, one `.env`, two pm2 processes.

**Rollout order (why we don't build the worker on day one):**

- **Step 1 (Phases 1–2, dev only):** port the app with writes **inline** (execute/restore/refresh run in the request, guarded by `MERGE_ENABLE_EXECUTION`). This proves the fold-in — UI, auth, reads, writes — against known-good behavior, fast. Prod merge traffic stays on 8020.
- **Step 2 (Phase 3):** flip writes to the worker + job queue. A self-contained refactor you diff against the just-ported version. Only after this is verified do you retire 8020 (Phase 6) — so the monolith **never runs destructive SF writes in production**.

**End-state job flow:**

1. User approves merges → `POST /api/salesforce-merge/merge/process` → `api.js` **enqueues** a row in `merge_jobs` (`queued`), returns immediately.
2. `worker_salesforce_merge.js` (pm2 `merge_worker`) runs `worker/run_jobs.js`: atomically **claims** a job, runs `merge_execute`/`merge_restore`/`refresh_runner`, writes **progress + result** back, sets `done`/`error`. Guarded by `MERGE_ENABLE_EXECUTION`.
3. UI polls `GET /api/salesforce-merge/merge/progress|status` → reads `merge_jobs`. Cancel = set `cancel_requested`, which the worker checks between records.

**Why the isolation matters:** a stuck refresh or bad merge run can't take the web tier down, and a web
deploy can't kill an in-flight merge.

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

**Recommendation:** give the pull/detection its **own** worker — `refresh_worker` — separate from the
`merge_worker` that runs execute/restore. Different workloads (refresh = heavy, batch, often scheduled;
merge = interactive, transactional), so a long pull can't delay a merge and each gets its own memory limit and
schedule. Both are still just spawn-and-monitor around the real work, which stays in the child process.
`src/salesforce_duplicates/` stays in the repo — the ETL the pull depends on, same as participation kept
`src/participation_data`.

---

## Target folder structure (end state, after Phase 3)

```
repo root/
  server_usat_apps_8022.js            # platform web server (unchanged) — hosts the merge MODULE (UI + reads + writes*)
  worker_salesforce_merge.js          # Phase 3 — pm2 "merge_worker" — runs execute/restore jobs
  worker_salesforce_refresh.js        # Phase 3 — pm2 "refresh_worker" — orchestrates the SF detection/data pulls

  src/usat_apps/
    modules/
      registry.js                     # uncomment `merge`
      salesforce_merge/
        module.js                     # manifest: id 'merge', group 'Salesforce', panels, mount()=web routes, menu(), warm()
        api.js                        # WEB routes /api/salesforce-merge/* (Phase 1: calls writes inline; Phase 3: enqueues)
        menu.js                       # ops/ETL items (trigger a refresh, etc.)
        worker/
          run_jobs.js                 # Phase 3 — worker loop: claim job -> execute -> write status/progress back
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
          job_queue.js                # Phase 3 — enqueue / claim / complete EXECUTION jobs (DB-backed)
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
    query_create_merge_jobs_table.js  # Phase 3 — merge_jobs DDL (job_type, payload, status, progress, result, cancel_requested, timestamps)

  src/salesforce_duplicates/          # KEEP — detection CLIs the refresh SPAWNS (the actual 700K SF pull); ETL dep, like participation_data
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

_Only after Phase 2 parity is signed off. Self-contained refactor; diff behavior against the Phase-2 build._

| # | Step | Detail |
|---|---|---|
| 1 | `merge_jobs` table | New DDL: `job_type`, `payload` JSON, `status`, `progress`, `result`, `cancel_requested`, `created_at_*`, `claimed_at`, `finished_at` |
| 2 | `store/job_queue.js` | `enqueue()`, `claim_next()` (atomic), `set_progress()`, `complete()/fail()`, `request_cancel()` |
| 3 | `worker/run_jobs.js` | Poll loop: claim → dispatch → progress → complete. Honors `cancel_requested` + `MERGE_ENABLE_EXECUTION` |
| 4 | **Two workers** (repo root) | `worker_salesforce_merge.js` (pm2 `merge_worker`) for execute/restore; `worker_salesforce_refresh.js` (pm2 `refresh_worker`) for the SF detection/data pulls (spawns the `salesforce_duplicates` CLIs). Both read `merge_jobs`, routed by `job_type` |
| 5 | Flip endpoints to enqueue | `/merge/process`, `/merge/restore`, `/refresh/start` → **enqueue**; `/merge/progress`, `/merge/status`, `/refresh/status` → **read `merge_jobs`**; `/merge/cancel`, `/refresh/cancel` → set `cancel_requested` |
| 6 | Guard the boundary | `api.js` imports only web-safe store modules; `salesforce_write.js` + execute/restore/run/refresh imported **only** by the worker |
| 7 | Verify | Start `merge_worker`; enqueue a merge → worker claims + runs → UI shows progress → cancel works |

## Phase 4 — Metrics continuity

| # | Step | Detail |
|---|---|---|
| 1 | New usage → platform `track.js` | Tagged `panel: