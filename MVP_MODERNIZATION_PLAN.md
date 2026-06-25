# MVP Modernization Plan — sql_programs

Planning only. No code changes. The goal across all three projects is the **smallest possible change that delivers the outcome while staying consistent with the current code** (Express + pm2 + Cloudflare tunnels + SSH-tunneled MySQL). Each project is broken into phases so you can stop after any phase and still have something working.

Useful fact discovered during review: **`http-proxy-middleware@3` and `@google-cloud/storage@7` are already in `package.json`**, and GCP service accounts already exist in `.env`. So projects (a) and (b) need almost no new dependencies.

---

## Current state (what we're working with)

- ~22 `server_*.js` files, each a standalone Express app on its own port (`8014` auto_renew, `8015` scraper, `8016` event_analysis, `8017` salesforce_duplicates, `8018` race_results_transform, `8019` salesforce_email_queue, `org_chart` via `ORG_CHART_PORT`, plus several Slack/data servers on default ports).
- **pm2** runs each one (`utilities/pm2_scripts`, the `pm2_*` scripts in `package.json`, with `--cron-restart` schedules).
- Each app is exposed to the internet **individually** via a Cloudflare tunnel subdomain (`usat-events.kidderwise.org`, `usat-salesforce-duplicates.kidderwise.org`, etc.). `utilities/create_ngrok_tunnel.js` is the dev equivalent.
- **Two apps already use a clean `create_app()` / `start_server()` factory** (8016 event_analysis, 8019 email_queue). 8019 also already has cookie-session auth (`src/salesforce_email_queue_proof_of_concept/auth/*`). The older apps (events, duplicates) use the inline `app.listen(PORT)` pattern.
- Databases: a **local MySQL** (`usat_sales`, port 3306) and a **remote USAT membership DB** reached over an **SSH tunnel** (`utilities/connectionUSATMembershipDB.js` + `utilities/config.js`).
- The three target web apps (`events`, `salesforce_duplicates`, `salesforce_email_queue`) currently render **server-side HTML / static files** — there is no Vite or React anywhere yet.

---

## Project A — Route all servers through one proxy

You suggested "just create a proxy server JS and route everything through it." That instinct is correct and is the recommended path. Below is a comparison, then the phased plan for the recommended option.

### Option comparison

**Option 1 — Node reverse proxy (recommended).** A single new `server_proxy_8000.js` (Express + the already-installed `http-proxy-middleware`) listens on one public port and forwards path prefixes to each existing server on its localhost port:

```
/events/*      -> http://127.0.0.1:8005
/event-analysis/* -> http://127.0.0.1:8016
/duplicates/*  -> http://127.0.0.1:8017
/email-queue/* -> http://127.0.0.1:8019
... etc
```

- **Pros:** one file, one new pm2 process, fully consistent with your JS/pm2 world; you can add cross-cutting logic later (single auth gate, logging, rate limiting) in one place; only one Cloudflare tunnel needed going forward.
- **Cons:** the proxy is a single process in the request path (pm2 already mitigates this); apps that build absolute URLs or set cookie paths may need a base-path tweak.

**Option 2 — Edge-only (Cloudflare / nginx).** Keep every server as-is and consolidate routing at the edge: one hostname with path rules (Cloudflare "public hostname" path routes, or an nginx `location` block per app) instead of one subdomain per app.

- **Pros:** zero new Node code; no extra process; TLS and routing handled by infrastructure you already run.
- **Cons:** routing config lives outside the repo (less "consistent with current code"); per-app changes mean editing tunnel/nginx config rather than JS; no shared place for app-level logic like a unified login.

Recommendation: **Option 1** as the primary, because it lives in the codebase, matches your pattern, and becomes the natural home for the single Office login in Project C. Option 2 remains available as the TLS/edge layer in front of the proxy.

### Phases

**Phase A0 — Inventory & decide the path scheme.** List every server, its port, and its current Cloudflare subdomain; pick a path prefix for each. Decide whether the proxy preserves the prefix (`/events/scheduled-events`) or strips it. ~1–2 hrs, no code.

**Phase A1 — Stand up the proxy for 1 app (spike).** Create `server_proxy_8000.js` proxying just `/events/*` -> `8005`. Run it under pm2. Confirm the existing endpoints work through the proxy. Smallest possible proof. ~2–4 hrs.

**Phase A2 — Add the remaining servers.** Add one proxy rule per server, driven by a small route table (so adding a server is a one-line change). Keep the apps on their existing ports unchanged. ~half a day.

**Phase A3 — Flip the edge to one tunnel.** Point a single Cloudflare hostname at the proxy port; retire the per-app subdomains (or keep them temporarily as aliases for a safe cutover). Update any hard-coded callback URLs (Slack slash commands, cron `curl` targets in `utilities/cron_*`). ~half a day + testing.

**Phase A4 (optional later) — Centralize cross-cutting concerns.** Move logging/auth into the proxy. This is also where Project C's single Office login naturally lives.

**Risks / watch-items:** Slack endpoints and the `utilities/cron_*` jobs call these servers by URL — those URLs change when you consolidate, so they must be updated in lockstep. SSE endpoints (event_analysis `/api/build`, etc.) need proxy buffering disabled.

---

## Project B — Nightly database backup to cloud storage

Destination chosen: **Google Cloud Storage** (you already have `@google-cloud/storage` installed and GCP service-account credentials in `.env`). This is the lowest-friction option.

Mechanism, end to end: a scheduled job runs `mysqldump` for each database, gzips the output, names it with a timestamp, and uploads it to a GCS bucket — exactly mirroring how your existing `utilities/cron_*` jobs are structured and scheduled by pm2 `--cron-restart`.

### Phases

**Phase B0 — Confirm scope & retention.** Two databases to cover: local `usat_sales` (localhost:3306) and the remote membership DB (via the SSH tunnel in `connectionUSATMembershipDB.js`). Decide retention (e.g. keep 30 daily + 12 monthly) and create/choose the GCS bucket with a lifecycle rule for auto-expiry. ~1–2 hrs, no code.

**Phase B1 — Back up the local DB (spike).** New `utilities/cron_db_backup/` job: `mysqldump usat_sales | gzip` to a temp file, then upload to GCS using the existing Storage client. Run it once by hand to verify the object lands in the bucket. Smallest proof. ~half a day.

**Phase B2 — Back up the remote DB.** Reuse the existing SSH-tunnel connection pattern so the dump runs through the same tunnel the app already uses (`mysqldump` over the forwarded port). ~half a day.

**Phase B3 — Schedule nightly + verify restore.** Add a pm2 entry with a nightly `--cron-restart` (consistent with your other crons). Add a lightweight success check (log line / Slack ping reusing `server_slack.js`). **Do one test restore** from a downloaded dump into a scratch DB — a backup isn't real until a restore is proven. ~half a day.

**Phase B4 (optional) — Alerting.** Notify on failure or if no new object appeared in the bucket within 24h.

**Notes:** GCS lifecycle rules handle retention/rotation for you (no cleanup script). `mysqldump` needs to be available on the host (it is, given the MySQL tooling already in use). The `.env` currently contains live private keys committed to a tracked file — worth treating as a separate security cleanup item, independent of this plan.

---

## Project C — Consolidate the three web apps into one Vite/React site behind Microsoft Office auth

Today `events`, `salesforce_duplicates`, and `salesforce_email_queue` are separate apps with server-rendered HTML. Target: **one React (Vite) front end**, served under **one site**, gated by **Microsoft (Entra/Office 365) login**, with the existing Express servers continuing to do the data work behind it. This is the largest of the three; the phasing keeps each step shippable.

Reusable assets: 8019 already has a working session/auth module and a `create_app()` factory; 8016 also has the factory pattern and a public dashboard. You mentioned having related code — that can seed Phase C2.

### Phases

**Phase C0 — Decide the auth + hosting shape.** Confirm Microsoft Entra ID (Azure AD) app registration: who can log in (single tenant vs. specific users), redirect URI, and whether auth is enforced **at the proxy** (recommended — one gate for everything, builds on Project A) or per-app. Register the app in Entra and capture client/tenant IDs into `.env`. ~half a day, mostly config.

**Phase C1 — Add Microsoft login at the proxy (depends on Project A).** Implement the OIDC/OAuth login flow once, in the proxy, issuing a session cookie in the same style 8019 already uses. Every proxied app sits behind it automatically. This supersedes the local cookie login in 8019 for these surfaces. ~1–2 days.

**Phase C2 — Scaffold the unified Vite/React app.** Create one `web/` Vite + React project with a route per surface (`/events`, `/duplicates`, `/email-queue`) and a shared shell (nav + signed-in user). Start by embedding/porting the simplest existing screen so there's a running site early. ~2–3 days for the shell + first screen.

**Phase C3 — Port screens one at a time.** Convert each app's current HTML/dashboard into React views that call the existing Express endpoints as JSON APIs (most already return JSON). Do them in order of simplicity: duplicates → events → email-queue. Each ported screen is independently shippable. ~1–3 days per app depending on complexity (email_queue is the richest).

**Phase C4 — Serve the built site through the proxy.** Vite builds to static assets; the proxy (or one small Express static handler) serves them at the root, with `/api/*`-style calls proxied to the backing servers. Retire the old per-app HTML once parity is confirmed. ~1 day.

**Risks / watch-items:** the three apps have different data shapes and the email-queue app has the most surface area — treat C3 as iterative, not one big bang. Any endpoint that isn't already JSON needs a thin JSON wrapper. Keep the old HTML routes live until each React equivalent is verified.

---

## Suggested overall sequencing

The three projects share infrastructure, so order matters:

1. **Project A (proxy)** first — it's small, low-risk, and is the foundation the Office login (C1) and the unified site (C4) plug into.
2. **Project B (backups)** next, in parallel if you like — it's independent of A and C and protects your data while the bigger front-end work proceeds.
3. **Project C (Vite/React + Office auth)** last and incrementally — auth at the proxy (C1) reuses A, then port screens one at a time so the site is always shippable.

Rough effort at MVP quality: A ≈ 2–3 days, B ≈ 2 days, C ≈ 2–3 weeks (front-loaded by auth + scaffold, then steady per-screen porting). Each phase above is a natural stopping point.

## Open questions to resolve before building

- Project A: keep per-app subdomains as aliases during cutover, or hard switch?
- Project B: confirm GCS bucket name + retention policy, and where `mysqldump` credentials for the remote DB should live.
- Project C: single-tenant Entra (only your org's Microsoft accounts) or a specific allow-list of users? This drives the app registration.
