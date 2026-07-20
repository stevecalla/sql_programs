'use strict';
// Child-record counts — configured list and auto-discovery (incl. Person-Account Contact-side
// children). Injected fake jsforce connection; no live Salesforce.
//   node --test src/salesforce_merge/tests/salesforce_children.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { count_children_by_ids, count_children, discover_child_objects } = require('../store/salesforce_read');

describe('count_children_by_ids (configured list)', () => {
  test('sums per-account counts across child objects', async () => {
    const connect = async () => ({
      query: async (soql) => {
        if (/FROM Opportunity/.test(soql)) return { records: [{ pid: 'A', c: 40 }, { pid: 'B', c: 5 }] };
        if (/FROM Case/.test(soql)) return { records: [{ pid: 'A', c: 2 }, { pid: 'C', c: 3 }] };
        return { records: [] };
      },
    });
    const out = await count_children_by_ids(['A', 'B', 'C'], { connect });
    assert.equal(out.A.total, 42);
    assert.deepEqual(out.A.by, { Opportunities: 40, Cases: 2 });
  });
});

describe('count_children (auto-discovery)', () => {
  const fakeConn = {
    sobject: (name) => ({
      describe: async () => ({
        childRelationships: name === 'Account'
          ? [{ childSObject: 'Opportunity', field: 'AccountId', relationshipName: 'Opportunities' },
             { childSObject: 'AccountHistory', field: 'AccountId', relationshipName: 'Histories' }]   // skipped (system)
          : [{ childSObject: 'Case', field: 'ContactId', relationshipName: 'Cases' }],                 // Contact-side
      }),
    }),
    query: async (soql) => {
      if (/FROM Opportunity/.test(soql)) return { records: [{ pid: 'A', c: 3 }] };
      if (/FROM Case/.test(soql)) return { records: [{ pid: 'C1', c: 2 }] };   // C1 is A's PersonContact
      return { records: [] };
    },
  };

  test('discovery skips system relationships', async () => {
    const rels = await discover_child_objects(fakeConn, 'Account');
    assert.ok(rels.some((r) => r.object === 'Opportunity'));
    assert.ok(!rels.some((r) => r.object === 'AccountHistory'));   // *History filtered out
  });

  test('rolls up Account- and Contact-side children to the account', async () => {
    const out = await count_children(['A'], { connect: async () => fakeConn, contactByAccount: { A: 'C1' } });
    assert.equal(out.A.total, 5);                       // 3 opps (Account) + 2 cases (Contact)
    assert.equal(out.A.by.Opportunities, 3);
    assert.equal(out.A.by.Cases, 2);
  });
});


describe('discover_child_objects excludes non-re-pointable activity relations (issue #5)', () => {
  test('drops Task.AccountId + *Relation junctions; keeps real lookups and Task.WhatId', async () => {
    const conn = { sobject: () => ({ describe: async () => ({ childRelationships: [
      { childSObject: 'Task', field: 'AccountId', relationshipName: 'Tasks' },
      { childSObject: 'Task', field: 'WhatId', relationshipName: 'ActivityWhat' },
      { childSObject: 'TaskRelation', field: 'RelationId', relationshipName: 'TaskRelations' },
      { childSObject: 'TaskWhoRelation', field: 'RelationId', relationshipName: 'TaskWhoRelations' },
      { childSObject: 'EventRelation', field: 'RelationId', relationshipName: 'EventRelations' },
      { childSObject: 'AccountHistory', field: 'AccountId', relationshipName: 'Histories' },
      { childSObject: 'Opportunity', field: 'AccountId', relationshipName: 'Opportunities' },
    ] }) }) };
    const out = await discover_child_objects(conn, 'Acct_ActivityRelTest');   // unique name avoids the module cache
    const keys = out.map((o) => o.object + '.' + o.field);
    assert.ok(!keys.includes('Task.AccountId'), 'Task.AccountId (read-only derived) excluded');
    assert.ok(!keys.includes('TaskRelation.RelationId'), 'TaskRelation excluded');
    assert.ok(!keys.includes('TaskWhoRelation.RelationId'), 'TaskWhoRelation excluded');
    assert.ok(!keys.includes('EventRelation.RelationId'), 'EventRelation excluded');
    assert.ok(!keys.includes('AccountHistory.AccountId'), 'History excluded');
    assert.ok(keys.includes('Opportunity.AccountId'), 'real Account lookup kept');
    assert.ok(keys.includes('Task.WhatId'), 'Task via WhatId kept (only the derived AccountId is dropped)');
  });
});
