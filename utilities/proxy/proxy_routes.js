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
  '/merge':                 { target: 'http://127.0.0.1:8020', health: '/api/status', host: 'app' },
  // Reporting app (React SPA, port 8021 — participation maps + future reports). Built path-aware
  // (`npm run reporting_build_proxy`, Vite base '/reporting/'). See src/reporting/plans_and_notes/DEPLOY_AND_PROXY.md.

  // '/reporting':             { target: 'http://127.0.0.1:8021', health: '/api/status', host: 'app' },
  '/':            { target: 'http://127.0.0.1:8022', health: '/api/status', host: 'app' },     // catch-all already handles /reporting/*

  // usat_apps platform (React SPA, port 8022) — the app front door + Ops console. Built at root base '/'.
  '/':                      { target: 'http://127.0.0.1:8022', health: '/api/status', host: 'app' },
  
  // '/event-analysis': { target: 'http://127.0.0.1:8016', health: '/api/status', host: 'app' },
  // '/race-results':   { target: 'http://127.0.0.1:8018', health: '/api/status', host: 'app' },
  // '/email-queue':    { target: 'http://127.0.0.1:8019', health: '/api/status', host: 'app' },
  // '/org-chart':      { target: 'http://127.0.0.1:8011', health: '/healthz', host: 'app' },  // Streamlit — keep standalone
};
