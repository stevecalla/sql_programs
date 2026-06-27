// proxy_routes.js — path prefix -> { target, health } for server_proxy_8000.js.
// Uncomment a line to route that prefix through the proxy. `health` is pinged by
// the /api/health aggregator. No secrets here -> committed to git.

module.exports = {
  // API SERVERS (usat-api) — headless data jobs + Slack webhook receivers.
  '/events':                { target: 'http://127.0.0.1:8005', health: '/events-test' },
  '/sales':                 { target: 'http://127.0.0.1:8003', health: '/scheduled-all-sales-test' },
  '/participation':         { target: 'http://127.0.0.1:8004', health: '/participation-test' },
  '/recognition':           { target: 'http://127.0.0.1:8006', health: '/recognition-test' },
  '/scraper':               { target: 'http://127.0.0.1:8015', health: '/scraper-test' },
  '/membership-base':       { target: 'http://127.0.0.1:8012', health: '/membership-test' },
  '/auto-renew':            { target: 'http://127.0.0.1:8014', health: '/auto-renew-test' },
  '/duplicates':            { target: 'http://127.0.0.1:8017', health: '/salesforce-duplicates-test' },

  // Slack webhook receivers (called BY Slack -> need the public usat-api host):
  '/slack':                 { target: 'http://127.0.0.1:8001', health: '/get-member-sales-test' },
  '/slack-revenue':         { target: 'http://127.0.0.1:8007', health: '/revenue-test' },
  '/slack-events':          { target: 'http://127.0.0.1:8008', health: '/slack-events-test' },
  '/slack-races':           { target: 'http://127.0.0.1:8009', health: '/slack-races-test' },
  '/slack-news':            { target: 'http://127.0.0.1:8010', health: '/slack-news-test' },
  '/slack-membership-base': { target: 'http://127.0.0.1:8013', health: '/slack-membership-base-test' },

  // APP / UI SERVERS (React — Project C). Keep on their own subdomains for now.
  // '/event-analysis': { target: 'http://127.0.0.1:8016', health: '/api/status' },
  // '/race-results':   { target: 'http://127.0.0.1:8018', health: '/api/status' },
  // '/email-queue':    { target: 'http://127.0.0.1:8019', health: '/api/status' },
  // '/org-chart':      { target: 'http://127.0.0.1:8011', health: '/healthz' },  // Streamlit — keep standalone
};
