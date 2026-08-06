'use strict';
// queue_access was promoted to the shared services/queue_access (used by the email queue AND the chatbot,
// so neither surface owns it). Kept here as a re-export so existing importers (api.js, admin, tests) are
// unchanged. New callers should require services/queue_access directly.
module.exports = require('../../../services/queue_access');
