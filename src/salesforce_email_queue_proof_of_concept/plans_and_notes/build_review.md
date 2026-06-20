# Build Review — Salesforce Email Queue Assistant (POC)

A guide to review everything built so far. Read-only POC; nothing is sent to Salesforce.

## 1. What was built (all stages complete)

| Stage | Delivered | Files | Tests |
|---|---|---|---|
| A | SF reads: queues, threads (quoted-history stripped), attachments, sender history, status/message counts | `sf/*` | text_clean, sf_threads |
| B | Attachment text extraction (text native; pdf/docx/xlsx via optional parsers) | `ai/extract.js` | extract |
| C | AI layer: provider select (ChatGPT default, Claude), grounded prompt + guardrails, draft / not-enough-info, ask | `ai/*` | ai |
| D | Local auth: scrypt user store + signed-cookie sessions + recovery account | `auth/*`, `src/admin.js` | auth |
| E | Express server + auth-gated JSON API (no writes) | `web/routes.js`, `../../server_..._8019.js` | smoke-tested |
| F | Single-page web UI (login + 3-pane: list / thread+attachments / AI panel) | `web/public/index.html` | manual |
| G | Per-queue FAQ + operator corrections injected into grounding | `ai/faq.js`, `store/corrections.js` | faq_corrections |
| — | Color CLI launcher + guided assist flow | `menu.js`, `src/cli.js` | — |

**Tests: 37 passing across 7 suites**, all offline (mock SF connection + mock AI provider).

## 2. How to run it

```
cd src/salesforce_email_queue_proof_of_concept

# tests
node menu.js test                 # or: node --test tests/*.test.js

# CLI (read-only, live SF + AI)
node menu.js                      # -> Browse & assist: queue -> status -> email -> draft/ask/correct

# web app for reviewers
node src/admin.js add             # create a login
node ../../server_salesforce_email_queue_8019.js   # http://localhost:8019
```

Needs repo-root `.env`: `SF_PROD_*` (reads) and `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (AI).
For PDF/DOCX/XLSX attachment text: `npm install` (optional parsers).

## 3. Review checklist

Code / architecture:
- [ ] `sf/` reads are injectable (mock `conn`) and reuse `race_results_transform/sf` plumbing.
- [ ] `ai/respond.js` + `ai/ask.js` take an injectable provider; no network in tests.
- [ ] Prompt/guardrails (`ai/prompt.js`) forbid ungrounded specifics; bounces flagged.
- [ ] Auth: scrypt hashing, signed cookies, recovery account, `require_auth` on every `/api` route.
- [ ] `web/routes.js`: `/api/send` returns 403; no DML anywhere; SF conn cached.
- [ ] snake_case throughout; structure matches the locked layout (admin/metrics reserved, not built).

Behavior to spot-check live:
- [ ] Browse a real queue; status picker shows live counts; case list shows `[A]` + message count.
- [ ] Open a multi-message case; thread is color-coded by sender; attachments openable.
- [ ] Draft on a normal case → grounded reply OR NEED_INFO (no invented facts).
- [ ] Draft on a bounce (mailer-daemon) → NEED_INFO / non-actionable, not a customer reply.
- [ ] Add a correction → it grounds the next draft/answer.
- [ ] Web app: login required; logout works; "send" button disabled with the not-enabled note.

## 4. Known limitations / intentionally deferred

- **No Salesforce writes** (close/status/send) — wired off by design; `/api/send` is 403.
- **Tier-3 queue-wide learning** not active (only this thread + sender history + FAQ + corrections).
- **Per-user Salesforce identity** (OAuth/Connected App) deferred; reads run as one integration user;
  app login is a separate local gate. See `salesforce_api_requirements.md` §11.
- **FAQ content is placeholder** (`data/faq/*.md`) — replace `XXX` with real USAT facts so drafts can
  cite real timelines/contacts (this is the proper fix for the "4-6 weeks" hallucination).
- **API limits** sized but to confirm at scale — see `salesforce_api_requirements.md` §13 (SF org has
  ~410k requests/24h, <1% used today).

## 5. Recommended next steps (post-review)

1. **Populate the FAQ** for the pilot queue(s) with vetted facts; capture a few corrections.
2. **Pilot** the CLI/web app with 1-2 staff on a single queue; gather feedback on draft quality.
3. Decide on **enabling sends** — which triggers: Connected App + per-user identity (or a shared
   org-wide address) and the write-flag work (close/status/send), all currently stubbed off.
4. Optional: add tier-3 exemplars (human replies only) once draft quality is validated.
5. Optional: add the `admin/` + `metrics/` sections (reserved) if we productionize.

## 6. Decisions on record (in plans_and_notes/)

- Build-ourselves vs native Salesforce + costs + data privacy/Trust Layer → team `.docx` brief & `plan.md`.
- SF data model, context rules, attachment handling, per-user identity, AI tools, API limits →
  `salesforce_api_requirements.md`.
- MVP scope/auth decision → `mvp_plan.md`.

---

## Round 2 update (web app, theme, context, tests)

Added since the first review:
- Web UI restyled to the transform palette + login card; **auto/light/dark theme** with the same
  sun/moon toggle and persistence.
- **User context folder** (`data/context/_global` + `/<queue_slug>`) read by the AI (md/csv/txt/html
  native; pdf/docx/xlsx via optional parsers). API: `GET/POST /api/context`. Template provided.
- **Password reset** (`node src/admin.js passwd`); passwords are scrypt-hashed (never shown).
- **Per-status counts** (`/api/status-counts`, CLI picker). **Ask history** param on `/api/ai/ask`.
- **Route-integration tests** (`tests/routes.test.js`): login/session, disabled send, context list,
  corrections - in-process, no Salesforce. **33 tests across 7 suites now.** No Playwright/E2E yet.
- Removed the POC-level `package.json` (deps install at the repo root); added `.gitignore` for `data/`.

Still to build (web UI batch): email numbering + checkboxes, in-app status counts, sticky case header,
collapsible newest-first thread with a de-dupe toggle, dark-mode header readability, resizable panes,
ask chips + history panel, editable draft, edit/send-anyway (mock), mock status-update card, context
upload UI, favicon. (Backend is ready for status counts, ask history, and context upload.)

Proposed: **AI queue triage** (scan a queue, auto-tag each email needs_info/draft_possible/...);
requirements doc Section 14. And move context storage off the repo for production (Section 15).

---

## Round 3 update (web UI batch + Ctrl-C + tests)

Web UI now includes: numbered queue list with checkboxes; in-app per-status counts + summary; sticky
case header; newest-first **collapsible** thread with a hide-quoted-text toggle; dark-mode-readable role
colors; **resizable** panes (persisted); Ask **preset chips** + running history; **editable** draft with
edit/compose + mock Send (uses the disabled /api/send path); **mock** case-status card; **context upload**
UI; favicon. Theme uses the transform sun/moon toggle.

Fixes: server now exits on Ctrl-C (SIGINT/SIGTERM cleanup + Windows readline shim, matching the
transform servers); menu no longer shell-wraps `node`. Removed POC `package.json` (deps at repo root);
data ignores moved into the **root** `.gitignore`.

Tests: **37 across 7 suites** (added context upload, save_context_file, ask-history). Plus a **Playwright
E2E scaffold** in `e2e/` (stubs the API; run `npx playwright test -c e2e/playwright.config.js` after
`npx playwright install chromium`) - not executed in this sandbox (no browser/registry).

---

## Round 4 update (AI status / triage + UI polish)

- **AI status (triage)**: `ai/triage.js` + `POST /api/ai/triage` classify a case as answer_ready /
  draft_possible / needs_info / non_actionable (bounces caught locally, no AI call). UI shows a colored
  badge in the thread header and on queue rows, plus an "AI triage visible" button to tag the list.
- AI-panel cards are now **collapsible** (only Draft open initially). Draft reply has a robust **Copy**
  button. Ask history is **newest-first**, **timestamped**, height-capped/scrollable, with a **see-more**.
- Fixed: queue + de-dupe **checkboxes** were unclickable (global input CSS); excluded checkboxes/radios.
- Tests: **40 across 8 suites** (added triage). Playwright E2E scaffold in `e2e/` (unrun here).

---

## Round 5 update (triage polish + UI fixes)

- Triage statuses expanded: **answer_ready / draft_possible / needs_info / awaiting_reply / spam /
  non_actionable**. `awaiting_reply` (latest msg is a human staff reply) and bounces are decided
  locally (no AI call); **spam** is model-detected. An automated auto-ack never counts as "answered".
- UI: fixed **dark-mode contrast** on queue status badges; **case + AI panels now split the remaining
  width equally** (queue pane stays fixed, still drag-resizable); **draft reply box opens taller**;
  opening a case now **expands the latest real inbound message and collapses auto-replies**; re-run
  button has a tooltip. Tests: **43 across 8 suites**.

---

## Round 6 update (Workbench/SF links, search, grounding indicator, status edit)

- **Queue search box**: one input filters the loaded case list across subject, status, case #,
  sender, date, attachment flag, and triage label (all terms must match). Client-side, instant.
- **Status dropdown counts fixed**: the left pane now re-renders after counts load, so the Status
  picker options and the summary chips show live per-status counts.
- **Editable status in the queue (mock)**: click a row's status chip to pick a new status inline
  (no extra clutter); shows `*` + dotted underline to flag it as a local mock (never written to SF).
- **AI panel - Salesforce links & SOQL card**: "Open case in Salesforce" deep link
  (`<instance>/lightning/r/Case/<id>/view`, instance URL now returned by `/api/queues`) plus
  copyable EmailMessage + Case SOQL to paste straight into Workbench.
- **Grounding indicator**: the Context card now shows what the AI is grounding on -
  `FAQ ✓ (N chars) · M context file(s) · K correction(s)` (`/api/context` now returns
  `faq_chars` + `corrections`). Confirms the placeholder FAQ (`data/faq/_global.md`,
  `data/faq/coaching.md`) is being read.
- **Auto-draft when answer ready**: if the AI status returns `answer_ready`, the draft reply is
  generated automatically (no second click). Other statuses still draft on demand.
- Tests: **43 across 8 suites** (unchanged; UI-only + 2 small route additions). JS validated.

---

## Round 7 update (search/UX cleanup + corrections card)

- **Copy buttons** flash "✓ Copied!" for ~1.5s (reply + both SOQL boxes).
- **SOQL card** is now editable and is the **last** card; the "Open in Salesforce" button was removed
  from it. SF deep links now live (a) per row in the queue list ("SF ↗") and (b) on the **Case #** in
  the thread header.
- **Persistence**: the last selected queue + status persist across reloads (localStorage).
- Removed the **status summary chips** under the queue (counts stay in the Status dropdown only).
- **Search box moved into the Queue card**; search now also matches **message count** and tolerates
  trailing punctuation (e.g. "Waiting...").
- **Removed the click-to-edit status chip** from the list (it required two clicks). Status change is
  now a single **dropdown in the case panel header** (mock; never written to SF).
- **Corrections card added** to the AI panel (was missing in the web UI): operators can add a
  correction (all-queues / this-queue / this-case) that is injected into the AI grounding so future
  drafts and answers honor it. Backed by the existing `/api/corrections`.
- **answer_ready**: the AI triage step judges whether the thread + grounding (FAQ + context files +
  corrections) contain enough to fully answer; if so it auto-populates the draft. Other statuses
  draft on demand.

---

## Round 8 update (date-range View, attachments, server-side SOQL, tunnel logging)

- **Queue date range + View button**: queue card now has From/To dates (default **yesterday..today**),
  an "Any date" toggle, and a field selector (Last activity / Created). Same rules as the transform app:
  floor 2025-01-01, never future, To bounded to From..From+14, **14-day max**. Selecting queue/status/
  dates no longer auto-pulls - the user clicks **View** to load (backend `/api/cases` accepts
  `from/to/field`; `sf_threads.list_queue_cases` filters with a Mountain-Time offset).
- **Search box**: added a **× clear** button; now filters only the loaded cases.
- **Attachments (type-aware)**: each message lists its files; **images** preview inline (view image),
  **csv/tsv/xlsx/xls** render as a **table** (`/api/attachment/:cvid/table`; csv parsed server-side,
  xlsx via optional `xlsx`), everything else shows **view text**. Download chip hits the SF file servlet.
- **SOQL runs read-only in-app**: replaced the browser REST link (which failed with INVALID_SESSION_ID)
  with a server-side **Run query** via the integration connection (`POST /api/soql`, SELECT-only),
  results shown in a table. Workbench can't be pre-filled from a URL, so it's Copy SOQL + Open Workbench.
- **Server**: request logger prints every route (and flags `GET /`) with the Host header - use it to
  confirm the `usat-email.kidderwise.org` tunnel reaches this process. Header documents the public URL.
- Tests: **43/43**. All backend files re-verified after the OneDrive cloud-sync truncation issue.

---

## Round 9 update (compact queue card + expandable views + link preview)

- **Counts on select**: choosing a queue now refreshes the Status dropdown counts immediately, but the
  case list still only loads when **View** is clicked.
- **Compact queue card**: date filters are now a **collapsible "Dates" section** (collapsed by default,
  shows the current range + a note that the default is yesterday->today). Frees vertical space for cases.
- Reverted the case filter back to the **"Search"** label + original placeholder.
- **Attachments-only checkbox** in the queue card (client-side filter of the loaded cases).
- **Expandable previews**: every attachment preview (image / table / text) and the SOQL results have an
  **"⤢ expand"** button that opens a large modal. SOQL results also get **"⬇ Download CSV"**.
- **Run buttons** are now the plain (non-primary) style, consistent across the SOQL card.
- **In-email links**: URLs in a message body are detected, shown as a 🔗 chip on the message and as
  clickable links in the text; clicking opens an **in-app preview modal** (sandboxed iframe + the full
  URL + Open-in-new-tab + Copy), so the operator stays in context. Links are flagged as email-sourced.
- Tests: **43/43**.

---

## Round 10 update (env logins + roles, HTML email view, server parity, more-than-25)

- **Auth via `.env` accounts with roles** (mirrors the transform `admin_store` env+store pattern):
  `SF_EMAIL_QUEUE_ADMIN_USER`/`_PASS` -> role `admin`, `SF_EMAIL_QUEUE_USER`/`_PASS` -> role `user`.
  `valid_user` returns the role; it flows through the signed cookie -> `req.role` -> `/api/login` +
  `/api/me`, ready for access differentiation later. The legacy `EQ_RECOVERY_*` account was **removed**.
- **Email body view**: HTML (default) in a sandboxed, script-free iframe, or plain text via a header
  toggle; falls back to text when there's no HTML body.
- **Queue: more than 25** via a "Show" selector (25/50/100/200, server cap 200); rows show a 🔗 link
  indicator (searchable) from a per-case body scan (`/api/cases?...&links=1`, `sf.cases_with_links`).
- **Server parity**: `server_salesforce_email_queue_8019.js` rebuilt to mirror the 8018 skeleton
  (`create_app`/`start_server`, cors, no-cache, `/api/status`, dual-stack `app.listen` so the Cloudflare
  tunnel reaches it over IPv6 localhost, optional ngrok off by default).
- Docs updated (README configuration + CLAUDE update notes). Tests: **43/43**.
