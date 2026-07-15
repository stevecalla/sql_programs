'use strict';
// Phase 2 — compose account detail for a record set: try a READ-ONLY live Salesforce fetch (richer
// fields), fall back to the local snapshot if Salesforce isn't configured/reachable. The set is
// resolved by `kind`: 'merge_id' (accounts sharing a Salesforce merge id) or 'group' (members of a
// consolidated cluster). Child counts are a SEPARATE call so detail renders immediately. No writes.
const reviews = require('./reviews_read');
const dashboard = require('./duplicates_read');
const sfread = require('./salesforce_read');
const { build_preview } = require('./merge_preview');

async function env_is_test() {
  const ds = await dashboard.dataset_info();
  return !(ds && ds.environment === 'Production');
}

async function accounts_for(key, kind) {
  if (kind === 'merge_id') {
    const ids = await reviews.merge_group_account_ids(key);
    const snap = await reviews.accounts_by_ids(ids);
    return { snap, ids };
  }
  const r = await reviews.cluster_accounts(key);
  const snap = r.accounts || [];
  return { snap, ids: snap.map((a) => a.account).filter(Boolean) };
}

async function cluster_detail(key, { sf = sfread, kind = 'group' } = {}) {
  const { snap, ids } = await accounts_for(key, kind);
  let accounts = snap;
  let source = 'snapshot';
  let fields = accounts.length ? Object.keys(accounts[0]).filter((k) => k !== 'account') : [];
  if (ids.length) {
    try {
      const deep = await sf.fetch_accounts_by_ids(ids, { is_test: await env_is_test() });
      if (deep && deep.length) { accounts = deep; source = 'salesforce'; fields = sfread.DETAIL_FIELDS; }
    } catch (e) { /* Salesforce not configured/reachable -> keep the snapshot rows */ }
  }
  return { key, kind, source, fields, accounts };
}

async function cluster_children(key, { sf = sfread, kind = 'group' } = {}) {
  const d = await cluster_detail(key, { sf, kind });
  if (d.source !== 'salesforce') return { source: d.source, children: {} };
  const contactByAccount = {};
  for (const a of d.accounts) if (a.contact) contactByAccount[a.account] = a.contact;
  const ids = d.accounts.map((a) => a.account);
  // Fast parallel COUNT over the discovered child objects (Account- AND Contact-parented), the same
  // discovery the snapshot walks. Cheaper than fetching full records. (May include the two person-account
  // self-halves per account — a small cosmetic over-count vs the snapshot's reparented figure.)
  const children = await sf.count_children(ids, { is_test: await env_is_test(), contactByAccount });
  return { source: d.source, children };
}

async function cluster_preview(key, survivor, opts = {}) {
  const d = await cluster_detail(key, opts);
  return { key, source: d.source, ...build_preview(d.accounts, survivor, { idKey: 'account', fields: d.fields }) };
}

module.exports = { cluster_detail, cluster_children, cluster_preview };
