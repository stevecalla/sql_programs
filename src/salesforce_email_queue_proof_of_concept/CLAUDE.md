# CLAUDE.md — context for reviewing/working on this project

Read this first when reviewing or extending the code. Keep it current as the code changes.

## What this is

A **read-only proof of concept**: an AI assistant that helps USA Triathlon staff respond to
emails in Salesforce queues. It browses a queue, reads a Case's full email thread + attachments,
pulls the sender's prior history + a per-queue FAQ + operator corrections, and asks an LLM to either
draft a reply or say "not enough info." Two surfaces over one engine: a color CLI (`menu.js`) and a
web app (`server_salesforce_email_queue_8019.js`). **Nothing is ever written/sent to Salesforce.**

## Status (built so far)

- A — SF read layer (queues, threads, attachments, sender history, status/message counts) ✅
- B — attachment text extraction ✅
- C — AI layer (provider select, prompt+guardrails, respond/ask) ✅
- D — local auth (scrypt users + signed-cookie sessions) ✅
- E — Express server + auth-gated JSON API ✅
- F — single-page web UI ✅
- G — per-queue FAQ + operator corrections ✅
- Tests: 50 passing across 8 suites (unit + route-integration) (`node --test`, no network) ✅

Deferred (documented, not built): SF write-back (close/status/send), tier-3 queue-wide learning,
per-user Salesforce identity (OAuth/Connected App).

## File map

```
sf/                 Salesforce reads (connection/plumbing reused from ../race_results_transform/sf)
  index.js          single import surface
  sf_queues.js      list_queues (+ open counts)
  sf_threads.js     list_queue_cases, get_thread (quoted-history stripped + attachments),
                    cases_with_attachments, status_counts, message_counts, is_automated_sender
  sf_context.js     get_sender_history (by SuppliedEmail)
  text_clean.js     html_to_text, strip_quoted_history (pure, tested)
ai/
  providers.js      OpenAI (default) + Anthropic via fetch; transport injectable for tests
  models.js         SINGLE model registry (list/default_model/price_for/cost_for) — the one source of
                    truth for triage/draft/ask AND the metrics Ask box. EDITABLE in /admin -> Settings
                    (config.json `ai_models`: provider/model/label/is_default/price_in/price_out);
                    falls back to BUILTIN (OpenAI tracks OPENAI_MODEL, Sonnet tracks ANTHROPIC_MODEL).
                    Prices (USD/1M tok, seeded from vendor pages) drive ai_cost_usd. Served /api/ai/models.
                    complete() returns {text,usage,model}; providers.norm_completion normalizes legacy
                    string returns. Token+cost columns: ai_prompt_tokens/ai_completion_tokens/ai_cost_usd.
  prompt.js         SYSTEM (role + strict grounding rules) + respond/ask prompt builders
  context.js        build_context (tiers 1/2/4 + corrections); tier-3 deferred
  respond.js        respond_to_case -> verdict draft|need_info (conn + provider injected)
  triage.js         triage_case -> status (answer_ready|draft_possible|needs_info|spam|awaiting_reply|
                    non_actionable). classify_local short-circuits (no AI): no-inbound/bounce ->
                    non_actionable, clear cold/bulk spam (ai/spam.js) -> spam, trailing staff reply ->
                    awaiting_reply. AI prompt gets SENDER + spam SIGNALS + strengthened SPAM criteria.
  spam.js           CONSERVATIVE local spam heuristic (looks_like_spam/signal_summary) — cold-outreach
                    OR opt-out+marketing OR many-links+marketing; tunable constants; no headers used.
  ask.js            ask_about_case
  extract.js        attachment bytes -> text (text native; pdf/docx/xlsx via OPTIONAL deps)
  faq.js            knowledge loader: ALL knowledge from the EXTERNAL context folder (via ../data_dir.js
                    -> determineOSPath; _global + /<slug>; md/csv/txt/html native, pdf/docx/xlsx opt, images stored)
  index.js
auth/
  auth_store.js     scrypt hash/verify, JSON user store, .env recovery account, session_secret
  session.js        HMAC signed-cookie sign/verify (no express-session dep)
  require_auth.js   Express middleware
store/
  corrections.js    in-memory + JSON corrections (grounding_lines injected into prompts)
web/
  routes.js         JSON API (login/logout public; rest auth-gated); SF conn cached; no writes
  public/index.html single-page app: login; resizable 3-pane; numbered+checkable queue with
                    status counts; sticky case header; collapsible newest-first thread + de-dupe
                    toggle; editable draft + mock send; ask chips + history; mock status; context upload
src/
  cli.js            CLI: assist (guided), queues, statuses, thread, draft, ask, corrections
  admin.js          user management (add/list/remove)
menu.js             RRT-style launcher (color sections, prefs toggle, banners, per-suite test headers)
tests/              node --test: text_clean, sf_threads, extract, ai, faq_corrections, auth
data_dir.js         resolves the EXTERNAL data root (<determineOSPath()>/usat_email_queue) for ALL
                    runtime data: context/, auth.json, corrections.json. Nothing data-related in the repo.
plans_and_notes/    plan.md, mvp_plan.md, salesforce_api_requirements.md, build_review.md, brief.docx
../../server_salesforce_email_queue_8019.js   repo-root web server
```

## Conventions

- **snake_case** is the standard for our own identifiers. Be strict where it's a data/contract surface
  (DB columns, analytics event/prop names, `config.json` keys, model-registry fields like `price_in`,
  and Node module functions/vars). Three pragmatic exceptions, by design — don't "fix" these:
  (1) **DOM + library + platform APIs** stay as-is (`getElementById`, `addEventListener`, `toISOString`);
  (2) the **JSON request contract** uses camelCase on the wire (`caseId`, `queueId`, `caseNumber`) and the
  server maps it to snake_case for storage (`case_id`, `queue_id`) — renaming the wire keys would churn
  client+server+tests for no gain;
  (3) the **browser SPA (`index.html`) has legacy camelCase** render/UI functions (`renderLeft`,
  `loadCases`, `triageVisible`); new *standalone logic* helpers there should be snake_case
  (`clear_working_state`, `retriage_visible`, `ai_banner`), but a new function that mirrors a camelCase
  family is allowed to match its siblings (e.g. `loadModels` next to `loadCases`/`loadCounts`).
  **Enforced** by `tests/lint_snake_case.test.js` (ported from the transform): it scans our source
  (comments/strings/`<style>` stripped) for camelCase and fails on any token not in `ALLOWED` (genuine
  DOM/Node/jsforce/Express/mysql2/crypto/analytics-client names) or a harvested DOM element id. When it
  flags a genuine library name, add it to `ALLOWED`; otherwise rename to snake_case. (It lints the app
  modules + `web/public/index.html` + the server + tests; the `/metrics` & `/admin` HTML are not linted,
  matching the transform, which doesn't lint its dashboard markup either.)
- **Injectable dependencies** so everything is unit-testable with **no network**: SF functions take a
  `conn` (mocked in tests), `respond/ask` take `complete`/`conn`, providers take a `transport`.
- Reads reuse `race_results_transform/sf` for the connection, `run_soql`, `fetch_content_version_bytes`,
  and date formatting. The POC's `sf/index.js` is the single import surface.
- No new npm installs are assumed (registry was unavailable); attachment parsers are
  `optionalDependencies` and degrade gracefully if absent.

## Guardrails (important)

- **Strict grounding:** the AI must use only the provided context (this thread, sender history,
  attachment text, FAQ, corrections) and must NOT invent specifics (timeframes, emails, prices,
  dates, policies). If it can't answer from context it returns NEED_INFO. (We observed it hallucinate
  "4-6 weeks" — hence the strict prompt + the FAQ/corrections tiers.)
- **Bounces / no-reply senders** (e.g. mailer-daemon) are flagged non-actionable, not drafted to.
- **Automated vs human:** outbound created by "Automated Process"/"System" is an auto-ack, marked and
  excluded from "answered" judgement; included in the thread so the AI knows what was already sent.
- **No SF writes:** `/api/send` returns 403; the UI "send" button is disabled. By design.

## How to run

```
cd src/salesforce_email_queue_proof_of_concept
node menu.js            # interactive: tests, SF verify, browse & assist, server, users
node menu.js test       # headless: run all suites
node src/admin.js add   # create a web-app login
node ../../server_salesforce_email_queue_8019.js   # web app at http://localhost:8019
```

Env (repo-root `.env`): `SF_PROD_*` (reads), `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (AI).
Web login: set `SF_EMAIL_QUEUE_ADMIN_USER` / `SF_EMAIL_QUEUE_ADMIN_PASS` (role admin) and/or `SF_EMAIL_QUEUE_USER` / `SF_EMAIL_QUEUE_PASS` (role user) in the repo-root `.env`; or add stored users via `node src/admin.js add`.

## Reference docs

`plans_and_notes/`: `salesforce_api_requirements.md` (SF data model + decisions + §11 per-user
identity, §12 AI tools, §13 API limits), `mvp_plan.md`, `plan.md` (full roadmap + native-vs-build),
`build_review.md` (this build's review guide), and the team `.docx` brief.

## Update notes (keep current)

- No `package.json` at this folder level (by request) - dependencies install at the **repo root**
  (`pdf-parse`, `mammoth` already listed there). Scripts run directly: `node menu.js`, `node src/cli.js`,
  `node ../../server_salesforce_email_queue_8019.js`.
- There is NO in-repo data folder. ALL knowledge + runtime/sensitive data (context, auth.json, corrections.json) lives OUTSIDE the repo via `data_dir.js` -> `determineOSPath()` (`<base>/usat_email_queue/`). Knowledge = the context folder only (no separate FAQ). Uploads allow text/docs + images.
- Web API additions: `/api/context` (GET list, POST upload base64), `/api/status-counts`, ask history
  param on `/api/ai/ask`; `/api/ai/triage` (per-case AI status). Admin: `node src/admin.js passwd <user>` (passwords are scrypt-hashed - never shown).
- `/api/queues` also returns `instance_url` (for SF deep links); `/api/context` also returns `knowledge_chars` + `corrections` (grounding indicator). UI: queue search box, editable per-row status (mock), SOQL/Workbench card, auto-draft on `answer_ready`.
- More API: `/api/me` (current user/role — also used by the server-rendered /metrics & /admin pages to
  stamp their client-side view events), `/api/ai/models` (the shared model registry for the picker),
  `/api/admin/config` (GET+POST `admin_landing` and the editable `ai_models` list), and
  `/api/attachment/:cvid/raw` (streams attachment bytes through our SF session so images/PDFs render
  inline without a separate Salesforce login — the in-app image viewer + PDF iframe use it).
- UI workspace helpers (snake_case, `index.html`): `clear_working_state` (clears queue/status/checked +
  view toggles; runs on sign-in AND sign-out so a fresh login is blank, prefs kept), `reset_app` (↻ Reset
  = full blank slate, stays signed in), `retriage_visible` (↻ Refresh triage — enabled only after a run).
  `session_id` is per-login (sessionStorage via `UsageMetrics.new_session()` at login); `visitor_id` stays
  durable. A failed AI call shows an `error` triage badge + a dismissible provider-down banner (`aiBanner`).
- Context storage is OUTSIDE the repo (member data never committed), via `data_dir.js` ->
  `utilities/determineOSPath()` -> `<base>/usat_email_queue/context/` (mirrors transform `src/data_dir.js`).
  `ai/faq.js` context fns are async (await `context_dir()`); overrides `EQ_CONTEXT_DIR`/`EQ_DATA_DIR`/
  Server seeds a SAMPLE knowledge file (`knowledge_SAMPLE.md`) on startup and logs the folder path.
- Auth + corrections now also live OUTSIDE the repo via `data_dir.js` (`<base>/usat_email_queue/auth.json`,
  `corrections.json`); overrides `EQ_USERS_FILE`/`EQ_CORRECTIONS_FILE`. Resolved with `determineOSPathSync()`
  (added to `utilities/determineOSPath.js`) since those stores are sync. In-app `data/` = curated FAQ only.
- - **Vision enabled**: `ai/providers.js` `complete()` accepts `images` (multimodal for OpenAI + Anthropic);
  `ai/faq.js` `load_context_images()` reads png/jpeg/gif/webp from the context folder (<=4 imgs, <=4MB);
  `respond`/`ask` pass them via routes. Uploaded context images become real grounding.
- - Full productionization plan: `plans_and_notes/path_to_production.md` (SF writes, per-user identity, DB).
- **Metrics & admin** (mirrors transform; reuses `utilities/analytics/*`): admin-gated `/metrics`
  dashboard + `/admin` hub, served by `server_8019` and gated by the existing session with role
  `admin` (`auth/require_auth.js` adds `require_admin` + `require_admin_page` — no second cookie).
  Per-app config in `metrics/metrics_config.js` (APP/TABLE/COLUMNS); aggregation in
  `metrics/metrics_report.js`; CLI `metrics/metrics_cli.js` (stats/size/purge-test). Table DDL:
  `src/queries/create_drop_db_table/query_create_salesforce_email_queue_events_table.js` (created on
  startup via `ensure_table`). **AI-call events are logged server-side** in `web/routes.js`
  (provider/action/verdict/latency/ok/grounded — no content); browser logs page/queue/thread/attachment/
  correction/context/soql/reply_copied via `metrics_client.js` (loaded in `index.html`).
- **Per-case tracking + SF-write outcome**: opening an email sets a sticky `case_id`/`case_number`
  context (browser via `M.setCase`; cleared on queue change) that rides on all later events; server
  events get it from the request body. `/api/send` + `/api/status` log `send_email`/`status_change`
  with `sf_action`/`sf_ok`/`sf_error`/`status_to` (mocked → sf_ok=0; flips to 1 when real). New columns
  (`case_id, case_number, sf_action, sf_ok, sf_error, status_to`) migrate via `ensure_columns`. The
  report excludes `is_test=1` from real stats, fixes acknowledge (counts `ai_action='acknowledge'`),
  and adds per-case table (asks/corrections/context/sends/status/attachments), case funnel, SF-writes,
  context-changes, corrections-by-scope, reply-copied. Browser visit fires AFTER sign-in (carries actor;
  `metrics_client` `autoPageView:false`). `?metrics_test=1` is **per-load only** (not persisted) so a
  user's real activity is never mis-flagged. **`?metrics_test=1`** stamps `is_test=1`; purge via `/admin`,
  CLI, or `npm run email_queue_metrics_purge_test`. **No member PII** (counts/enums + staff username +
  queue name + SF record ids only). Writes hit only the local MySQL DB.
- **Queue allow-list** (`store/queue_access.js`, external `queue_access.json`, override
  `EQ_QUEUE_ACCESS_FILE`): general default + per-user overrides; admins bypass. Enforced in
  `/api/queues` (filter) + `/api/cases`/`/api/status-counts` (403). Managed via `/api/admin/queue-access`.
- **Ask your data** (ported from transform `metrics/ask/*` — identical require depths, so near-verbatim):
  `ask.js` (plan→guarded SELECT→answer), `sql_guard.js` (read-only enforcement: single SELECT/WITH,
  allow-listed table, blocked keywords stripped from comments/strings, row cap), `db.js` (read-only pool;
  prefers `ASK_DB_*`, else analytics creds), `tools.js`, `context.js` + `context/events_context.yaml`
  (email-queue schema grounding), `live.js` (live snapshot from build_report), `corrections.js` +
  `ask_log.js` (MySQL tables `<APP>_ask_corrections` / `<APP>_ask_log`, created on startup), `models.js`
  (now a thin re-export of `ai/models.js` — one shared registry), and a `pick_provider` that delegates
  to the shared `ai/providers.complete()` (the per-ask `providers/{openai,anthropic}.js` adapters were
  removed — one transport for all AI). Server routes (require_admin): `/api/metrics-ask`, `-ask-models`,
  `-ask-correct`, `-ask-thread`. Dashboard has the Ask panel (model picker, SQL-mode toggle, chips,
  results table + chart, save-correction, history) + a "most recent active users" table
  (`recent_operators` in metrics_report). Consistent footer (App · Admin · Metrics, all `?metrics_test=1`)
  on all three pages.
- New test suites: `tests/metrics.test.js`, `tests/queue_access.test.js`, `tests/analytics.test.js`,
  `tests/ask.test.js` (71 tests / 12 files total). All pure (fake pool / temp JSON / injected provider —
  no DB or network needed); `ask.test.js` covers the SQL guard + the ask() brain end to end.
- Auth: `.env` accounts carry a **role** (mirrors transform `admin_store` env+store pattern):
  `SF_EMAIL_QUEUE_ADMIN_USER/PASS` -> `a