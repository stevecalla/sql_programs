# Salesforce Email Queue Assistant (Proof of Concept)

An AI assistant that helps USA Triathlon staff respond to emails in Salesforce queues, faster and
more consistently. It reads a Case's full email thread + attachments, pulls the sender's history, a
per-queue FAQ, and operator corrections, then drafts a reply — **or clearly says it doesn't have
enough information.** A human always reviews. **Nothing is ever sent to Salesforce** (read-only POC).

## Quick start

```
cd src/salesforce_email_queue_proof_of_concept
node menu.js
```

The menu (color-coded) gives you:

- **Tests** — run all suites (or individually); each prints its own header.
- **Salesforce (read-only)** — verify access, list queues, list case statuses.
- **AI assistant** — *Browse & assist*: pick a queue → status → email, view the color-coded thread,
  then **draft a reply**, **ask a question**, or add a **correction**. No record IDs needed.
- **Server & users** — start the web app, add/list logins.

Headless test run (e.g. CI): `node menu.js test`

## Web app

```
node ../../server_salesforce_email_queue_8019.js     # then open http://localhost:8019
```

Single page: queue/email list on the left, the email thread + attachments in the middle, and an AI
panel (suggested reply, ask-a-question, correction box, and a disabled "send" button) on the right.

Create a login first: set `.env` accounts (always valid, carry a role for future access control):
`SF_EMAIL_QUEUE_ADMIN_USER` / `SF_EMAIL_QUEUE_ADMIN_PASS` (admin) and/or `SF_EMAIL_QUEUE_USER` /
`SF_EMAIL_QUEUE_PASS` (user). You can also add stored users with `node src/admin.js add`.

## Configuration (repo-root `.env`)

- `SF_PROD_*` — Salesforce credentials (reads run as the integration user).
- `OPENAI_API_KEY` (default model `gpt-4o-mini`) and/or `ANTHROPIC_API_KEY` (Claude, default `claude-sonnet-4-6`).
- Optional model overrides: `OPENAI_MODEL`, `ANTHROPIC_MODEL`. These seed the **one model registry**
  (`ai/models.js`) that drives every AI feature — triage, draft, ask, and the metrics Ask box.
  The registry (selectable models **and** their USD-per-1M-token prices) is **editable at runtime in
  `/admin` → Settings** (saved to the external `config.json` as `ai_models`); the in-app picker and the
  Ask box both read it. Prices feed cost tracking (`ai_cost_usd`) and are seeded from the vendors'
  pricing pages — edit them when prices change. Models with no price simply show $0.
- Web-app logins (`.env` accounts, always valid, each carries a role used for access control):
  - `SF_EMAIL_QUEUE_ADMIN_USER` / `SF_EMAIL_QUEUE_ADMIN_PASS` — role `admin` (also gates `/metrics` + `/admin`).
  - `SF_EMAIL_QUEUE_USER` / `SF_EMAIL_QUEUE_PASS` — role `user`.
  - (Stored, scrypt-hashed users can also be added with `node src/admin.js add`.)
- Analytics DB (optional; same local MySQL the other servers use via `utilities/config.js`):
  `LOCAL_HOST`, `LOCAL_MYSQL_USER`, `LOCAL_MYSQL_PASSWORD`, `LOCAL_USAT_SALES_DB`. If unset/unreachable,
  analytics simply no-ops (the app is unaffected). Disable entirely with `METRICS_OFF=true`.

## Attachment parsing (optional)

Text/CSV/HTML attachments work out of the box. For PDF/DOCX/XLSX, install the optional parsers:

```
npm install        # installs pdf-parse, mammoth, xlsx (optionalDependencies)
```

Without them, attachments show a labeled placeholder instead of extracted text.

**Viewing attachments in-app.** Images (jpg/jpeg/png/gif/webp/…) and PDFs render **inline** in the case
view, streamed through the app's authenticated Salesforce connection via `GET /api/attachment/:cvid/raw`
(so no separate Salesforce browser login is needed); tables (csv/tsv/xls/xlsx) render as a grid and other
types show extracted text. A "⬇ Download" chip always links the original Salesforce file as a fallback.

## What it will NOT do (by design, this POC)

- It does not send replies or change Case status in Salesforce (read-only).
- It does not invent facts; if the answer needs a specific it can't find in context, it asks for it.
- It does not draft replies to automated bounces / no-reply senders (flags them for triage).

## More detail

See `CLAUDE.md` (architecture + conventions) and `plans_and_notes/` (requirements, MVP plan, full
roadmap with the native-Salesforce-vs-build comparison, and the build review guide).


## Adding your own context files (knowledge the AI reads)

Context lives **outside the repo** (so member data is never committed), resolved cross-platform via the
shared utility pattern (`data_dir.js` -> `utilities/determineOSPath()`), at
`<base>/usat_email_queue/context/` (e.g. `.../usat/data/usat_email_queue/context/` on linux/mac). Drop reference
files there and the assistant reads them as grounding:

- `<context>/_global/` - applied to EVERY queue
- `<context>/<queue_slug>/` - applied to that queue only (e.g. `coaching`, `event_services`, `rankings`)

Two ways to add context from the web app's **Context files** card (each file has **view** + an **exclude/include** toggle that keeps the file on disk but skips it for grounding):
1. **Add a file** - upload one file into the context folder.
2. **Choose a folder from your computer** - the browser reads a local folder (File System Access API;
   falls back to a folder picker on Safari/Firefox) and sends its files into the context store.

All knowledge (FAQ-style facts, policies, contacts, rosters) goes here for now - it is the single
grounding source. Overrides: `EQ_CONTEXT_DIR` (point at any local folder; uploads write there too) and
`EQ_DATA_DIR` (project data root). A SAMPLE file (`knowledge_SAMPLE.md`) is seeded into `_global` on
first run so grounding works out of the box; the server logs the folder path at startup.

Supported (text-extracted): `.md` `.txt` `.csv` `.tsv` `.html` `.json` `.xml` `.log` `.yaml`/`.yml` `.rtf`,
and (with optional parsers via `npm install`) `.pdf` `.docx` `.xlsx` `.xls`. **Images** are read by the AI via **vision**: `.png` `.jpg/.jpeg` `.gif` `.webp` in the context folder are
sent to the model as grounding (up to 4 images, <=4MB each). Other image types (`.bmp/.tif/.heic/.svg`)
and binaries are stored/listed but not sent. Total text context is capped (~20k chars) per request.

See what's currently loaded: `node src/cli.js context [queue]` (or menu -> View context files).
This is the single place to give the AI real USAT facts (policies, timelines, contacts) so it stops
guessing - alongside operator corrections.

## Web app features

Login (auth-gated) - 3 **resizable** panes:
- **Queue:** pick queue + status (with per-status counts + summary); numbered case list with checkboxes
  to tick off items, status / message-count / attachment chips.
- **Thread:** sticky header (case # + count); newest-first, each message **collapsible** (date + role);
  a "hide quoted/repeated text" toggle to cut clutter; attachments openable.
- **AI status (triage):** per-case badge (answer ready / draft possible / needs info / no action / spam /
  awaiting reply), shown in the thread header and on queue rows; an "AI triage visible" button tags the
  listed cases. Each badge's **tooltip** shows the reason **and the source** — "Local rule (no AI)" vs
  "AI · <model>"; badges decided by a **local rule** (no inbound message, bounce/no-reply sender, or
  awaiting the customer — no API call) are marked with a trailing **`*`**. Failed triage shows **⚠ Failed**
  with the provider error on hover (never a fabricated status).
- **Spam handling:** a conservative local heuristic (`ai/spam.js`) flags **clear** cold/bulk/marketing
  outreach (SEO/link-building/guest-post pitches, unsubscribe + promo content, link-heavy blasts) with no
  AI call; anything ambiguous goes to the model, which is given the **sender + signals** (link count,
  unsubscribe present) and is told to prefer SPAM for cold/bulk marketing unrelated to triathlon. Cheaper
  models (e.g. Haiku) miss more spam — pick a stronger model for better triage.
- **AI panel:** Draft reply (verdict + **editable** draft you can edit/compose and "Send" - mocked,
  returns the not-enabled message); Ask with **preset chips** + running **history**; **mock** case-status
  update (not connected); **context upload** (drop files the AI will read).

## What we track (events)

Every event row carries: `actor` (staff username), `queue`/`queue_id`, a timestamp, `is_test`, and —
once an email is opened — the current `case_id`/`case_number`, so all activity is attributed to that
case until another email is opened (per-case funnel). **No member PII** (no names, bodies, addresses):
only counts, enums, the operator's username, the queue name, and Salesforce record ids.

| Event | Fires when | Key fields | Where it shows |
| --- | --- | --- | --- |
| `page_view` | after sign-in | visitor/session, env | Visits card |
| `queue_viewed` | a queue is selected (dropdown) | queue | (events / Ask) |
| `cases_listed` | **View** clicked — case list loaded | queue, status/dates | (events / Ask) |
| `thread_opened` | an email is opened (sets case context) | thread_msg_count, has_attachment | Threads card, Cases, funnel |
| `ai_call` · respond | **Draft reply** button | ai_verdict, latency, grounded, corrections_used | AI calls, Verdicts, by-action, Cases |
| `ai_call` · ask | Ask a question | latency, grounded | by-action, Cases |
| `ai_call` · acknowledge | **Acknowledge receipt** (holding reply) | latency | Acks card, by-action, funnel |
| `ai_call` · triage | AI status check | ai_intent | by-action |
| `attachment_viewed` | an attachment is opened | attachment_type | Attachments table, Cases |
| `correction_added` | a correction is saved | correction_scope | Corrections-by-scope, Cases |
| `context_changed` | context file upload/exclude/include | context_action | Context-changes panel, Cases |
| `reply_copied` | the draft is copied | ai_reply_chars | Replies-copied count, Cases |
| `soql_run` | a read-only SOQL is run | soql_chars | (events / Ask) |
| `context_viewed` | a context file is opened/previewed | attachment_type | (events / Ask) |
| `link_previewed` | a link in an email is previewed | — | (events / Ask) |
| `model_selected` | user switches the AI model | ai_provider, ai_model | (events / Ask) |
| `theme_changed` | user toggles light/dark | theme | (events / Ask) |
| `sign_out` | user signs out | — | (events / Ask) |
| `app_reset` | user clicks ↻ Reset (blank workspace) | — | (events / Ask) |
| `send_email` | **Send reply** (mocked) | sf_action, sf_ok, sf_error | Salesforce-writes panel, Cases |
| `status_change` | Case status changed (mocked) | status_to, sf_ok, sf_error | Salesforce-writes panel, Cases |
| `dashboard_view` / `admin_view` | `/metrics` or `/admin` opened | logged client-side → full meta (session_id, tz, viewport, theme); `is_test=1` via the page URL | excluded from real stats |

Every event carries `visitor_id` + `session_id` for end-to-end correlation. The three identity fields are
layered: **`visitor_id`** is the durable, anonymous per-browser id (cookie + localStorage, ~2 years) —
the join key for "who, over time"; **`session_id`** identifies **one sign-in/sitting** (minted per login,
held in `sessionStorage` so it's stable across the app → `/metrics` → `/admin` page hops and tab refreshes,
and reset on a new login or new tab) — the key for per-session rollups; **`actor`** is the signed-in
username. Server-logged events (`ai_call`, `send_email`, `status_change`) get these from ids the client
sends on the request; page navigations like `dashboard_view` read `visitor_id` from the `um_visitor_id`
cookie. AI calls also record the resolved `ai_model` (e.g. `gpt-4o-mini`). The app
header has **one model picker** (populated from `/api/ai/models` → `ai/models.js`); the chosen model is
sent with every triage / draft / ask request, so `ai_model` reflects exactly what was selected.

AI calls additionally record **token usage + estimated cost**: `ai_prompt_tokens` / `ai_completion_tokens`
(from the provider's usage block) and `ai_cost_usd` (= tokens × the per-model price from the registry).
The `/metrics` dashboard surfaces cost as a KPI, an **AI cost by model** table, and a per-case **Est. cost**
column. Prices are editable in `/admin` → Settings, so cost is an estimate you control — never billed data.

Salesforce writes (`send_email`, `status_change`) are **disabled** in this POC, so the **attempt** is
recorded with `sf_ok=0` + a reason; when real writes are wired up, `sf_ok` flips to 1 on acceptance or
records the error — so "received by Salesforce vs error" is visible either way. The dashboard's
**Cases worked** table breaks each email's activity into AI calls / asks / drafts / corrections /
context / sends / status changes / attachments, and the **per-case funnel** is Opened → AI-assisted →
Drafted → Sent → Status-changed. Real stats exclude `is_test=1` rows (admin views + test sessions),
which remain purgeable.

## Metrics & admin (usage analytics)

Two admin-only pages, modeled on the transform app's `/metrics` + `/admin` and reusing the shared
analytics core (`utilities/analytics/*`). Both are gated by the existing session with role `admin`
(no second login); admins also get **📊 Metrics** and **⚙ Admin** links in the app header.

- **`/metrics`** — usage dashboard. KPI cards + Chart.js charts for the **AI flow**: calls by provider
  (ChatGPT/Claude), respond **verdicts** (DRAFT/NEED_INFO), success rate + latency, grounded %, calls
  by queue and by action (respond/ask/acknowledge/triage), activity by day, top actors, AI errors,
  attachments viewed, and a **data-health** strip. Pick a window (1/7/30/90 days).
- **`/admin`** — config-status strip (booleans only — never secrets) plus the **queue allow-list**:
  set the **general default** (all queues, or only selected) and **per-user overrides**. Non-admins
  only see/READ queues they're permitted (`/api/queues` filters; `/api/cases` 403s otherwise). Admins
  always see everything. Also a **🧪 Purge test rows** button.

**Test mode + purge.** `is_test=1` is driven **only by the `?metrics_test=1` URL parameter** (never by
session/role state) — when a page loads with it, every event from that browser session is stamped
`is_test=1`. To make **all admin activity removable**, admins are wired to always carry it: after sign-in
an admin is routed to their landing page **with `?metrics_test=1`**, and the cross-area nav links
(App · Metrics · Admin) are **admin-only and all carry the param** — so an admin moving between pages,
and signing out, stays flagged the whole time. Regular users get **no cross-area links and no param**,
so their activity is always real. Test rows are separable and **deletable** later via `/admin` → Purge
test rows, the CLI (`node metrics/metrics_cli.js purge-test`), or `npm run email_queue_metrics_purge_test`.

**Workspace state + reset.** The selected queue, status filter, and checked cases are saved per browser
(`eq_queue` / `eq_status` / `eq_checked`) so a mid-session **page refresh keeps your place**. They are
cleared on **sign-in and sign-out** (`clear_working_state`), so a fresh sign-in always starts blank and
nothing leaks between users on a shared browser; genuine preferences (theme, model pick, column widths)
persist. The header **↻ Reset** button returns the app to a full blank slate (also resetting those prefs)
without signing out. Triage never auto-runs on a model change (avoids surprise API cost); the **↻ Refresh**
button by "AI triage visible" force-re-triages the visible cases and is enabled only once triage has been
run (nothing to refresh otherwise).

**What's tracked.** AI-call events are logged **server-side** (provider, action, verdict, latency,
success, grounded, images, corrections applied — never message content); the browser logs page views,
queue/thread opens, attachment views, corrections, context changes and SOQL runs. Events go to the
`salesforce_email_queue_events` table (created on startup; created by
`src/queries/create_drop_db_table/query_create_salesforce_email_queue_events_table.js`). **No member
PII** is stored — no names, bodies, addresses, or Case ids; just counts/enums, the operator's staff
username, and the queue name. Analytics writes go only to the local MySQL DB, never to Salesforce.

**Ask your data (AI/search).** The dashboard has an "Ask your data" panel (ported from the transform):
type a natural-language question and the assistant plans a **read-only** MySQL `SELECT` over the events
table, runs it behind a hardened guard (`metrics/ask/sql_guard.js` — single SELECT/WITH only, allow-listed
table, blocked keywords even inside comments/strings, enforced row cap), then summarizes the rows (with a
chart when the shape fits). It also supports a **SQL mode** toggle (run your own read-only SQL), a model
picker (served from the shared `ai/models.js` registry — same list as the app's header picker), follow-up
conversation history, and **corrections** you can
save to ground future answers. Questions/answers are logged to `salesforce_email_queue_ask_log` and
corrections to `salesforce_email_queue_ask_corrections` (no member PII — questions are admin-typed). The
brain queries through a read-only pool that prefers a dedicated read-only DB user if `ASK_DB_*` is set,
otherwise reuses the analytics creds (the guard is the enforcement layer either way). A "most recent active
users" table sits near the top of the dashboard. All three pages (App · `/admin` · `/metrics`) share a
footer linking every path with `?metrics_test=1`.

CLI: `node metrics/metrics_cli.js stats [days] | size | purge-test` (also `npm run email_queue_metrics_stats`).

## Theme

The web app supports auto / light / dark, matching the transform app (USAT red accent, navy brand).
Use the "Theme:" button in the header (or on the login screen); the choice persists in your browser.

## Data handling, privacy & where context lives

- Dependencies (incl. optional parsers `pdf-parse`, `mammoth`, `xlsx`) live in the **repo-root**
  `package.json`; run `npm install` at the repo root. This folder has no `package.json` by design.
- **No sensitive data in the repo.** Logins (`auth.json`), operator `corrections.json`, the queue
  allow-list (`queue_access.json`), and uploaded context all live OUTSIDE the repo via `data_dir.js` ->
  `utilities/determineOSPath()` (`<base>/usat_email_queue/`). There is no in-repo data folder.
  `corrections` is slated to move to a DB table (see `plans_and_notes/path_to_production.md`, Track C).
  Overrides: `EQ_DATA_DIR`, `EQ_CONTEXT_DIR`, `EQ_USERS_FILE`, `EQ_CORRECTIONS_FILE`, `EQ_QUEUE_ACCESS_FILE`.
- **Usage analytics** (the `salesforce_email_queue_events` table) store counts/enums + the operator's
  staff username + queue name only — never member names, email bodies, addresses, or Case ids. Writes
  go only to the local MySQL analytics DB, never to Salesforce.
- AI calls use your **commercial OpenAI/Anthropic API** keys: under those terms inputs/outputs are
  **not used for training** by default; retention is short (OpenAI ~30d, Anthropic ~7d) and can be
  **zero** with a Zero-Data-Retention (ZDR) agreement.
  - **Get ZDR:** request it from the vendor with a qualifying use case - OpenAI via your enterprise/
    account team (or platform data controls); Anthropic via Anthropic sales - alongside a signed DPA.
    Put DPA + ZDR in place before processing real member data.

## Tests

**Code style:** use `snake_case` for every identifier we define — **enforced** by
`tests/lint_snake_case.test.js` (scans our source with comments/strings/`<style>` stripped; allow-lists
genuine DOM/Node/jsforce/Express/mysql2/crypto/analytics-client names + DOM element ids). If it flags a
real library name, add it to that file's `ALLOWED`; otherwise rename to snake_case.

`node menu.js test` (or `node --test tests/*.test.js`) runs all suites
(includes `metrics`, `queue_access`, `analytics`, `ask`, `spam`, `lint_snake_case`):
unit (text/threads/extract/ai/faq+context/auth) p