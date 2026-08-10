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
  panels: [{ key: 'chatbot', label: 'Chatbot' }],
  metricsTable: null,                   // shares the platform events table (panel_view tracking is automatic)
  mount: function (app) { api.mount(app); publicApi.mount(app); evalApi.mount(app); },
};
