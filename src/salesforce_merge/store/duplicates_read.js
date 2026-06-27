'use strict';
// Read-only queries over the EXISTING duplicate tables (written by the salesforce_duplicates
// finder). Table names are imported from the duplicates config so they stay in sync. Every query
// is wrapped so a missing table (no finder run yet) returns null instead of crashing — the
// dashboard then shows "—" for that figure.
const { query } = require('./db');
const cfg = require('../../salesforce_duplicates/config');

async function safe(sql, params) {
  try { return await query(sql, params); } catch (e) { return null; }
}

// Phase 0 dashboard figures — all read-only, all from tables the finder already produced.
async function dashboard_counts() {
  const T_SNAP = cfg.SNAPSHOT_TABLE_NAME;          // salesforce_account_duplicate_snapshot
  const T_CL = cfg.RESULT_CONSOLIDATED_TABLE;      // salesforce_duplicate_consolidated_cluster
  const T_MR = cfg.RESULT_MERGE_ID_REVIEW_TABLE;   // salesforce_duplicate_merge_id_review

  const out = {
    total_accounts: null,
    merge_id_accounts: null,
    clusters: null,
    duplicate_pairs: null,
    buckets: [],
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

  r = await safe('SELECT Bucket__c AS bucket, COUNT(*) AS n FROM `' + T_MR + '` GROUP BY Bucket__c');
  if (r) out.buckets = r.map(function (x) { return { bucket: x.bucket, count: Number(x.n) }; });

  return out;
}

module.exports = { dashboard_counts };
