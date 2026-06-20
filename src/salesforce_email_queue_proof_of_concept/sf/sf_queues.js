'use strict';
// List Salesforce queues (Group records with Type='Queue'), optionally with open-case counts.
// Connection is INJECTED (unit-testable with a mock conn). Reuses race_results_transform's run_soql.
const { run_soql } = require('../../race_results_transform/sf');

function soql_str(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// opts: { with_open_counts }
async function list_queues(conn, opts) {
  const o = opts || {};
  const rows = await run_soql(conn,
    "SELECT Id, Name, DeveloperName FROM Group WHERE Type = 'Queue' ORDER BY Name");
  const queues = (rows || []).map(function (g) {
    return { id: g.Id, name: g.Name, developer_name: g.DeveloperName, open_count: null };
  });
  if (!o.with_open_counts || !queues.length) return queues;

  const in_ids = queues.map(function (q) { return "'" + soql_str(q.id) + "'"; }).join(',');
  const counts = await run_soql(conn,
    "SELECT OwnerId, COUNT(Id) cnt FROM Case WHERE IsClosed = false AND OwnerId IN (" + in_ids + ") GROUP BY OwnerId");
  const by_owner = {};
  (counts || []).forEach(function (r) { by_owner[r.OwnerId] = Number(r.cnt != null ? r.cnt : (r.expr0 || 0)); });
  queues.forEach(function (q) { q.open_count = by_owner[q.id] || 0; });
  return queues;
}

module.exports = { list_queues };
