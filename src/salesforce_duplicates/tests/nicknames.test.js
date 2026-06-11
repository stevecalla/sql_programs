/**
 * nicknames.test.js — Unit tests for src/nicknames.js (symmetric nickname equivalence).
 *
 * Uses the real `nicknames-curated` dataset. Run from src/salesforce_duplicates via:
 *   node --test tests/nicknames.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { nn_key, are_nickname_equivalents, nickname_reason } = require('../src/nicknames');

describe('nn_key', () => {
    test('lowercases and strips non-letters', () => {
        assert.equal(nn_key('  Bob.  '), 'bob');
        assert.equal(nn_key('Jo-Ann'), 'joann');
        assert.equal(nn_key(''), '');
        assert.equal(nn_key(null), '');
    });
});

describe('are_nickname_equivalents', () => {
    test('classic nickname pairs are equivalent (both directions)', () => {
        assert.equal(are_nickname_equivalents('Bob', 'Robert'), true);
        assert.equal(are_nickname_equivalents('Robert', 'Bob'), true);
        assert.equal(are_nickname_equivalents('Bill', 'William'), true);
        assert.equal(are_nickname_equivalents('Liz', 'Elizabeth'), true);
        assert.equal(are_nickname_equivalents('Mike', 'Michael'), true);
    });

    test('two nicknames of the same root are equivalent (shared canonical)', () => {
        // bob and bobby both reduce to robert; the package does not link them
        // directly, so this exercises the shared-canonical clause.
        assert.equal(are_nickname_equivalents('Bob', 'Bobby'), true);
    });

    test('case and punctuation are ignored', () => {
        assert.equal(are_nickname_equivalents('  bOb ', 'ROBERT'), true);
    });

    test('identical names are NOT a nickname relationship', () => {
        assert.equal(are_nickname_equivalents('Robert', 'robert'), false);
        assert.equal(are_nickname_equivalents('Bob', 'Bob'), false);
    });

    test('empty or unknown names are not equivalent', () => {
        assert.equal(are_nickname_equivalents('', 'Robert'), false);
        assert.equal(are_nickname_equivalents('Robert', ''), false);
        assert.equal(are_nickname_equivalents('Xyzzy', 'Robert'), false);
        assert.equal(are_nickname_equivalents('Robert', 'Zachary'), false);
    });

    test('accepts an injected namer (no real dataset needed)', () => {
        const fake = {
            nicknamesOf: (k) => (k === 'robert' ? new Set(['bob']) : new Set()),
            canonicalsOf: (k) => (k === 'bob' ? new Set(['robert']) : new Set()),
        };
        assert.equal(are_nickname_equivalents('robert', 'bob', fake), true);
        assert.equal(are_nickname_equivalents('robert', 'mike', fake), false);
    });
});

describe('nickname_reason', () => {
    test('explains an equivalent pair', () => {
        const r = nickname_reason('Bob', 'Robert');
        assert.ok(typeof r === 'string' && r.toLowerCase().includes('nickname'));
    });
    test('explains a non-equivalent pair', () => {
        const r = nickname_reason('Bob', 'Zachary');
        assert.ok(r.includes('not nickname-equivalent'));
    });
});
