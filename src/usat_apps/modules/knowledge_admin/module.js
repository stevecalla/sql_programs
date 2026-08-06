'use strict';
// knowledge_admin module — the SHARED "Knowledge & AI" admin surface. Governs the one knowledge base both
// the chatbot and the email queue use: the retrieval blend (keyword <-> semantic weight), the embedding
// model + reindex, and the web allowlist. Neutral namespace, admin-only, config under the shared `knowledge`
// key. It owns no queue data of its own — just the shared settings the two surfaces read.
const api = require('./api');

module.exports = {
  id: 'knowledge-admin',
  label: 'Knowledge & AI',
  group: 'Admin',
  panels: [{ key: 'knowledge-admin', label: 'Knowledge & AI' }],
  metricsTable: null,
  mount: function (app) { api.mount(app); },
};
