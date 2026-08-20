'use strict';
// chatbot module — internal POC of the TeamUSA assistant. A floating chat bubble that lives ONLY in the
// Chatbot section of usat_apps, grounded on the SAME curated knowledge + operator corrections the Salesforce
// email queue uses (services/knowledge + services/corrections + services/ai). It answers ONLY from TeamUSA
// knowledge — no member PII, no raw cases. Mounts into the platform server (:8022). It ALSO mounts the
// isolated PUBLIC widget surface (public.js: /api/public-chatbot/*) — unauthenticated, curated-knowledge
// only, for embedding on external sites via an iframe. Panel: 'chatbot'.
const api = require('./api');
const publicApi = require('./public');
const evalApi = require('./eval/api');   // stress-test / training harness (/api/chatbot/eval/*)

module.exports = {
  id: 'chatbot',
  label: 'Chatbot',
  group: 'Chatbot',                     // new nav group
  // One panel key per rail sub-page (Bot training / Public widget / Stress test), so each is listed and
  // grantable on its own in Admin · Users & access — consistent with every other module. The shared
  // operator surface (queues/context/corrections) is reachable from any of the three via require_any_panel
  // in api.js; page-specific routes are gated by the matching key (public-bots -> chatbot-widget,
  // eval/* -> chatbot-stress). Metrics is its own key (chatbot-metrics), declared in the curated catalog.
  panels: [
    { key: 'chatbot',        label: 'Bot training' },
    { key: 'chatbot-widget', label: 'Public widget' },
    { key: 'chatbot-stress', label: 'Stress test' },
  ],
  metricsTable: null,                   // shares the platform events table (panel_view tracking is automatic)
  mount: function (app) { api.mount(app); publicApi.mount(app); evalApi.mount(app); },
};
