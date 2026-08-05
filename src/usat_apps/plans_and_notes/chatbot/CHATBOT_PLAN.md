# Chatbot Platform — Plan

_Planning only, no code. A usat_apps-hosted AI chatbot whose first deployment is an embeddable widget on the
Team USA page (`usatriathlon.org/our-community/age-group-team-usa`), injected via GTM. Built on the shared
`salesforce_email_queue` AI + knowledge brain so the two feed each other. **Multi-instance from day one** — new
pages are config, not code. Revised 2026-08-04 (supersedes the 2026-07-13 draft: adds a short phase table +
skip's considerations). The email-queue fold-in that this depends on is DONE, so the shared brain already exists._

## Vision
One backend **brain** (shared AI + curated knowledge, reused with the email queue) behind **N front doors**.
First door: a public chat widget on the Team USA page. Admin + testing live in usat_apps. The public bot
**never touches member PII** — it reads only curated / derived knowledge, never raw cases. Enforced by
composition (the public module simply never mounts the raw-case routes), not by convention.

## Phases

| #  | Phase | Gate (done when) |
|----|-------|------------------|
| C0 | Lock decisions (PII boundary, human handoff, model, launch scope) | Decisions signed off |
| C1 | Knowledge **scope** + `team_usa` curation + page-scan ingestion | `load_knowledge('team_usa')` returns curated content |
| C2 | Public chatbot **module** (`externalApi:true`, PII-safe) | Registers; contributes nav/access; no route into raw cases |
| C3 | Public **server** + `/chat` (CORS, site key, rate limit, no cookie) + guardrails + model control | curl → grounded Team USA answer; off-scope/PII refused |
| C4 | **Control panel** + staff **test/train console** (corrections + analytics) | Staff test, correct, and see usage/cost — no code |
| C5 | **Widget** + GTM (shadow DOM; CSP/consent coordinated with web team) | Bubble live on the page (staging) |
| C6 | **Scale** — add a 2nd scope/page | New page = config + GTM tag only |
| C7 | Security review + **public launch** | Live, monitored |

_The staff test/train console (C4) can land before the public server (C3) so you train it before anything is exposed._

## Considerations

### Guardrails
- **Only USAT / Team USA — three layers:** (1) **retrieval-grounded** — answer only from the curated `team_usa`
  scope; nothing relevant retrieved → politely decline; (2) a **cheap pre-classifier** that rejects off-topic
  questions before the expensive answer call (reuse the queue's `classify_local` pattern); (3) **system-prompt
  scope constraint** + a refusal/escalation template ("I can only help with USAT / Team USA — here's how to reach us").
- **What else:** no member PII (structural — no route to raw cases); **no account-specific actions** (deflect to
  staff); **prompt-injection resistance** (treat user input AND scanned pages as untrusted data); rate limits +
  input caps + toxicity/impersonation handling; **"don't invent policy"** — cite the page or say it doesn't know →
  human; PII-free logging for review.

### Controlling which AI it uses
Reuses the shared **model registry + admin "AI models & pricing"** (provider/model + default; same
`config.json` / `set_config_reader` pattern as the email-queue admin), set **per scope**. A cheap model can run
the guard/classifier and a stronger one the answer. Spend is logged **per model** (like the queue metrics), and
provider fallback is supported.

### Scalable to other pages
Built in via the **scope / embed-key** design: one brain, N scopes. A new page = a **new scope, not new code**.
Per-scope config (all in the panel): curated knowledge + page allowlist · AI model + scope statement · site key +
allowed origin + rate limit · corrections + analytics. The **same server and the same widget serve every scope**
(the widget's site key resolves which scope answers). Adding a page = create scope → curate → issue key →
allowlist origin. **No redeploy, no fork.**

### Context
- **From the email queue:** feed the bot the queue's **curated knowledge + operator corrections** (approved FAQ,
  reference docs, corrections) — **never raw cases / PII.** "Assign channel access" = an **admin mapping** of which
  scopes / queue-context / corrections feed each bot. The corrections loop grounds it automatically (a fix to the
  queue improves the bot).
- **Scan specific pages:** a **scheduled fetcher** over an **allowlist** of URLs → clean/extract (reuse
  `text_clean` / `extract`) → write into the scope's knowledge → re-scan on a cadence. Allowlist only (no open
  crawl); page content treated as untrusted data.
  - **Ad-hoc refresh button** — an admin can trigger a re-scan of one page (or all) on demand to grab data now.
  - **Admin pages panel** — lists the scanned pages with last-scanned/status, and lets an admin **add/remove**
    pages in the allowlist.

### Including it in usat-app.kidderwise
- **Control panel** — a chatbot admin module (rail-swap + panel-access, like the email-queue admin) holding: the
  model setting, the knowledge-source / channel-access mapping, the page allowlist + scan cadence + refresh,
  guardrail toggles + rate limits, site keys + allowed origins, corrections review, and analytics (usage, cost,
  top questions, and the **deflected/unanswered** ones that reveal knowledge gaps).
- **Test / train** — a **staff-only test console** in the authenticated platform: chat with the **same brain** the
  public widget uses (minus the public trust boundary), see which knowledge it grounded on + the model + the cost,
  and **add corrections inline**. Training = curate knowledge + corrections + tune the allowlist, driven by
  reviewing deflected questions. Iterate internally, then flip on the public widget (staging origin first).

## Decisions / risks to lock (C0)
- **PII boundary (biggest)** — read only curated knowledge; enforce in the scope model.
- **Human handoff** — escalate to an email-queue ticket / contact form / live-chat vendor?
- **Reliability** — first public, customer-facing endpoint; isolate the public API process from the admin.
- **Cost** — model tier, cache common answers, per-scope rate limits / budgets.
- **CSP / consent / GTM permissions** on usatriathlon.org — web-team coordination.
- **Launch scope** — Team USA only, then widen.

---

## Build log — conversation tracking + context transparency (added)

**DB (approved name): `chatbot_conversations`** — one row per TURN, grouped by a unique `conversation_id`
(UUID v4, minted client-side and reconciled with a server-minted id). Transcript tier (stores `text`) +
counts (model, grounded, latency_ms, knowledge_chars, context_files, corrections_used).

**Scaling keys (mirror the SF email queue):**
- `queue` — the SF email-queue queue whose knowledge grounds the bot (e.g. `TeamUSA`). The grounding key.
- `channel` — the surface the conversation came from (`internal-poc` now; `web-widget`/page/GTM later).
So every conversation is keyed by `(channel, queue)` — one table scales across surfaces AND queues, no
rename/migration as bots are added.

**Timestamps:** dual `created_at_utc` + `created_at_mtn` (America/Denver), stamped in Node via
`utilities/analytics/event_ingest.fmt_in_tz` (no MySQL CONVERT_TZ dependency) — the platform convention.

**PII posture:** `is_test` defaults to 1 (internal staff testing). The public GTM widget passes `is_test=0`
and needs transcript scrubbing/consent before it writes here — that's why the public server stays separate.
Logging is fire-and-forget: it never blocks or breaks a chat response.

**Context transparency:** `GET /api/chatbot/context` returns the exact non-excluded knowledge files (name,
scope, size) + corrections count + knowledge_chars. Surfaced in the card as a "Context in use" list with a
refresh (↻) button. Names/sizes only — never file contents, never member data.

**Endpoints:** `GET /config`, `GET /context`, `POST /chat` (now returns `conversation_id`; logs both turns).
**Store module:** `modules/chatbot/conversations.js` (TABLE/DDL/ensure/log_turn + read helpers
by_conversation / recent_conversations / stats for a future review-train console).

---

## Build log — email-queue-style operator surface (3-column)

Clicking **TeamUSA Assistant** now opens an operator page mirroring the email queue:
- **Left rail** — queue picker (allow-listed, starts at TeamUSA; add via `CHATBOT_QUEUES`) + filters
  (All / Test / Live + search) + the **conversation-thread list** (from `chatbot_conversations`).
- **Center** — the selected conversation's **transcript** (our logged turns; per-answer model/grounded/latency).
  Never a Salesforce email thread — no member PII.
- **Right rail** — the shared-brain cards: **Test the assistant** (PII-safe analog of the email-queue
  "Ask the AI" — same knowledge+corrections grounding, no case; logged is_test=1), **Corrections (teach)**
  (list + add; shared store, sharpens the email queue too), **Context files** (list + view + location +
  upload + include/exclude).

The **queue picker drives the whole surface** — grounding, corrections, context, and the conversation log
all switch to the selected queue's context space. Scales to more SF queues with no schema change.

New endpoints (all queue-keyed): `/queues`, `/config`, `/context` (+ `/context/file`, `/context/raw`,
POST upload, `/context-exclude`), `/corrections` (GET+POST), `/conversations`, `/conversation`, `/chat`.
New web files: `components/{ui,ChatbotRail,Transcript,ChatbotAiPanel}.jsx`, rewritten `ChatbotSection.jsx`
+ `chatbot.css` + `lib/api.js`. (Old `ChatBubble.jsx` is now orphaned/unused.)

---

## Task log — AI Chat Bot operator surface (this session)

| # | Task | What we did | Status |
|---|------|-------------|--------|
| 1 | Conversation tracking DB | `chatbot_conversations` (transcript + counts), keyed by (channel, queue), unique conversation_id, dual `created_at_mtn`+`created_at_utc` (mtn first). Auto-creates on first chat. | Built (unverified live) |
| 2 | 3-column operator page | Email-queue-style: left rail + center transcript + right AI rail. | Built |
| 3 | Queue picker | Allow-listed (TeamUSA; `CHATBOT_QUEUES`), drives grounding/corrections/context/log. | Built |
| 4 | Thread list + transcript | Left rail lists conversations; center shows the selected transcript with per-turn MTN time. | Built |
| 5 | Right-rail cards | Test the assistant, Corrections (teach), Context files (view/location/upload/exclude), Reference, Settings, GTM spec. | Built |
| 6 | Floating bubble | Quick-test bubble docked bottom-right OF THE RIGHT RAIL (absolute), queue-aware, logs test convos. | Built |
| 7 | Generic naming | Nav + title "AI Chat Bot" + active-queue chip; prompt parametrized by queue. | Built |
| 8 | Timestamps | Per-turn + conversation-card MTN friendly format; column order mtn-before-utc. | Built |
| 9 | Date filters | From/To + 7/30/90 presets + search; default yesterday→today; dark-mode calendar via platform `color-scheme`. | Built |
| 10 | AI model picker + Settings | `/settings` + `/ai/models`; model saved in shared config; `/chat` uses it. | Built |
| 11 | GTM spec card | Planning card + sample GTM embed snippet (not live). | Built (spec) |
| — | Restart + visual verification | Nothing above has been seen running yet. | PENDING |
| — | True shared components w/ email queue | Features/patterns MIMICKED; not literally shared modules yet. | Proposed |
| — | Public GTM widget build | widget.js + dedicated public server + PII scrubbing. | Not started |
| — | Escalation → SF Team USA queue | Push chatbot escalations into Salesforce. | Not started |

---

## Update — queue names aligned with the email queue's live SF list

The chatbot `/queues` now reads from the SAME source as the email queue: `sf.list_queues()` via the shared
`modules/salesforce_email_queue/sf` service + a read connection (names only — never cases/PII). The
`CHATBOT_QUEUES` allowlist still decides which queues are bot-enabled, but the DISPLAY name is pulled from
Salesforce so it can't drift (key stays the allowlist value for pick_queue validation + grounding scope;
slug(key) === slug(sf name)). Falls back to the allowlist name if SF is unreachable (dev without creds).
Rail shows a "name synced from Salesforce / offline" indicator. Needs backend :8022 restart to take effect.

## Also this session — panel-activity tracking (usat_apps metrics)

Interaction events now emit to `usat_apps_events` via the platform `lib/track.js` (queue/show/date/view
filters, conversation_open, chat_send [test+bubble], model_change, correction_add, context_view/upload),
tagged `panel='chatbot'`; plus an "AI Chat Bot" scope tab in web/src/pages/Metrics.jsx.

## Next up (user wants): A add server context · B read web pages for context · C build GTM widget
Recommended order A → B → C (bot answers well before public exposure). GTM widget needs its own public
analytics path (lib/track.js is session-bound / same-origin).

---

## D DONE — shared UI components (Card/Modal) extracted

New shared lib: `web/src/lib/ui.jsx` — `Collapsible` (card) + `PortalModal`, style-agnostic (callers pass
their own class map via `classes`), so behavior lives once and each module keeps its exact look.
- Email queue: `components/ui.jsx` `Modal` + `AiPanel.jsx` `Card` now thin wrappers around the shared
  primitives with the SAME `eq-*` classes / DOM (byte-identical markup — no visual change intended).
- Chatbot: `components/ui.jsx` `Card` + `Modal` wrap the shared primitives with `cbx-*` classes
  (Card keeps controlled+uncontrolled; small CSS added for the modal head h3+actions structure).
Validated: chatbot full bundle OK; email-queue ui.jsx bundles against the shared lib; AiPanel transpiles.
NOT shared (left per-module, low value/higher coupling): formatters (fmtBytes casing differs), date-field
(entangled with the email-queue store). Recommend a visual spot-check of the email queue's cards + a modal
(e.g. Context viewer) on :5175 after restart, since UI isn't covered by the unit tests.

---

## Add Files — shared component (parity with email queue)

Extracted the email queue's "Add files" control into `web/src/lib/ui.jsx` `ContextAddFiles` (scope select
"This queue only / Global", Choose file(s), Choose folder via webkitdirectory, progress msg, 25MB skip),
style-agnostic via `classes`/`styles`, upload delegated via `onUpload(fileList, folder)`.
- Email queue AiPanel now renders it with `eq-*` classes (same markup as before).
- Chatbot ContextCard now renders it with `cbx-*` classes (replaces the old single "＋ Add"): full parity —
  scope dropdown + choose files + choose folder + folder-name preserved. Chatbot backend POST /context
  already supported scope+folder, so no backend change. Frontend-only; needs a Vite reload.

Note: existing chatbot_conversations rows logged under the old 'TeamUSA' spelling need NO change — the list
now matches queue by normalized name. Optional canonical cleanup:
  UPDATE chatbot_conversations SET queue='Team USA'
  WHERE REGEXP_REPLACE(LOWER(queue),'[^a-z0-9]','')='teamusa';

---

## Email-queue-parity layout (siderail + resizable rails + shared grabber)

Restructured the AI Chat Bot to match the email queue exactly:
- **Queue & filters + conversation list** moved into the platform LEFT siderail (`ChatbotRail.jsx`),
  rendered by `App.jsx` (new condition on `/chatbot`, mirroring the email-queue rail wiring).
- **Main area = 2 columns**: transcript + AI panel, with a **resizable** divider; the left rail is also
  resizable. Widths persist in localStorage (cb_railW / cb_aiW).
- **Shared store** `modules/chatbot/lib/store.js` (useSyncExternalStore) so the siderail and Section share
  queue/filter/thread/selection/width state — same pattern as the email queue's `lib/store.js`.
- **AI panel is a plain scrolling block** (`.cbx-ai`, like `.eq-ai`) — cards no longer flex-shrink/"scrunch".
- **Shared ResizeHandle**: `web/src/lib/ResizeHandle.jsx` + `web/src/lib/ui.css` (the chatbot "grabber":
  slim bar + hover/focus highlight + visible ⋮ grip). BOTH modules use it now — the email queue's
  `Section.jsx` + `EmailQueueRail.jsx` imports were swapped from `./components/ResizeHandle.jsx` to the
  shared one, so the grabber is identical everywhere. (Old `components/ResizeHandle.jsx` + `.eq-resizer`
  in sfeq.css are now unused.)

Frontend-only; needs a Vite restart. Spot-check the EMAIL QUEUE resizers too (they now show the ⋮ grip).
