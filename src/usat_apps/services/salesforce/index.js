'use strict';
// Shared Salesforce client for every SF-touching module (merge, email queue, race results, …).
// Wraps the repo-level connector utilities/salesforce/salesforce_connect.js (role-aware read/write,
// prod/sandbox) and adds generic SOQL/describe/limits helpers. Domain reads (queues, threads, etc.)
// stay in each module; this is only the connection + generic plumbing.
//
// The connector is lazy-required inside connect() so importing this module for the pure helpers
// (parse_limits) never pulls in jsforce.

// role: 'read' | 'write'.  is_test: true = sandbox/dev creds + test.salesforce.com.
async function connect(opts) {
  const o = opts || {};
  const { connect_salesforce } = require('../../../../utilities/salesforce/salesforce_connect');
  return connect_salesforce({ is_test: !!o.is_test, role: o.role || 'read', version: o.version });
}

// Run a SOQL query and return the records array (jsforce query().execute with auto-fetch).
const MAX_FETCH = 5000;
async function run_soql(conn, soql, max_fetch) {
  const result = await conn.query(String(soql)).execute({ autoFetch: true, maxFetch: max_fetch || MAX_FETCH });
  return (result && result.records) || [];
}

// List Salesforce queues (Group records with Type='Queue'), optionally with open-case counts.
// Generic SF read (not surface-specific), so it lives here in the shared client. Connection is injected.
function soql_str(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
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

// ---- Mountain-Time date helpers (shared; ported from race_results_transform/sf/sf_dates) ----
const DEFAULT_TZ = 'America/Denver';
function ymd_in_time_zone(value, time_zone) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: time_zone || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = function (t) { const p = parts.find(function (x) { return x.type === t; }); return p && p.value; };
  const y = get('year'), m = get('month'), d = get('day');
  return (y && m && d) ? (y + '-' + m + '-' + d) : '';
}
function datetime_in_time_zone(value, time_zone) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: time_zone || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short' }).format(new Date(value));
}
// Describe an sObject.
async function describe_object(conn, name) {
  return conn.sobject(name).describe();
}
// Download a ContentVersion's bytes through the authenticated connection (attachments).
async function fetch_content_version_bytes(conn, content_version_id) {
  const url = conn.instanceUrl + '/services/data/v' + conn.version + '/sobjects/ContentVersion/' + content_version_id + '/VersionData';
  const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + conn.accessToken } });
  if (!response.ok) { const text = await response.text().catch(function () { return ''; }); throw new Error('Salesforce download failed for ' + content_version_id + ' (HTTP ' + response.status + '): ' + text); }
  return Buffer.from(await response.arrayBuffer());
}

// Raw org limits (jsforce conn.limits()).
async function get_limits(conn) {
  return conn.limits();
}

// ---- pure: parse conn.limits() into the daily API budget + other per-org limits ----
const OTHER_LIMITS = ['DailyBulkApiBatches', 'DailyBulkV2QueryJobs', 'DailyAsyncApexExecutions'];
function one(lim, key) {
  const e = lim && lim[key];
  if (!e || typeof e.Max !== 'number') return null;
  const max = e.Max;
  const remaining = typeof e.Remaining === 'number' ? e.Remaining : max;
  const used = Math.max(0, max - remaining);
  return { key: key, used: used, max: max, remaining: remaining, pct: max > 0 ? Math.round((used / max) * 1000) / 10 : 0 };
}
function parse_limits(lim) {
  return { daily: one(lim, 'DailyApiRequests'), other: OTHER_LIMITS.map(function (k) { return one(lim, k); }).filter(Boolean) };
}

module.exports = { connect, run_soql, list_queues, describe_object, get_limits, parse_limits, OTHER_LIMITS, DEFAULT_TZ, ymd_in_time_zone, datetime_in_time_zone, fetch_content_version_bytes };
