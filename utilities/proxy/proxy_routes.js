// proxy_routes.js — path prefix -> { target, health, host } for server_proxy_8000.js.
// Uncomment a line to route that prefix through the proxy. `health` is pinged by the /api/health
// aggregator. `host` gates which public hostname may reach the route:
//   'api' = usat-api.kidderwise.org   'app' = usat-app.kidderwise.org   (localhost always allowed).
// A request on the wrong hostname 404s; an untagged route stays reachable on both hosts.
// No secrets here -> committed to git.

module.exports = {
  // API SERVERS (usat-api) — headless data jobs + Slack webhook receivers.
  '/events':                { target: 'http://127.0.0.1:8005', health: '/events-test', host: 'api' },
  '/sales':                 { target: 'http://127.0.0.1:8003', health: '/scheduled-all-sales-test', host: 'api' },
  '/participation':         { target: 'http://127.0.0.1:8004', health: '/participation-test', host: 'api' },
  '/recognition':           { target: 'http://127.0.0.1:8006', health: '/recognition-test', host: 'api' },
  '/scraper':               { target: 'http://127.0.0.1:8015', health: '/scraper-test', host: 'api' },
  '/membership-base':       { target: 'http://127.0.0.1:8012', health: '/membership-test', host: 'api' },
  '/auto-renew':            { target: 'http://127.0.0.1:8014', health: '/auto-renew-test', host: 'api' },
  '/duplicates':            { target: 'http://127.0.0.1:8017', health: '/salesforce-duplicates-test', host: 'api' },

  // Slack webhook receivers (called BY Slack -> need the public usat-api host):
  '/slack':                 { target: 'http://127.0.0.1:8001', health: '/get-member-sales-test', host: 'api' },
  '/slack-revenue':         { target: 'http://127.0.0.1:8007', health: '/revenue-test', host: 'api' },
  '/slack-events':          { target: 'http://127.0.0.1:8008', health: '/slack-events-test', host: 'api' },
  '/slack-races':           { target: 'http://127.0.0.1:8009', health: '/slack-races-test', host: 'api' },
  '/slack-news':            { target: 'http://127.0.0.1:8010', health: '/slack-news-test', host: 'api' },
  '/slack-membership-base': { target: 'http://127.0.0.1:8013', health: '/slack-membership-base-test', host: 'api' },

  // APP / UI SERVERS (usat-app) — React SPAs served under a path on the usat-app host.

  // Merge tool (React SPA, port 8020). Built path-aware (`npm run salesforce_merge_build_proxy`,
  // Vite base '/merge/'), so the proxy strips '/merge' and :8020 serves the assets, SPA deep links,
  // and the /merge/api/* calls correctly. Point usat-app.kidderwise.org -> :8000 in Cloudflare.
  // RETIRED 2026-07-13 — folded into usat_apps (/apps/salesforce/merge); monolith 8020 un-routed.
  // '/merge':                 { target: 'http://127.0.0.1:8020', health: '/api/status', host: 'app' },

  // Reporting app (React SPA, port 8021 — participation maps + future reports). Built path-aware
  // (`npm run reporting_build_proxy`, Vite base '/reporting/'). See src/reporting/plans_and_notes/DEPLOY_AND_PROXY.md.
  // '/reporting':             { target: 'http://127.0.0.1:8021', health: '/api/status', host: 'app' }, legacy version when /reporting existed

  // Event COI (Insurance) — DEDICATED backend (port 8023) that runs the Playwright submission loop,
  // isolated from usat_apps so a wedged browser can't take the front door down and front-end deploys
  // don't kill runs. Its server defines full /api/event-coi/* paths, but app.use(prefix) strips the
  // prefix — so pathRewrite re-adds it. MUST be listed before the '/' catch-all so it matches first.
  '/api/event-coi':         { target: 'http://127.0.0.1:8023', health: '/api/event-coi/health', host: 'app', pathRewrite: { '^/': '/api/event-coi/' } },

  // PUBLIC CHATBOT (embeddable widget) — OPTIONAL dedicated backend (port 8024), same isolation idea as
  // event-coi above: an unauthenticated, internet-facing process that serves ONLY the public widget routes
  // (/api/public-chatbot/widget, /widget.js, /ask — from modules/chatbot/public.js).
  //   INACTIVE by default. While this line stays commented, /api/public-chatbot/* falls through to the '/'
  //   catch-all below and is served by the platform (:8022) — which is exactly how the widget works today.
  //   To move public widget traffic onto the dedicated :8024 process: UNCOMMENT this line, then
  //   `npm run pm2_reload_proxy`. After that, :8024 must stay running (pm2_start_public_chatbot) or both the
  //   public widget AND the in-app preview panel break. To roll back: re-comment + reload → back to :8022.
  //   pathRewrite RE-ADDS the prefix that `app.use(prefix,…)` strips — :8024's public.js defines the full
  //   /api/public-chatbot/* paths (same as event-coi), so without this the backend sees /widget → 404. Must sit ABOVE '/'.
  '/api/public-chatbot':    { target: 'http://127.0.0.1:8024', health: '/api/status', host: 'app', pathRewrite: { '^/': '/api/public-chatbot/' } },

  // usat_apps platform (React SPA, port 8022) — the app front door + Ops console. Built at root base '/'.
  // catch all => handles /reporting & /ops; see src\usat_apps\web\src\nav.js
  '/':                      { target: 'http://127.0.0.1:8022', health: '/api/status', host: 'app' },

  // '/event-analysis': { target: 'http://127.0.0.1:8016', health: '/api/status', host: 'app' },
  // '/race-results':   { target: 'http://127.0.0.1:8018', health: '/api/status', host: 'app' },
  // '/org-chart':      { target: 'http://127.0.0.1:8011', health: '/healthz', host: 'app' },  // Streamlit — keep standalone
};
