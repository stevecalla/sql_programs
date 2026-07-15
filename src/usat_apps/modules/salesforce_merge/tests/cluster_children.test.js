'use strict';
// cluster_children (impact preview) — builds contactByAccount from the live detail and delegates to the
// fast parallel count_children (same discovery the snapshot walks, incl. Contact-parented objects).
//   node --test modules/salesforce_merge/tests/cluster_children.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cluster = require('../store/cluster_detail');

test('cluster_children delegates to count_children with contactByAccount from the live detail', async () => {
  let seenIds = null; let seenContacts = null;
  const sf = {
    fetch_accounts_by_ids: async () => [
      { account: 'A1', contact: 'C1' },
      { account: 'A2', contact: 'C2' },
    ],
    DETAIL_FIELDS: ['PersonEmail'],
    count_children: async (ids, opts) => {
      seenIds = ids; seenContacts = opts.contactByAccount;
      return { A1: { total: 2, by: { ContactPointEmail: 2 } }, A2: { total: 1, by: { cfg_Subscription_Member__c: 1 } } };
    },
  };
  const dash = require('../store/duplicates_read');
  const orig = dash.dataset_info;
  dash.dataset_info = async () => ({ environment: 'Sandbox' });
  const reviews = require('../store/reviews_read');
  const origCA = reviews.cluster_accounts;
  reviews.cluster_accounts = async () => ({ accounts: [{ account: 'A1' }, { account: 'A2' }] });
  try {
    const r = await cluster.cluster_children('A1|A2', { sf, kind: 'group' });
    assert.equal(r.source, 'salesforce');
    assert.deepEqual(seenIds, ['A1', 'A2']);
    assert.deepEqual(seenContacts, { A1: 'C1', A2: 'C2' }, 'contactByAccount built from live detail (enables Contact-parented counts)');
    assert.equal(r.children.A1.total, 2);
    assert.equal(r.children.A2.total, 1);
  } finally {
    dash.dataset_info = orig;
    reviews.cluster_accounts = origCA;
  }
});

test('cluster_children returns empty when the detail falls back to the snapshot (no live contacts)', async () => {
  const sf = {
    fetch_accounts_by_ids: async () => { throw new Error('SF unreachable'); }, // -> detail source 'snapshot'
    DETAIL_FIELDS: ['PersonEmail'],
    count_children: async () => { throw new Error('should not be called'); },
  };
  const dash = require('../store/duplicates_read');
  const orig = dash.dataset_info; dash.dataset_info = async () => ({ environment: 'Sandbox' });
  const reviews = require('../store/reviews_read');
  const origCA = reviews.cluster_accounts;
  reviews.cluster_accounts = async () => ({ accounts: [{ account: 'A1' }] });
  try {
    const r = await cluster.cluster_children('A1', { sf, kind: 'group' });
    assert.notEqual(r.source, 'salesforce');
    assert.deepEqual(r.children, {});
  } finally {
    dash.dataset_info = orig;
    reviews.cluster_accounts = origCA;
  }
});
