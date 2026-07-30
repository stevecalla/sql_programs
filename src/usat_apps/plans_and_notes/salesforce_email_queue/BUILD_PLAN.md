# Email Queue fold-in — BUILD PLAN (sequenced)

Status: **planning** · Last updated: 2026-07-30

The execution companion to `EMAIL_QUEUE_FOLDIN_PLAN.md` (the architecture) and `PORT_INVENTORY.md`
(the file map). This doc answers three questions at once: **what are the phases**, and how each phase
delivers **feature parity**, **chatbot-prep**, and **efficiency**.

Yes, it's a real build — but it's smaller than it looks, because ~40% of the old app is chrome the
platform already provides, the backend ports nearly verbatim with its own tests, and the only true
*rebuild* is one UI page. The shared-services work is leverage, not overhead: it's paid once and reused
by the email queue, the chatbot, and race-results.

---

## The three lenses (applied to every phase)

**Parity — the test suite is the contract.** The app ships ~16 node tests + a Playwright E2E. They port
*with* the code, and **each phase's gate is its tests green + a side-by-side check against the live 8019
app.** No slice is "done" until it matches. This is how we get 100% parity cheaply — we don't invent a
QA process, we inherit one.

**Chatbot-prep — extract shared, scope-aware services first.** `services/ai`, `services/knowledge`,
`services/corrections`, `services/salesforce` are built as first-class, **scope-aware** services (scope =
`_global | <queue> | <embed-key>`) from day one. The chatbot then becomes a thin second consumer of the
same brain — not a fork. The earlier we land these, the sooner the chatbot's architecture is unblocked.

**Efficiency — reuse, extract-once, backend-before-UI, no premature cutover.** Reuse the platform (auth,
session, Ops, metrics framework, React shell, the shared SF connector). Extract each shared service once
and reuse it across apps. Port the tested backend before rebuilding the UI. Run in parallel with 8019 and
retire it only after parity is proven.

---

## Phase map at a glance

| Ph | Focus | New server? | Parity gate | Chatbot-prep | Rough size |
|----|-------|-------------|-------------|--------------|-----------|
| 0 | Scaffold + decisions | no | skeleton reviewed | seam chosen | XS |
| 1 | **Shared services** (ai/knowledge/corrections/salesforce) | no | brain tests green | ★ the foundation | M |
| 2 | EQ module API + SF read (mount into 8022) | no | routes tests green | confirms PII boundary | M |
| 3 | Operator UI (React rebuild) | no | E2E + side-by-side | — | L (biggest) |
| 4 | Admin settings + metrics dashboards | no | admin/metrics tests | — | M |
| 5 | Cutover + retire 8019 | removes one | full suite + UAT | — | S |
| 6 | Chatbot (separate plan) | **yes** (public) | its own | ★ ships on the brain | (separate) |

---

## Phase 0 — Scaffold + decisions  *(mostly done)*

**Do:** module + `services/` + plans folders exist (done). Confirm the four blocking decisions: (a) the
top-level `services/` seam — recommended yes; (b) corrections/knowledge storage — DB now vs file-first;
(c) default AI provider; (d) the `email-queue` slug.
**Parity:** n/a — platform unchanged, 8022 still boots.
**Chatbot-prep:** deciding the `services/` seam *is* the chatbot-prep decision.
**Efficiency:** nothing built yet; just remove ambiguity so Phase 1 doesn't rework.
**Gate:** decisions confirmed; skeleton reviewed.

## Phase 1 — Shared services foundation  *(the leverage phase)*

**Do:** extract the brain into `src/usat_apps/services/`:
- `services/ai/` — providers (OpenAI + Anthropic), models/pricing, respond/triage/ask/extract, prompt.
- `services/knowledge/` — from `ai/faq.js`, **scope key generalized** (`_global | <queue> | <embed-key>`).
- `services/corrections/` — scope-generalized, DB-backed per Phase 0.
- `services/salesforce/` — adopt the existing `utilities/salesforce/salesforce_connect.js` (role-aware
  read/write, prod/sandbox) + SOQL/describe/limits helpers. One shared SF client for all modules.
Port the brain-facing unit tests (ai, ask, extract, triage, spam, text_clean, faq_corrections).
**Parity:** the same unit tests that guard 8019's `ai/`/`sf/`/`store/` now guard the services — green = parity of the brain.
**Chatbot-prep:** ★ **this is the chatbot's foundation.** Scope-aware knowledge + shared AI + shared SF
mean the chatbot is a second caller, not a copy.
**Efficiency:** extract once → reused by email queue (Ph 2), chatbot (Ph 6), race-results (later). Highest
leverage in the whole plan.
**Gate:** `services/*` tests green under `run_tests.js`. No routes, no UI, no server.

## Phase 2 — Email Queue module API + SF read  *(mounts into 8022 — no new server)*

**Do:** port the email-queue's `sf/` read layer (pointed at `services/salesforce`, not a copied
connection); port `web/routes.js` → `modules/salesforce_email_queue/api.js` under
`/api/salesforce-email-queue/*`, login- and `email-queue`-panel-gated; add the manifest to
`modules/registry.js` so `mount_all` wires it into the existing server. Read-only, no UI yet. Port the
routes + analytics tests.
**Parity:** routes tests green; hit each endpoint and diff against 8019's responses.
**Chatbot-prep:** the module's raw-case read routes stay *inside* the module — the chatbot simply won't
mount them, which is the PII boundary made structural.
**Efficiency:** **no new server** — this phase proves the "just register" model; adopt the shared SF
connector rather than re-copying plumbing.
**Gate:** endpoints answer under `/apps` behind the proxy; tests green.

> After Phase 2, the chatbot's *architecture* is unblocked — its brain (services) and the read/PII
> boundary both exist. Phase 3 (UI) and early chatbot design can proceed in parallel if you want.

## Phase 3 — Operator UI (React rebuild)  *(the biggest single chunk)*

**Do:** rebuild the ~890-line vanilla page as `web/src/modules/salesforce_email_queue/Section.jsx` +
pages — queue & filters + case cards in the module rail; thread + AI panel (Draft, Ask, Corrections,
Context files, SOQL) in the body, per the approved mockup. Register in `web/src/modules/registry.js`.
Port the Playwright E2E.
**Parity:** Playwright E2E green + side-by-side against 8019 (the mockup is the spec).
**Chatbot-prep:** none directly — but the widget later reuses the same `services` the UI calls.
**Efficiency:** reuse the Merge module's structure + the platform shell/theme/footer. **MVP-first**:
queue → thread → draft → ask → corrections first; knowledge editor + SOQL panel follow so the app is
usable sooner.
**Gate:** parity checklist + E2E green. The operator app is fully live in usat_apps at this point.

## Phase 4 — Admin settings + metrics dashboards

**Do:** port the EQ **Settings** (SF env switch, AI models & pricing, TEST-MODE banner, admin landing),
**queue access** (general default + per-user overrides), and the **Reference** page. Port the **metrics
dashboards** (funnel, verdicts, by-queue/provider/action, cases-worked, corrections/context changes, AI
spend + cost-by-model) as a module Metrics page. Reuse platform users/panel-access/Ops/Ask.
**Parity:** admin + metrics tests green; dashboards match the live numbers.
**Chatbot-prep:** the AI-models/pricing list + Ask are shared surfaces the chatbot's analytics can reuse.
**Efficiency:** reuse the platform metrics *framework* + Ask-your-data; only the domain charts/config are
new. (Consolidate the shared **SF API-usage** tracking here or just after — generalize the Merge SF-API
panel into `services/salesforce/api_usage` so merge + email-queue report one org footprint.)
**Gate:** admin + metrics tests green.

## Phase 5 — Cutover + retire 8019

**Do:** full test pass + your hands-on UAT; run the module and 8019 in parallel briefly; then retire 8019
like we did 8020 — a retirement runbook (copy the merge one), pm2 stop/delete, remove
scripts/proxy/tasks entries. **Keep** all `SF_*` creds and the `salesforce_email_queue_events` +
ask-log/ask-corrections tables. No worker to preserve.
**Parity:** full suite green + your acceptance = the definition of done.
**Efficiency:** reuse the merge retirement runbook; nothing net-new to design.
**Gate:** 8019 retired; the module is the single source of truth.

## Phase 6 — Chatbot  *(separate plan, now unblocked — the one place a new server appears)*

**Do:** a new module that is a **second consumer** of `services/ai` + `services/knowledge` (PII-safe
scope only), a **dedicated public server** (`externalApi: true`, e.g. `server_usat_apps_public_80xx.js`)
with CORS allowlist + site key + rate limits + **no session cookie**, and the GTM shadow-DOM widget.
**Chatbot-prep:** ★ it ships *on top of* Phases 1–2 with no re-work — that's the whole point of the
sequence.
Covered by `plans_and_notes/chatbot/CHATBOT_PLAN.md`; not part of this fold-in.

> **Race Results Transform** ports next and plugs into the same `services/salesforce` (and any shared
> bits), validating the extract-once investment — no new SF plumbing, and its consumption joins the
> shared org-budget footprint automatically.

---

## How the three goals are guaranteed (summary)

- **Feature parity:** the ported test suite is the gate at every phase, plus a side-by-side check against
  the live app; 8019 stays running until parity is proven (Phase 5), so there's always a reference.
- **Chatbot-prep:** the shared, scope-aware services land in Phase 1 and are proven by Phase 2, so the
  chatbot (Phase 6) is a thin second consumer — no fork, no duplicated brain, PII boundary structural.
- **Efficiency:** reuse the platform (~40% of the old app not re-written), extract shared services once
  and reuse across 3+ apps, port the tested backend before the one real UI rebuild, MVP-first UI, and no
  premature cutover.

## Sequencing / parallelism (to move fast without rework)

- Phases are mostly linear, **but** after **Phase 2** the chatbot's architecture and the **Phase 3** UI
  can run on separate tracks.
- **Phase 4** (admin/metrics) can partly overlap **Phase 3** (UI) — different surfaces.
- Do **not** start **Phase 5** (retire 8019) until Phases 3–4 parity is signed off.

## Open decisions to lock before Phase 1

1. `services/` top-level seam — yes (recommended).
2. Corrections/knowledge storage — DB in Phase 1, or file-first then migrate.
3. Default AI provider — keep OpenAI, or standardize on Anthropic.
4. UI parity bar for Phase 3 — MVP-first (recommended) vs full-parity-in-one.
5. Slug/URL/panel — `salesforce_email_queue` / `/email-queue` / `email-queue`.
