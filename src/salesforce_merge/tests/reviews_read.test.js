'use strict';
// reviews_read — server-side paging/search/sort/filter builders + paged reads + facets, via an
// injected fake query (no MySQL). Asserts safe SQL (whitelisted sort/filter, LIMIT/OFFSET, params).
//   node --test src/salesforce_merge/tests/reviews_read.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const reviews = require('../store/reviews_read');

function recorder(rows) {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params: params || [] });
    if (/COUNT\(\*\)/.test(sql)) return [{ n: 42 }];
    return rows;
  };
  return { q, calls };
}

describe('build_clauses', () => {
  test('clamps paging, whitelists sort, builds parameterized search', () => {
    const spec = { select: '*', search_cols: ['a', 'b'], sort: { x: 'colx', y: 'coly' }, default_sort: 'x' };
    const c = reviews.build_clauses({ page: '2', page_size: '10', q: 'foo', sort: 'y', dir: 'desc' }, spec);
    assert.equal(c.page, 2);
    assert.equal(c.page_size, 10);
    assert.equal(c.offset, 10);
    assert.ok(c.order_sql.includes('coly DESC'));
    assert.ok(c.where_sql.includes('LIKE ?'));
    assert.equal(c.params.length, 2);
    assert.equal(c.params[0], '%foo%');
  });

  test('rejects a non-whitelisted sort (falls back to default) and clamps page_size', () => {
    const spec = { select: '*', search_cols: [], sort: { x: 'colx' }, default_sort: 'x' };
    const c = reviews.build_clauses({ sort: 'evil; DROP TABLE', page_size: '9999' }, spec);
    assert.ok(c.order_sql.includes('colx'));
    assert.ok(!/evil/i.test(c.order_sql));
    assert.equal(c.page_size, reviews.MAX_PAGE_SIZE);
  });
});

describe('paged reads', () => {
  test('list_duplicates: COUNT + SELECT with LIMIT/OFFSET, numeric sort, mapped shape', async () => {
    const { q, calls } = recorder([{ cluster: 'CL1', names: 'A;B', size: '2', signal: 'exact only', tier: 'exact', merge_ids: '', best: '96' }]);
    const out = await reviews.list_duplicates({ page: 1, page_size: 25, sort: 'size', dir: 'desc' }, q);
    assert.equal(out.total, 42);
    assert.equal(out.rows.length, 1);
    const sel = calls.find((c) => /FROM/.test(c.sql) && !/COUNT/.test(c.sql));
    assert.ok(/LIMIT \? OFFSET \?/.test(sel.sql));
    assert.ok(/ORDER BY CAST\(Group_Record_Count__c AS UNSIGNED\) DESC/.test(sel.sql));
    assert.ok(/AS `signal`/.test(sel.sql));
  });

  test('duplicates search now also covers size + tier columns', async () => {
    const { q, calls } = recorder([{}]);
    await reviews.list_duplicates({ q: 'foo' }, q);
    const sel = calls.find((c) => /FROM/.test(c.sql) && !/COUNT/.test(c.sql));
    assert.ok(/`Group_Record_Count__c` LIKE \?/.test(sel.sql));
    assert.ok(/`Confidence_Tier__c` LIKE \?/.test(sel.sql));
  });

  test('list_merge_id: bucket filter adds WHERE Bucket__c = ? with its param', async () => {
    const { q, calls } = recorder([{ account: '001', bucket: 'sf_only' }]);
    await reviews.list_merge_id({ filters: { bucket: 'sf_only' } }, q);
    const sel = calls.find((c) => /Account__c AS/.test(c.sql) && !/COUNT/.test(c.sql));
    assert.ok(/Bucket__c = \?/.test(sel.sql));
    assert.ok(sel.params.includes('sf_only'));
  });

  test('list_accounts: has_merge_id filter adds the static WHERE', async () => {
    const { q, calls } = recorder([{ account: '001' }]);
    await reviews.list_accounts({ filters: { has_merge_id: '1' } }, q);
    const sel = calls.find((c) => /salesforce_account_id AS/.test(c.sql) && !/COUNT/.test(c.sql));
    assert.ok(/salesforce_merge_id <> ''/.test(sel.sql));
  });

  test('per-column filters add a whitelisted LIKE; unknown keys are ignored', async () => {
    const { q, calls } = recorder([{ account: '001' }]);
    await reviews.list_duplicates({ colFilters: { signal: 'exact', bogus: 'x' } }, q);
    const sel = calls.find((c) => /FROM/.test(c.sql) && !/COUNT/.test(c.sql));
    assert.ok(/`Match_Composition__c` LIKE \?/.test(sel.sql));
    assert.ok(sel.params.includes('%exact%'));
    assert.ok(!/bogus/i.test(sel.sql));
  });
});

describe('facets', () => {
  test('returns distinct values for the whitelisted facet columns', async () => {
    const q = async (sql) => {
      if (/Match_Composition__c/.test(sql)) return [{ v: 'exact only' }, { v: 'fuzzy only' }, { v: '' }];
      if (/Confidence_Tier__c/.test(sql)) return [{ v: 'exact' }, { v: 'fuzzy90' }];
      return [];
    };
    const f = await reviews.facets('duplicates', q);
    assert.deepEqual(f.signal, ['exact only', 'fuzzy only']);  // blanks filtered out
    assert.deepEqual(f.tier, ['exact', 'fuzzy90']);
  });
});

describe('export_rows', () => {
  test('no paging, applies filters, caps at EXPORT_MAX', async () => {
    const { q, calls } = recorder([{ account: '001' }]);
    await reviews.export_rows('accounts', { filters: { has_merge_id: '1' }, q: 'foo' }, q);
    const sel = calls.find((c) => /salesforce_account_id AS/.test(c.sql));
    assert.ok(!/OFFSET/.test(sel.sql));                                  // not paged
    assert.ok(new RegExp('LIMIT ' + reviews.EXPORT_MAX).test(sel.sql));  // capped
    assert.ok(/salesforce_merge_id <> ''/.test(sel.sql));               // filter applied
  });
});
