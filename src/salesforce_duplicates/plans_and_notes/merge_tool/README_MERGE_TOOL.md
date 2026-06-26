# Merge Management Tool — Plan (DRAFT)

**Status:** Draft / planning only. No code yet. Phasing and final decisions are
deliberately deferred (see the end) — this doc captures the architecture, the read-vs-write
safety model, and the data-extraction question.

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

## Restore — best-effort, snapshot-based (not a native undo)

Salesforce has no clean one-click un-merge. The design:

- **Before** each merge, snapshot the full pre-state to `salesforce_merge_premerge_snapshot`:
  losing accounts, every child record ID and its original parent, and the master's field values.
- **Restore** = undelete the losing account (only within the ~15-day Recycle Bin window) + an
  Apex routine that re-reparents the snapshotted children + reapplies the captured fields.
- **Known limits (set expectations):** records created on the master *after* the merge, rollups,
  and downstream automation can't be cleanly unwound; outside the 15-day window the losing
  record may be unrecoverable. Restore is best-effort, scoped, and logged.

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
