'use strict';
// chatbot module — internal POC of the Team USA assistant. A floating chat bubble that lives ONLY in the
// Chatbot section of usat_apps, grounded on the SAME curated knowledge + operator corrections the Salesforce
// email queue uses (services/knowledge + services/corrections + services/ai). It answers ONLY from Team USA
// knowledge — no member PII, no raw cases. Mounts into the platform server (:8022); the dedicated PUBLIC
// server + widget come later (see plans_and_notes/chatbot/CHATBOT_PLAN.md, phases C2/C3/C5). Panel: 'chatbot'.
const api = require('./api');

module.exports = {
  id: 'chatbot',
  label: 'Chatbot',
  group: 'Chatbot',                     // new nav group
  panels: [{ key: 'chatbot', label: 'Chatbot' }],
  metricsTable: null,                   // shares the platform events table (panel_view tracking is automatic)
  mount: function (app) { api.mount(app); },
};
