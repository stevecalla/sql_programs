# Salesforce Email Queue Assistant — POC Plan

A tool that pulls an email thread from a selected Salesforce queue and lets an
AI customer-service agent decide how to respond — drafting a reply **only when
it has enough information**, otherwise telling the operator what's missing.

Built to match repo conventions: snake_case everywhere, injectable/testable
modules, a `menu.js` CLI, an Express web app, MySQL + `data/` for storage, and
heavy reuse of `race_results_transform` and `salesforce_duplicates`.

---

## Decisions locked in

- **Surface:** build CLI **and** web app in parallel over a shared engine.
- **Salesforce writes:** wiring + UI present but **disabled**. The app tells the
  user "Sending to Salesforce is not enabled in this build." Read-only for now.
- **AI provider:** user-selectable; **default ChatGPT** (OpenAI Responses API,
  as in `bot_analyst_chatgpt_like`); Claude/Anthropic selectable (key exists).
- **AI role:** a customer-service rep that answers the sender only when it has
  enough info, with strong guardrails against leaking other users' PII.

## Architecture (one engine, two front ends)

```
salesforce_email_queue_proof_of_concept/
  menu.js                     # CLI launcher (mirror race_results_transform/menu.js)
  package.json                # scripts: menu, cli, start, test, e2e
  README.md                   # robust docs (mirror RRT)
  CLAUDE.md                   # conventions + module map for future work
  sf/                         # Salesforce layer — see salesforce_api_requirements.md
  ai/
    agent.js                  # tool-loop, provider-agnostic (port from bot_analyst)
    providers.js              # openai (default) + anthropic select; from .env
    prompt.js                 # system prompt: CS-rep role + guardrails
    guardrails.js             # PII / scope / "do-not-quote-others" enforcement
    decide.js                 # "enough info?" -> {draft} | {need_info, next_steps}
    tools/                    # AI tools: get_thread, get_contact_history, search_faq...
  src/
    cli.js                    # thin CLI over the engine (queue->email->draft)
    pipeline.js               # orchestrates: select queue -> email -> context -> AI
    context.js                # assemble thread + scoped history + FAQ for the model
    display.js                # table/thread rendering for CLI
    data_dir.js               # data/ paths (gitignored), per-queue content folders
  web/
    server is server_salesforce_email_queue_8019.js at repo root (repo pattern)
    routes.js                 # /api/* gated by auth; mirrors sf_routes.js
    public/                   # converter-style UI: queue picker, thread, AI draft
  store/                      # MySQL: ai threads/history, corrections, login tracking
  tests/                      # node --test, mock conn + mock provider
  e2e/                        # Playwright (optional, mirror RRT)
  plans_and_notes/            # this folder
```

Server lives at repo root as `server_salesforce_email_queue_8019.js` to match
the existing `server_*_80NN.js` pattern (RRT=8018, duplicates=8017).

## End-user flow (notes.txt requirements → steps)

1. List Salesforce queues; user picks one. *(sf_queues)*
2. User sets a date range + status; app lists emails (Case#, Subject, Status,
   sender, date). *(sf_threads)*
3. User selects an email. App shows full thread, attachments, Case detail.
   *(sf_threads + sf_fetch)*
4. User selects AI model (default ChatGPT). *(ai/providers)*
5. App shows an AI **next step**: either a drafted reply, or "not enough
   info" + the specific gaps and suggested next actions. *(ai/decide)*
6. AI grounding = this thread + this contact's history + queue patterns (no
   cross-user PII) + the queue's FAQ/content folder. *(context + guardrails)*
7. If a draft: show it; the "push to Salesforce" button/command is present but
   **disabled** with a clear message. *(sf_write, flag off)*
8. Operator can save a **correction** (specific-to-me or global) to steer future
   answers. *(store + corrections, port from RRT)*
9. AI threads/history are persisted and viewable by the user. *(store)*

## Reuse map (don't recreate)

- **Salesforce:** entire `race_results_transform/sf/` (see API doc).
- **AI tool-loop / provider call / safe-JSON / YAML grounding:**
  `bot_analyst_chatgpt_like/src/agent.js`, `sql_guard.js` (as a guardrail
  template), `config/usat_context.yaml`.
- **Corrections (MySQL, active flag, grounding injection):**
  `race_results_transform/metrics/ask/corrections.js`.
- **Auth + user/login tracking + admin console:**
  `race_results_transform/admin/admin_store.js`, `console_registry.js`,
  `console_runner.js`, `log_ring.js`.
- **CLI menu + run harness:** `race_results_transform/menu.js`.
- **Snapshot/DB + config patterns:** `salesforce_duplicates/config.js`,
  `database_snapshot.js`, `schema.md`.
- **Analytics/event ingest util:** `utilities/analytics/event_ingest`.

## Storage

- **MySQL** (existing `.env` `MYSQL_*`): tables prefixed `email_queue_*` —
  `email_queue_ai_threads`, `email_queue_ai_messages`,
  `email_queue_corrections` (mirror RRT DDL, add `scope` = user|global),
  `email_queue_events` (login/logout + usage tracking).
- **`data/`** (gitignored): per-queue `content/` FAQ folders, cached queue
  history, downloaded attachment bytes (transient).

## Guardrails (AI role protection)

- System prompt fixes the role: USAT customer-service rep, answer only within
  scope, never invent facts, never expose other contacts' data.
- `guardrails.js`: strip/deny PII from other contacts; allow this contact's own
  data; queue-wide history is *style only*, never quoted verbatim.
- "Enough info?" gate (`decide.js`) returns a structured verdict so the UI can
  branch to draft vs. need-info without trusting free text.
- Auto-respond is **off** for the POC; everything is operator-reviewed.

## Tests

- Unit (`node --test`, no network): mock `conn` for every `sf/` function; mock
  provider for `ai/`; guardrail tests (PII leak attempts must fail);
  decide.js verdict tests; snake_case lint test (port RRT's).
- Integration: read-only smoke against SF **sandbox** (`SF_DEV_*`).
- E2E (optional): Playwright over the web UI (port RRT's harness).
- Write path: assert it stays disabled — a test that `send_reply` returns
  `{enabled:false}` and never calls the connection.

## Milestones

0. **Verify access (do first).** Run `verify_sf_access.js` as the integration
   user; record results in `salesforce_api_requirements.md` §10. Fix any FLS /
   Enhanced-Email / sharing gaps before writing `sf_threads.js`.
1. **Scaffold + SF reads.** Copy `sf/`, add `sf_queues`/`sf_threads`/
   `sf_context` per the §8 field contract + §9 context rules; CLI lists queues →
   emails → full thread. `sf_threads` assembles multi-turn threads (group by
   `ParentId`, order by `MessageDate`, **strip quoted history**) and lists
   attachments (`ContentDocumentLink → ContentVersion`, with download via
   `sf_fetch`). Unit tests w/ mock.
2. **AI draft (read-only).** Port agent + providers; `context.js` assembles
   grounding (stripped thread turns + contact history + extracted attachment
   text + FAQ); `decide.js` returns draft | need-info. Default ChatGPT, Claude
   selectable.
3. **Web app + auth.** Express server 8019, converter-style UI, auth + login
   tracking from RRT/admin.
4. **Corrections + history + guardrails hardening.** MySQL store, scope
   user|global, viewable threads, PII/scope tests.
5. **Write wiring (disabled).** `sf_write.js` builds payloads, returns
   `would_send`, surfaces "not enabled" in UI/CLI. Sandbox-gated for the future.
6. **Docs.** README + CLAUDE.md + this plan kept current.

## Alternative: native Salesforce build (build-vs-buy)

What we're building is close to a product Salesforce already sells, so this is
partly a build-vs-buy decision. Two native paths:

1. **Agent-assist (human-in-the-loop) — closest to this POC.** *Einstein
   Service Replies for Email*: Einstein drafts a reply the agent reviews/edits/
   sends, grounded in Knowledge / Data Libraries, now customizable via *Prompt
   Builder*. Maps ~1:1 to our "AI drafts → operator reviews → send, don't
   auto-send" requirement.
2. **Autonomous — *Agentforce Service Agent for Email*.** Plugs into the
   Email-to-Case flow and responds autonomously, grounded in Data Libraries.
   Already skips emails whose headers look automated (the auto-loop concern we
   documented in the API doc §9).

### High-level to build native (agent-assist path)

1. Enable Service Cloud Einstein (+ Data Cloud if using Data Libraries) — paid.
2. Build a Knowledge base / Data Library = our per-queue "content folder" FAQs.
3. Author a Prompt Builder template = our system prompt + context rules (role,
   guardrails, "say when you don't have enough info").
4. Ground the prompt on the Case, EmailMessages, Contact, and Knowledge.
5. Surface "Draft with Einstein" in the Case email composer; agent reviews/sends
   → native sender identity solves the "who responded / attribution" question.
6. Iterate via Knowledge edits + prompt versioning; report via native analytics.

### Pros (native)

- Far less to build/maintain; no API plumbing, auth, or hosting.
- Sender identity & "send into the queue" are native — erases the OAuth /
  attribution work.
- Einstein Trust Layer gives PII masking + zero-retention guardrails for free.
- Threading, attachments-as-files, Knowledge grounding built in.

### Cons / clashes with our stated requirements

- **LLM choice:** native uses Salesforce's models (BYO-LLM only via Models API/
  Einstein Studio). Our "default to ChatGPT, user-selectable model" is awkward.
- **Attachments:** Agentforce email agent processes only subject + body, not
  images/attachments — our notes want attachments considered.
- **Bespoke context rules:** our custom logic (exclude automated from learning
  but keep in thread; match history by SuppliedEmail; per-user vs global
  corrections) is freer in our own code than in Prompt Builder/Data Libraries.
- **Cost & re-platforming:** paid add-ons + consumption (see below), and we'd
  move off the Node repo's reusable auth/corrections/metrics/menu patterns.

### Cost (2026 list prices — confirm with our Salesforce AE; nonprofit discounts likely apply)

- **Agent-assist (per user):** the Einstein/Agentforce-for-Service add-on is
  ~**$125 / user / month** on top of an eligible Service Cloud license
  (~$150 for industry clouds). Predictable; scales with # of agents, not email
  volume. For a handful of USAT agents this is the modest, predictable option.
- **Autonomous (consumption):** *Agentforce Service Agent* is usage-priced —
  **$2 / conversation**, OR **Flex Credits** at **$500 per 100,000 credits**
  (standard action = 20 credits ≈ **$0.10**; voice = 30 ≈ $0.15). The two models
  can't be mixed in one org. Free tier: Agent Builder, Prompt Builder, 200k Flex
  Credits + 250k Data 360 credits.
- **Bundle:** *Agentforce 1 Edition* ≈ **$550 / user / month** (base license +
  unmetered AI + 1M Flex Credits/yr + Data Cloud).
- **Likely add-ons:** Data Cloud (~$25–50/user/mo) if using Data Libraries;
  Einstein Bots (~$75/user/mo) for some chat scenarios.
- **Rough volume sanity check:** the Coaching queue alone saw ~899 inbound/3 mo
  (~300/mo). Across 11 queues, autonomous-by-conversation could run from a few
  hundred to a few thousand $/month depending on volume; agent-assist stays flat
  at (# agents × ~$125). USAT is a nonprofit/NGB, so Salesforce.org discounts may
  materially change these numbers — confirm with the account team.

### Recommendation

- If the goal is the least-effort path to production and Salesforce's LLM +
  licensing are acceptable → **native (Einstein Service Replies for assist,
  Agentforce for autonomous)** likely beats building from scratch.
- If the goal is full control (ChatGPT default, custom context/guardrail/
  correction logic, attachments, no new licensing) → **the external app** (this
  plan) is the right vehicle to validate on our terms.
- **Hybrid is viable:** prove the concept in the app now; later port the winning
  prompt + rules into Prompt Builder, OR keep the app but call Salesforce's
  Models API so the LLM runs in-platform behind the Trust Layer.
- **Biggest single decision driver:** the LLM-choice requirement. Firm on
  "default ChatGPT" → external/hybrid. Negotiable → native gets much stronger.

## Open items to confirm later (not blockers)

- Exact send mechanism when writes are enabled (emailSimple action vs
  EmailMessage create) and which integration user/profile.
- **Sender identity:** true per-user attribution (Carlie sends as Carlie →
  OAuth/impersonation, each app user mapped to their SF user) vs. a shared queue
  Org-Wide Email Address. This decision drives the auth design — see
  `salesforce_api_requirements.md` §5a.
- Whether to move to a Connected App / OAuth before any prod write.
- **API limits** (ACTION ITEM) — confirm the Salesforce daily API allocation +
  per-email call cost, and the OpenAI/Anthropic RPM/TPM + context-window limits,
  sized against expected volume. Details in `salesforce_api_requirements.md` §13.
- How "stages/steps" on a Case should be populated (Case Status vs a custom
  field) — confirm the org's Case process.
