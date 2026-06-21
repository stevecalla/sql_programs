'use strict';
// Selectable models for the Ask-your-data box. Re-exports the app-wide registry (ai/models.js) so the
// dashboard, the in-app model picker, triage, draft and ask all offer the SAME models from one list.
module.exports = require('../../ai/models');
