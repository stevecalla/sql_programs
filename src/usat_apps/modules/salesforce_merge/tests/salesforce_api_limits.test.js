'use strict';
// SF API usage (Phase 1) — parse_limits is pure (jsforce Limits object -> our shape); get_api_limits
// uses an injectable connect so we exercise it without a live org (fake conn.limits()/identity() and
// the conn.request() fallback for jsforce builds without a limits() helper).
const test = require('node:test');
const assert = require('node:assert');
const sfread = require('../store/salesforce_read');

test('parse_limits computes used / pct from Max & Remaining', () => {
  const r = sfread.parse_limits({
    DailyApiRequests: { Max: 100000, Remaining: 73000 },
    DailyBulkApiBatches: { Max: 15000, Remaining: 14990 },
  });
  assert.strictEqual(r.daily_api.max, 100000);
  assert.strictEqual(r.daily_api.remaining, 73000);
  assert.strictEqual(r.daily_api.used, 27000);
  assert.strictEqual(r.daily_api.pct_used, 27);
  assert.strictEqual(r.other.DailyBulkApiBatches.used, 10);
});

test('parse_limits returns nulls when DailyApiRequests is missing/partial', () => {
  const r = sfread.parse_limits({});
  assert.strictEqual(r.daily_api.max, null);
  assert.strictEqual(r.daily_api.used, null);
  assert.strictEqual(r.daily_api.pct_used, null);
  const r2 = sfread.parse_limits({ DailyApiRequests: { Max: 0, Remaining: 0 } });
  assert.strictEqual(r2.daily_api.pct_used, null, 'no divide-by-zero when Max=0');
});

test('get_api_limits uses injected connect + conn.limits() + identity()', async () => {
  const fakeConn = {
    limits: async () => ({ DailyApiRequests: { Max: 50000, Remaining: 40000 } }),
    identity: async () => ({ organization_id: '00Dxx0000001' }),
  };
  const r = await sfread.get_api_limits({ is_test: true, connect: async () => fakeConn });
  assert.strictEqual(r.org_id, '00Dxx0000001');
  assert.strictEqual(r.daily_api.used, 10000);
  assert.strictEqual(r.daily_api.pct_used, 20);
});

test('get_api_limits falls back to conn.request() when limits() is absent', async () => {
  let requested = null;
  const fakeConn = {
    version: '59.0',
    request: async (u) => { requested = u; return { DailyApiRequests: { Max: 10, Remaining: 3 } }; },
    identity: async () => ({ organization_id: 'x' }),
  };
  const r = await sfread.get_api_limits({ is_test: false, connect: async () => fakeConn });
  assert.match(requested, /\/services\/data\/v59\.0\/limits$/);
  assert.strictEqual(r.daily_api.used, 7);
});

test('get_api_limits tolerates identity() failure (org_id null)', async () => {
  const fakeConn = {
    limits: async () => ({ DailyApiRequests: { Max: 100, Remaining: 100 } }),
    identity: async () => { throw new Error('no identity'); },
  };
  const r = await sfread.get_api_limits({ is_test: true, connect: async () => fakeConn });
  assert.strictEqual(r.org_id, null);
  assert.strictEqual(r.daily_api.used, 0);
  assert.strictEqual(r.daily_api.pct_used, 0);
});
