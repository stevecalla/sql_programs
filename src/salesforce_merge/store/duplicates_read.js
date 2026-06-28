'use strict';
// Read-only queries over the EXISTING duplicate tables (written by the salesforce_duplicates
// finder). Table names are imported from the duplicates config so they stay in sync. Every query
// is wrapped so a missing table (no finder run yet) returns null instead of crashing — the
// dashboard then shows "—" for that figure.
const { query: real_query } = require('./db');
const cfg = require('../../salesforce_duplicates/config');

// Phase 0 dashboard figures — all read-only, all from tables the finder already produced.
// `query` is injectable (defaults to the real DB) so this is unit-testable without MySQL.
async function dashboard_counts(query = real_query) {
  const safe = async (sql, params) => {
    try { return await query(sql, params); } catch (e) { return null; }
  };
  const T_SNAP = cfg.SNAPSHOT_TABLE_NAME;          // salesforce_account_duplicate_snapshot
  const T_CL = cfg.RESULT_CONSOLIDATED_TABLE;      // salesforce_duplicate_consolidated_cluster
  const T_MR = cfg.RESULT_MERGE_ID_REVIEW_TABLE;   // salesforce_duplicate_merge_id_review

  const out = {
    total_accounts: null,
    merge_id_accounts: null,
    clusters: null,
    accounts_in_clusters: null,
    duplicate_pairs: null,
    buckets: [],
    // Per-signal breakdown for the dashboard "By match signal" table. Each is keyed
    // exact/fuzzy/nickname/multi. Pairs have no multi (a pair is a single signal).
    signal_breakdown: { accounts: {}, pairs: {}, clusters: {} },
  };

  let r;
  r = await safe('SELECT COUNT(*) AS n FROM `' + T_SNAP + '`');
  if (r) out.total_accounts = Number(r[0].n);

  r = await safe("SELECT COUNT(*) AS n FROM `" + T_SNAP + "` WHERE salesforce_merge_id <> ''");
  if (r) out.merge_id_accounts = Number(r[0].n);

  r = await safe('SELECT COUNT(*) AS n FROM `' + T_CL + '`');
  if (r) out.clusters = Number(r[0].n);

  r = await safe('SELECT SUM(CAST(Match_Link_Count__c AS UNSIGNED)) AS n FROM `' + T_CL + '`');
  if (r) out.duplicate_pairs = Number(r[0].n || 0);

  // Duplicate ACCOUNTS = sum of cluster sizes (the individual records in clusters) — the figure
  // that reconciles total accounts -> clusters -> pairs on the dashboard.
  r = await safe('SELECT SUM(CAST(Group_Record_Count__c AS UNSIGNED)) AS n FROM `' + T_CL + '`');
  if (r) out.accounts_in_clusters = Number(r[0].n || 0);

  r = await safe('SELECT Bucket__c AS bucket, COUNT(*) AS n FROM `' + T_MR + '` GROUP BY Bucket__c');
  if (r) out.buckets = r.map(function (x) { return { bucket: x.bucket, count: Number(x.n) }; });

  // Pairs by signal — the per-signal link counts summed across clusters. A pair is one
  // signal, so these three sum to the total pairs (no multi bucket for pairs).
  r = await safe(
    'SELECT SUM(CAST(Exact_Link_Count__c AS UNSIGNED)) AS exact, ' +
    'SUM(CAST(Fuzzy_Link_Count__c AS UNSIGNED)) AS fuzzy, ' +
    'SUM(CAST(Nickname_Link_Count__c AS UNSIGNED)) AS nickname FROM `' + T_CL + '`');
  if (r && r[0]) out.signal_breakdown.pairs = {
    exact: Number(r[0].exact || 0), fuzzy: Number(r[0].fuzzy || 0), nickname: Number(r[0].nickname || 0),
  };

  // Accounts + clusters by composition — a cluster's Match_Composition__c is "<signal> only"
  // for single-signal clusters, else a "a + b" mix. Fold mixes into "multi".
  r = await safe(
    'SELECT Match_Composition__c AS comp, COUNT(*) AS clusters, ' +
    'SUM(CAST(Group_Record_Count__c AS UNSIGNED)) AS accounts FROM `' + T_CL + '` GROUP BY Match_Composition__c');
  if (r) {
    const acc = { exact: 0, fuzzy: 0, nickname: 0, multi: 0 };
    const cls = { exact: 0, fuzzy: 0, nickname: 0, multi: 0 };
    for (const x of r) {
      const comp = String(x.comp || '');
      const key = comp === 'exact only' ? 'exact'
        : comp === 'fuzzy only' ? 'fuzzy'
        : comp === 'nickname only' ? 'nickname' : 'multi';
      acc[key] += Number(x.accounts || 0);
      cls[key] += Number(x.clusters || 0);
    }
    out.signal_breakdown.accounts = acc;
    out.signal_breakdown.clusters = cls;
  }

  return out;
}

// Scope label for a run row. A plain --test run is a *capped sample* even though is_full/is_partial
// are both false, so the test mode falls back to "Sample" (matches the finder's own "Fetch scope" log).
function scope_label(row) {
  if (row.is_full) return 'Full';
  if (row.is_partial) return 'Sample';
  return row.mode === 'test' ? 'Sample' : 'Full';
}
function env_label(mode) {
  return mode === 'prod' ? 'Production' : (mode === 'test' ? 'Sandbox' : (mode || null));
}

// "Data as of" stamp for every page — the latest finder run from the run logbook.
async function dataset_info(query = real_query) {
  const safe = async (sql) => { try { return await query(sql); } catch (e) { return null; } };
  const r = await safe(
    "SELECT run_at, mode, is_full, is_partial, total_records_scanned FROM `" +
    cfg.RUN_TABLE_NAME + "` WHERE run_type = 'finder' ORDER BY run_at DESC LIMIT 1");
  if (!r || !r[0]) return null;
  const x = r[0];
  return {
    run_at: x.run_at || null,
    environment: env_label(x.mode),
    scope: scope_label(x),
    total_records: x.total_records_scanned == null ? null : Number(x.total_records_scanned),
  };
}

// Recent runs for the Process page's Activity feed — durable history from the run logbook.
async function recent_runs(limit = 12, query = real_query) {
  const safe = async (sql) => { try { return await query(sql); } catch (e) { return null; } };
  const n = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50);
  // SELECT * so this stays robust if the table predates a column (e.g. run_seconds added later) —
  // referencing a missing column by name would error and return an empty Activity feed.
  const r = await safe('SELECT * FROM `' + cfg.RUN_TABLE_NAME + '` ORDER BY run_at DESC LIMIT ' + n);
  if (!r) return [];
  return r.map((x) => ({
    run_type: x.run_type,
    environment: env_label(x.mode),
    scope: scope_label(x),
    run_at: x.run_at || null,
    duration_seconds: x.run_seconds == null ? null : Number(x.run_seconds),
    total_records: x.total_records_scanned == null ? null : Number(x.total_records_scanned),
    clusters: x.consolidated_clusters == null ? null : Number(x.consolidated_clusters),
  }));
}

module.exports = { dashboard_counts, dataset_info, recent_runs };
