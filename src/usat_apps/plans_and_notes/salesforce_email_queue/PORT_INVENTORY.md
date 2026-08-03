# Email Queue → usat_apps — port inventory

File-by-file mapping from `src/salesforce_email_queue_proof_of_concept` (source of truth read
2026-07-30) into the usat_apps module + shared services. Line counts are the current tree.

Legend for **Disposition**:
- **PORT** — moves nearly verbatim (light rewiring: data_dir → platform, auth → platform).
- **SHARE** — extracted to `src/usat_apps/services/` for reuse by the chatbot.
- **REBUILD** — reimplemented (vanilla → React).
- **DROP** — not re-ported; the platform already provides it.

## Backend brain

| Source | Lines | Disposition | Destination |
|---|---|---|---|
| `ai/index.js` + providers/models/respond/triage/ask/extract/context/prompt/spam (11 files) | ~802 | **SHARE** | `services/ai/` |
| `ai/faq.js` (knowledge loader) | (part of ai) | **SHARE** | `services/knowledge/` (scope key generalized queue → scope) |
| `sf/` — index, sf_context, sf_queues, sf_threads, text_clean (5 files) | ~303 | **PORT** | `modules/salesforce_email_queue/sf/` |
| `store/corrections.js` | ~part of 134 | **SHARE** | `services/corrections/` (→ DB, Track C) |
| `store/queue_access.js` | ~part of 134 | **PORT** | `modules/salesforce_email_queue/store/` |
| `web/routes.js` (JSON API + SSE) | ~511 | **PORT** | `modules/salesforce_email_queue/api.js` → `/api/salesforce-email-queue/*` |
| `data_dir.js` | ~53 | **DROP/rewire** | platform `data_dir.js` |
| `menu.js` / `src/cli.js` / `src/admin.js` | ~475 | **PORT (trim)** | `modules/salesforce_email_queue/menu.js` (CLI entry) |
| `verify_sf_access/` | ~277 | **PORT (dev tool)** | keep as a module dev utility |

## UI

| Source | Lines | Disposition | Destination |
|---|---|---|---|
| `web/public/index.html` (vanilla HTML+CSS+JS, 3-pane) | ~890 | **REBUILD** | `web/src/modules/salesforce_email_queue/Section.jsx` + `pages/` |
| `web/public/favicon.svg` | — | reuse platform | — |

## Admin & metrics — framework REUSED, domain layer PORTED

The standalone app has a robust admin (Overview/config-status, Settings, Access, Operations, Logs,
Reference) and a rich metrics dashboard. These do **not** get dropped — they split into "framework the
platform already provides (reuse)" and "Email-Queue domain layer (port)".

| Source | Lines | Disposition | Notes |
|---|---|---|---|
| `auth/` (auth_store, require_auth, session) | ~145 | **REUSE** | platform `auth/` is the same signed-cookie pattern + roles + .env recovery |
| `admin/` (console_registry, console_runner, log_ring) — Operations + Logs | ~404 | **REUSE** | platform **ops** module = health/routes/pm2/logs/cron/system commands |
| Admin **Overview** (config-status booleans) | (in web/routes) | **REUSE pattern** | platform has the same status idea |
| Admin **Access** — users + roles | (in web/routes) | **REUSE** | platform admin users + panel-access |
| Admin **Access** — queue access (general default + per-user overrides) | (in web/routes + `store/queue_access.js`) | **PORT** | EQ-specific: which SF queues a non-admin sees |
| Admin **Settings** — SF env switch, AI models & pricing, TEST-MODE banner, admin landing | (in web/routes) | **PORT** | EQ domain config; the models/pricing list is shared by the app picker + Ask |
| Admin **Reference** (system reference text) | (in web/routes) | **PORT (light)** | small static doc, mirror merge's Reference page |
| `metrics/` framework — events table + report + **Ask-your-data** (SQL-guarded AI) | ~836 | **REUSE framework, keep table** | platform metrics report + Ask; keep `salesforce_email_queue_events` + `..._ask_log` / `..._ask_corrections` |
| Metrics **dashboards** — funnel, verdicts, AI-by-queue/provider/action, cases-worked, corrections/context changes, AI spend + cost-by-model | (in `metrics/`) | **PORT** | EQ-specific charts on the module's own events table |

## Tests — a porting asset (~16 node tests + Playwright E2E)

The app ships a robust harness, all runnable from the Operations console. These come *with* the code and
are the parity gate — keeping them green is the acceptance criterion for each phase.

| Source | Lines | Disposition |
|---|---|---|
| Brain-facing: `ai`, `ask`, `extract`, `triage`, `spam`, `text_clean`, `sf_threads`, `faq_corrections`, `queue_access` | ~half of 1,089 | **PORT** alongside the moved code → usat_apps `tests/` |
| Platform-facing: `auth`, `admin_users`, `console`, `analytics`, `metrics`, `routes`, `lint_snake_case` | ~half of 1,089 | **PORT/adapt** to platform equivalents (auth/console/access now platform-owned) |
| `e2e/app.spec.js` (Playwright web E2E) | — | **PORT** → usat_apps `e2e/` |
| Harness | — | run under platform `run_tests.js`; each test stays an ops "Run" command |

## Rollup

- **~1,750 backend lines port nearly as-is** (ai + sf + store + routes).
- **Admin/metrics is a split, not a drop:** the *framework* (auth, roles, panel access, ops console,
  metrics-events + Ask) is **reused** from the platform (~1,400 lines not re-written); the EQ *domain
  layer* — a **Settings** page (SF env, AI models/pricing, banners), **queue access**, and the
  **dashboards** (funnel, verdicts, cases-worked, cost-by-model) — **ports** as module code.
- **~890 vanilla UI lines rebuilt in React** — operator app; the Settings + dashboards add a second,
  smaller React surface built on platform primitives.
- **Analytics are already PII-free** (counts/enums + staff username + queue name) — which is what lets
  the same events safely coexist with the chatbot's no-PII boundary.
- **No SF writes, no worker, no execution surface** — the low-risk part of the estimate.

## Env vars (re-home under usat_apps `.env`)

`OPENAI_API_KEY` / `OPENAI_MODEL`, `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`,
`SF_EMAIL_QUEUE_USER` / `SF_EMAIL_QUEUE_PASS`, `ASK_DB_HOST|PORT|NAME|USER|PASSWORD`.
Retire the `EQ_*` file-override vars as corrections/knowledge move to the platform data dir / DB.
