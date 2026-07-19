# Parallel merge workers — MVP plan

Turn the proven pm2-cluster parallelism (validated by the stress harness) into a real product
capability: when a user runs a merge job, it **auto-splits into parallel batches** that a running
worker cluster drains side by side. Transparent to end users (no knob they can change); tunable live
by an admin (no env-var round-trips); with an admin-only **Merge Ops** panel that adds settings, a
live worker view, and direct parallel-batch control.

## Decisions (locked)

- **Admin panel scope:** BOTH — live settings editor + read-only worker view + admin batch-run control.
- **Default chunk size:** 5 sets per parallel batch, **editable live** in the panel (not an env round-trip).
- **Worker cluster:** target **4 workers**, **scalable on the fly** from the panel (`pm2 scale`), and the
  app stays cluster-agnostic (it chunks; whatever workers exist drain).
- **Access:** the Merge Ops panel is **grantable in Users & Access** (a new `merge-ops` panel key in the
  access catalog; opt-in, not default-on).
- **Docs:** this file + a Reference-panel section.

## Why it fits the existing architecture

The write worker already runs as a separate process (`:8021`) from the web app (`:8022`), and the queue
claim (`merge_run.claim_next`) is atomic + race-safe with lock-retry (`salesforce_write.merge_one`). So
"go parallel" is **more of what already exists, fed differently** — not a rearchitecture. The stress
harness proved the model end-to-end (both merges and restores) without touching merge logic.

Today `/merge/process` enqueues **one** `salesforce_merge_run` holding every selected set; a single
worker drains it start to finish. Progress polls that one run; cancel flags that one run; the only knob
is the `MERGE_MAX_BATCH` env var.

## Core idea: a "job" = N chunk-runs sharing a `job_id`

A user-facing job fans out into several `salesforce_merge_run` rows that share a `job_id`. The cluster
drains them concurrently; the UI aggregates them back into one job. Small jobs (or parallel disabled)
collapse to a single run — **byte-identical to today** (behavior-preserving fallback).

```
Execute (200 sets, chunk_size 5, parallel on)
  → 40 chunk-runs, job_id = job-<ts>-<rand>, batch_index 1..40
  → pm2 cluster (4 workers) claims + drains them
  → UI polls /merge/job/<job_id>/progress → one aggregate bar + "4 workers active"
```

---

## Phase 1 — Auto-split + job grouping (the engine)

**Schema (additive, like `claimed_by`/`params` were):** add to `salesforce_merge_run`
- `job_id VARCHAR(40) NULL` (groups the chunk-runs; NULL = legacy single run)
- `batch_index INT NULL`, `batch_total INT NULL` (position within the job, for display)
Migration file under `src/queries/create_drop_db_table/` + an idempotent `ensure()` ALTER (same pattern
as `alter_salesforce_merge_run_phase3.js`).

**Chunker** (pure, unit-tested): `plan_job(ids, chunk_size)` → array of id-arrays. Reuse the stress
harness `plan_batches` logic (already tested) so there's one chunker, not two.

**`/merge/process` change:** resolve `parallel_enabled` + `chunk_size` from settings (Phase 2). If off or
`ids.length <= chunk_size`, enqueue one run (today's path). Otherwise chunk and enqueue **one run per
chunk** sharing a fresh `job_id`; return `{ job_id, runs: N }`. Keep the `max_batch` job-cap guard.

**Progress (job-aware):** `GET /merge/job/:jobId/progress` sums `completed_sets`/`total_sets` across the
child runs, reports `runs_done/runs_total`, and counts **active workers** via the `claimed_by` pid-prefix
trick already built for the harness (`active_worker_count`). Old single-run `/merge/progress` stays for
back-compat.

**Cancel-all:** `POST /merge/job/:jobId/cancel` flags `cancel_requested` on every child run (the worker
already honors it at the set boundary). Old single-run cancel stays.

**Restore / recreate:** route them through the same chunker (the harness already parallelizes restores),
so restore jobs fan out too.

**Tests:** chunker; job progress aggregation; cancel-all; a parity test that `parallel_enabled=false`
produces exactly one run (behavior-preserving).

---

## Phase 2 — Settings store (live admin control, no env vars)

**Table `salesforce_merge_settings`** (`skey VARCHAR PK, sval TEXT, updated_at, updated_by`) with an
**env fallback resolver**: `settings.get(key)` = DB value → `process.env.<ENV>` → hard default. Every read
of `MERGE_MAX_BATCH`, `MERGE_APEX_PER_SET`, etc. goes through it, so a panel edit takes effect on the next
run with no redeploy. Injectable executor for tests (same style as the other stores).

MVP keys:

| key | default | env fallback | meaning |
|---|---|---|---|
| `parallel_enabled` | `true` | `MERGE_PARALLEL` | master on/off (the live **kill switch**) |
| `chunk_size` | `5` | `MERGE_CHUNK_SIZE` | sets per parallel batch |
| `max_batch` | `100` | `MERGE_MAX_BATCH` | max sets one job may run (hard cap 500) |
| `worker_target` | `4` | `MERGE_WORKER_TARGET` | desired cluster size (drives `pm2 scale`, informational otherwise) |
| `apex_stop_enabled` | `true` | `MERGE_APEX_STOP` | async-Apex circuit breaker on/off |
| `apex_stop_threshold` | `200000` | `MERGE_APEX_STOP_AT` | pause a job when DailyAsyncApexExecutions used reaches this (clamped 1k..250k) |

### Async-Apex circuit breaker — pause + resume (built in Phase 1)

Rather than a hard stop, a job **pauses and is resumable**. When `DailyAsyncApexExecutions` used reaches
`apex_stop_threshold` (`merge_settings.apex_should_pause`), the worker calls `merge_run.hold_job`: every
still-queued chunk is parked as **`held`**, and any running chunk is flagged to stop at its next set
boundary (the in-flight set finishes cleanly — nothing half-written). `job_progress` then reports status
**`paused`** with a `runs_held` count. **Resume** (`merge_run.resume_job`, `POST .../job/:id/resume`) puts
the held chunks back to `queued` so the cluster drains them again — sets already merged are `done` and
drop out via the executor's drift check, so resume safely continues with only what's left. Nothing is
discarded; you resume when headroom returns or the daily counter rolls over.

**Admin API:** `GET/PUT /api/salesforce-merge/ops/settings`, gated to the `merge-ops` panel. Values are
validated + clamped (chunk_size 1..50, max_batch 1..500, worker_target 1..8).

---

## Phase 3 — Admin-only "Merge Ops" panel (BOTH features)

New route `/salesforce/merge-ops` (nested under the Merge section), rendered from a new
`pages/MergeOps.jsx`. Three cards:

1. **Settings** — live editors for `parallel_enabled`, `chunk_size`, `max_batch`, `worker_target`. Save →
   `PUT ops/settings`. Shows the resolved source (DB vs env-default) per value so it's clear what's overridden.
2. **Workers (live)** — workers online, active runs, queue depth, and (during a job) the worker split —
   reusing `active_worker_count`/`format_worker_balance`. Poll `GET ops/workers`.
3. **Batch run control** — kick a parallel run against approved sets straight from the UI (the productized
   stress-harness `parallel` path): pick count/chunk size, Simulate/Execute (same typed-confirm + Execute
   gates), watch aggregate progress + worker split. Reuses the Phase-1 job endpoints.

**On-the-fly worker scaling:** a "Workers: N" control that runs `pm2 scale salesforce_merge_worker N`
server-side (bounded 1..8, admin-gated) and reads the live count back. This is the ONE place the app
shells to pm2 — isolated, guarded, best-effort, and never in the merge write path.

### Access control (Users & Access)

- Add a `merge-ops` key to the `CATALOG` in `access/panel_access.js` (label "Merge Ops", group
  "Salesforce"), and add it to `DEFAULT_ALL_EXCLUDE` so it is **opt-in** (not part of the default "all"
  grant). Admins always see it; everyone else needs an explicit grant.
- Add the nav entry with `panel: 'merge-ops'`. It then appears **automatically** in the Users & Access
  page (`/admin/users`, `Admin.jsx`), because that page renders the access catalog — no extra wiring.
- All `ops/*` API routes gate through the existing `require_auth` → `panel_access.is_allowed(user, role,
  'merge-ops')`.

---

## Phase 4 — End-user surfacing (transparent, no controls)

Process Merges progress becomes **job-aware**: one aggregate bar (sets done / total across the child
runs), a live **"N workers active"** line, elapsed + ETA — the user just sees it go faster, with no
parallelism knob. The Cancel button calls cancel-all for the job. If `parallel_enabled=false`, the UI is
exactly today's single-run view.

---

## Guardrails

- **Concurrency cap** via `worker_target` (1..8) + the modest cluster; lock-retry already absorbs the
  occasional shared-parent contention (dlrs/Cirrus rollups). We saw zero lock-retries through 4 workers
  in sandbox.
- **Async Apex budget:** parallelism spends the *same total* Apex, just faster, so a big job approaches
  the daily `DailyAsyncApexExecutions` cap sooner. The pre-flight already estimates Apex — keep it as the
  gate and warn when a fast parallel burn would cross the daily limit.
- **Kill switch:** `parallel_enabled=false` (instant, DB) reverts every job to single-run — no redeploy.
- **Claim safety:** unchanged — `claim_next` is a single conditional UPDATE, so no set is ever double-run.

## Rollout

1. Phase 1 + 2 behind `parallel_enabled` (default off in production until validated).
2. Sandbox: run real UI merges (not just the harness) at chunk_size 5 with 2 → 4 workers; confirm
   aggregate progress, cancel-all, and zero double-processing.
3. Flip production default cluster to `pm2 -i 4` (the `pm2_start_salesforce_merge_worker_cluster` script),
   enable `parallel_enabled`, watch the first production job.
4. Fast-follow: auto-scale `worker_target` by job size if desired.

## Measurement

Report the **reliable** metrics (concurrency-proof): throughput (merges/min) and seconds/merge (median
batch). Treat the org-wide API/Apex counters as daily-headroom context, not per-merge precision — a clean
per-merge API figure comes from a serial calibration run. (See the stress-harness notes.)

## Test matrix

- Unit: chunker; settings resolver (DB→env→default); job progress aggregation; cancel-all; parallel-off
  parity (one run).
- Integration (sandbox): UI Execute fan-out; worker scaling via panel; access grant/deny for `merge-ops`.
