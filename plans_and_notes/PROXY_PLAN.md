# Project A — Single Proxy Server (standalone plan)

A focused, work-through-one-step-at-a-time plan for routing all servers through one proxy. **Nothing here is wired into the live system yet** — the code below is a mockup/draft to review before any file is created.

---

## Goal

Replace the per-subdomain entry points (`usat-events.kidderwise.org`, …) with **one public host + path prefixes** (`usat-api.kidderwise.org/events`, `/duplicates`, …), served by a single Node proxy on port **8000**, supervised by pm2. Backends keep running on their existing ports, unchanged.

## What stays the same

- Every `server_*.js` keeps its own port and pm2 process. Deploys stay per-app (`pm2 restart usat_salesforce_email_queue`) — you never touch the proxy to ship app code.
- The ~25 `utilities/cron_*` jobs call `http://localhost:<port>/...` directly — they need **no changes** (see "Should the cron jobs switch to the URL?" below).
- `.vscode/tasks.json` runs npm script *names*, not URLs/ports — existing tasks unaffected.
- Port **8000** is currently unused (verified).

## What changes

- One new Cloudflare hostname → port 8000. Old per-app subdomains **kept as aliases** during cutover.
- Two new files, a few additive lines in `package.json`, optionally one task entry.
- Only **external** callers of the old hostnames (Slack slash-command callbacks, external webhooks) need URL updates.

---

## Should the cron jobs switch to the URL instead of localhost? — No.

Recommendation: **leave the crons on `http://localhost:<port>` exactly as they are.** Reasons:

- They run **on the same machine** as the servers, so localhost is the fastest and most reliable path — no DNS, no TLS, no internet round-trip, no dependency on Cloudflare/ngrok being up.
- Routing internal jobs through the public URL would add failure points (Cloudflare outage, proxy down, **rate limits throttling your own jobs**) to jobs that today nothing external can disrupt.
- Several endpoints take secrets in the query string (e.g. `backup-recognition-history?password=...`). Keeping them on localhost avoids sending those over the public internet.
- The only case where a cron *should* use the URL is if it runs on a **different machine** than the servers — then it would go through the proxy (and you'd exempt it from rate limits).

Optional middle ground (not recommended for MVP): point crons at `http://localhost:8000/events/...` so even internal calls share one entry and get centralized logging — but then you must whitelist localhost from the rate limiter. Not worth it now.

---

## Dependencies — what's already here vs. new

Verified against `package.json`:

- `express` ✓, `http-proxy-middleware@3` ✓, `@ngrok/ngrok` ✓, `dotenv` ✓, `pm2` ✓ — **already installed**.
- `express-rate-limit` — **NOT installed**. This is the *only* new package, and it's needed **only if** you rate-limit at the proxy. If you do rate limiting at Cloudflare's edge instead, you add **zero** packages. Install (only if needed): `npm i express-rate-limit`.

## Mockup 1 — `proxy_routes.js` (full route map, api/app breakout)

**Location: repo root**, next to `server_proxy_8000.js` (loaded via `require('./proxy_routes')`). Not `utilities/` — that's for shared helpers; this is config for one server. A `.js` module (not JSON) so you can enable backends **one at a time** by uncommenting lines, and so it can carry comments. No secrets here → committed to git.

The map is split into two groups: **API servers** (headless/Slack — safe to proxy now) and **APP/UI servers** (8016/8018/8019 — stay on their own subdomains until Project C, then the React `usat-app` calls them through `usat-api`).

Each entry is `{ target, health }` — `health` is that server's existing test route (verified from the code) so the proxy's `/api/health` aggregator can ping it. Going-forward standard is `/api/status` (already used by 8016/8018/8019); the legacy `*-test` routes are left as-is. (`org_chart` already has `/healthz` — it's a Streamlit proxy that stays on its own subdomain; see the per-server actions table below.) No backend edits are required to migrate.

```js
// proxy_routes.js — path prefix -> { target, health } for server_proxy_8000.js.
// Uncomment a line to route that prefix through the proxy. Start with one,
// verify, then enable the next. `health` is pinged by the proxy /api/health
// aggregator. No secrets here -> committed to git.

module.exports = {
  // ───────────────────────────────────────────────────────────────────────
  // API SERVERS (usat-api) — headless data jobs + Slack webhook receivers.
  // No browser UI; safe to proxy with zero app changes. Enable one at a time.
  // ───────────────────────────────────────────────────────────────────────
  '/events': { target: 'http://127.0.0.1:8005', health: '/events-test' },          // ← START HERE
  // '/sales':                 { target: 'http://127.0.0.1:8003', health: '/scheduled-all-sales-test' },
  // '/participation':         { target: 'http://127.0.0.1:8004', health: '/participation-test' },
  // '/recognition':           { target: 'http://127.0.0.1:8006', health: '/recognition-test' },
  // '/scraper':               { target: 'http://127.0.0.1:8015', health: '/scraper-test' },
  // '/membership-base':       { target: 'http://127.0.0.1:8012', health: '/membership-test' },
  // '/auto-renew':            { target: 'http://127.0.0.1:8014', health: '/auto-renew-test' },
  // '/duplicates':            { target: 'http://127.0.0.1:8017', health: '/salesforce-duplicates-test' },

  // Slack webhook receivers (called BY Slack -> need the public usat-api host):
  // '/slack':                 { target: 'http://127.0.0.1:8001', health: '/get-member-sales-test' },
  // '/slack-revenue':         { target: 'http://127.0.0.1:8007', health: '/revenue-test' },
  // '/slack-events':          { target: 'http://127.0.0.1:8008', health: '/slack-events-test' },
  // '/slack-races':           { target: 'http://127.0.0.1:8009', health: '/slack-races-test' },
  // '/slack-news':            { target: 'http://127.0.0.1:8010', health: '/slack-news-test' },
  // '/slack-membership-base': { target: 'http://127.0.0.1:8013', health: '/slack-membership-base-test' },

  // ───────────────────────────────────────────────────────────────────────
  // APP / UI SERVERS (future usat-app, React — Project C).
  // Serve browser HTML with absolute asset paths, so they STAY on their own
  // usat-* subdomains during Project A (do NOT uncomment yet). Enable in Project C.
  // ───────────────────────────────────────────────────────────────────────
  // '/event-analysis': { target: 'http://127.0.0.1:8016', health: '/api/status' },
  // '/race-results':   { target: 'http://127.0.0.1:8018', health: '/api/status' },
  // '/email-queue':    { target: 'http://127.0.0.1:8019', health: '/api/status' },
  // '/org-chart':      { target: 'http://127.0.0.1:8011', health: '/healthz' },  // Streamlit UI — keep on own subdomain; subpath is fragile
};
```

As written, only `/events` is live — exactly the day-one config. Uncomment downward as you verify each.

## Server inventory — what falls under `usat-api` vs `usat-app`

`usat-api` is the universal backend front door — **every** server gets a path. `usat-app` is the consolidated React site (Project C) — only servers with a human-facing browser UI live there, and that UI fetches data from `usat-api`. Only 3 servers serve a browser UI today (verified by checking for static/sendFile/HTML); the rest are cron-triggered jobs or Slack webhook receivers.

| Server | Port | `usat-api` path | UI today? | `usat-app` (React)? |
|---|---|---|---|---|
| server_slack.js | 8001 | `/slack` | – | – |
| server_sales.js | 8003 | `/sales` | – | – |
| server_participation.js | 8004 | `/participation` | – | – |
| server_events.js | 8005 | `/events` | – | – |
| server_recognition.js | 8006 | `/recognition` | – | – |
| server_slack_revenue.js | 8007 | `/slack-revenue` | – | – |
| server_slack_events.js | 8008 | `/slack-events` | – | – |
| server_slack_races.js | 8009 | `/slack-races` | – | – |
| server_slack_news.js | 8010 | `/slack-news` | – | – |
| server_org_chart.js | 8011 | (keep subdomain) | **UI** (Streamlit) | no — Streamlit, stays standalone |
| server_membership_base.js | 8012 | `/membership-base` | – | – |
| server_slack_membership_base.js | 8013 | `/slack-membership-base` | – | – |
| server_auto_renew_8014.js | 8014 | `/auto-renew` | – | – |
| server_scraper_8015.js | 8015 | `/scraper` | – | – |
| server_event_analysis_8016.js | 8016 | `/event-analysis` | **UI** | yes |
| server_salesforce_duplicates_8017.js | 8017 | `/duplicates` | – (Slack-only) | yes (UI is new in Project C) |
| server_race_results_transform_8018.js | 8018 | `/race-results` | **UI** | yes (confirmed) |
| server_salesforce_email_queue_8019.js | 8019 | `/email-queue` | **UI** | yes |

Confirmed React UI apps for Project C: **8016, 8018, 8019**. **8017** (duplicates) is API-only today and may gain a UI later — it stays under `usat-api` and joins `usat-app` only when its React screen is built. (Note: the "events" UI app is `event_analysis` at 8016, not the headless `server_events.js` at 8005.)

Migration is incremental: start the route table with the safe JSON apps (uncomment one at a time), add the rest as you verify each. The full table above is the end state, not the day-one config.

## What to address per server (migration actions)

For each server, here's the one thing (if any) you must do beyond uncommenting its route. The cron-only servers need **nothing** — their jobs call `localhost` directly and never touch Slack/Cloudflare config. The Slack servers need their Request URL repointed in `api.slack.com`. The UI apps stay on their own subdomains for now.

| Server | Port | usat-api path | What you need to do |
|---|---|---|---|
| server_slack.js | 8001 | `/slack` | **Slack:** repoint slash-cmd Request URL → `usat-api…/slack/get-member-sales` |
| server_sales.js | 8003 | `/sales` | Nothing (cron → localhost) |
| server_participation.js | 8004 | `/participation` | Nothing (cron → localhost) |
| server_events.js | 8005 | `/events` | Nothing (cron → localhost) |
| server_recognition.js | 8006 | `/recognition` | **Slack:** repoint `/rec_history_insert\|delete\|backup` command URLs (→ `/recognition/…-recognition-history`). Scheduled data refresh is cron → localhost (no change) |
| server_slack_revenue.js | 8007 | `/slack-revenue` | **Slack:** repoint `/revenue-stats`, `/revenue-examples` |
| server_slack_events.js | 8008 | `/slack-events` | **Slack:** repoint `/slack-events-reporting`, `/slack-events-stats` |
| server_slack_races.js | 8009 | `/slack-races` | **Slack:** repoint `/slack-races-stats` |
| server_slack_news.js | 8010 | `/slack-news` | **Slack:** repoint `/slack-news-stats` |
| server_org_chart.js | 8011 | (keep subdomain) | **Streamlit UI** — keep `usat-org-chart` subdomain; don't subpath. Has `/healthz` |
| server_membership_base.js | 8012 | `/membership-base` | Nothing (cron → localhost) |
| server_slack_membership_base.js | 8013 | `/slack-membership-base` | **Slack:** repoint `/slack-membership-base` |
| server_auto_renew_8014.js | 8014 | `/auto-renew` | Nothing (cron → localhost) |
| server_scraper_8015.js | 8015 | `/scraper` | Nothing (cron → localhost) |
| server_event_analysis_8016.js | 8016 | (keep subdomain) | **UI app** — keep subdomain until Project C |
| server_salesforce_duplicates_8017.js | 8017 | `/duplicates` | **Slack:** repoint `/salesforce-duplicates-reporting`, `/salesforce-duplicates-stats` |
| server_race_results_transform_8018.js | 8018 | (keep subdomain) | **UI app** — keep subdomain until Project C |
| server_salesforce_email_queue_8019.js | 8019 | (keep subdomain) | **UI app** — keep subdomain until Project C |

### Slack endpoints — exact before → after (mapped to the real command registry)

Two things are independent: the **command name** users type (left column) and the **Request URL** it posts to. You only change the Request URL in `api.slack.com → Your Apps → [app] → Slash Commands` (and Interactivity / Event Subscriptions if used). The command name and the path after the prefix are unchanged, so **no server code changes** — the proxy strips the prefix before forwarding.

| Slash command (unchanged) | Server | Port | Endpoint path | NEW Request URL (set in Slack) |
|---|---|---|---|---|
| `/sales` | server_slack | 8001 | `/get-member-sales` | `usat-api…/slack/get-member-sales` |
| `/revenue` | server_slack_revenue | 8007 | `/revenue-stats` | `usat-api…/slack-revenue/revenue-stats` |
| `/revenue-examples` | server_slack_revenue | 8007 | `/revenue-examples` | `usat-api…/slack-revenue/revenue-examples` |
| `/events` | server_slack_events | 8008 | `/slack-events-stats` | `usat-api…/slack-events/slack-events-stats` |
| `/reporting` | server_slack_events | 8008 | `/slack-events-reporting` | `usat-api…/slack-events/slack-events-reporting` |
| `/races` | server_slack_races | 8009 | `/slack-races-stats` | `usat-api…/slack-races/slack-races-stats` |
| `/news` | server_slack_news | 8010 | `/slack-news-stats` | `usat-api…/slack-news/slack-news-stats` |
| `/members` | server_slack_membership_base | 8013 | `/slack-membership-base` | `usat-api…/slack-membership-base/slack-membership-base` |
| `/rec_history_insert` | server_recognition | 8006 | `/insert-recognition-history` | `usat-api…/recognition/insert-recognition-history` |
| `/rec_history_delete` | server_recognition | 8006 | `/delete-recognition-history` | `usat-api…/recognition/delete-recognition-history` |
| `/rec_history_backup` | server_recognition | 8006 | `/backup-recognition-history` | `usat-api…/recognition/backup-recognition-history` |

Notes:
- **`/duplicates` is NOT in your command registry above** — the duplicates server exposes `/salesforce-duplicates-reporting`/`-stats` (POST) but no matching slash command was listed. If those are triggered by a Slack app, repoint them the same way (`usat-api…/duplicates/…`); if they're triggered only by curl/cron, nothing to change. Worth confirming.
- The **schedules** in your second table (the "auto schedule" posts at 8am, etc.) are outbound — fired by local cron hitting `localhost`. They don't go through the public URL, so they're **unaffected** by the proxy. Same for every "data update" time.

Transition tip: keep the old subdomains live and repoint Slack commands **one at a time** — the old URL keeps working until you flip it, so there's no flag-day. After repointing, run the command in Slack to confirm, then retire that subdomain.

## No separate spike — use the real proxy with routes commented out

(The throwaway mock-spike file is removed per decision.) Instead, the real `server_proxy_8000.js` includes a built-in `/api/test` endpoint (no backend) for the first smoke test, and reads routes from `proxy_routes.js` with everything commented except one. So the rollout is: run the real proxy → hit `/api/test` (and `/api/status`) → flip `is_test_ngrok = true` and hit `/api/test` over the printed ngrok URL → uncomment `/events` and hit `/events/events-test` → keep uncommenting one route at a time. No disposable file, no second codebase.

## Mockup 2 — `server_proxy_8000.js` (the real proxy, consistent with the other server_*.js)

This mirrors the conventions in `server_event_analysis_8016.js` and `server_salesforce_email_queue_8019.js` so it reads like the rest of the codebase: shebang + JSDoc header, `'use strict'`, repo-root `dotenv`, `create_app()` / `start_server()` factory, **dual-stack listen** (no host arg), the same `is_test_ngrok` flag, a `cleanup()` SIGINT/SIGTERM handler, a 404 fallback, and `module.exports` for tests.

```js
#!/usr/bin/env node
/**
 * server_proxy_8000.js — single reverse proxy in front of the USAT server_*.js
 * services. One public host (usat-api.kidderwise.org) + path prefixes replace
 * the per-app Cloudflare subdomains. Backends keep their own ports, unchanged.
 *
 * Lives at the repo root alongside the other server_*.js services for naming
 * consistency. Port 8000 sits just below the existing sequence (8005 events,
 * 8016 event_analysis, 8017 sf_duplicates, 8018 race_results_transform,
 * 8019 email_queue).
 *
 * Patterned after server_event_analysis_8016.js / _8019.js:
 *   - create_app() builds the Express app (health, rate limits, proxy routes, 404)
 *   - start_server() listens with NO host arg -> dual-stack '::' (IPv6 ::1 + IPv4),
 *     matching 8018/8019 so the Cloudflare tunnel's 'localhost' dial never 502s
 *   - optional ngrok tunnel (off by default), same is_test_ngrok flag as 8016/8019
 *   - cleanup() on SIGINT/SIGTERM so Ctrl-C stops cleanly
 *
 * Public URL (production): https://usat-api.kidderwise.org  (Cloudflare tunnel -> 8000)
 *
 * Usage:
 *   node server_proxy_8000.js                 # default port 8000
 *   PROXY_PORT=9000 node server_proxy_8000.js
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit'); // ONLY new dep; remove if rate-limiting at Cloudflare
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

const DEFAULT_PORT = Number(process.env.PROXY_PORT) || 8000;

// NGROK TUNNEL FOR TESTING — off by default (Cloudflare fronts this in prod).
// Flip to true to get a public ngrok URL for testing /api/test before cutover.
const is_test_ngrok = false;

// Route table: a JS module so routes can be commented in/out one at a time.
const ROUTES = require('./proxy_routes');

function create_app() {
  const app = express();

  // Trust Cloudflare's forwarded headers so rate-limit sees real client IPs.
  app.set('trust proxy', 1);

  // ── Health check — patterned after 8016/8019 /api/status, enriched with
  //    memory, uptime, and Mountain-time clock. /healthz is an alias. ───────
  app.get(['/api/status', '/healthz'], (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      app: 'proxy',
      now_utc: new Date().toISOString(),
      now_mtn: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }),
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: {
        rss: +(mem.rss / 1048576).toFixed(1),
        heap_used: +(mem.heapUsed / 1048576).toFixed(1),
      },
      pid: process.pid,
      node: process.version,
      routes: Object.keys(ROUTES),
    });
  });

  // ── Built-in smoke test — no backend needed. Hit this first (locally, then
  //    over ngrok) to prove the proxy + tunnel work before enabling routes. ─
  app.get('/api/test', (req, res) =>
    res.json({ ok: true, msg: 'proxy is alive', time: new Date().toISOString() }));

  // ── Aggregate health — pings every ENABLED backend's health route and
  //    reports one up/down table. /api/health is the single URL to verify all. ─
  app.get('/api/health', async (req, res) => {
    const checked = {};
    await Promise.all(Object.entries(ROUTES).map(async ([prefix, cfg]) => {
      const target = typeof cfg === 'string' ? cfg : cfg.target;
      const health = (typeof cfg === 'object' && cfg.health) || '/api/status';
      const url = target + health;
      const t0 = Date.now();
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
        checked[prefix] = { ok: r.ok, status: r.status, ms: Date.now() - t0 };
      } catch (e) {
        checked[prefix] = { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : e.message };
      }
    }));
    const all_ok = Object.values(checked).every(r => r.ok);
    res.status(all_ok ? 200 : 503).json({ ok: all_ok, checked, time: new Date().toISOString() });
  });

  // ── Reject bad requests early ───────────────────────────────────────────
  const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  app.use((req, res, next) => {
    if (!ALLOWED_METHODS.includes(req.method)) {
      return res.status(405).json({ ok: false, error: 'method not allowed' });
    }
    next();
  });

  // ── Rate limit (stop intense / abusive traffic). Tune to taste. ──────────
  app.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  // Optional stricter cap on an expensive route:
  // app.use('/event-analysis/api/build', rateLimit({ windowMs: 60 * 1000, limit: 10 }));

  // ── One forwarding rule per route-table entry (accepts string or {target,health}) ─
  for (const [prefix, cfg] of Object.entries(ROUTES)) {
    const target = typeof cfg === 'string' ? cfg : cfg.target;
    app.use(prefix, createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,                              // websockets / SSE pass through
      // No pathRewrite: app.use(prefix, ...) already strips the mount prefix.
      proxyTimeout: 30000,                   // cut off a stuck backend
      timeout: 30000,
      on: {
        error: (err, req, res) => {          // one dead backend != whole site down
          if (res.writeHead && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
          }
          res.end(JSON.stringify({ ok: false, error: 'backend unavailable', path: req.url }));
        },
      },
    }));
  }

  // ── 404 fallback — same shape as 8016/8019 ──────────────────────────────
  app.use((req, res) => res.status(404).json({ ok: false, error: 'not found', path: req.path }));

  return app;
}

async function start_server({ port = DEFAULT_PORT, silent = false } = {}) {
  const app = create_app();

  return await new Promise((resolve, reject) => {
    // NO host arg -> dual-stack bind (::1 + 127.0.0.1), same as 8018/8019.
    const server = app.listen(port, () => {
      const actual = server.address().port;
      if (!silent) {
        console.log(`\nUSAT Proxy — local server`);
        console.log(`  -> http://localhost:${actual}/api/status   (health check)`);
        Object.keys(ROUTES).forEach(p =>
          console.log(`  -> http://localhost:${actual}${p}/*  ->  ${ROUTES[p]}`));
        console.log(`  -> https://api.kidderwise.org              (Cloudflare tunnel -> ${actual})`);
        console.log(`  Press Ctrl-C to stop.\n`);
      }
      // NGROK — best-effort; a missing NGROK_AUTHTOKEN must NOT crash the proxy.
      if (is_test_ngrok) create_ngrok_tunnel(port);
      resolve({ port: actual, server });
    });
    server.on('error', reject);
  });
}

// Clean up on exit — same pattern as the other server_*.js services so Ctrl-C
// reliably stops the process instead of hanging the terminal.
async function cleanup() {
  console.log('\nGracefully shutting down...');
  process.exit();
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// CLI entry: only run when invoked directly (not via require for tests).
if (require.main === module) {
  start_server({ port: DEFAULT_PORT }).catch(err => {
    console.error('Proxy failed to start:', err);
    process.exit(1);
  });
}

module.exports = { create_app, start_server, DEFAULT_PORT };
```

### Sample `/api/status` response

```json
{
  "ok": true,
  "app": "proxy",
  "now_utc": "2026-06-25T18:42:10.001Z",
  "now_mtn": "6/25/2026, 12:42:10 PM",
  "uptime_seconds": 3725,
  "memory_mb": { "rss": 61.4, "heap_used": 18.2 },
  "pid": 48213,
  "node": "v20.11.1",
  "routes": ["/events", "/event-analysis", "/duplicates", "/race-results", "/email-queue"]
}
```

> Want per-backend memory too? `utilities/pm2_scripts/pm2_log_memory_usage.js` already reads RSS/CPU from the pm2 process list — the status route could optionally call it to report every app's memory, not just the proxy's. Keep it out of the MVP unless you want it.

## Mockup 3 — `package.json` changes (additive; verified against the real file)

`package.json` has 125 scripts and a `pm2_run_all_servers` chain. Two edits, both safe:

**3a. Add proxy scripts.** Drop these in right after the email-queue block (after `"restart_salesforce_email_queue"`), mirroring the existing per-app pattern. `-i 2` = pm2 cluster mode (**2 workers**) → zero-downtime `reload`; deliberately no `--cron-restart` / `--no-autorestart`:

```json
"pm2_start_proxy": "npx pm2 start /home/usat-server/development/usat/sql_programs/server_proxy_8000.js --name usat_proxy -i 2 --max-memory-restart 500M",
"pm2_reload_proxy": "npx pm2 reload usat_proxy",
"restart_proxy": "npx pm2 restart usat_proxy",
"logs_proxy": "npx pm2 logs usat_proxy",
"stop_proxy": "npx pm2 stop usat_proxy",
"delete_proxy": "npx pm2 delete usat_proxy",
"show_proxy": "npx pm2 show usat_proxy",
```

**3b. Add the proxy to the `pm2_run_all_servers` chain.** It currently ends at step 17 (`pm2_start_salesforce_email_queue`). Append this fragment to the very end of that one-line value:

```
 && echo '▶ (18 of 18) Starting pm2_start_proxy' && npm run pm2_start_proxy
```

The existing steps read `(N of 17)`. Bumping those 17 labels to `(N of 18)` is cosmetic (just the echo text) — optional but tidy. No other script changes.

## Mockup 4 — `.vscode/tasks.json` changes (matches the existing logs/shell/split pattern)

Each service in `tasks.json` has three entries — a `(logs)` tail, a `(shell)`, and a `(split)` that runs both — plus an `All Logs (17 groups)` aggregator. The proxy slots in as service **18** the same way.

**4a. Add the logs + shell pair** (after the `17 EMAIL QUEUE (shell)` block):

```json
{
  "label": "18 PROXY (logs)",
  "type": "shell",
  "command": "npm run logs_proxy",
  "isBackground": true,
  "problemMatcher": [],
  "options": { "cwd": "${workspaceFolder}" },
  "presentation": { "reveal": "always", "panel": "shared", "group": "grp-proxy", "focus": true }
},
{
  "label": "18 PROXY (shell)",
  "type": "shell",
  "command": "bash -lc \"echo -e '\\n\\033[1;34mREADY: PROXY\\033[0m\\n'; exec bash\"",
  "isBackground": true,
  "problemMatcher": [],
  "options": { "cwd": "${workspaceFolder}" },
  "presentation": { "reveal": "always", "panel": "shared", "group": "grp-proxy", "focus": false }
},
```

**4b. Add the split task** (after the `Email Queue (split)` block):

```json
{
  "label": "Proxy (split)",
  "dependsOn": [
    "18 PROXY (logs)",
    "18 PROXY (shell)"
  ],
  "dependsOrder": "parallel"
},
```

**4c. Register it in the aggregators.** Add `"Proxy (split)"` to the `dependsOn` arrays of both `All Logs (17 groups)` and `Test`, and rename the label `All Logs (17 groups)` → `All Logs (18 groups)`.

## Mockup 5 — Cloudflare (config, not code)

Naming decision: **keep the `usat-` prefix** → `usat-api.kidderwise.org` (now) and `usat-app.kidderwise.org` (React site, later). Reason: these are first-level subdomains covered by the free Universal SSL wildcard `*.kidderwise.org`, exactly like your current `usat-*` hostnames. A nested `api.usat.kidderwise.org` is two levels deep, which the free wildcard does NOT cover — it would require paid Advanced Certificate Manager. Not worth it for internal tools.

Add the new hostname (dashboard: Zero Trust → Tunnels → your tunnel → Public Hostname → Add; or `config.yml` ingress rule + `cloudflared tunnel route dns`):

```
usat-api.kidderwise.org         ->  http://localhost:8000   (NEW — the proxy)
usat-events.kidderwise.org      ->  http://localhost:8005   (KEEP as fallback)
usat-salesforce-duplicates...   ->  http://localhost:8017   (KEEP as fallback)
...
usat-app.kidderwise.org         ->  http://localhost:8000   (LATER — React site, Project C)
```

`config.yml` form:

```yaml
ingress:
  - hostname: usat-api.kidderwise.org
    service: http://localhost:8000
  # ... existing usat-* rules stay as fallback ...
  - service: http_status:404
```

then once: `cloudflared tunnel route dns <tunnel-name> usat-api.kidderwise.org`

**Do NOT create `usat-app` now.** It only exists once there's a React site to serve (Project C). Until then, the three UI apps (8016 event_analysis, 8018 race_results_transform, 8019 email_queue) keep running on their existing `usat-*` subdomains exactly as today — nothing goes down. So for Project A: move the **API/JSON servers** behind `usat-api`, and leave the three UI apps on their own subdomains. `usat-app` comes online with the React build. (8017 duplicates is API-only today and stays under `usat-api`; it gains a `usat-app` presence only when its React screen is built.)

---

## Consistency checklist (so 8000 matches the other servers)

The full draft already follows each of these — verify before committing:

- `#!/usr/bin/env node` shebang + JSDoc header explaining port placement (like 8016/8019).
- `'use strict';`
- repo-root `dotenv.config({ path: path.join(__dirname, '.env') })`.
- `create_app()` + `start_server()` factory; `module.exports = { create_app, start_server, DEFAULT_PORT }`.
- `app.listen(port)` with **no host arg** (dual-stack) — matches 8018/8019 so the tunnel doesn't 502.
- `is_test_ngrok` flag + `create_ngrok_tunnel(port)` best-effort, exactly as in 8016/8019.
- `cleanup()` on `SIGINT`/`SIGTERM`.
- `/api/status` health route (+ `/healthz` alias) returning `ok` + `time`, enriched here.
- 404 fallback returning `{ ok:false, error, path }`.
- `if (require.main === module)` guard so tests can `require()` without listening.

---

## The one real caveat — static assets on rich front-ends

The API/JSON servers work through the proxy with **zero** changes. But the three UI apps (8016, 8018, 8019) serve HTML referencing assets by absolute path (`/css/style.css`), which 404 under a prefix. For Project A you don't need to solve this — just **leave the three UI apps on their own `usat-*` subdomains** until Project C's React site replaces them. (If you ever did want one behind the proxy sooner, add a `<base href="/email-queue/">` tag to its HTML.)

---

## Step-by-step checklist (one at a time)

**Step 1 — Route module.** Write `proxy_routes.js` with everything commented except `/events` (one safe JSON app). *(no code beyond the module)*

**Step 2 — Run the real proxy, smoke-test with no backend.** Start `server_proxy_8000.js`; hit `http://localhost:8000/api/test` and `/api/status`. Then flip `is_test_ngrok = true` and hit `/api/test` over the printed ngrok URL. Proves proxy + tunnel with zero backend risk.

**Step 3 — Enable routes one at a time.** Uncomment `/events`, test `/events/events-test`; then uncomment the next API server, test; repeat. Leave the three UI apps' routes commented (they stay on their subdomains).

**Step 4 — Run under pm2 (Mockup 3).** Cluster mode, 2 workers; confirm `pm2 reload` drops no traffic.

**Step 5 — Hardening.** Confirm method allowlist, body/timeout limits, catch-all 404; decide rate limiting here (`express-rate-limit`) vs. Cloudflare.

**Step 6 — Edge cutover (Mockup 5).** Point `usat-api.kidderwise.org` at 8000; keep old subdomains live; test both.

**Step 7 — External callers.** Repoint Slack callbacks / external webhooks to `usat-api`. Internal crons unchanged.

**Step 8 — Retire aliases** for the migrated API servers after a confident run. (UI apps keep theirs until Project C.)

## Verifying a backend, then retiring its old subdomain

The health/test route is your green light to migrate. Because every route on a backend traverses the **same** proxy mechanism (prefix strip → target port → reach the process), if the health route returns 200 *through the proxy* then the backend's other routes work through the proxy too. So: **health passes via `usat-api` ⇒ that backend's old `usat-*` subdomain can be retired.** Hit `usat-api.kidderwise.org/api/health` for the whole picture, or `usat-api.kidderwise.org/events/events-test` for one.

Caveats before you turn an old route down:

- **UI apps (8016/8018/8019):** `/api/status` passing does NOT prove the browser UI works — their HTML loads assets by absolute path that 404 under a prefix. Don't retire those subdomains on a health check; that's why they stay on their own subdomains until Project C.
- **Special routes:** SSE/streaming (event_analysis `/api/build`), websockets, large uploads, long timeouts behave differently than a quick JSON ping — exercise the real route once, not just health.
- **POST / Slack endpoints:** health is a GET. For Slack receivers, also repoint the Slack callback URL to `usat-api` before retiring — the proxy doesn't repoint Slack for you.
- **Grace period:** keep the old subdomain live a few days after health passes (zero cost), then retire.

## Operations runbook

### Adding (or changing) a backend path — the day-to-day task

Three small steps, ~1 minute:

1. **Edit `proxy_routes.js`** — uncomment an existing line, or add a new one: `'/new-thing': 'http://127.0.0.1:80XX',`. (If it's a brand-new public path, also add the Cloudflare hostname/route once — but most additions reuse the single `usat-api` host, so this step is rarely needed.)
2. **Reload the proxy** so it re-reads the route module: `npm run pm2_reload_proxy`. Cluster mode recycles the 2 workers one at a time → no dropped traffic.
3. **Test** `https://usat-api.kidderwise.org/new-thing/<an-endpoint>` (and `http://localhost:8000/new-thing/...` locally).

That's the whole loop. You do **not** touch any backend server to add a route — the backend keeps running unchanged; you're only teaching the front door about it. Removing a path is the same in reverse (comment the line, reload).

### Restarting / reloading the proxy — when and why

**Why a restart is ever needed:** `proxy_routes.js` and `server_proxy_8000.js` are read **once when the process starts**. So any change to the route map or the proxy's own code only takes effect after the process re-reads them. The proxy is the *only* thing that needs recycling for these — backends are independent processes.

**When you need to recycle the proxy:**

- You edited `proxy_routes.js` (added/removed/changed a route or target). → reload
- You edited `server_proxy_8000.js` (rate limits, timeouts, hardening, ngrok flag). → reload
- A worker is wedged/leaking, or a reload behaved oddly. → restart

**When you do NOT:**

- Deploying new code to a backend app (e.g. `pm2 restart usat_salesforce_email_queue`) — the proxy keeps running and forwards to the new process automatically. The route (host:port) didn't change, so the proxy doesn't care.

**How (prefer reload):**

```
npm run pm2_reload_proxy     # zero-downtime: recycles workers one at a time (use this normally)
npm run restart_proxy        # hard restart: ~1s blip on all paths (use if a worker is stuck)
npm run logs_proxy           # tail logs to confirm it came back and re-read routes
```

Reload is the default because in cluster mode there's always a live worker serving while another restarts. Hard restart is the fallback when a worker is unresponsive and you want a clean boot. Either way, the old `usat-*` subdomains still bypass the proxy, so even a botched restart can't take the apps down.

## Rollback

The old per-app subdomains keep working at every step (apps never stopped on their own ports) — repoint and the proxy is out of the path instantly.

## Decisions made

- Hostnames: **`usat-api.kidderwise.org`** (proxy, now) + **`usat-app.kidderwise.org`** (React site, later — not created during Project A). Kept the `usat-` prefix to stay on the free Universal SSL wildcard.
- pm2 **cluster mode, 2 workers** (`-i 2`).
- No disposable spike file — use the real proxy with routes commented out + built-in `/api/test`, enabling routes one at a time.
- React UI apps = **8016, 8018, 8019** (8017 joins later when it gets a UI). They stay on their own subdomains during Project A.
- Only new package: **`express-rate-limit`**, and only if rate-limiting at the proxy.
- Health verification: route map carries each backend's existing test route as `health`; proxy exposes `/api/health` (aggregate) + `/api/status` + `/api/test`. Standard going forward is `/api/status`; no backend health routes need adding (`org_chart` already has `/healthz`).
- `org_chart` (8011) is a Streamlit app (Node proxies to Streamlit on 8501) — it stays on its own subdomain, not behind `usat-api`.
- Slack-inbound servers needing Request-URL repoints: 8001, 8006 (rec_history), 8007, 8008, 8009, 8010, 8013 (and 8017 if its reporting is Slack-triggered). All cron/scheduled posts are localhost → unaffected.

## Open questions

- Rate limiting at the proxy (`express-rate-limit`) or Cloudflare edge — or both?
- Cutover: hard switch, or run both entrances in parallel for a week?
- Is `/duplicates` reporting triggered by a Slack app (needs URL repoint) or only curl/cron (no change)?

---

## Appendix — Slack command registry & schedules (source of truth)

Captured from the live Slack app config + ops schedule, for reference when repointing Request URLs.

> Placeholder only: `password=<password>` is intentionally generic so this file carries no credential and won't trip secret scanners / GitHub push protection. The real value is `SLACK_COMMAND_PASSWORD` in `.env` (gitignored). Never paste the actual password into a committed file.

### Slash command registry

| command | description | usage_hint |
|---|---|---|
| `/sales` | Enter "/sales" for real time membership sales | |
| `/revenue` | Enter "/revenue" for latest membership revenue | `month=ytd type=one_day category=bronze` |
| `/revenue-examples` | Some examples of how to request revenue stats | |
| `/events` | Enter "/events" for latest sanctioned event counts | `/events` or `/events month=5` |
| `/reporting` | Enter "/reporting" for all events with reported status | `/reporting`; options month (all, 1-12), type (all, clinic, race), reported (true, false) |
| `/races` | Enter "/races" for latest race results | `/races` |
| `/news` | Enter "/news subject=triathlon" for recent google news | `/news` or `/news subject=usatriathlon count=5` |
| `/members` | Enter "/members" for most recent unique member count | `/members` |
| `/rec_history_insert` | Enter "/rec_history_insert password=&lt;password&gt; year=2026 month=3" | `/rec_history_insert` |
| `/rec_history_delete` | Enter "/rec_history_delete password=&lt;password&gt; snapshot=revenue_month_2026_03" | `/rec_history_delete` |
| `/rec_history_backup` | Enter "/rec_history_backup password=&lt;password&gt;" | `/rec_history_backup` (usat_5825) |

### Auto schedule & data update

| data | auto schedule (outbound posts → localhost) | data update (cron → localhost) |
|---|---|---|
| `/sales` | 8am, 10am, 12 noon, 4pm, 8pm, 11:58pm | real time |
| `/revenue` | 8:30am daily | nightly ~2am |
| `/events` | 8:32am daily | 7am, 12 noon, 5pm |
| `/reporting` | 8:40am Monday | 7am, 12 noon, 5pm |
| `/races` | 8:35am daily | nightly ~3am |
| `/news` | 10:30am, 5pm daily | real time |
| `/members` | 8:25am daily | nightly ~5am |
| revenue recognition | none | nightly
---

## Management console (auth-gated) — BUILT

Implemented: `proxy_auth.js` (separate `PROXY_ADMIN_*` account, own cookie + generated secret), gated `/admin` dashboard (`public/proxy_admin.html`, mirrors the email_queue admin theme), and gated `/api/logs` pm2 tail. Login at `/admin/login`, logout `/admin/logout`. Original plan below:

Goal: a browser dashboard to see status and tail logs remotely (no SSH), reusing
the email_queue cookie-session auth so it's consistent and secure before the
Microsoft SSO stage exists.

**Reuse from `src/salesforce_email_queue_proof_of_concept/auth/`:**
- `session.js` — generic HMAC signed-cookie (sign/verify/parse_cookies). Use as-is.
- `auth_store.js` pattern — scrypt-hashed passwords + `.env` recovery accounts + a
  generated `session_secret`, users persisted to a gitignored JSON outside the repo.

**New, gated proxy routes (behind a `require_auth` like email_queue's `/admin`):**
- `GET /status`  — dashboard over `/api/status` + `/api/health` (auto-refresh).
- `GET /logs`    — tail recent pm2 log lines per server (reads `~/.pm2/logs/*.log`).
- `GET /login` / `POST /login` / `POST /logout` — same flow as email_queue.
- Public (ungated): `/api/test`, `/api/status`, `/api/health`, and all proxied app paths.

**Open decision (security):** shared vs. separate credentials —
1. **Separate proxy account (recommended):** new `.env` vars `PROXY_ADMIN_USER` /
   `PROXY_ADMIN_PASS`, proxy-specific cookie name + users file. Fully independent of
   email_queue; least coupling.
2. **Shared:** reuse email_queue's `SF_EMAIL_QUEUE_ADMIN_*` accounts + `eq_session`
   cookie, so one login covers both. Less to manage, but couples the two apps.

**Security notes:** logs can contain member PII / secrets, so `/logs` must stay
gated; serve only tail (not full files); this console is superseded by the
Microsoft SSO gateway in the React stage.
