/**
 * ids.test.js — Unit tests for src/ids.js (run id, hash, external id).
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/ids.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { make_run_id, make_hash, make_external_id } = require('../src/ids');

describe('make_run_id', () => {
    test('formats UTC date as duplicate_run_YYYY_MM_DD_HHMMSS', () => {
        assert.equal(
            make_run_id(new Date('2026-06-04T14:30:05Z')),
            'duplicate_run_2026_06_04_143005'
        );
    });
});

describe('make_hash', () => {
    test('is a 40-char sha1 hex and deterministic', () => {
        const h = make_hash('hello');
        assert.match(h, /^[0-9a-f]{40}$/);
        assert.equal(h, make_hash('hello'));
    });
    test('differs for different inputs; null hashes like empty string', () => {
        assert.notEqual(make_hash('a'), make_hash('b'));
        assert.equal(make_hash(null), make_hash(''));
    });
});

describe('make_external_id', () => {
    test('joins run_id | match_type | hash(value)', () => {
        const ext = make_external_id('R1', 'exact_group', 'key-123');
        const parts = ext.split('|');
        assert.equal(parts.length, 3);
        assert.equal(parts[0], 'R1');
        assert.equal(parts[1], 'exact_group');
        assert.equal(parts[2], make_hash('key-123'));
    });
});
