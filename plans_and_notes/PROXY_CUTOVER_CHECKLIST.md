# Proxy Cutover Checklist (Project A go-live)

Ordered, hands-on steps to take the proxy live on the server. The code is done;
this is deploy/config only. Full detail in PROXY_PLAN.md. Work top to bottom —
each step has a verify and nothing is irreversible until the last step.

Legend: `$` = run on the server.  "menu" = `npm run menu` option.

---

## 0. Pre-flight (one-time, on the server)

> **NOTE (2026):** the proxy's `/admin` console was retired — it now lives in the usat_apps
> platform (Ops module, :8022). `proxy_auth.js`, `public/proxy_admin.html`, and the
> `PROXY_ADMIN_*` credentials are gone. The steps below that mention them are historical.

- [ ] Pull the new files: `server_proxy_8000.js`, `proxy_routes.js`, `menu.js`,
      `test/server_proxy_8000.test.js`, and the
      `package.json` / `.vscode/tasks.json` / `README.md` / `.gitignore` changes.
      (The console now lives in usat_apps — no `proxy_auth.js` / `proxy_admin.html`.)
- [ ] (Optional) enable proxy rate limiting: `$ npm i express-rate-limit`
      (proxy runs fine without it; skip if you'll rate-limit at Cloudflare).
- [ ] Confirm `proxy_routes.js` has ONLY `/events` uncommented (day-one config).

Verify: `$ npm run test_proxy`  → expect 8/8 pass.

---

## 1. Start the proxy under pm2

- [ ] `$ npm run pm2_start_proxy`   (cluster, 2 workers; or menu → Start the local server)
- [ ] `$ npm run logs_proxy`        (or menu → Logs → Tail proxy logs) — confirm it booted.

Verify:
- `curl http://localhost:8000/api/test`   → `{ok:true}`
- `curl http://localhost:8000/api/status` → uptime/memory/routes
- menu → Health & status → these same checks.

Rollback: `$ npm run stop_proxy` — nothing else is affected; all backends + old
subdomains are untouched at this point.

---

## 2. Enable backends one at a time

For each backend, in `proxy_routes.js` uncomment its `{ target, health }` line, then:

- [ ] `$ npm run pm2_reload_proxy`  (zero-downtime; re-reads the route map)
- [ ] Verify health: `curl http://localhost:8000/api/health` → that prefix shows UP
      (or menu → Health & status → All backends health). `ECONNREFUSED` = backend not running.
- [ ] Verify a real route end-to-end, e.g. `curl http://localhost:8000/events/events-test`.

Order: start with the headless/JSON apps (events, sales, participation, recognition,
scraper, membership-base, auto-renew, duplicates, the slack-* receivers). Leave the
UI apps (event-analysis 8016, race-results 8018, email-queue 8019) and Streamlit
org_chart (8011) on their own subdomains for now (Project C).

---

## 3. Edge — add the single Cloudflare hostname

- [ ] Add public hostname `usat-api.kidderwise.org` → `http://localhost:8000`
      (Zero Trust → Tunnels → your tunnel → Public Hostname → Add; or a `config.yml`
      ingress rule + `cloudflared tunnel route dns <tunnel> usat-api.kidderwise.org`).
- [ ] KEEP all existing `usat-*` per-app subdomains live (fallback during cutover).

Verify: `https://usat-api.kidderwise.org/api/test` from off the server (phone, etc.).

---

## 4. Repoint external callers (Slack)

Only the Slack-facing servers need this; internal crons call localhost and need
NO change. In api.slack.com → [app] → Slash Commands, change each Request URL to
`usat-api.kidderwise.org/<prefix>/<same-path>` (command name + backend unchanged).
See the "Slack endpoints — exact before → after" table in PROXY_PLAN.md.

- [ ] /sales → /slack/get-member-sales
- [ ] /revenue, /revenue-examples → /slack-revenue/...
- [ ] /events, /reporting → /slack-events/...
- [ ] /races → /slack-races/slack-races-stats
- [ ] /news → /slack-news/slack-news-stats
- [ ] /members → /slack-membership-base/slack-membership-base
- [ ] /rec_history_insert|delete|backup → /recognition/...-recognition-history
- [ ] (verify whether /duplicates reporting is Slack-triggered; repoint if so)

Verify: run each slash command in Slack; confirm it still responds.

---

## 5. Retire old subdomains (last; reversible up to here)

- [ ] After a confident run (a few days), remove the old `usat-*` subdomains for the
      migrated API servers in Cloudflare. Leave UI-app subdomains (8016/8018/8019)
      and org_chart until Project C.

---

## Verify-then-retire rule

Health passing THROUGH the proxy (`/api/health` or a route's test endpoint) proves
that backend's other routes work through the proxy too → its old subdomain can retire.
Caveats: UI apps need their real screen checked (not just health); Slack endpoints need
the Request URL repointed first.

## Rollback (any step before 5)

The old per-app subdomains keep working the whole time (backends never stopped on
their own ports). If anything misbehaves, point traffic back at the old subdomain and
`$ npm run stop_proxy` — the proxy is out of the path instantly.

## Daily ops (after go-live)

- `npm run menu` → health checks, fleet start/restart, restart-one (pick), log tails, reminders.
- Browser console: `https://usat-api.kidderwise.org/ops/overview` (usat_apps Ops — platform login).
- Add a route later: edit `proxy_routes.js` → `npm run pm2_reload_proxy` → test.
