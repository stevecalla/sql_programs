# Merge Management Tool — Plan

**Status:** BUILT and going live — this doc is retained as the original architecture/decision record.
What shipped beyond the original draft: the review pages (Dashboard, Duplicates, Merge-ID, All
accounts, Tuning), the staged-merge workflow (Select → Process → Restore), and **multi-user auth
with per-panel access control** (`.env` recovery admins + file-backed scrypt users, `panel_access.json`
default/overrides, enforced in the nav and server-side; managed from `/admin` or the `admin.js`
CLI / menu). See the tool's `README.md` for current usage. The read-vs-write safety model below
still holds: the duplicates pipeline is untouched and the Apex `Database.merge` call is the single
write chokepoint.

## Purpose

A web admin tool — templated on the email-queue app's `/`, `/metrics`, `/admin` pattern —
that lets a reviewer:

- review all accounts,
- review accounts that carry a Salesforce merge ID,
- review the duplicates our pipeline found,
- manage and initiate the merge process,
- keep a history of what was merged, and
- (best-effort) restore merged accounts across related objects.

It builds on the existing read-only duplicates pipeline and reuses `usat_sales_db`. It does
**not** change how duplicates are detected — it sits on top as a separate management layer.

## Decided stack + roadmap (locked)

**Decisions (locked):**
- **Foundation now, consolidation-ready.** Build the merge tool as the **reference app** for the
  repo's planned consolidated front-end (Project C / usat-app).
- **Front-end: Vite + React** — first React app in the repo, deliberately, to avoid a later
  vanilla→React rewrite. Its `/metrics` and `/admin` pages become the templates the other apps
  copy when they fold in.
- **Backend: mirror the email-queue app's conventions** — Express `server_salesforce_merge_8020.js`,
  JSON API (`/api/...`), reuse its `auth/session`, the `/metrics` analytics stack
  (`utilities/analytics/*`), `/admin` hub, MySQL, jsforce. The React app **builds to static
  assets the Express server serves** — same runtime shape as email-queue ("static SPA + JSON
  API"), so the proxy/Cloudflare/deploy story is unchanged; Vite just adds a build step.
- **Master selection is deterministic:** winner = account where `Id == merge_id`; losers = same
  `merge_id`, `Id != merge_id`.
- **Merge execution:** prototype Node-SOAP `merge()` and the Apex wrapper in the sandbox, then pick.
- **Worker reliability (stale-claim reaper):** the run row carries a `heartbeat_at` that every
  progress update refreshes; the worker loop calls `merge_run.reap_stale(MERGE_WORKER_STALE_SECONDS,
  default 600)` each tick to **fail** any run stuck `running` with no heartbeat past the threshold — the
  signature of a worker that died mid-run (crash/OOM/reboot), which the in-loop try/catch can't catch.
  Reaping only fails the run row (unsticks the UI); the queued sets stay `approved` and can be
  re-selected — safe because the add-dedup + drift checks prevent double-processing. Multi-worker safe
  (a live run's heartbeat is always fresh).
- **Env/org alignment (verified):** every queue entry stores the `environment` **and** the Salesforce
  `org_id` it was staged from (captured at add — both the single-add and bulk-add routes resolve it via
  `resolve_org_id`); `verify_alignment` refuses to execute a set unless both match the connected org, so
  a set built in one sandbox can't run against a different/refreshed sandbox or Production.
- **Merge drift check:** queueing captures a stage-time field baseline
  (`store/merge_stage_baseline.js`) for single **and** bulk adds; at process time the run diffs live vs
  that baseline on a canonical identity field set (shape-robust; scope = email, member #, name, DOB,
  gender, ZIP, address, merge id — not every field) and surfaces any field that changed
  since staging in the progress bar, per-set badge, run summary, and history. Execute **skips drifted
  sets by default** (left approved); an operator acknowledges via a checkbox (`ack_drift`) to merge
  them anyway. Mirror of the restore diff, opposite direction.
- **Restore:** two tiers (≤15-day undelete + backup recreate) from a deep pre-merge snapshot. A
  read-only **restore diff / drift check** (`store/restore_diff.js`, `GET …/merge/restore/diff`,
  `RestoreDiffDetail.jsx`) lets an operator expand any completed merge to compare the survivor's
  current live values against the pre-merge snapshot field by field — "in sync" (a restore changes
  nothing) vs the fields a restore would reset (and any edited after the merge that a blind restore
  would overwrite). See `README_RESTORE_DIFF.md`.
- **Contact-point preservation** gated by a configurable `high_value_flags` list (donor, …).
- **Salesforce auth:** start simple (username/password) in sandbox; add a **Connected App
  (OAuth JWT, least-privilege write user) before production**. (Independent of the React choice.)
- **Env switch:** Sandbox default; Production behind extra guardrails; writes off by default.

**Roadmap:**
- **Phase 0 (first step) — read-only foundation scaffold.** Express server skeleton +
  Vite/React app shell (nav, env switch, auth gate, layout) + a working **Dashboard** reading the
  **existing** `salesforce_duplicate_*` MySQL tables. No Salesforce calls, no writes, no Connected
  App needed yet.
- **Phase 1 — review pages:** duplicates, merge-ID reconciliation, all-accounts (over the JSON
  API + DB), plus the `/metrics` and `/admin` layers (reuse `utilities/analytics`).
- **Phase 2 — per-cluster deep fetch from Salesforce (read) + dry-run merge preview** (field
  survivorship + child-record impact).
- **Phase 3 — sandboxed execute** (Node-SOAP and/or Apex) + deep pre-merge snapshot + history/
  audit. Writes gated (`ENABLE_MERGE_EXECUTION`, dry-run, confirm token).
- **Phase 4 — restore** (two tiers) + Contact-Point preservation.
- **Phase 5 — harden + production** behind the Connected App; later fold into Project C.

**Still open (don't block Phase 0):** which apps port into Project C and in what order; shell
SSO/auth source; Person-Accounts-only vs other objects; the donor/high-value flag API names;
restore default when no flag matches.

## Feasibility / stack

All on the existing stack: **Node/JS + Express** (same shape as the email-queue app),
**MySQL** (`mysql2`, `usat_sales_db`) for state/history, **jsforce** for Salesforce I/O.
The one addition: the actual merge is executed by a small **Salesforce Apex REST endpoint**
(`Database.merge`), invoked by the Node worker — because `Database.merge` natively handles
Person Accounts, reparents child records in one transaction, and lets us control the master
and field survivorship. Node orchestrates and logs; Salesforce performs the destructive step.

Conventions follow the rest of the repo: **snake_case** for files, identifiers, and table
names; config `ENABLE_*` flags; pure/testable modules; tests + docs alongside each change.

## Read vs write — the safety model (core requirement)

This tool is the first part of the system that **writes** to Salesforce (the duplicates
pipeline is strictly read-only). The destructive surface (merge, restore) is isolated behind
hard guardrails:

- **The existing read-only pipeline is untouched.** Detection, the snapshot table, and the
  result tables stay exactly as they are (regression-safe). This tool only *reads* them.
- **Separate read and write paths in code.** All Salesforce writes go through a single
  chokepoint module (e.g. `src/merge_execute.js`) — nothing else is allowed to call a write
  API. Review/browse code can only read.
- **Least-privilege Salesforce access.** Review pages use a read-only integration user; the
  merge worker uses a separate write-enabled user/connected app. Credentials are distinct so
  a misconfigured review page physically cannot merge.
- **Config-gated execution.** Writes are off by default: `ENABLE_MERGE_EXECUTION = false`
  and a `DRY_RUN` default of `true`, mirroring the existing `ENABLE_*` flag pattern. A real
  merge requires the flag on AND dry-run off AND explicit confirmation.
- **Mandatory dry-run / preview before any merge.** Preview shows the chosen master, field
  survivorship, and the child-record impact. Execution consumes a confirmation token minted
  by the preview ("two-key" style) so you can't execute without previewing.
- **Sandbox first.** Every write path is exercised against the dev sandbox before prod, the
  same way the finder distinguishes `--test` / `--prod`.
- **DB isolation.** This tool's writes go only to its **new** tables; it never mutates the
  existing snapshot/result tables.
- **Full audit + idempotency.** Every merge/restore job is logged immutably (who, when,
  master, merged IDs, decisions, child counts, status) and is idempotent/retry-safe so a
  re-run can't double-merge.
- **Admin-only auth + rate limiting**, respecting Salesforce governor limits.

## Architecture overview

Mirrors the email-queue app, extended:

- `/` dashboard — totals: accounts, accounts with merge IDs, duplicate clusters pending,
  merges done/failed, restorable window.
- `/metrics` — throughput + health (merges/day, success vs fail, avg cluster size, API/
  governor usage).
- `/admin` — the console: browse clusters → pick master → preview survivorship + impact →
  confirm → execute → see it in history.
- review routes — review all accounts / merge-ID accounts / duplicates (read the existing
  MySQL tables: `salesforce_account_duplicate_snapshot`, `salesforce_duplicate_consolidated_cluster`,
  `salesforce_duplicate_merge_id_review`), plus merge history and restore.

New MySQL tables (snake_case, in `usat_sales_db`; names spelled out, no abbreviations):

- `salesforce_merge_job_queue` — queued/in-progress/done merge jobs (mirrors the email-queue
  pattern: a DB-backed queue + a worker).
- `salesforce_merge_history` — immutable audit log, one row per executed merge.
- `salesforce_merge_premerge_snapshot` — pre-merge JSON snapshot of the losing records + their
  child relationships + the master's field values (the basis for restore).
- `salesforce_merge_restore_log` — restore attempts + outcomes.

## Build it as a shared app shell (consolidated front-end) — recommended

Since we want to consolidate the repo's separate web pages into one front-end, **yes — build
this as a modular "app shell" from the start, not a one-off.** The merge console becomes the
first *module* in a shared shell that other apps (the email-queue app, the duplicates Slack/
report, future tools) can be added into.

**Shape:**

- **One Express server + a shared shell** providing the cross-cutting pieces once: top nav,
  auth/session, the Sandbox⇄Production env switch, layout + styling, the shared MySQL pool, a
  jsforce connection factory (read-only vs write users), structured logging/audit, and error
  handling.
- **Each tool = a self-contained module** mounted under a route prefix (`/merge`,
  `/email-queue`, `/duplicates`, `/<future>`), exposing its own router + views + optional
  worker. The shell composes them; modules don't know about each other.
- **A module registry/manifest.** Each module declares: name, base route, nav label, required
  role, env support, and health/metrics hooks. The shell builds the nav, the `/` dashboard,
  and `/metrics` *from the registry* — so adding an app = drop in a module + register it.
- **Shared UI kit** = header/nav/footer + a table component (search + sort + paging baked in)
  + cards. Every app looks the same and every table gets search/sort for free (satisfies the
  table-conventions requirement once, centrally).
- **Shared job-queue framework.** The email-queue and the merge queue are the same DB-backed
  queue + worker pattern — build it once in the shell, reuse per module.
- **Safety model stays at the shell level:** read modules are unaffected; write modules
  (merge) are gated (`ENABLE_*`, dry-run, per-env confirm) — see Read vs write.

**Approach: strangler-fig, not big-bang.** Build the shell + the merge module first. Then port
the existing apps into modules one at a time; the old apps keep running until each is moved.
Stack is unchanged (Node/Express + MySQL + jsforce); Express routers are the natural module
boundary, in a `modules/<name>/` layout. Server-rendered pages + light JS for tables (matching
the current apps) — no heavy SPA framework needed unless we later want one.

**Naming:** the "Account Merge Console" is really *module 1* of a broader "USAT Ops/Admin
Console." The mockups show the merge module's pages; the shell adds an app switcher around them.

(Decision to confirm — see "To revisit": commit to the shell now, or build merge stand-alone
first and refactor into a shell later. Building shell-ready now is cheaper than retrofitting.)

### Front-end framework — React (for the consolidated shell)

If we commit to one consolidated front-end, **React is a good fit** for the shell — provided we
also split the backend into a JSON API:

- **Shape:** one **React SPA shell** with each tool as a feature module (route), backed by the
  existing **Node/Express + MySQL + jsforce** as a **JSON API**. Express stops server-rendering
  for new modules and serves JSON; React renders. The app switcher + module routing live in the
  React router.
- **Why React here:** one component library / design system reused across every module; uniform
  **data tables** (search + sort + paging via a grid lib such as TanStack Table) and **charts**
  (e.g. Recharts) so the table-conventions and metrics come consistently "for free"; and the
  interactive merge flow (master select → survivorship → dry-run preview → confirm) is exactly
  the kind of stateful UI React handles well.
- **Stack:** Vite + React (TypeScript recommended), a table/grid lib, a chart lib, and a data
  layer (e.g. TanStack Query) calling the Express JSON API.
- **Naming boundary (note):** snake_case stays the rule for the **backend, DB, and API**
  (tables, columns, JSON fields, routes). The **React front-end** follows React idioms
  (PascalCase components, camelCase props) — that's expected and not a conflict with the repo's
  snake_case preference, which is a backend convention.
- **Migration (strangler-fig):** build the React shell + the merge module first; port the
  existing server-rendered apps into React routes one at a time; until ported, old apps stay
  reachable (link out / reverse-proxy) behind the same nav.
- **Trade-off / decision:** React adds a build + deploy pipeline and a JSON-API layer vs the
  current server-rendered Express pages. The lighter alternative is server-rendered Express +
  htmx/light JS (no SPA, no build step) — simpler to maintain but less uniform for a rich,
  interactive console. For a true consolidated admin console, React is the stronger long-term
  choice. (Added to "To revisit".)

The mockups in this doc are framework-agnostic visual targets — they translate directly to
React components.

## UI mockups (screenshot drafts)

Static, non-functional mockups of the six pages (saved beside this doc as PNGs so they view
directly in any file viewer; the `.svg` sources are kept alongside). They show intended layout
+ the read-vs-write guardrails + the environment switch, not final styling.

Every page carries an **environment switch** in the top nav (Sandbox ⇄ Production) — see the
"Environment switch" section below.

### `/` — Dashboard

![Dashboard mockup](mockups/mockup_dashboard.png)

Read-only overview: account/cluster/pair counts, merge totals, a prominent "Merge execution
OFF (dry-run)" card, duplicate-pairs-by-signal, and recent activity.

### `/duplicates` — Review duplicates

![Duplicates mockup](mockups/mockup_duplicates.png)

The consolidated clusters as a filterable table (signal, tier, size, has-merge-ID), with
size, signal composition, tier, and best score. Click a cluster to open it in Admin.

### `/merge-id` — Review merge-ID accounts

![Merge-ID mockup](mockups/mockup_merge_id.png)

The merge-ID review buckets as summary cards (`in_both` / `sf_only` / `exact_only` /
`fuzzy_only` / `nickname_only` / `multi_signal`) plus a per-account table with bucket, merge ID,
and which-list. `sf_only` is highlighted as the recall-gap list.

### `/accounts` — All accounts

![All accounts mockup](mockups/mockup_all_accounts.png)

Browse the full snapshot (server-side paging over ~700k), with search and "in a cluster" /
"has merge ID" filters. Lean snapshot columns; click a row to fetch full Salesforce detail +
child records on demand (Tier 2).

### `/admin` — Merge console

![Admin mockup](mockups/mockup_admin.png)

The write surface, behind guardrails: a write-disabled banner, cluster list, master-selection
table (with live per-record detail + child counts), field survivorship, a dry-run impact
preview, an active **Preview** button, and a **locked Execute** button (needs
`ENABLE_MERGE_EXECUTION=true`, dry-run off, and a confirmation token).

### `/metrics` — Throughput + health

![Metrics mockup](mockups/mockup_metrics.png)

Merge throughput (per-day bars), success/fail/pending split, avg cluster size, daily API
usage vs limit, and a recent-jobs table. Empty until merges run.

## Environment switch (Sandbox ⇄ Production)

Yes — the tool runs against either org, switchable from the UI, the same way the finder uses
`--test` / `--prod`:

- A top-nav toggle selects **Sandbox** or **Production**; the active env is shown on every page
  and stamped on every merge-history row, so you always know which org an action hit.
- Each env maps to its own jsforce connection + credentials (reuse the existing dev-vs-prod
  credential split). Production uses the least-privilege write user; Sandbox can be looser.
- **Production raises the guardrails:** switching to Production should require an extra confirm,
  and (recommended) `ENABLE_MERGE_EXECUTION` is gated per-env so writes can be enabled in
  Sandbox while still hard-off in Production until sign-off.
- Default env on load is **Sandbox** (safe default), mirroring `resolve_is_test` defaulting
  rules but inverted for safety.

## Reconciliation: merge IDs ↔ our duplicates

Make it obvious, at a glance, which Salesforce merge IDs our duplicate detection covers and
which it doesn't — in both directions. All of this is computed from existing tables (snapshot
`salesforce_merge_id` + the consolidated `record_ids`); no new extraction.

- **Account level (the merge-ID review we already build).** Each account is `in_both` (has a
  merge ID *and* sits in one of our clusters) or `sf_only` (has a merge ID, *not* in our
  clusters); our-side-only accounts are `exact_only` / `fuzzy_only` / `nickname_only` /
  `multi_signal`. The `/merge-id` page adds an explicit **"In our duplicates?"** column
  (✓ + cluster id, or ✗) so coverage reads instantly.
- **Merge-group level (the "in vs not in" answer).** Group accounts by `merge_id` and label
  each group:
  - **matched** — all members fall in our clusters (ideally the *same* cluster = we agree on
    the grouping),
  - **partial** — some members covered, some not,
  - **missing** — none covered (the `sf_only` groups — our recall gaps).
  A reconciliation summary banner shows the totals (e.g. "11 merge groups · 7 matched · 2
  partial · 2 missing").
- **The other direction.** `/duplicates` shows a **"merge ID?"** column so you can see which of
  our clusters already carry a Salesforce merge ID vs none.

Net: `sf_only` / "missing" = merge IDs **not** in our duplicates (investigate); `in_both` /
"matched" = merge IDs **in** our duplicates (agreement).

## Table conventions — search + sort everywhere

Every data table in the tool (duplicates, merge-ID, all accounts, history) supports:

- **Free-text search** (debounced) across the key columns.
- **Click-to-sort on every column header** (asc/desc, with a caret indicator).
- **Server-side search + sort + paging** for large tables (all accounts ~700k); client-side is
  fine for the small ones.
- **Sticky filters/sort/search in the URL** so a view is shareable and bookmarkable.

## Capabilities → how

- **Review all / merge-ID / duplicates** — read-only pages over existing result tables;
  optional "refresh from Salesforce" re-runs the finder. Build these first (zero write risk).
- **Manage + initiate merge** — pick a cluster, choose the surviving master, resolve field
  survivorship, dry-run preview, enqueue a job; the worker calls the Apex endpoint. Clusters
  larger than 3 are chained (Salesforce merges 1 master + up to 2 per call).
- **History** — every job writes to `salesforce_merge_history`.
- **Restore** — snapshot-based reconstruction (see below).

## Data extraction — do we need to pull more? (decision)

**Yes, but in two tiers — keep the bulk extraction lean.**

- **Tier 1 — bulk snapshot (current extraction, kept lean).** The initial ~700k-row pull
  stays focused on dedup fields it already has (name, gender, birthdate, ZIPs, member number,
  foundation constituent, merge ID). Do **not** bloat the full-scale extraction with merge-time
  detail.
- **Tier 1.5 — a few survivorship-helpful columns (candidates, to confirm).** Optionally add a
  small set of Account fields to the snapshot so the review pages are useful without a live
  call per row — candidates: `created_date`, `last_modified_date`, `last_activity_date`,
  primary email, primary phone, membership status/dates, record owner, record type, and the
  **high-value flags** (donor, major member, …) that gate Contact-Point preservation (see
  `reference/README_MERGE_EXECUTION.md`). These help a reviewer pick the master at a
  glance and drive the preservation rule. Final list TBD.
- **Tier 2 — on-demand deep fetch (live jsforce, per cluster).** At review/merge time, pull the
  full field set for just the records in the cluster **plus child-object counts/IDs** —
  opportunities/donations, memberships, event registrations, cases, activities/tasks, and any
  custom child objects. This is what powers survivorship, the impact preview, and the pre-merge
  snapshot for restore. It's per-cluster (tens of records), not bulk, so it's cheap.
- **Discovery prerequisite:** enumerate every child object that reparents on an Account merge,
  so the snapshot and restore are complete. This is a Phase 0 task.

Net: extend the snapshot only modestly; do the heavy enrichment just-in-time for the handful of
records actually under review.

## Salesforce merge mechanics (constraints to design around)

- `Database.merge`: one master + up to **2** records per call; chain for larger clusters.
- **Destructive:** losing records go to the Recycle Bin (~15 days), child records reparent to
  the master, and overwritten master fields are lost unless captured first.
- **Person Account specifics** — the underlying Contact merges too; confirm behavior in sandbox.
- Governor limits — chunk + queue + retry.

## Restore — a core, designed-in capability (snapshot-based)

Restore is a first-class job of this tool, not an add-on. Salesforce has no clean one-click
un-merge, so the tool makes restore possible by capturing the data **at merge time** and
surfacing a per-merge restore action later.

- **Captured at execute (Phase 3):** before every merge, snapshot the full pre-state to
  `salesforce_merge_premerge_snapshot` — losing accounts' fields, every child record ID + its
  original parent, and the master's field values. This is what makes restore possible (and it
  doubles as a backup).
- **Surfaced in the UI (Phase 4):** merge history → pick a past merge → restore, in two tiers:
  - **≤ ~15 days (high fidelity):** undelete the loser from the Recycle Bin (keeps its
    **original id**), re-parent the snapshotted children, reapply overwritten fields.
  - **beyond 15 days (approximate):** recreate the loser from the snapshot/backup — **new ids**,
    so external links won't reconnect and children are recreated from the snapshot.
- **Only reliable for merges done *through this tool*** — that's when the snapshot is captured. A
  merge performed outside the tool has only Salesforce's 15-day Recycle Bin and no child map.
- **Known limits:** records created on the master *after* the merge, roll-ups, and downstream
  automation can't be cleanly unwound. Restore is best-effort, scoped, logged — and all the
  restore steps run from Node (undelete + re-parent + recreate), no Apex required.

## Conventions

- snake_case throughout (files, functions, variables, table/column names).
- The read-only duplicates pipeline is not modified.
- Writes are gated by `ENABLE_*` config flags and default off.
- Tests + docs land with each change (standing rule).

## How this fits the repo (revised — match the house pattern)

The repo already has a consolidation layer, so the tool should slot into it rather than be a
brand-new standalone app:

- Each tool is `server_<name>_<port>.js` at the repo root + logic under `src/<name>/`, sharing
  `utilities/`, `controllers/`, `routes/`, `public/`.
- A reverse proxy (`server_proxy_8000.js` + `proxy_routes.js`) fronts them under one host by
  path prefix; `proxy_auth.js` gives the proxy console signed-cookie auth.
- `proxy_routes.js` already names a **"future usat-app, React — Project C"** that will
  consolidate the UI servers (email-queue 8019, event-analysis 8016, race-results 8018).

So the merge tool follows the house style, and its consolidated front-end **is** Project C —
we don't fork a new shell, we add a module to the planned `usat-app`:

```text
sql_programs/                          # existing repo root
  server_salesforce_merge_8020.js      # NEW — merge server (own port), like the other server_*.js; /api/status health
  proxy_routes.js                      # add: '/merge': { target: 'http://127.0.0.1:8020', health: '/api/status' }
  src/
    salesforce_duplicates/             # existing read-only pipeline — reused, untouched
    salesforce_merge/                  # NEW — merge tool logic (sibling)
      manifest.js                      # name / base route / role / nav (for proxy + usat-app)
      merge_review.js                  # reuses ../salesforce_duplicates/src/merge_id_review.js
      merge_preview.js                 # dry-run: survivorship + child-record impact (read-only)
      merge_execute.js                 # the SINGLE write chokepoint -> calls Apex
      premerge_snapshot.js             # capture pre-merge state (for restore)
      restore.js                       # best-effort restore
      auth/                            # reuse the email-queue signed-cookie session scheme
      db/                              # NEW tables only (snake_case)
        001_salesforce_merge_job_queue.sql
        002_salesforce_merge_history.sql
        003_salesforce_merge_premerge_snapshot.sql
        004_salesforce_merge_restore_log.sql
      tests/
  utilities/  public/  controllers/  routes/   # existing shared code — reused

  # Consolidated React front-end = the repo's planned "usat-app (Project C)".
  usat_app/  (Project C, React — when it lands)
    src/modules/merge/                 # Dashboard / Duplicates / MergeId / AllAccounts / Admin / Metrics / History
    src/components/DataTable.jsx        # shared search + sort + paging, used by every module

salesforce/  (org metadata, deployed separately via SFDX/CI)
  classes/MergeService.cls             # thin Apex REST wrapper over Database.merge (write surface)
  classes/MergeService_Test.cls
```

`src/salesforce_merge/merge_execute.js` is the lone backend write path; everything else reads.
Until Project C lands, the merge server can ship its own server-rendered UI (like the other
UI servers) and be folded into `usat-app` later — same `src/salesforce_merge/` backend either way.

## Salesforce access — connected app + Apex (decisions)

**Is it a Salesforce Connected App?** Two senses:

- **Hosting:** No — it stays an external Node app like the rest of the repo (not a Salesforce-
  hosted Canvas/Lightning app). The only thing that lives *in* the org is a thin Apex class.
- **Auth:** Today the repo logs in with jsforce username + password + security token
  (`conn.login(...)`, dev/prod via env). That's fine for read-only batch jobs, but for a
  **write/merge** tool we should add a **Salesforce Connected App** using the **OAuth 2.0 JWT
  bearer flow** with a dedicated **least-privilege integration user** for the write path —
  no stored password, revocable, scoped, and auditable. This is exactly the read-vs-write
  separation already in the plan (read user vs write user). Recommended.

**How the merge runs — Node-primary.**

- The **merge itself is native** Salesforce — the SOAP `merge()` call and Apex
  `Database.merge()`; both **auto-reparent all child objects** to the master. We do not
  reimplement merge logic.
- **Primary path: call native SOAP `merge()` from Node** (over the jsforce session). No Apex
  deployed; native all-children reparenting still happens. The only thing given up vs Apex is
  that the pre-merge snapshot and the merge are two Node steps instead of one transaction —
  acceptable because the snapshot doubles as our backup (see Restore).
- **Alternative: a thin Apex REST class** (`AccountMergeService`) that wraps `Database.merge()`
  if we later want snapshot + merge atomic in one Salesforce transaction. Kept ready-to-deploy.
- **Master / loser selection is deterministic from the data:** within a group sharing one
  `salesforce_merge_id`, the **master is the account whose `Id` equals the `merge_id`**, and the
  **losers are the accounts whose `Id` ≠ `merge_id`** (the `merge_id` holds the surviving id).
  No manual master picking. Edge cases (no master in group, 15/18-char ids, >2 losers → chain)
  are handled in Node.
- **Exact code + deploy steps + the Node merge driver** live in
  `reference/` (`README_MERGE_EXECUTION.md` for the Node-primary path + selection rule
  + restore; `apex/` for the optional Apex class, its test, and `DEPLOY.md` for sandbox/prod).

## Process page + data refresh (R-series) — planned

A top-level **Process** page that runs multi-step jobs with live progress, plus a unified
activity log. First job: kick off the duplicate-detection run from the tool itself, so the
review tables can be refreshed on demand instead of waiting for the separate duplicates job.
This is still **read-only against Salesforce** — it runs the detector, which never writes to SF.

Mockups saved beside this doc: `mockups/mockup_process.svg` (the hub: refresh runner + activity)
and `mockups/mockup_merge_drawer.svg` (the future per-cluster merge flow). PNG renders are pending
a converter (the sandbox couldn't install one this session); the SVGs open directly.

### Decisions (locked)

- **Page:** new top-level `Process` (its own nav item; Admin stays for users/settings). Two areas —
  the data-refresh runner (step tracker + cancel) above a unified **Activity** log of every run.
- **Invocation: spawn a child process.** The merge server runs `node step_1_find_duplicates.js
  <flags>` as a tracked child from the repo root, holds a single-run lock, captures stdout, and
  parses the `[STEP]` lines the step-timer already prints for live progress. Independent of the
  8017 Slack server; gives a working Cancel and isolated memory.
- **Run config = Environment × Scope = the four `menu.js` modes:**

  | UI selection | Flags | menu.js item |
  |---|---|---|
  | Sandbox · Sample | `--test` | 7 — TEST |
  | Sandbox · Full | `--test --full` | 8 — TEST FULL |
  | Production · Sample | `--prod --partial` | 9 — PROD PARTIAL |
  | Production · Full | `--prod` | 10 — PRODUCTION |

- **All four modes exposed; Production requires a typed CONFIRM** + a freshness check (warn/skip if
  the last run is newer than `FRESH_OUTPUT_WINDOW_MINUTES` unless forced). Admin-only; one run at a
  time. The environment is recorded on the run-logbook row so the UI can show which env produced
  the current tables.
- **Shared step-tracker / run-status component** reused by the refresh now and the merge later.
- **Merge initiates from a cluster** (Duplicates → preview → confirm → execute in a drawer using the
  same tracker), then logs to the Process Activity feed. (Phase 3; writes stay off by default.)

### Phasing

- **R1 — backend runner.** `refresh_runner` module (spawn + single-run lock + stdout/`[STEP]`
  parse + start/finish/env recorded), endpoints `POST /api/refresh/start {env,scope}`,
  `GET /api/refresh/status`, `POST /api/refresh/cancel`; flag mapping; unit tests with a fake spawn.
- **R1a — indexes (include with R1).** Add the B-tree indexes from the recommendation below
  **in the duplicates project's table-build code** — `database_snapshot.js` (snapshot) and
  `database_results.js` (result tables) — created right after each table is (re)built, inside the
  existing load transaction. This is the right home because those tables are dropped/recreated every
  run, so a hand-added DB index would vanish. It's additive and **output-preserving** (indexes don't
  change detection results), but it does touch the read-only pipeline, so guard it as a pure
  schema-add and re-run the parity tests. FULLTEXT on the searched columns is optional/later, only if
  `%term%` latency shows up at full scale.
- **R2 — Process page UI.** Selector, command preview + menu-item equivalence, Run + confirm,
  live step tracker + elapsed + log tail, Activity log; reuses the search spinner/timer styling.
- **R3 — docs** (+ optionally surface that the nightly scheduled job still runs).

### Indexing for search/sort/filter (recommendation — no code yet)

The review pages now do server-side search (`LIKE '%term%'` across a few columns), sort (`ORDER BY`),
and per-column filters (`LIKE`) over `salesforce_account_duplicate_snapshot` (~700k rows) and the
result tables. As data grows, add indexes — but mind two facts about how these tables are built:

1. **The tables are dropped and recreated every detection run** (`database_snapshot.js` /
   `database_results.js`). So indexes must be (re)created **as part of that build**, in code, right
   after the load — not added by hand in the DB, or they vanish on the next run. The right place is
   a `CREATE INDEX` step (or indexes declared in the `CREATE TABLE`) inside those modules, run once
   per rebuild inside the existing load transaction.
2. **`LIKE '%term%'` (leading wildcard) cannot use a normal B-tree index.** Plain indexes speed up
   exact match, range, `ORDER BY`, and prefix `LIKE 'term%'`, but not "contains" search. Options:

What I'd recommend, in order:

- **Index the sort + equality/prefix columns** (cheap, high value): on the snapshot —
  `last_name`, `first_name`, `salesforce_merge_id`, `member_number`, `composite_zip_five_digit`,
  `birthdate_normalized`, `salesforce_account_id` (already the PK); on the result tables —
  `Bucket__c`, `Confidence_Tier__c`, `Match_Composition__c`, `Which_List__c`, and the numeric sort
  columns. This directly accelerates `ORDER BY`, the bucket/tier/which-list filters, and any
  prefix search. Composite indexes (e.g. `(last_name, first_name)`) help the default sort.
- **For "contains" search, switch those columns to a `FULLTEXT` index** and use `MATCH … AGAINST`
  for the free-text box (word/prefix matching), keeping per-column `LIKE` for the targeted filters.
  FULLTEXT is the only index that helps substring-ish search at this scale on MySQL/InnoDB.
- **Or anchor the search to prefix** (`term%` instead of `%term%`) where product-acceptable — then a
  plain B-tree index applies and no FULLTEXT is needed. Cheapest, but changes search behavior.
- **Keep it lean:** index only the columns the UI actually sorts/filters on (every index slows the
  per-run rebuild and uses space). Measure with `EXPLAIN` on the real row counts before adding more.

Net: add B-tree indexes on the sort/filter columns inside the table-build step now; consider FULLTEXT
for the free-text search only if `%term%` latency becomes a problem at full scale. This would be a
small, self-contained change to `database_snapshot.js` / `database_results.js` (still read-only vs SF).

## To revisit (deferred)

- **Phasing** — deferred (will sketch read-only app first, then preview, then sandboxed
  execute, then history, then restore).
- **Decisions** — deferred:
  - Person Accounts only, or other objects too?
  - How real must "restore" be — best-effort snapshot, or rely on the 15-day Recycle Bin?
  - Sandbox-only to start, or prod behind admin auth?
  - Auth model + who uses it.
  - Which extra survivorship columns (Tier 1.5) to add to the snapshot.
  - Reuse the email-queue app's queue/worker pattern for the merge queue?
  - **Commit to the shared app shell now** (build merge as module 1) vs build merge stand-alone
    and refactor into a shell later?
  - Which existing apps get ported into the shell, and in what order?
  - Single login/SSO for the shell + per-module roles — what's the auth source?
  - **Front-end: React SPA + JSON API, or server-rendered Express + htmx?** (React recommended
    for a consolidated console; htmx if we want minimal change/no build step.)
  - **Salesforce auth: add a Connected App (OAuth JWT, least-privilege write user)** vs keep the
    current username/password login? (Connected App recommended for the write path.)
  - **Merge surface: thin Apex REST wrapper over `Database.merge` (recommended)** vs native SOAP
    `merge()` from jsforce (no Apex, but weaker control)?
  - Ship merge as its own UI server now and fold into usat-app (Project C) later, vs wait for C?
  - **Preserve loser contact info as Contact Points** (decided: Contact Point objects). Confirm
    the donor flag's API name + which side triggers it, and the default when no flag matches.
    See `reference/README_MERGE_EXECUTION.md`.
- **Reference inputs needed:** read the email-queue app (framework, auth, deploy) and
  `server_salesforce_duplicates_8017.js` so the scaffold matches.

---

## Execution & restore — LOCKED plan (Phase 3a / 3b / 4)

This section is the source of truth for the merge execution + restore work and supersedes the
matching "To revisit" items above. Decisions here are confirmed.

> **STATUS — BUILT (safe mode).** Phase 3b + 4 are implemented and unit-tested (fake jsforce/db),
> shipping OFF by default. New stores: `salesforce_write.js` (jsforce `conn.soap.merge` / `undelete`),
> `merge_run.js` (progress), `merge_restore.js` (Phase 4); `merge_execute.js` rewritten for the real
> path; `merge_snapshot.js` now child-aware + keep-latest. New tables: `salesforce_merge_run`
> (+ child rows in `salesforce_merge_premerge_snapshot`, `mode` col on `salesforce_merge_history`).
> API: `/api/merge/progress`, `/api/merge/restore` (GET/POST), execute params on `/api/merge/process`.
> UI: Process Merges gets the Simulate/Execute switch + typed-MERGE + progress bar/timer/ETA; new
> **Restore** page (`/restore`). To enable real writes (sandbox first): set
> `MERGE_ENABLE_EXECUTION=true` and (recommended) the dedicated write-user env vars
> `SF_DEV_WRITE_USERNAME` / `SF_DEV_WRITE_PASSWORD` / `SF_DEV_WRITE_SECURITY_TOKEN` (PROD equivalents
> for production), then choose **Execute** + type MERGE. **Verify the `conn.soap.merge` masterRecord
> shape against the org in sandbox before production.**
>
> **Optional "stamp survivor as merged" (Process Merges checkbox).** When enabled, after a successful
> merge the survivor is best-effort updated with custom fields `usat_was_merged__c` (Checkbox) +
> `usat_was_merged_date__c` (DateTime) + `usat_was_merged_by__c` (Text — the actor who initiated the run).
> These are **NOT auto-created** — an admin adds them in Salesforce
> (Setup → Object Manager → Account → Fields) and grants field-level security. If they're missing the
> merge still succeeds and the run logs "stamp skipped"; the UI checks field presence
> (`GET /api/merge/stamp-fields`) and shows a warning. Note: this is the *survivor*-side marker;
> Salesforce already stamps each deleted loser's `MasterRecordId` with the survivor id.
>
> **Refinements from sandbox simulate testing.** (1) The snapshot has a `child_type` column on child
> rows: `child` (real child to re-point) vs `self_account` / `self_contact` (the Person Account's own
> two halves, which return automatically on undelete). (2) Restore **skips** the self-halves when
> re-pointing — they're not writable and come back with the loser. (3) Repeated **simulate** runs keep
> only the latest history row per entry (`merge_history.clear_simulated`); real `done`/`failed` rows
> are always kept. (4) Live progress reports a per-set `stage` (validate → snapshot → merge → record)
> and the survivor name, rendered as a stepper on Process Merges (like the Get Duplicates progress).

### Locked decisions
- **Merge surface:** native Salesforce `merge()` **directly from Node via jsforce** — **no Apex**.
- **Credentials:** a **dedicated least-privilege write user** (read + update + delete on
  Account/Contact; no create), separate env vars, used only by the merge connection. The
  read-only duplicates pipeline keeps its read user.
- **Safety switch:** a UI **Simulate / Execute** toggle (default Simulate) on top of the
  deploy-level `MERGE_ENABLE_EXECUTION` flag. Simulate does *everything except the Salesforce
  writes*.
- **Snapshot:** child-aware, written on **every run** (simulate *and* execute) so the backup
  pipeline is exercised end-to-end each time; **kept latest-only per queue entry** (re-running an
  entry replaces its prior snapshot — never a stack).
- **Status lifecycle:** `approved → done` on success, `approved → failed` on a halt,
  `done → restored` after a Phase 4 restore. Simulate never changes status.
- **Failure handling:** **fail-stop, no auto-revert** (see below).

### Phase 3a — safe-mode scaffolding (DONE)
The whole pipeline except the write: queue → approve → process(dry-run) runs alignment check,
drift re-fetch, snapshot, and records a `simulated` history row. `merge_execute.js` is the single
chokepoint; with `MERGE_ENABLE_EXECUTION` unset it can never write, and the real `merge()` is not
implemented. A `whoami` probe reports whether the connected user could merge (Account
update+delete). UI: Process Merges page with safe-mode banner, processing-steps card, dry-run,
history, environment/org alignment.

### Phase 3b — the real merge (sandbox first)
Per selected `approved` entry:
1. Verify environment/org **alignment** — skip on mismatch.
2. **Re-fetch** the cluster fresh and run the **drift check** (survivor + losers still present) —
   skip on drift.
3. **Save the child-aware snapshot** (replace this entry's prior snapshot).
4. Compute the **survivorship field plan** (master keeps non-blank, blanks backfill from a loser,
   overrides win).
5. **Simulate →** record `simulated`, status unchanged, return. **Execute (all gates pass) →**
   write survivor fields to the master, then merge.

**Batching (the 26-account case).** `merge()` = master + up to **2 losers** per call, master
persists. A set of N accounts = 1 master + (N-1) losers → **ceil((N-1)/2) sequential calls**
(26 accounts → 13 calls). Sequential, not parallel (shared master would row-lock). Watch the
per-merge related-records cap on big child counts.

**Gate stack for a real write (any one missing → Simulate):** `MERGE_ENABLE_EXECUTION=true` +
UI mode = Execute + typed **MERGE** confirm + alignment OK + sandbox-first.

**Failure plan — stop, don't auto-revert.** One `merge()` call is all-or-nothing. In a multi-call
set, if a call fails the earlier calls already applied, so the set is partway done. On first
failure: **halt that set**, mark it `failed`, record which losers merged vs remain + the error,
keep the snapshot, continue to the next set. **No auto-revert** — a merge can't be undone by
another merge; undo = Recycle-Bin undelete + child re-point (Phase 4), which is itself risky and
would undo correct work. **Retry is safe:** because every run re-fetches, a retry's drift check
sees the already-merged losers are gone and continues with the master + remaining losers (no
double-merge).

**Cross-environment safety & idempotency (switching Sandbox ⇄ Production).** The tool operates on
*one* loaded dataset at a time; `dataset_info().environment` is the label, and it also selects the
SF credentials used for the org-identity check and the write (`is_test = env !== 'Production'`), so
the write target always follows the loaded data. The merge queue persists across switches (never
auto-cleared) and every entry is stamped with its `environment` at add time (`routes.js`
add/bulk-add, from `dataset_info`). Protection layers:

1. **Alignment guard** (`verify_alignment`): each entry's stamped `environment` (and `org_id` when
   present) is compared to the current run context; a mismatch is recorded `skipped`
   ("environment mismatch" / "org mismatch") **before** the snapshot/merge steps — no write. A
   Sandbox-built set therefore cannot execute while Production data is loaded, and vice-versa;
   switch the loaded dataset back and the set is runnable again. The `org_id` is **captured
   server-side at add time** (`routes.js` `resolve_org_id` calls `get_org_identity` for the loaded
   environment, cached per env, best-effort) on both the single and bulk add paths, so the org guard
   is **always-on** — a hard org pin on top of the Sandbox/Production label, which matters if two
   environments ever share a label (e.g. two sandboxes). If Salesforce is unreachable at add time the
   capture falls back to null and queueing still succeeds; the environment label remains the guard
   until a later add (cache stores positive results only, so a transient failure is retried).
2. **Status lifecycle:** a merged set → `done` and drops out of the `approved` list, so it is never
   reselected. Simulate never changes status (rehearsable).
3. **Drift re-check:** every run re-fetches the cluster and skips a set whose survivor/losers are
   missing from fresh data ("records changed since queueing") — e.g. losers already merged away. On
   a retry of a partially-merged set, the already-merged losers are gone, so it continues with only
   the remainder (no double-merge).
4. **Salesforce backstop:** merging an already-deleted record errors → recorded `failed` (fail-stop),
   not a silent re-merge.

*Honest limit:* the drift check reads the **loaded dataset** (last detection run), not a live
per-record query, so the dependable "don't merge twice" guarantees are the `done` status (for merges
run through this tool) plus refreshing data after merges. Merges performed **directly in Salesforce**
are caught at execute time by Salesforce (layer 4), not pre-skipped. Tests:
`merge_execute.test.js` covers the Sandbox-set-skipped-under-Production case, the done-not-reselected
case, and the drift skip, alongside the existing alignment/gate tests.

**Timer / estimate / progress.** A run-progress record (`run_id`, `total_ops`, `completed_ops`,
current set + batch, `status`, `started_at`, `finished_at`), updated after each call. Pre-run
**estimate** = `total_ops × avg_op_time` (config default until real history exists, then a rolling
average of real merge-call durations — simulate runs excluded). UI polls it for a **progress bar +
elapsed timer + live ETA** ("Set 3 of 7 · batch 9/13"). Actual durations logged for future
estimates.

**UI transparency.** Steps card reflects mode/gates; banner shows mode + environment + which gates
pass; type-MERGE + Execute enabled only when armed; history shows `done`/`failed` with
completed/remaining counts, error text, duration, snapshot link.

**Tests (fake jsforce):** success (status→done, snapshot incl. children), mid-set failure (halt,
partial recorded, status→failed, no revert), retry resumes, simulate writes snapshot but no
Salesforce write and no status change, alignment/drift skips.

### Phase 4 — best-effort restore (undo a merge)
Salesforce has **no native un-merge** — `undelete` only brings back one soft-deleted record. Restore
composes an un-merge from standard ops (update + undelete + update) using the pre-merge snapshot, so
the **order is ours to get right**. Reuses 3b's chokepoint, Simulate/Execute switch, gate stack,
write user, and progress/timer. Steps, in this deliberate order:
1. **Reset the master's overwritten fields** to pre-merge values from the snapshot — FIRST. This frees
   any **unique** value that survivorship moved onto the survivor during the merge (e.g. a member
   number, `cfg_Member_Number__c`); otherwise step 2's undelete is blocked by Salesforce with
   "duplicate value found …" (the loser still carries that value). Resetting first restores the
   documented pre-merge state and releases the value — no out-of-band field-editing.
2. **Undelete the losers** from the Recycle Bin (restores **original ids**). The undelete result is
   CHECKED — a loser that won't come back is a real failure, reported with Salesforce's own message.
3. **Re-point the reparented children** back to their original parents from the snapshot.
Then log a restore record and flip `done → restored`.

**Resilience (BUILT).** Best-effort per record: a child that is itself deleted is undeleted-then-
re-pointed; anything still unfixable is skipped with a note; an already-live loser (from a prior
partial restore) still counts as recoverable (retry-safe); a purged loser routes to recreate. One bad
record never aborts the whole restore, and failures surface the exact Salesforce reason in the UI +
run history. Tests cover: reset-before-undelete order, undelete-failure reporting, deleted-child
recovery, retry-safety, and purge→recreate routing.

**Managed-package byproducts (QI).** A merge can make a managed package (namespace `em4sf`) create +
delete its own **"Queue Item" (`QI-…`) job records**, which then show in the Recycle Bin. These are
**not account data**, have no Account relationship, aren't in the snapshot, and are neither restored
nor touched by the tool — same category as the SFMC caveat (reconcile in that package).

**Two tiers (already in the Restore section above):** ≤ ~15 days = high-fidelity undelete; beyond
15 days = approximate recreate (new ids). **Best-effort limits:** 15-day window + Recycle-Bin
purge, downstream automation / roll-ups / external systems (SFMC) don't auto-undo, and post-merge
changes complicate it. Restore takes a **fresh snapshot of current state before it runs** (so a
botched restore is itself recoverable). UI: a restore view listing past merges flagged
**restorable vs expired** (live Recycle-Bin check), simulate then execute behind the gates.

#### Phase 4b — secondary recreate-from-backup queue (BUILT, gated)
Eligibility is **all-or-nothing per set**: a set restores from the Recycle Bin only if *every* loser
is still there. When an **execute**-mode restore finds a set ineligible (window expired / a loser
purged), it doesn't just skip — it **routes the whole set** to a secondary queue by transitioning
`done → recreate_pending` and recording the reason (transparent in the UI). The user then runs a
deliberate, separate **recreate-from-backup** process on that queue:
- `merge_restore.list_recreatable()` lists `recreate_pending` sets + what the backup snapshot can
  rebuild (loser count, child-link count, "no snapshot" flag).
- `merge_restore.recreate(ids, opts)` — same gate model as restore but typed **RECREATE**. Per set:
  `create_record` each loser Account from its snapshot fields (`account_create_fields` strips
  system/derived fields), map old→new id, re-point the snapshotted children to the **new** ids,
  reset the master, then `recreate_pending → recreated`. Simulate previews with no writes; fail
  records-but-continues per set. New module method `salesforce_write.create_record`.
- **Caveat (documented in the UI + Reference):** recreated records get **new Salesforce ids**, so
  external references (Marketing Cloud, data warehouse) won't reconnect — this tier is approximate
  by nature. Routing granularity is **per-set** (a partially-recoverable set goes whole to recreate),
  per the product decision.
- API: `GET/POST /api/merge/recreate`. UI: a "Recreate queue" card on Restore with the reason +
  backup availability + Simulate/Execute. Tests: routing→recreate_pending, list_recreatable,
  recreate simulate/execute, and `create_record` (in `merge_restore.test.js` / `salesforce_write.test.js`).

### 3a leftover (folded in)
With "snapshot on every run + keep latest," simulate writes a snapshot (rehearsal) but no
Salesforce write and no status change. To avoid history pile-up from repeated simulates, keep the
**latest simulate history row per entry** (real `done`/`failed` rows are always kept).
