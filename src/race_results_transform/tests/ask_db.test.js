'use strict';
// Catalog/allowlist for the ask brain (no DB connection — import only).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../metrics/ask/db');
const cfg = require('../metrics/metrics_config');

describe('ask_db (catalog / allowlist)', () => {
  test('allowlists the events table only (v1)', () => {
    assert.equal(db.ALLOWED_TABLES.length, 1);
    assert.ok(db.ALLOWED_TABLES.includes(cfg.TABLE));
    assert.equal(db.is_allowed_table(cfg.TABLE), true);
    assert.equal(db.is_allowed_table('membership_data'), false);
    assert.equal(db.CATALOG[0].name, cfg.TABLE);
  });
});
