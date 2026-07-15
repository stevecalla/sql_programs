'use strict';
// Survivorship resolver — override = ACCOUNT ID -> that record's value (the sandbox bug fix: an
// overridden member number / email must NOT write the account id). Precedence override>master>backfill.
//   node --test src/usat_apps/modules/salesforce_merge/tests/survivorship.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const s = require('../store/survivorship');

const accts = () => [
  { account: 'M', PersonEmail: '', Phone: '111', usat_Member_Number__pc: '' },
  { account: 'L1', PersonEmail: 'l1@x.com', Phone: '999', usat_Member_Number__pc: '1001' },
  { account: 'L2', PersonEmail: 'l2@x.com', Phone: '', usat_Member_Number__pc: '2002' },
];

test('resolve_value: override account id -> that record value (status override)', () => {
  const r = s.resolve_value(accts(), 'M', { Phone: 'L1' }, 'Phone');
  assert.equal(r.value, '999');
  assert.equal(r.sourceId, 'L1');
  assert.equal(r.status, 'override');
});

test('resolve_value: master non-blank is kept (value = master)', () => {
  const r = s.resolve_value(accts(), 'M', {}, 'Phone');
  assert.equal(r.value, '111'); // master wins; a differing loser makes this a "conflict" for review
});

test('resolve_value: blank master backfills from first non-blank loser', () => {
  const r = s.resolve_value(accts(), 'M', {}, 'PersonEmail');
  assert.equal(r.value, 'l1@x.com');
  assert.equal(r.status, 'filled');
});

test('resolve_master_fields: overrides resolve to values, blanks backfill, account ids never written', () => {
  const out = s.resolve_master_fields(accts(), 'M', { Phone: 'L1' });
  assert.equal(out.Phone, '999');                    // override -> L1's value
  assert.equal(out.PersonEmail, 'l1@x.com');         // master blank -> backfill
  assert.equal(out.usat_Member_Number__pc, '1001');  // master blank -> backfill
  assert.ok(!Object.values(out).includes('L1'), 'never writes the account id as a value');
});

test('resolve_master_fields: unchanged master field is not written; override to a blank record is skipped', () => {
  const out = s.resolve_master_fields(accts(), 'M', {}); // no overrides
  assert.ok(!('Phone' in out), 'master Phone kept unchanged -> not in the write map');
  const out2 = s.resolve_master_fields(accts(), 'M', { Phone: 'L2' }); // L2 Phone is blank
  assert.ok(!('Phone' in out2), 'override to a record whose value is blank writes nothing');
});
