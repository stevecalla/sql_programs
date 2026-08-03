# MVP Plan — Salesforce Email Queue Assistant (proof of concept)

The smallest build that still gives a real feel for the concept: browse a
queue's incoming email, read a thread + its attachment content, see how the AI
would respond using thread + history, fire test questions or your own question
at it, and capture a correction — all locally, read-only against Salesforce.

This is a scoped slice of `plan.md` / `salesforce_api_requirements.md`, not a
replacement. Same modules, same conventions; just fewer of them.

---

## What you'll be able to do (the demo loop)

1. Pick a queue (e.g. Coaching) → see its incoming emails (date, subject,
   status, sender, answered/automated, attachment indicator).
2. Click an email → read the full thread in order (quoted history collapsed),
   see Case/contact info, and **view attachment content** (extracted text for
   pdf/xlsx/csv/docx; inline for images; download link always).
3. See an **AI Suggested Response** for that email, grounded in: this thread +
   this sender's prior emails + the queue FAQ folder. The AI either drafts a
   reply or says "not enough info" and lists what's missing.
4. **Probe the AI**: pick from a few seeded **test questions** or type your own,
   and see the answer against the same context.
5. Hit **Correct / add guidance**, type a better answer or a rule; it's stored
   in local memory and injected into the next AI calls so you can watch behavior
   change.

Nothing is ever sent to Salesforce — drafts are display + copy only, clearly
labeled "Sending is not enabled."

## Surface: CLI menu + web app over one shared engine (DECIDED)

Both surfaces ship in the MVP, sharing the same `sf/` + `ai/` engine:

- **`menu.js` CLI** — RRT-style launcher (auto-numbered sections / "renumber",
  prefs file, spawn + Ctrl-C run harness). Sections: Server · SF reads · AI ·
  Auth · Tests. Lets us drive/list queues, emails, threads, and AI calls from
  the terminal and run tests.
- **Web app** — `server_salesforce_email_queue_8019.js` at repo root serving one
  page, three panes: **Queue/email list | Thread + attachments | AI panel**.
  This is where attachment rendering, question entry, and the correction button
  live. For reviewers to click through.

## Architecture & reuse

Locked structure (mirrors RRT; MVP modules built, rest reserved so we never
restructure):

```
src/salesforce_email_queue_proof_of_concept/
  menu.js              # RRT-style CLI: auto-numbered sections, prefs, run harness
  package.json         # scripts: menu, cli, start, test
  README.md  CLAUDE.md
  sf/                  # COPY race_results_transform/sf (proven reads) +
    sf_queues.js       #   list queues (+ open counts)
    sf_threads.js      #   list queue emails; full thread (group ParentId, order
                       #   MessageDate, strip quoted history); attachment list
    sf_context.js      #   this sender's history by SuppliedEmail/FromAddress
  ai/
    providers.js       # OpenAI (default) + Anthropic select, keys from .env
    prompt.js          # CS-rep role + guardrails + "say when not enough info"
    respond.js         # assemble context -> draft | not-enough-info
    ask.js             # test/custom question against same context
    extract.js         # attachment bytes -> text (pdf/xlsx/csv/docx)
  auth/                # COPY RRT scrypt+JSON store pattern
    auth_store.js      #   scrypt hashing, JSON persistence, .env recovery acct
    require_auth.js    #   middleware gating /api routes
    providers/         #   local_password.js now; sf_oauth.js later (drop-in)
  web/
    routes.js          # JSON API (auth-gated)
    public/            # login page + single-page app (3-pane)
  store/
    corrections.js     # in-memory array (+ optional data/corrections.json)
  src/
    cli.js  pipeline.js  display.js  data_dir.js
  tests/               # node --test: mock conn, mock provider, auth, snake_case lint
  data/                # gitignored: corrections.json, <queue>/content/ FAQ files
  plans_and_notes/
repo root:
  server_salesforce_email_queue_8019.js   # express app mounting web/routes
( admin/ and metrics/ intentionally NOT built yet — reserved )
```

Reuse: `sf/` wholesale; OpenAI loop pattern from `bot_analyst_chatgpt_like`;
auth store + menu.js + node-test harness from `race_results_transform`.

## Auth (DECIDED — local login, OAuth-ready)

- **Local username/password**, reusing RRT's `admin_store` pattern: scrypt +
  per-user salt, timing-safe compare, users in a gitignored JSON (mode 0600),
  generated session secret, `.env` recovery account. No bcrypt/jwt dependency.
- `require_auth` middleware gates **every** `/api` route (the API exposes SF
  data, so this is the point of auth for the MVP — secure the data + API access).
- Each user record carries an **optional `sf_email`/`sf_username`** captured now
  but **unused in MVP** — it's the forward hook for per-user send attribution.
- All Salesforce reads run as the **single integration user** (`SF_PROD_*`).
- **SF identity as sender is deferred** (no writes in MVP). When sending is
  enabled later, add `auth/providers/sf_oauth.js` (Connected App / JWT) without
  restructuring — see `salesforce_api_requirements.md` §5a/§6.
- Auth is a **pluggable provider**: `local_password` now, `sf_oauth` later.

## API routes (all read-only against SF)

- `GET  /api/queues` → `[{id,name,developer_name,open_count}]`
- `GET  /api/emails?queue=<id>&status=open` → list rows for the left pane
- `GET  /api/thread?caseId=<id>` → `{case, contact, messages[](stripped+raw),
  attachments[]}`
- `GET  /api/attachment/:contentVersionId` → streams bytes (download) ; or
  `GET /api/attachment/:id/text` → extracted text for display
- `POST /api/ai/respond` `{caseId, model}` → `{verdict:'draft'|'need_info',
  draft?, missing?[]}`
- `POST /api/ai/ask` `{caseId, question, model}` → `{answer}` (test/custom Qs)
- `POST /api/corrections` `{caseId?, question?, note, scope}` → stores in memory
- `GET  /api/corrections` → list (to show what's active)

## AI context for MVP (tiers)

Per `salesforce_api_requirements.md` §9, but trimmed for MVP:

- **Tier 1 — this thread** (incl. automated messages so it knows what was sent).
- **Tier 2 — this sender's history** matched by `SuppliedEmail`/`FromAddress`.
- **Tier 4 — queue FAQ folder** (`data/<queue>/content/`), if present.
- **Tier 3 — queue-wide exemplars: DEFERRED** for MVP (the heavy part). Add later.
- **Corrections** — active in-memory corrections appended as grounding.
- Facts only from tiers 1/2/4; never quote other contacts' PII.

## Correction button (simple, local)

- In-memory array; optionally mirrored to `data/corrections.json` so it survives
  a restart. No MySQL for MVP.
- Fields: `{note, question?, caseId?, scope:'me'|'global', created_at}`. With
  local memory everything is effectively global; the `scope` field is kept for
  forward-compatibility with the full plan (user|global) but is a no-op now.
- Active corrections are injected into `prompt.js` grounding on the next
  `respond`/`ask` call, so you can correct → re-run → see the change.

## Seeded test questions (dropdown + free text)

Examples to ship so there's something to click immediately:

- "Draft a reply to the latest message."
- "What information is missing before we can fully answer?"
- "Summarize this thread in 3 bullets."
- "Is anything here outside this queue's scope or needs escalation?"
- "Write a friendly reply asking for the missing details."

Plus a free-text box for the user's own question. Both hit `/api/ai/ask`.

## Intentionally cut from MVP (in the full plan, not here)

Auth/login & user tracking · MySQL store · metrics/admin dashboards · Playwright
e2e · CLI surface · tier-3 queue-wide learning · any Salesforce write (stays
disabled & labeled) · per-user vs global correction enforcement · provider
beyond OpenAI+Claude.

## Build order

A. **SF reads** — `sf_queues`, `sf_threads` (thread + quoted-history strip +
   attachment list), `sf_context` (history by email). (Reads already proven by
   `verify_sf_access.js`.)
B. **Attachment text** — `ai/extract.js` for pdf/xlsx/csv/docx.
C. **AI** — `providers.js` + `prompt.js` + `respond.js` (+ `ask`). Default GPT.
D. **Server + routes** — Express on 8019 wiring A–C.
E. **Single page UI** — 3-pane; email list, thread+attachments, AI panel with
   suggested response, test-question dropdown, free-text, correction button.
F. **Corrections** — in-memory (+ optional JSON) and prompt injection.
G. **Light verification** — a couple of node unit tests (mock conn + mock
   provider) + a manual click-through on the Coaching queue.

## How it'll run

```
node server_salesforce_email_queue_8019.js     # then open http://localhost:8019
```
Uses existing `.env` (SF_PROD_* for reads, OPENAI_API_KEY / ANTHROPIC_API_KEY).

## Path from MVP → full plan

Each MVP piece is a subset of the full module, so growth is additive: add auth
(RRT/admin), swap in-memory corrections for the MySQL table (with real
user|global scope), add tier-3 exemplars, add the CLI surface, add metrics, and
finally enable `sf_write.js` behind its flag. Nothing in the MVP needs to be
thrown away.

## Decisions (resolved)

1. Surface: **both** `menu.js` CLI **and** web app over a shared engine. ✓
2. Auth: **local login, OAuth-ready** (scrypt+JSON, `require_auth`, `sf_email`
   captured but unused). ✓
3. No admin/metrics, no SF writes (disabled + labeled). ✓
4. Corrections: in-memory + optional `data/corrections.json` mirror. ✓
5. Context tiers 1/2/4 in MVP; tier-3 queue-wide learning deferred. ✓

Awaiting go-ahead to start the build (order A–G above).
