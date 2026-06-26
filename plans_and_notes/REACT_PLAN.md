# Project C — React Consolidation + Unified Auth (standalone plan)

A staged plan to consolidate the UI apps into **one React (Vite) site** behind **Microsoft (Entra) sign-on**, while keeping each app's current look/behavior and unifying the cross-cutting concerns (auth, nav, logging, security). **Nothing here is built yet** — this is the strategy/decision record to work through one stage at a time, the same way as `PROXY_PLAN.md`.

Depends on Project A (the proxy) as its foundation. Read `PROXY_PLAN.md` first.

---

## Core principle — rewrite the UI layer only, never the backends

Moving to React changes the **presentation layer only**. The split that makes this tractable:

- **Backends stay as-is.** All Express servers, data pipelines, cron jobs, Slack handlers, SQL/BigQuery logic, and the proxy are untouched. React is a browser/frontend technology — it has nothing to say about server-side data work.
- **The UI gets rebuilt as React components that call the backends over URLs.** Calling a JSON endpoint by URL isn't a shortcut to avoid — it *is* the architecture. React fetches from existing endpoints (e.g. `usat-api/event-analysis/api/events`) and renders. You rebuild the *screens*, not the business logic.

So the Express servers shift role from "serve the page **and** the data" to "serve the data only" — a pure API/data tier. The code that fetches/computes data lives on; the code that renders/ships HTML retires.

### What this changes in how the sites use the server JS

- The UI apps (8016/8018/8019) **stop serving HTML/static** (`express.static`/`sendFile`); React owns the UI. Their JSON endpoints stay and become the only thing React talks to.
- Interaction becomes pure HTTP request/response: React loads once → fetches JSON → re-renders just the changed piece (no full page reload).
- **Two new seams appear at the boundary:**
  - **CORS** — frontend (`usat-app`) and API (`usat-api`) are different origins, so the servers must allow the cross-origin calls. email_queue already uses `cors()`; others may need it added.
  - **Auth moves upstream** — instead of each app logging users in, Microsoft login happens once at the gateway and the apps trust the verified identity (a forwarded header/token). Per-route gating logic stays similar to today's `require_auth`.
- **Spillover:** any screen that today emits only finished HTML (no JSON behind it) needs a small JSON endpoint added so React has something to fetch. Mostly already covered.
- **No change** to: data/SQL/BigQuery logic, result shapes, cron jobs, Slack servers (React never talks to them), or how apps run (still Express under pm2, behind the proxy).

### Static → dynamic

Today's UI apps are server-rendered: full page builds, reloads to see new data ("static" feel). React makes them single-page apps — the page loads once, components fetch in the background and re-render in place. Benefits: live updates without reloads (poll or SSE — event_analysis already streams build progress), client-side interactivity (sort/filter/search/tabs instantly), and shared state across sections (user, filters persist as you move between events/duplicates/email-queue). Caveat: "dynamic" needs the backend serving **data, not HTML** (mostly true already), and data is only as fresh as the pipelines make it — nightly tables stay nightly; what changes is the UI reflects them continuously and real-time sources can actually surface live.

---

## The UI apps in scope

| App | Port | Today | React target? | Notes |
|---|---|---|---|---|
| event_analysis | 8016 | server-rendered dashboard + `/api/*` | **yes** | the "events" UI app (not headless `server_events.js` 8005) |
| race_results_transform | 8018 | dashboard + `/api/*` + Slack | **yes** | confirmed UI app |
| salesforce_email_queue | 8019 | SPA-ish + `/api/*`, own cookie login | **yes** | richest app; SF integration (see below) |
| salesforce_duplicates | 8017 | Slack-only today | **future** | API-only now; gains a React screen when built |
| org_chart | 8011 | **Streamlit (Python)** | **special case** | Node proxies to Streamlit on 8501; see options below |

---

## Is React warranted? (consistency vs. trajectory)

A deliberate gut-check before committing, since most of the goals don't actually require React.

**What React does NOT buy you:** consolidation, single sign-on, consistent nav, unified logging/security — those all come from the **proxy + gateway auth** (Stages 1–2), not React. So ~90% of "stop having scattered apps with separate logins" is achievable without rewriting a single screen.

**Where React earns its keep:** genuinely interactive, stateful UIs. By app:
- **email_queue (8019)** — real interactive app (browse queues, read threads, AI triage/respond). React fits well; not overkill.
- **event_analysis (8016)** — borderline (editor + live build justify some dynamism, but much is dashboard).
- **race_results (8018)** / future **duplicates** — mostly dashboards/reports; a full SPA is more than the job needs.
- **org_chart** — Streamlit special case (separate decision).

**The honest reframe on "one framework":** you can't literally put everything in one framework — backends stay Node/Express, org_chart is Python/Streamlit, Slack/cron servers aren't UIs. React unifies the **human-facing frontends** (3–4 apps), not the whole system.

**The case FOR standardizing those frontends on one framework (the real reason to go past the gateway):**
- One mental model — today each `server_*.js` UI is bespoke; the tax is context-switching between differently-built apps, which hurts a solo maintainer most.
- A shared component/design system — build table/form/modal once, reuse everywhere; fixes propagate. This is the deep consistency a shared shell + CSS can't fully give.
- Compounding returns — the payoff scales with how many apps you have and how often you add them. Recent additions (duplicates, email_queue) suggest a growing platform, which is exactly when this pays off.

**Counterweights:**
- The benefit only materializes if you **commit to finishing** — a half-migrated state (some React, some server-rendered) means maintaining two stacks, worse than either.
- A shared **shell + design tokens** over existing pages gets much of the *felt* consistency (one login, nav, look) cheaply; full React adds the *deep* consistency (shared interactive components, one toolchain), which matters more the more the apps evolve.
- React's cost for a small/solo operation is real: Vite build pipeline, frontend/backend split (CORS, token plumbing), JSON endpoints where only HTML exists, a stack to maintain.

**The deciding question — trajectory:** is this a *growing platform* you'll keep building on, or a *stable set* of tools that mostly needs unifying then leaving alone? Growing → one-framework consistency is probably worth it, *provided* you commit to migrating the UIs over time. Stable → shell-level consistency captures most of the value and full React is hard to justify.

**Read for this situation:** the consistency argument tips toward "worth it," but the sequencing is unchanged — land proxy + gateway auth + shared shell first (unification is immediate and reversible), *then* commit to standardizing UIs on React deliberately (email_queue first). Bet on the framework *after* feeling how much the shell alone solved, not before. Decide React per app, not as a blanket rewrite.

## Staged approach (UI stays the same; cross-cutting gets unified first)

The valuable consistency (SSO, one front door) is a **gateway** concern and comes early and cheaply. The laborious part (UI rebuild) is decoupled, optional, incremental, and last. Order:

**Stage 1 — Proxy (Project A).** One front door. No UI change. Foundation for everything below.

**Stage 2 — Unify auth at the gateway.** Microsoft (Entra) login once at the proxy; existing apps sit behind it unchanged. Users get one sign-on; each app's screens look exactly as today. **No React required.** Apps shift from their own login to trusting the gateway-verified identity (small per-app change: accept a forwarded identity header; keep existing login as fallback during transition). Convert one app at a time.

**Stage 3 — Shared shell (optional, still no UI rewrite).** A thin wrapper giving every app a common header/nav/branding, with current app screens embedded or linked. Consistent frame; each app's actual UI untouched.

**Stage 4+ — Rebuild screens in React, faithfully, one at a time.** Only when you want the SPA/dynamic behavior. Goal is to reproduce the same UX (same fields/layout), so each port is mechanical, not a redesign. Deferrable app-by-app, screen-by-screen.

**Two levels of "consistent UX," arriving at different stages:** a consistent *shell* (same login, same nav) comes early (Stages 2–3); a consistent *look-and-feel* (shared design system — same buttons/fonts/spacing across apps) only arrives with the Stage 4 rebuild. "Each app keeps its current appearance" = easy/early. "All apps look like one product" = the later rebuild.

---

## Microsoft (Entra) authentication

- Register one Entra app (single-tenant or a specific allow-list of users — decide who can sign in).
- Auth enforced **at the proxy/shell** (recommended) so one gate protects everything, building on Project A.
- Issues a session the proxied apps trust; supersedes email_queue's local cookie login for these surfaces.
- **org_chart (Streamlit) caveat:** Streamlit won't natively honor an external identity, so it's *gated* at the proxy (blocked unless signed in) rather than truly integrated.

---

## Salesforce — move to a per-user Connected App (OAuth)

**Today:** the email queue reads Salesforce via a **shared service account** (`SF_PROD_USERNAME/PASSWORD/SECURITY_TOKEN/LOGIN_URL`, plus a `SF_DEV_*` sandbox set, toggled in the admin hub) using jsforce. Username/password/token login, server-side, read-only POC (`/api/send` is 403). **This is fully retained under the proxy + React** — SF connection is the server reaching out to Salesforce; the proxy only handles inbound HTTP, and React never holds SF credentials (it calls the 8019 server's endpoints; the server talks to SF as today).

**Target:** a Salesforce **Connected App with per-user OAuth**, so each staffer authorizes the app against their own SF login and the app acts on their behalf with their real permissions (profile, sharing rules, field-level security), logged as the real actor. This is the proper foundation if the app ever moves beyond read-only to sending/responding, because Salesforce enforces that user's permissions.

**Two identity layers — keep distinct (complementary, not redundant):**

- **Microsoft (Entra) SSO** = "can this person use the app at all" (gates entry to the site).
- **Salesforce Connected App OAuth** = "what SF data can this person see/do" (authorizes the app to act as that user in SF).

A user signs into the app via Microsoft, then connects their Salesforce once; a refresh token keeps it alive. (If SF is federated to the same Entra IdP, the SF step could later be made seamless — advanced; two logins is the normal MVP.)

**Callback URL — ties to the hostname decision.** A Connected App requires a registered **Callback URL (redirect_uri)** that must be the app's real public URL, e.g. `https://usat-app.kidderwise.org/auth/salesforce/callback`. Same "repoint" concern as the Slack URLs: it's configured in the Connected App and must match the deployed host — so **settle the hostname before registering it.** Flow: user clicks "Connect Salesforce" → SF login → authorize → SF redirects to the callback with a code → backend exchanges it for access + refresh tokens.

**Architecture fit — backend concern.** React just shows a "Connect Salesforce" button; the 8019 server handles the redirect, code exchange, and secure per-user token storage (encrypted at rest, likely extending the existing `auth_store`/session module backed by MySQL), and auto-refresh. React never sees SF tokens. Slots cleanly into the React-frontend / API-backend split.

**Practical notes for when built:**
- A Salesforce **admin** creates the Connected App; request least-privilege OAuth scopes (`api`, `refresh_token`/`offline_access`, `web` if needed).
- Org may require **admin pre-authorization** (permitted users via profiles/permission sets) so users aren't each prompted.
- Build/test against **sandbox** (`SF_DEV_*`) first, then production (both credential sets + env toggle already exist).
- **Token storage + refresh** is real backend work (encrypt, auto-refresh, handle revocation) — modest but don't hand-wave.

**Sequencing:** later-stage; not a prerequisite for the proxy. Pairs with rebuilding the email queue in React and standing up Microsoft auth. One cross-dependency: lock the final public hostname before registering the Connected App callback.

---

## org_chart (Streamlit) — conversion options

It's a Python Streamlit app (Node proxies to Streamlit on 8501; already has `/healthz`). Streamlit's model (Python script reruns top-to-bottom with server-side widgets) doesn't map mechanically onto React — converting is a genuine **rewrite**, not a port. Two parts with very different costs: the **org-chart visualization** is the easy part (JS has strong libraries — d3, org-chart components, react-flow), and the **data/compute logic** is the real work (where correctness lives). Three paths, by effort:

1. **Full JS rewrite** — reimplement data logic in Node + build the chart in React. Max consistency (one stack, unified auth/nav, no separate Python/venv, no double-proxy), max effort + risk of re-deriving Python logic wrong.
2. **Hybrid (lowest risk for the value)** — keep proven Python doing data prep as a small headless JSON API, build only the React frontend. Keeps the Python investment, gains UI consistency.
3. **Leave Streamlit as-is, just gate it** — behind unified Microsoft auth at the proxy, linked from the shell. Zero rewrite; consistent on login/nav but stays its own thing visually/technically.

**Recommendation:** org_chart is the **last** thing to touch, not the first. SSO + shell already make it feel consistent. Decide between option 1 and 2 based on how complex the Python logic is and whether full visual consistency justifies the rewrite. No need to take on the rewrite to get the early consistency wins.

---

## Decisions made

- Rebuild the **UI layer only**; backends become JSON APIs called by React over URLs. No business-logic rewrite.
- **Faithful UI ports** (reproduce current look/behavior), not a redesign — at least initially.
- **Staged, gateway-first:** proxy → unified Microsoft auth (no React needed) → optional shared shell → rebuild screens in React last, app by app.
- React UI apps = **8016, 8018, 8019**; **8017** gains a React screen later; **org_chart (8011)** is a special Streamlit case, touched last.
- Salesforce: move to a **per-user Connected App (OAuth)**; keep the shared service account working until then. Microsoft auth and Salesforce auth are **separate layers**.
- Lock the public hostname (`usat-app.kidderwise.org`) before registering the SF Connected App callback URL.

## Open questions

- Entra scope: single-tenant (all org Microsoft accounts) or a specific allow-list of users?
- Shared shell first (link/iframe existing apps), or go straight to native React per app?
- Does org_chart get a full JS rewrite (option 1), a Python-API + React frontend (option 2), or stay standalone behind SSO (option 3)?
- Build the SF Connected App against sandbox first — who is the Salesforce admin to create it and set scopes/pre-authorization?
- Design system: faithful per-app look initially, and unify into one product look later — or unify the look as each app is rebuilt?
