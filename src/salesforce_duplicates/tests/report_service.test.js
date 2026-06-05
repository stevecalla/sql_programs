/**
 * report_service.test.js — Unit tests for report_service.js (the slash-arg
 * parsing + freshness/force resolution that the Slack server relies on).
 *
 * resolve_report's Salesforce/report dependencies are injected as fakes, so no
 * network or /data access is needed.
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/report_service.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parse_report_args, resolve_report } = require('../report_service');

// A fake "req" — query params + an optional slash-command text body.
function req({ query = {}, text = null } = {}) {
    return { query, body: text == null ? {} : { text } };
}

// Fakes for resolve_report: a report with a given age, a regenerate spy.
function make_deps(age_minutes, window_minutes = 30) {
    const calls = { get: 0, regen: 0 };
    return {
        deps: {
            get_report: async () => {
                calls.get += 1;
                return {
                    counts: { exact: 1, fuzzy_pair: 0, fuzzy_group: 0 },
                    age_minutes,
                    has_output: age_minutes != null,
                };
            },
            regenerate: async () => { calls.regen += 1; },
            window_minutes,
        },
        calls,
    };
}

describe('parse_report_args', () => {
    test('defaults when nothing passed', () => {
        assert.deepEqual(parse_report_args(req()), { mode: 'latest', file: 'all', force: false });
    });

    test('parses mode/file/force from the slash text', () => {
        assert.deepEqual(
            parse_report_args(req({ text: 'mode=run force=true file=exact' })),
            { mode: 'run', file: 'exact', force: true }
        );
    });

    test('force is only true for the literal "true"', () => {
        assert.equal(parse_report_args(req({ text: 'mode=run force=yes' })).force, false);
        assert.equal(parse_report_args(req({ text: 'mode=run force=TRUE' })).force, true);
    });

    test('reads query params too', () => {
        assert.deepEqual(
            parse_report_args(req({ query: { mode: 'run', file: 'fuzzy_pair' } })),
            { mode: 'run', file: 'fuzzy_pair', force: false }
        );
    });
});

describe('resolve_report', () => {
    test('mode=latest never regenerates', async () => {
        const { deps, calls } = make_deps(5);
        const out = await resolve_report({ mode: 'latest', file: 'all', force: false }, deps);
        assert.equal(out.regenerated, false);
        assert.equal(calls.regen, 0);
        assert.equal(calls.get, 1);
    });

    test('mode=run within the window returns latest (no regenerate)', async () => {
        const { deps, calls } = make_deps(5, 30); // 5 min old, window 30
        const out = await resolve_report({ mode: 'run', file: 'all', force: false }, deps);
        assert.equal(out.regenerated, false);
        assert.equal(calls.regen, 0);
    });

    test('mode=run when stale regenerates (and re-reads)', async () => {
        const { deps, calls } = make_deps(40, 30); // 40 min old, window 30 -> stale
        const out = await resolve_report({ mode: 'run', file: 'all', force: false }, deps);
        assert.equal(out.regenerated, true);
        assert.equal(calls.regen, 1);
        assert.equal(calls.get, 2); // read, regenerate, read again
    });

    test('mode=run with force=true regenerates even when fresh', async () => {
        const { deps, calls } = make_deps(2, 30); // brand new, but force
        const out = await resolve_report({ mode: 'run', file: 'all', force: true }, deps);
        assert.equal(out.regenerated, true);
        assert.equal(calls.regen, 1);
    });

    test('mode=run with no output yet regenerates', async () => {
        const { deps, calls } = make_deps(null, 30); // no output -> age null -> stale
        const out = await resolve_report({ mode: 'run', file: 'all', force: false }, deps);
        assert.equal(out.regenerated, true);
        assert.equal(calls.regen, 1);
    });
});
