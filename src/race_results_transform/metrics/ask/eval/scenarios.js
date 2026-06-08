'use strict';
// Review scenarios for the AI-ask eval harness. Each is a small conversation; where
// the produced SQL is deterministic enough we assert a regex on it. Used by run_eval.js
// (live model) and by the offline structure test. Corrections are passed inline as
// grounding (no DB writes), so running the eval never pollutes the corrections table.
const T = require('../../metrics_config').TABLE;

const SCENARIOS = [
  {
    id: 'correction_power_user',
    kind: 'correction',
    why: 'A saved correction redefines an undefined term and the SQL must reflect it.',
    correction: 'A "power user" is any visitor with 3 or more uploads (file_uploaded events).',
    turns: [
      { q: 'how many power users do we have?', expect_sql: /having[\s\S]*(>=\s*3|>\s*2)|>=\s*3/i }
    ]
  },
  {
    id: 'thread_breakdown',
    kind: 'thread',
    why: 'A follow-up must reuse the prior metric and only add a dimension.',
    turns: [
      { q: 'how many uploads in the last 7 days?', expect_sql: new RegExp('file_uploaded') },
      { q: 'break that down by file type', expect_sql: /group\s+by/i }
    ]
  },
  {
    id: 'out_of_scope_membership',
    kind: 'single',
    why: 'Out-of-scope data must be declined, not substituted.',
    turns: [
      { q: 'how many members signed up last month?', expect_mode: 'out_of_scope' }
    ]
  }
];

module.exports = { SCENARIOS, TABLE: T };
