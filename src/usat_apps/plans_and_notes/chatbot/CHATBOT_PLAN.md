# Chatbot Platform — Plan

_Planning only, no code. A usat_apps-hosted AI chatbot platform whose first deployment is an embeddable widget on the Team USA page (`https://www.usatriathlon.org/our-community/age-group-team-usa`), injected via GTM. Built on the **salesforce_email_queue** AI + knowledge foundation so the two feed each other. Designed **multi-instance from day one** so it scales to other pages / sites / channels without a rebuild. Drafted 2026-07-13._

---

## Vision in one line
One backend **brain** (shared AI + curated knowledge, reused with the email queue) behind **N front doors** — the first door is a public chat widget on the Team USA page; the admin lives in usat_apps.

---

## 1. Architecture — two front doors, one brain

- **Public door — the widget:** a tiny embeddable chat bubble for anonymous website visitors.
- **Staff door — the usat_apps module:** login-gated; configure the bot(s), review transcripts, curate knowledge, handle escalations, watch metrics/cost.
- **Shared AI + knowledge service:** the same provider/cost + FAQ/corrections + SF-read foundation the email queue uses. Neither app "owns" it; both consume it. This is where "the two apps feed off each other" actually happens.

## 2. Hosted in usat_apps, served to the public site

usat_apps hosts three things; the public site loads only the first via GTM.

- **Widget bundle** — a small self-contained JS/CSS served from your origin (e.g. `usat-app.kidderwise.org/apps/chatbot/widget.js`). GTM injects a Custom HTML tag (`<script async …>`) with a trigger scoped to the `/our-community/age-group-team-usa` path. Rendered in a **shadow DOM** so host-page CSS can't break it (or vice-versa). **Config-driven** via data attributes (embed key / scope) — see §4.
- **Public chat API** — CORS-enabled, **unauthenticated but hardened**: origin allowlist (only the Team USA page), a public **site/embed key**, per-session/IP **rate limits**, and hard **scoping to PII-safe knowledge only**. Message in → grounded answer out.
- **Admin panel** — a normal usat_apps module behind the existing login + rail.

**Coordination (not code):** the site's **CSP** must allow the script origin + `connect-src` to the API (GTM injection + cross-origin fetch are commonly CSP-blocked), and **cookie/consent** if any cookie is set. Both are conversations with the web/marketing team.

## 3. Shared brain + the feedback loop — and the PII line

**The crux: a public bot must never touch member PII.** Its value from the email queue is the *curated, derived knowledge*, not the raw inbox.

- **Email queue → chatbot:** per-queue **FAQ**, operator **corrections**, and approved/published answers become the bot's grounding. Same knowledge that answers a Team USA email answers a visitor — minus the personal data.
- **Chatbot → email queue:** when the bot can't answer, or the visitor needs a human / has an account-specific issue, it **escalates** — drops a ticket into the queue (or a dedicated "chatbot escalations" lane). Unanswered questions become **FAQ candidates**; chat analytics surface top questions to add proactively.
- **Shared AI plumbing:** the email POC's provider abstraction, model/cost tracking, and **strict grounding** ("answer only from provided context; else say you don't know and offer a human") carry straight over — that grounding is exactly what keeps a public bot from hallucinating or leaking. Both modules log to the platform metrics + cost tracking.

## 4. Scaling to other pages / surfaces — design multi-instance from day one

Launch on one page, but build so "add it to another page" is **a config row + a GTM tag, not a code change.** The Team USA page is just the first *deployment* of a general platform.

- **Bot instances keyed by an embed key / scope.** One widget bundle, one API, N configured instances. Each instance = persona/system prompt + allowed knowledge scope(s) + guardrails + rate limits + escalation target + theme + **origin/page allowlist** + embed snippet.
- **Knowledge partitioned by scope** (Team USA, membership, events, coaching, rules …). An instance binds to one or more scopes. This **generalizes the email queue's per-queue FAQ** — each queue/topic is already a scope, so the partition exists.
- **Config-driven widget + scope-parameterized API.** The widget carries its embed key (and optionally the current page URL); every API request carries a scope; grounding filters by it. No Team-USA specifics hardcoded.
- **Page-aware routing (optional).** The widget can pass the page URL and the API picks the scope from a URL-pattern map — so one GTM tag site-wide can serve the right scope per section. Start with an explicit per-page config; grow into URL routing.
- **Channel-agnostic brain.** Because the brain is "message → grounded answer," the website is just one channel. Later channels (in-app help inside usat_apps, Slack, SMS, a different domain) are new front doors on the same backend — the same "N front doors, one brain" pattern.
- **Per-scope isolation + metrics.** Each scope has its own origin allowlist, escalation path, PII policy, and its own analytics/cost breakdown, so a bot on one page can't reach another scope's data, and you can see which pages drive usage.
- **MVP discipline:** ship **one instance (Team USA)** on the multi-instance foundation. Build the data model + scope param now; the full multi-instance admin UI is an additive later step, not a rebuild.

## 5. Sequencing — port the email queue first (it's the foundation)

**Port the email queue into usat_apps first — the real prerequisite is the shared backend, not 100% UI polish.**

- The chatbot depends on the email queue's **AI + knowledge**, which today lives inside standalone 8019. Building the chatbot against 8019 across a service boundary is exactly the cross-service coupling / tech debt we're avoiding.
- Right first move: **fold the email queue into usat_apps as a module, refactoring its AI/providers/cost + knowledge (FAQ/corrections) + SF-read layer into shared usat_apps services.** That establishes the foundation the chatbot needs anyway.
- You do **not** need pixel-perfect UI parity before starting the chatbot — you need the shared services + a *functional* admin. Finish the email-queue UI parity iteratively.

## 6. Phases (each stops at a working gate)

- **Phase 0 — Lock decisions** (§7). Especially the PII boundary + human-handoff path.
- **Phase 1 — Email queue → usat_apps module.** Backend + functional React admin; extract AI (providers/models/cost), knowledge (FAQ/corrections), and SF-read into **shared usat_apps services**. _Gate: staff triage works in-platform; shared services callable._
- **Phase 2 — Chatbot backend.** Public chat API with the **scope model**, RAG over the shared knowledge, strict grounding, rate limits, origin allowlist, escalation hook. Seed **one Team USA scope**. _Gate: curl the API, get a grounded Team USA answer; unknown → escalation._
- **Phase 3 — Widget + GTM.** Shadow-DOM, config-driven widget bundle; GTM tag scoped to the Team USA path; CSP/consent coordinated. _Gate: bubble live on the page in staging, answers real questions._
- **Phase 4 — Admin.** Bot config, transcript review, escalation queue, metrics/cost, FAQ curation loop back into the shared knowledge. _Gate: staff can tune the bot + see conversations without touching code._
- **Phase 5 — Scale.** Add a second scope/page (proves the multi-instance model); optional new channels. _Gate: a new page bot = config + GTM tag only._

## 7. Decisions to lock / risks

- **PII boundary (biggest):** bot reads only curated knowledge, never raw cases/PII. Confirm + enforce in the scope model.
- **Human handoff:** escalate to a queue ticket, a live-chat vendor, or a contact form?
- **Anonymous trust model:** site key + origin allowlist + rate limits now; identifying a logged-in member is a later, separate phase.
- **Reliability posture:** this is the **first public, customer-facing** endpoint — internal tools could be flaky, this can't. Capacity + isolation review (possibly a worker-style split like merge; consider a separate public-API process from the admin).
- **Cost controls:** model tier, cache common answers, rate limits, per-scope budgets.
- **CSP / consent / GTM permissions** on usatriathlon.org — web-team coordination.
- **Knowledge scope at launch:** Team USA FAQ only, then widen.
- **Hallucination / brand safety:** strict grounding + "I don't know → human," refusal on out-of-scope, logging for review.
