'use strict';
// Cross-thread context: this sender's prior cases, matched by SuppliedEmail (verified ~100%
// populated; ContactId is unreliable on these queues). Safe-to-quote tier-2 history.
// Connection is INJECTED (mock-testable). Reuses race_results_transform's run_soql.
const { run_soql, datetime_in_time_zone, DEFAULT_TZ } = require('../../race_results_transform/sf');

function soql_str(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// opts: { email, exclude_case_id, limit, tz }
async function get_sender_history(conn, opts) {
  const o = opts || {};
  if (!o.email) return [];
  const tz = o.tz || DEFAULT_TZ;
  const limit = Number(o.limit) > 0 ? Number(o.limit) : 25;
  const exclude = o.exclude_case_id ? " AND Id != '" + soql_str(o.exclude_case_id) + "'" : '';
  const rows = await run_soql(conn,
    "SELECT Id, CaseNumber, Subject, Status, CreatedDate FROM Case WHERE SuppliedEmail = '" +
    soql_str(o.email) + "'" + exclude + " ORDER BY CreatedDate DESC LIMIT " + limit);
  return (rows || []).map(function (c) {
    return {
      case_id: c.Id, case_number: c.CaseNumber, subject: c.Subject || '',
      status: c.Status || '', created_utc: c.CreatedDate || null,
      created_mtn: c.CreatedDate ? datetime_in_time_zone(c.CreatedDate, tz) : ''
    };
  });
}

module.exports = { get_sender_history };
