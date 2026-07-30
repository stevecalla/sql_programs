# Salesforce Email Queue — fold-in plan (port into usat_apps)

Status: **planning** · Owner: skip · Last updated: 2026-07-30

This is the Phase-1 plan referenced by `plans_and_notes/chatbot/CHATBOT_PLAN.md`. It ports
`src/salesforce_email_queue_proof_of_concept` into `usat_apps` as a first-class module, and —
critically — extracts its AI + knowledge layer into **shared platform services** so the Team USA
chatbot can build on the same brain. Porting the email queue is the prerequisite for the chatbot,
not a parallel track.

---

## 1. Why fold in first (the chatbot connection)

The chatbot and the email queue are **two front doors on one brain**. The email queue answers staff
on inbound Salesforce cases; the chatbot answers members on the public Team USA page. Both should
draw from — and improve — the same AI connection, the same curated knowledge, and the same operator
corrections. If we build the chatbot against a copy of the brain, the two immediately drift.

So the sequence is: **fold the email-queue backend into usat_apps as shared services first**, then the
chatbot is a thin second consumer of those services. This plan is about that fold-in. The "100% UI
parity" question resolves cleanly once you see the code (Section 3): the *backend* is the load-bearing,
reusable part and ports nearly verbatim; the *UI* is a vanilla-JS page that we rebuild in React to match
the platform — and the chatbot doesn't need that UI at all.

---

## 2. What the email queue is today (ground truth)

Read from the live tree on 2026-07-30 (`src/salesforce_email_queue_proof_of_concept`):

- **Standalone Express app**, `server_salesforce_email_queue_8019.js`, **port 8019**, pm2 name
  `usat_salesforce_email_queue`. Same family as the old `/merge` 8020 we just retired.
- **Read-only against Salesforce.** It reads queues / threads / sender history and runs AI over them.
  **No SF writes** anywhere — no merge, no execution, no worker. This makes it a *much* lower-risk port
  than merge (no execution-safety surface to preserve).
- A **well-factored Node brain**:
  - `ai/` (11 files, ~802 lines): providers (OpenAI + Anthropic), models/pricing, respond, triage,
    ask, extract, `context.js` (grounding assembly), `prompt.js`, `faq.js` (knowledge loader), spam.
  - `sf/` (5 files, ~303 lines): SF read layer — queues, threads, context, text cleaning.
  - `store/` (2 files, ~134 lines): `corrections.js` (operator corrections) + `queue_access.js`.
  - `web/routes.js` (511 lines): the JSON API + SSE for the operations/logs panels.
- A **vanilla single-page UI**: `web/public/index.html` — **890 lines of hand-written HTML + inline
  CSS + inline vanilla JS** (a 3-pane layout: queues rail / thread / AI draft). **No React, no Vite,
  no build step.** It is served as a static file.
- Platform-overlap pieces we will **not** re-port: `auth/` (145 lines — usat_apps already has this),
  `admin/` console+logs (404 lines — the usat_apps **ops** module covers this), most of `metrics/`
  (836 lines — usat_apps has a metrics platform).
- **15 test files, ~1,089 lines** — port the ones that follow the brain (ai/sf/store/faq/corrections).

### Persistence today (moves to the platform)
- Knowledge = files under `<osPath>/usat_email_queue/context/_global/**` and `/<queue_slug>/**`
  (loaded by `ai/faq.js`).
- Operator corrections = `<osPath>/usat_email_queue/corrections.json` (`store/corrections.js`; already
  slated to move to a DB table — see its own `path_to_production.md`, Track C).
- Analytics events table = `salesforce_email_queue_events` (MySQL).

---

## 3. Your two questions, answered

**Is the email queue in React?** No. The backend is plain Node/CommonJS; the UI is a single 890-line
vanilla `index.html` (inline CSS/JS, no framework, no build). Merge was already React when we ported it
— this one is not, so the UI is a **from-scratch React rebuild** rather than a lift. That's actually the
*consistent* path: the platform shell is React/Vite, so we rebuild the one page as a module Section and
retire the vanilla file.

**How big of a port?** Medium — and front-loaded on value, not risk. Rough shape:

| Bucket | Lines | Disposition |
|---|---|---|
| `ai/` (brain) | ~802 | **Port ~verbatim** → shared service `services/ai/` |
| `sf/` (SF read) | ~303 | **Port ~verbatim** → module `sf/` |
| `store/` (corrections, queue access) | ~134 | Port; move JSON → DB (Track C) |
| `web/routes.js` (JSON API) | ~511 | Port → `modules/salesforce_email_queue/api.js` |
| `web/public/index.html` (UI) | ~890 vanilla | **Rebuild in React** as the module Section |
| `auth/` | ~145 | **Drop** — use platform `auth/` |
| `admin/` console+logs | ~404 | **Drop** — use platform **ops** module |
| `metrics/` | ~836 | **Mostly drop** — use platform metrics; keep the events table |
| tests | ~1,089 | Port the brain-facing ~half |

Net: roughly **~1,750 lines of backend that port nearly as-is** (ai + sf + store + routes), **~1,385
lines we do NOT re-port** because the platform already provides them (auth + admin/console + most
metrics), and **one ~890-line vanilla page rebuilt in React**. Bigger than `event_coi`, similar order
to the merge port — but lower risk, because it's read-only + AI with no execution path.

---

## 4. Target shape in usat_apps

Mirror the existing module contract (`modules/_template/module.js`, `plans_and_notes/README_USAT_APPS.md`):
one server manifest + one front-end manifest, both registered in their registries. **The chatbot payoff
is that the AI + knowledge layer is extracted one level up, into shared `services/`, so a second module
(the chatbot) can require the same brain instead of copying it.**

```
src/usat_apps/
  services/                              # NEW — shared, module-agnostic brain (the chatbot reuse point)
    ai/                                  # ported from email-queue ai/ (providers, models, respond,
                                         #   triage, ask, extract, context, prompt, spam)
    knowledge/                           # ported from ai/faq.js — scoped knowledge loader
    corrections/                         # ported from store/corrections.js (→ DB-backed)
  modules/
    salesforce_email_queue/              # NEW — the operator-facing module
      module.js                          # manifest: id 'salesforce_email_queue', panels, mount()
      api.js                             # ported web/routes.js → /api/salesforce-email-queue/*
      sf/                                # ported sf/ (SF read layer)
      menu.js                            # CLI menu entry (optional, mirrors merge)
      tests/                             # ported brain-facing tests
  web/src/modules/salesforce_email_queue/
    Section.jsx                          # React rebuild of the 3-pane index.html
    pages/                               # Queue / Thread / Draft / Knowledge / Corrections views
    components/                          # shared bits (draft card, correction editor, ...)
    lib/api.js                           # front-end API client (mirror merge's lib/api.js)
  plans_and_notes/salesforce_email_queue/
    EMAIL_QUEUE_FOLDIN_PLAN.md           # this doc
    PORT_INVENTORY.md                    # file-by-file mapping
    STATUS.md                            # living status
```

Registration is the last flip, not the first: the scaffold folder can exist un-registered (like
`modules/_template`) and change nothing until we add it to `modules/registry.js` +
`web/src/modules/registry.js`.

---

## 5. Shared services extraction (the reason to do this now)

The single most important design decision: **the AI connection, knowledge store, and corrections do NOT
live inside the email-queue module.** They move to `src/usat_apps/services/`, and the email-queue module
becomes their first consumer. Concretely:

- `services/ai/` — provider abstraction (OpenAI + Anthropic keys already in `.env`), model/pricing,
  and the `respond / triage / ask / extract` operations. Pure functions over a passed-in context, as
  today. The chatbot calls `respond`/`ask` with its own context; the email queue calls them with case
  context. One brain, two callers.
- `services/knowledge/` — the scoped knowledge loader generalized from `ai/faq.js`. Today it keys on
  `_global` + `<queue_slug>`. We generalize the key from "queue" to **scope** (`_global`, a queue slug,
  or a chatbot embed key like `team_usa`). Same loader, one extra dimension. This is exactly the
  multi-instance knowledge partition the chatbot plan's §4 depends on.
- `services/corrections/` — operator corrections, scoped `me | queue | global` today, generalized the
  same way. Moving this to a **DB table** (Track C, already planned) is the natural moment.

**PII boundary (your hard constraint, encoded here):** the shared knowledge/corrections services return
only **curated, derived** content — approved answers, FAQ, corrections. Raw case bodies and sender
history stay inside the email-queue module's `sf/` read path and its authenticated operator API; they
are **never** exposed through the shared knowledge service. The public chatbot will consume
`services/knowledge` + `services/ai` and has **no route** into `sf/` or raw cases. Enforced by
composition (the chatbot module simply doesn't mount those routes), not by convention.

### 5a. Shared Salesforce layer (Merge ↔ Email Queue)

Merge and the email queue both talk to Salesforce, and there are **two distinct kinds of sharing** —
one is code, one is a live resource. Both already have precedent in the repo.

**1) Shared SF *connection/client* (code) — already exists.** There is a repo-level connector,
`utilities/salesforce/salesforce_connect.js` (`connect_salesforce` + `resolve_creds(is_test, env,
role)`), that is already **role-aware** (`role: 'read' | 'write'`) and env-aware (`is_test` →
sandbox/dev vs production). **Merge already uses it.** The email queue currently borrows the older
`race_results_transform/sf` plumbing (its own `sf/index.js` even says "internalize later"). During the
port, the email queue's SF read layer should **adopt the same shared connector** instead of copying
plumbing — one client, two callers:
- Email queue requests a **read** connection (`role:'read'`) — queues, threads, sender history. No writes.
- Merge requests **read** *and* **write** connections (`role:'write'` for SOAP `merge`/`undelete`), plus
  Bulk 2.0 query for the full data pull.
So the SF connection, SOQL/describe helpers, and limits parsing become (or stay) a shared
`services/salesforce/` client; each module uses only the surface its credentials permit.

**2) Shared SF *API budget* (resource) — the important one.** Both apps authenticate to the **same
production org** (`SF_PROD_*` → `usatriathlon.my.salesforce.com`). Salesforce's Daily API Request limit
and Bulk limits are **per-org**, so every call from *either* app draws down the *same* pool. Consequences:
- The **live limits gauge** (`conn.limits()`) we built for Merge already reflects **combined** usage,
  because it reads the org's own counter — it can't tell merge's calls from the email queue's.
- But the **per-op capture / trend / pre-flight** ("warn before big runs") we built only records *merge's*
  operations. Once the email queue is also live and doing reads, that consumption is invisible to the
  per-op view (even though it's silently eating the same budget).
- **Recommendation:** generalize the Merge SF-API-usage tracking into a shared
  `services/salesforce/api_usage` that **both** modules record into — giving one true "org budget + our
  combined footprint" view, and a pre-flight guardrail that accounts for what the *other* app is also
  consuming. (The chatbot, by design, uses curated knowledge — not live SF — so it normally won't draw
  on this budget; if it ever needs a live read, it goes through the same shared client + tracking.)

**Phasing implication:** adopting the shared **connector** is part of Phase 2 (the email queue's SF read
layer points at `services/salesforce/` instead of copying `sf/`). Consolidating the **API-usage
tracking** is a later step — best done once both modules are in usat_apps, generalizing the existing
Merge SF-API panel rather than duplicating it.

**This generalizes beyond these two apps.** `race_results_transform` is a **third** SF consumer already
slated to port (it was the top "next app" recommendation), and it's literally the plumbing the email
queue borrows today (`sf/index.js` requires `../../race_results_transform/sf`). So the shared
`services/salesforce/` isn't a merge↔email-queue special case — it's the **platform SF layer** that every
SF-touching module (merge, email queue, race results, and later the chatbot if it ever reads live) sits
on top of. Two payoffs when race results ports:
- No more one-module-depending-on-another-module's-`sf/` folder — they all depend on the shared
  connector (`utilities/salesforce/` → `services/salesforce/`), which is the correct direction.
- The org-budget footprint view becomes complete across *all* SF apps at once, so the "warn before big
  runs" guardrail reflects total org consumption — merge's bulk pulls, email-queue reads, and
  race-results syncs together — instead of any one app's slice.

Practically: build the shared SF client seam once (Phase 2 here), and each later port — race results
included — plugs into it instead of re-copying plumbing. Same pattern as `services/ai` +
`services/knowledge`: extract once, reuse many.

---

## 6. Admin, metrics, auth, env — the robust tooling

The standalone app has a genuinely robust admin (Overview/config-status, Settings, Access, Operations,
Logs, Reference) and a rich metrics dashboard (funnel, verdicts, AI-calls by queue/provider/action,
cases-worked, corrections/context-file changes, AI spend + cost-by-model, plus a read-only
**Ask-your-data** AI box). **None of this is thrown away.** It splits cleanly into two piles:
*framework we reuse from the platform*, and *Email-Queue domain surfaces we port*.

**Reuse from the platform (no re-port):**
- **Auth / users / roles** — the platform's signed-cookie session + `require_auth` / `require_panel`,
  the `.env` recovery accounts, and role `admin`. A new panel key `email-queue` (and later `chatbot`)
  is added to the access catalog via the module manifest.
- **Panel access** control (per-panel grants) — platform admin already does this.
- **Operations + Logs** — the platform **ops** module already gives health, routes, pm2, logs, cron,
  and curated system commands (we extended it during the 8020 retirement). The EQ-specific menu items
  (verify SF, list queues, view corrections/context, purge test rows) register as ops commands.
- **Metrics *framework*** — the events table, the report, and the SQL-guarded **Ask-your-data** box are
  platform primitives. Keep `salesforce_email_queue_events` (+ `..._ask_log` / `..._ask_corrections`)
  as the module's tables.
- **Overview/config-status**, theme, header, footer clock.

**Port as Email-Queue domain (module code):**
- **Settings** — the SF **environment switch** (Production / Sandbox), the **AI models & pricing** table
  (one shared list feeding both the app's model picker and the metrics Ask box), the **TEST-MODE banner**
  toggle, and the **admin default landing**. These are EQ-specific and have no platform equivalent.
- **Queue access** — the general default + per-user overrides of which SF queues a non-admin operator
  sees (`store/queue_access.js` + its admin UI).
- **Metrics dashboards** — the funnel, verdicts, by-queue/provider/action breakdowns, cases-worked,
  corrections/context changes, and AI spend / cost-by-model. These are charts that read the module's own
  events table; they port as a module Metrics page (built on the platform's metrics primitives, same way
  merge added its own metrics view).
- **Reference** — a small static system-reference page (mirror merge's Reference).
- **Test suite & operations** — the app ships a robust harness: ~16 node unit/contract tests (text
  clean, thread reader, attachment extract, AI layer, FAQ + corrections, auth, metrics config/DDL, queue
  access, analytics, ask-your-data, admin users, routes API, spam heuristic, snake_case lint) **plus a
  Playwright web E2E**, all runnable from the Operations console. This is a *porting asset, not a cost* —
  the tests come with the code and are what give us parity confidence. They port into usat_apps' existing
  `tests/` + `e2e/` and run under the platform's `run_tests.js`; each test stays available as an ops
  "Run" command. Keeping them green is the acceptance gate for each phase.

**Why this is safe alongside the chatbot:** the app already stores **no member PII** in analytics —
every row is counts/enums + the operator's staff username + the queue name (confirmed on the app's own
Reference page). Sensitive data (`auth.json`, `corrections.json`, `queue_access.json`) already lives
outside the repo. So the same dashboards that make the tool observable also honor the no-PII boundary the
public chatbot requires.

- **Env vars** (already present, re-homed under usat_apps' `.env`): `OPENAI_API_KEY` / `OPENAI_MODEL`,
  `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`, `SF_EMAIL_QUEUE_USER` / `SF_EMAIL_QUEUE_PASS` (SF read),
  `SF_EMAIL_QUEUE_ADMIN_*`, and `ASK_DB_*` for the Ask feature. The `EQ_*` file-path overrides retire as
  corrections/knowledge move to the platform data dir / DB.

---

## 7. Server architecture — do we build a new server?

Short answer for the fold-in: **no new server.** The email-queue operator app becomes a *module* that
mounts its routes onto the existing `server_usat_apps_8022.js`, exactly like Merge did. usat_apps boots
one Express server; `api/routes.js` calls `registry.mount_all(app)`, which invokes each module's
`mount(app)`. The standalone `server_salesforce_email_queue_8019.js` is retired at the end (like 8020) —
we are *removing* a server, not adding one.

The platform already contemplates the alternative, and it matters for the chatbot later:

- **Pattern A — `mount(app)` (default).** Routes live on 8022 behind the shared session/auth. Merge and
  the email-queue **operator** app use this. No new process, no new port.
- **Pattern B — `externalApi: true` (dedicated server).** A module contributes panels/nav for
  access-control but its routes are served by its *own* server process; `mount_all` skips it. This
  already exists in the repo: **`event_coi`** runs `server_event_coi_8023.js` this way.

So the contemplated split is:
- **Email-queue fold-in → Pattern A.** Nothing new to stand up; it rides 8022. No worker either — the
  app is read-only + synchronous AI, so unlike Merge there's no `8021`-style worker process to build.
- **Chatbot (later, its own plan) → Pattern B.** The public Team USA widget needs a *different trust
  boundary* — CORS origin allowlist, site key, rate limiting, **no session cookie**, and only the
  PII-safe `services/knowledge` + `services/ai`. That is a natural `externalApi:true` module with its
  own entrypoint (e.g. a `server_usat_apps_public_80xx.js`), so the public surface never shares
  middleware or trust with the authenticated staff app. Following the repo's `server_<name>_<port>.js`
  convention keeps it consistent with everything else.

Net: the fold-in reuses the shared server; the *only* new server we'd ever stand up is the chatbot's
public one, and that's deliberately isolated for security — not an accident of porting.

### 7a. "No new server" ≠ "no API/DB/AI layers"

A *server* (a process listening on a port) is different from the *layers* it hosts. We reuse the server;
we still port all three layers — they're the actual work:

- **HTTP API layer — yes, and it's central.** `modules/salesforce_email_queue/api.js` (ported from
  `web/routes.js`) is the Express route layer under `/api/salesforce-email-queue/*` — login-gated,
  panel-gated, the ~dozens of endpoints the UI calls. It *mounts onto* 8022 rather than booting its own
  server, but it is a full API layer.
- **MySQL / data layer — yes.** The analytics writer + the Ask-your-data reader talk to MySQL
  (`salesforce_email_queue_events`, `..._ask_log`, `..._ask_corrections`, and corrections/knowledge if
  DB-backed). These reuse the platform's existing `LOCAL_MYSQL_*` connection to `usat_sales_db` (shared
  pool/plumbing) but keep their **own queries and own tables** — the module owns its schema.
- **AI-integration layer — yes.** `services/ai/` is exactly the code that calls the OpenAI / Anthropic
  HTTP APIs (keys from `.env`), plus model/pricing and the respond/triage/ask/extract operations. It
  becomes a shared service so the chatbot calls the same layer.

So: **one shared server; three real layers ported.** What we avoid is duplicating the *server + auth +
session + boot* that the platform already provides — not the API routes, the DB access, or the AI calls,
all of which are the substance of the module.

---

## 8. Phased plan (initial phases in focus)

Each phase's **gate** is its ported tests staying green (see §6 test suite). Phases 0–3 are the initial
arc that gets the operator app fully running inside usat_apps; 4–6 finish admin/dashboards, unblock the
chatbot, and retire 8019.

**Phase 0 — Scaffold + decisions (done alongside this doc).** Module + `services/` + plans folders
created, nothing registered, platform unchanged. *Blocking decisions to confirm:* the `services/` seam
(recommended), corrections/knowledge storage (DB vs file first), default AI provider, and the
`email-queue` slug. **Gate:** skeleton reviewed; 8022 still boots unchanged. *No server work.*

**Phase 1 — Shared brain (`services/`).** Move `ai/` → `services/ai/`; `ai/faq.js` →
`services/knowledge/` (scope key generalized queue → scope); `store/corrections.js` →
`services/corrections/` (DB-backed decision from Phase 0). Port the brain-facing unit tests. No routes,
no UI, no server. **Gate:** `services/` tests green under `run_tests.js`.

**Phase 2 — Module API + SF read (mounts into 8022).** Port `sf/` into the module; port `web/routes.js`
→ `modules/salesforce_email_queue/api.js` under `/api/salesforce-email-queue/*`, gated by the
`email-queue` panel; add the manifest to `modules/registry.js` so `mount_all` wires it into the **existing**
server. Read-only, no UI yet. Port the routes/analytics tests. **Gate:** endpoints answer under `/apps`
behind the proxy; tests green. *This is the phase that proves "no new server" — it just registers.*

**Phase 3 — Operator UI (React rebuild).** Rebuild the vanilla page as `Section.jsx` + pages (queue &
filters + case cards in the module rail; thread + AI panel in the body — per the mockup). Register in
`web/src/modules/registry.js`. Port the Playwright E2E. **Gate:** parity checklist + E2E green. Biggest
single chunk of new work.

**Phase 4 — Admin settings + dashboards.** Port the EQ Settings (SF env, AI models/pricing, TEST-MODE
banner, landing), queue access (default + per-user), the Reference page, and the metrics dashboards on
the module's events table. Reuse platform users/panel-access/ops/Ask. **Gate:** admin + metrics tests green.

**Phase 5 — Chatbot can begin (Pattern B).** With `services/ai` + `services/knowledge` live and
scope-aware, the chatbot is a second consumer + a dedicated public server (`externalApi:true`) + the GTM
widget. Its own plan; not part of this fold-in.

**Phase 6 — Retire 8019.** Parity confirmed → retire the standalone server like 8020: runbook (copy the
merge one), pm2 stop/delete, remove scripts/proxy/tasks entries; keep all `SF_*` creds and the
`salesforce_email_queue_events` data. No worker to preserve this time.

---

## 9. Effort & risk

- **Risk: low–moderate.** Read-only + AI, no SF writes, no execution path, no worker. The scary parts of
  the merge port simply don't exist here.
- **Biggest chunk of work:** the React UI rebuild (Phase 3) — mechanical but sizable (one known layout).
- **Trickiest design:** the shared-service seam (Phase 1) and the PII boundary — worth getting right once
  because the chatbot inherits it.
- **Sequencing win:** Phases 1–2 (the brain + API) unblock the chatbot's *architecture* even before the
  operator UI is fully rebuilt, so the two efforts can overlap after Phase 2 if desired.

---

## 10. Open decisions (what I need from you)

1. **`services/` seam:** OK to introduce a top-level `src/usat_apps/services/` for the shared brain
   (vs. tucking it under the module and having the chatbot reach across)? Recommended: yes — it's the
   whole point of doing this now.
2. **Corrections/knowledge storage:** move both to DB tables during Phase 1 (recommended, and already on
   the email-queue's own roadmap), or keep the file-backed stores initially and migrate later?
3. **Default AI provider:** email queue defaults to OpenAI today. Keep that default in the shared service,
   or standardize on Anthropic? (Either; the abstraction supports both per call.)
4. **UI parity bar for Phase 3:** full parity with the vanilla page, or MVP-first (queues → thread →
   draft → corrections) with the knowledge editor following? Recommended: MVP-first, matching how we
   staged merge.
5. **Panel/name:** module id `salesforce_email_queue`, URL `/email-queue`, panel key `email-queue` — good,
   or prefer a shorter slug?
