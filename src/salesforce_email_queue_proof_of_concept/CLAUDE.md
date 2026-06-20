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
  prompt.js         SYSTEM (role + strict grounding rules) + respond/ask prompt builders
  context.js        build_context (tiers 1/2/4 + corrections); tier-3 deferred
  respond.js        respond_to_case -> verdict draft|need_info (conn + provider injected)
  triage.js         triage_case -> status (answer_ready|draft_possible|needs_info|non_actionable)
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

- **snake_case** for our identifiers (DOM/library names excepted).
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
- Auth: `.env` accounts carry a **role** (mirrors transform `admin_store` env+store pattern):
  `SF_EMAIL_QUEUE_ADMIN_USER/PASS` -> `a