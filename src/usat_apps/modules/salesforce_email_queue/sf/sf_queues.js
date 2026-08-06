'use strict';
// list_queues now lives in the shared client (services/salesforce) — listing queues is generic SF, not
// email-queue-specific. Kept here as a re-export so existing importers (sf/index.js) are unchanged.
module.exports = { list_queues: require('../../../services/salesforce').list_queues };
