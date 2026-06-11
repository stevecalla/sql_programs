/**
 * config.test.js — run-mode flag resolvers.
 * Run: node --test tests/config.test.js
 */
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolve_is_test, resolve_is_full, resolve_is_partial, resolve_fetch_plan } = require('../config');

describe('resolve_is_test', () => {
    test('--test => true, --prod => false, default => false', () => {
        assert.equal(resolve_is_test(['node', 'x', '--test']), true);
        assert.equal(resolve_is_test(['node', 'x', '--prod']), false);
        assert.equal(resolve_is_test(['node', 'x']), false);
    });
});

describe('resolve_is_full', () => {
    test('--full => true, otherwise false', () => {
        assert.equal(resolve_is_full(['node', 'x', '--test', '--full']), true);
        assert.equal(resolve_is_full(['node', 'x', '--full']), true);
        assert.equal(resolve_is_full(['node', 'x', '--test']), false);
        assert.equal(resolve_is_full(['node', 'x']), false);
    });
});

describe('resolve_is_partial', () => {
    test('--partial => true, otherwise false', () => {
        assert.equal(resolve_is_partial(['node', 'x', '--prod', '--partial']), true);
        assert.equal(resolve_is_partial(['node', 'x', '--partial']), true);
        assert.equal(resolve_is_partial(['node', 'x', '--prod']), false);
        assert.equal(resolve_is_partial(['node', 'x']), false);
    });
});

describe('resolve_fetch_plan', () => {
    test('maps each run mode to the right cap + fetch path', () => {
        assert.deepEqual(resolve_fetch_plan(true, false, false),  { max_fetch: 5000,    use_rest: true,  use_bulk: false, ordered: true });   // --test
        assert.deepEqual(resolve_fetch_plan(true, true, false),   { max_fetch: 1000000, use_rest: false, use_bulk: true,  ordered: false });  // --test --full
        assert.deepEqual(resolve_fetch_plan(false, false, true),  { max_fetch: 5000,    use_rest: true,  use_bulk: false, ordered: false });  // --prod --partial
        assert.deepEqual(resolve_fetch_plan(false, false, false), { max_fetch: 1000000, use_rest: false, use_bulk: true,  ordered: false });  // --prod
    });
});
