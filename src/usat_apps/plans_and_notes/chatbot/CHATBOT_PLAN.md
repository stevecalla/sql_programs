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
