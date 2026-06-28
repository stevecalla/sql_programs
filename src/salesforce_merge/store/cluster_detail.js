'use strict';
// Phase 2 — compose a cluster's account detail: try a READ-ONLY live Salesforce fetch (richer
// fields), and fall back to the local snapshot rows if Salesforce isn't configured/reachable.
// Plus the dry-run merge preview. Nothing here writes anything.
const reviews = require('./reviews_read');
const dashboard = require('./duplicates_read');
const sfread = require('./salesforce_read');
const { build_preview } = require('./merge_preview');

async function cluster_detail(key, { sf = sfread } = {}) {
  const snap = await reviews.cluster_accounts(key);          // { key, accounts: [{account, ...}] }
  const ids = (snap.accounts || []).map((a) => a.account).filter(Boolean);
  let accounts = snap.accounts || [];
  let source = 'snapshot';
  let fields = accounts.length ? Object.keys(accounts[0]).filter((k) => k !== 'account') : [];
  if (ids.length) {
    try {
      const ds = await dashboard.dataset_info();
      const is_test = !(ds && ds.environment === 'Production');
      const deep = await sf.fetch_accounts_by_ids(ids, { is_test });
      if (deep && deep.length) { accounts = deep; source = 'salesforce'; fields = sfread.DETAIL_FIELDS; }
    } catch (e) { /* Salesforce not configured/reachable -> keep the snapshot rows */ }
  }
  return { key, source, fields, accounts };
}

async function cluster_preview(key, survivor, opts) {
  const d = await cluster_detail(key, opts);
  return { key, source: d.source, ...build_preview(d.accounts, survivor, { idKey: 'account', fields: d.fields }) };
}

module.exports = { cluster_detail, cluster_preview };
