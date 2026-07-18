'use strict';
// Passive Salesforce API-usage capture (Phase 2). Snapshots DailyApiRequests used/max (from the
// Sforce-Limit-Info header, exposed by jsforce as conn.limitInfo.apiUsage) into
// salesforce_merge_api_usage, tagged with env + op (probe | merge | restore | recreate | build) and an
// optional run_id — so we get an intraday TREND plus per-activity / per-run ATTRIBUTION. Every write is
// fire-and-forget: it must NEVER throw or block a merge/request (analytics can't break the app).
const { ensure_table } = require('../../../../../utilities/analytics/ensure_table');
const { query_create_salesforce_merge_api_usage_table } = require('../../../../queries/create_drop_db_table/query_create_salesforce_merge_api_usage_table');
const ts = require('./timestamps');

const TABLE = 'salesforce_merge_api_usage';

let _ready = null;
async function ensure(pool) {
  if (_ready) return _ready;
  _ready = (async () => { await ensure_table(pool, await query_create_salesforce_merge_api_usage_table(TABLE)); })();
  return _ready;
}

// Read { used, max } from a jsforce connection's limitInfo (populated from the Sforce-Limit-Info header
// on EVERY API response). Returns null when unavailable (no call made yet / non-jsforce conn).
function usage_from_conn(conn) {
  const u = conn && conn.limitInfo && conn.limitInfo.apiUsage;
  if (!u) return null;
  const used = Number(u.used);
  const max = Number(u.limit);
  if (!Number.isFinite(used) || !Number.isFinite(max)) return null;
  return { used: used, max: max };
}

// Accurate current usage via a real REST /limits call (SOAP merge calls don't refresh the header-based
// limitInfo, so start==end otherwise). /limits itself does NOT count against DailyApiRequests. Falls
// back to the header value if the call fails.
async function usage_via_limits(conn) {
  try {
    const lim = await conn.limits();
    const d = lim && lim.DailyApiRequests;
    const max = Number(d && d.Max); const remaining = Number(d && d.Remaining);
    if (Number.isFinite(max) && Number.isFinite(remaining)) return { used: max - remaining, max };
  } catch (e) { /* fall back below */ }
  return usage_from_conn(conn);
}

// Insert one snapshot. used/max are passed explicitly (caller reads them from the conn or the /limits
// result) so this stays pure/testable. Fire-and-forget; pool is injectable for tests.
async function record({ env, org_id, op, run_id, actor, used, max } = {}, pool) {
  try {
    if (used == null || max == null) return;
    const p = pool || (await require('../../../store/db').get_pool());
    await ensure(p);
    const t = ts.now_mtn_utc();
    await p.query(
      'INSERT INTO ' + TABLE + ' (created_at_utc, created_at_mtn, env, org_id, op, run_id, actor, api_used, api_max, source) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [t.utc, t.mtn, env || null, org_id || null, op || 'read', run_id || null, actor || null, Number(used), Number(max), 'web']
    );
  } catch (e) { /* analytics must never break the app */ }
}

// Trend points over the window (chronological, for charting).
async function list_recent(pool, { days = 1, env = null, limit = 1000 } = {}) {
  const where = ['created_at_utc >= UTC_TIMESTAMP() - INTERVAL ' + (Number(days) || 1) + ' DAY'];
  const args = [];
  if (env) { where.push('env = ?'); args.push(env); }
  const rows = (await pool.query(
    'SELECT created_at_mtn, created_at_utc, env, op, run_id, actor, api_used, api_max FROM ' + TABLE +
    ' WHERE ' + where.join(' AND ') + ' ORDER BY created_at_utc ASC LIMIT ' + (Number(limit) || 1000), args))[0];
  return rows;
}

// Per-op attribution over the window. For run-tagged rows the used span (max-min) within a run ~ that
// run's DailyApiRequests cost; probes are point observations.
async function summary_by_op(pool, { days = 1, env = null } = {}) {
  const where = ['created_at_utc >= UTC_TIMESTAMP() - INTERVAL ' + (Number(days) || 1) + ' DAY'];
  const args = [];
  if (env) { where.push('env = ?'); args.push(env); }
  const rows = (await pool.query(
    'SELECT op, COUNT(*) snapshots, COUNT(DISTINCT run_id) runs, MIN(api_used) min_used, MAX(api_used) max_used, MAX(api_max) api_max FROM ' + TABLE +
    ' WHERE ' + where.join(' AND ') + ' GROUP BY op ORDER BY snapshots DESC', args))[0];
  return rows;
}

// Per-run cost: (max used - min used) across the snapshots sharing a run_id = DailyApiRequests consumed.
async function run_cost(pool, run_id) {
  const rows = (await pool.query(
    'SELECT run_id, op, env, COUNT(*) n, MIN(api_used) start_used, MAX(api_used) end_used, (MAX(api_used) - MIN(api_used)) cost FROM ' + TABLE +
    ' WHERE run_id = ? GROUP BY run_id, op, env', [run_id]))[0];
  return rows[0] || null;
}

// The single most recent snapshot for an env (any op) — what the panel shows on open, WITHOUT a live
// SF call. null if nothing captured yet.
async function latest(pool, env) {
  const args = []; let w = '';
  if (env) { w = ' WHERE env = ?'; args.push(env); }
  const rows = (await pool.query("SELECT DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') created_at_mtn, created_at_utc, env, org_id, op, api_used, api_max FROM " + TABLE + w + ' ORDER BY created_at_utc DESC LIMIT 1', args))[0];
  return rows[0] || null;
}

// Recent merge runs + their MEASURED DailyApiRequests cost (max-min used across each run_id's snapshots).
async function recent_runs(pool, { days = 7, env = null, limit = 20 } = {}) {
  const where = ['run_id IS NOT NULL', 'created_at_utc >= UTC_TIMESTAMP() - INTERVAL ' + (Number(days) || 7) + ' DAY'];
  const args = [];
  if (env) { where.push('env = ?'); args.push(env); }
  const rows = (await pool.query(
    'SELECT run_id, MAX(op) op, MAX(env) env, MAX(actor) actor, COUNT(*) snapshots, MIN(api_used) start_used, ' +
    "MAX(api_used) end_used, (MAX(api_used) - MIN(api_used)) cost, DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %H:%i:%s') last_seen FROM " + TABLE +
    ' WHERE ' + where.join(' AND ') + ' GROUP BY run_id ORDER BY MAX(created_at_utc) DESC LIMIT ' + (Number(limit) || 20), args))[0];
  return rows;
}

module.exports = { ensure, record, usage_from_conn, usage_via_limits, latest, list_recent, summary_by_op, run_cost, recent_runs, TABLE };
