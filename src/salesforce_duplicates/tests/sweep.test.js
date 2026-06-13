/**
 * sweep.test.js — Unit tests for src/sweep.js (criteria tuning engine).
 *
 * Pure engine, no Salesforce / no files. Run from src/salesforce_duplicates via:
 *   node --test tests/sweep.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    BASELINE_CRITERIA,
    expand_grid,
    run_profile,
    diff_profiles,
    fields_abbrev,
    trim_zip,
} = require('../src/sweep');

function rec(id, first, last, extra = {}) {
    return {
        Id: id,
        FirstName: first,
        LastName: last,
        cfg_Gender_Identity__pc: 'Male',
        PersonBirthdate: '1990-01-01',
        BillingPostalCode: '80301',
        PersonMailingPostalCode: '',
        ...extra,
    };
}

// A small, deterministic pool exercising exact / fuzzy / nickname signals.
function pool() {
    return [
        rec('1', 'Robert', 'Smith'),                              // exact dup of 2
        rec('2', 'Robert', 'Smith'),
        rec('3', 'Bob', 'Smith'),                                 // nickname of Robert
        rec('4', 'Robbert', 'Smith'),                             // fuzzy of Robert
        rec('5', 'William', 'Jones', { BillingPostalCode: '99999' }),
        rec('6', 'Bill', 'Jones', { BillingPostalCode: '99999' }), // nickname of William
        rec('7', 'Mike', 'Vale', { PersonBirthdate: '' }),         // ineligible (no DOB)
    ];
}

describe('trim_zip', () => {
    test('len 5 keeps first five digits', () => {
        assert.equal(trim_zip('80919-1234', 5), '80919');
        assert.equal(trim_zip('80919', 5), '80919');
    });
    test('len 0/null returns the full trimmed value', () => {
        assert.equal(trim_zip('80919-1234', 0), '80919-1234');
        assert.equal(trim_zip('  80919-1234 ', null), '80919-1234');
    });
    test('non-US codes pass through', () => {
        assert.equal(trim_zip('K1A 0B1', 5), 'K1A 0B1');
    });
});

describe('fields_abbrev', () => {
    test('canonical order g/b/z regardless of input order', () => {
        assert.equal(fields_abbrev(['zip', 'gender', 'birthdate']), 'gbz');
        assert.equal(fields_abbrev(['gender', 'birthdate']), 'gb');
        assert.equal(fields_abbrev(['birthdate', 'zip']), 'bz');
        assert.equal(fields_abbrev([]), 'none');
    });
});

describe('expand_grid', () => {
    test('baseline is always first and flagged', () => {
        const profiles = expand_grid({});
        assert.equal(profiles[0].is_baseline, true);
        assert.equal(profiles[0].label, 'baseline');
    });

    test('cartesian product size, baseline de-duplicated', () => {
        const profiles = expand_grid({
            fuzzy_threshold: [88, 90, 92],
            nickname_enabled: [true, false],
            rule_fields: [['gender', 'birthdate', 'zip'], ['gender', 'birthdate'], ['birthdate', 'zip']],
        });
        // 3 * 2 * 3 = 18 combos; the 90/ON/gbz combo equals the baseline, so it is
        // not added twice -> 18 total (baseline + 17 unique others).
        assert.equal(profiles.length, 18);
        const labels = profiles.map((p) => p.label);
        assert.equal(new Set(labels).size, labels.length); // all labels unique
    });
});

describe('run_profile — funnel + signal counts', () => {
    const records = pool();

    test('baseline: exact/fuzzy/nickname counts and funnel', () => {
        const r = run_profile(records, { ...BASELINE_CRITERIA, label: 'baseline' });
        const k = r.counts;
        assert.equal(k.total_records, 7);
        assert.equal(k.eligible_records, 6);          // record 7 missing DOB
        assert.equal(k.exact_groups, 1);              // the two Roberts
        assert.equal(k.exact_records, 2);
        assert.ok(k.fuzzy_pairs >= 1);                // Robbert ~ Robert
        assert.ok(k.nickname_pairs >= 2);             // Bob~Robert, Bill~William
        assert.ok(k.consolidated_clusters >= 2);
    });

    test('nickname OFF drops nickname pairs to zero and shrinks clusters', () => {
        const on = run_profile(records, { ...BASELINE_CRITERIA, label: 'on' });
        const off = run_profile(records, { ...BASELINE_CRITERIA, nickname_enabled: false, label: 'off' });
        assert.ok(on.counts.nickname_pairs > 0);
        assert.equal(off.counts.nickname_pairs, 0);
        assert.ok(off.counts.consolidated_clusters <= on.counts.consolidated_clusters);
    });

    test('higher threshold yields fewer-or-equal fuzzy pairs', () => {
        const low = run_profile(records, { ...BASELINE_CRITERIA, fuzzy_threshold: 88, label: 'low' });
        const high = run_profile(records, { ...BASELINE_CRITERIA, fuzzy_threshold: 99, label: 'high' });
        assert.ok(high.counts.fuzzy_pairs <= low.counts.fuzzy_pairs);
    });

    test('dropping ZIP from rule_fields widens the comparison (more pairs compared)', () => {
        const withZip = run_profile(records, { ...BASELINE_CRITERIA, label: 'z' });
        const noZip = run_profile(records, { ...BASELINE_CRITERIA, rule_fields: ['gender', 'birthdate'], label: 'noz' });
        assert.ok(noZip.counts.pairs_compared >= withZip.counts.pairs_compared);
    });

    test('nickname breakdown: only + both sums to total', () => {
        const r = run_profile(records, { ...BASELINE_CRITERIA, label: 'b' });
        assert.equal(r.counts.nickname_only + r.counts.nickname_both, r.counts.nickname_pairs);
    });
});

describe('diff_profiles', () => {
    test('baseline vs nickname-off: removed nickname edges, none added', () => {
        const records = pool();
        const base = run_profile(records, { ...BASELINE_CRITERIA, label: 'base' });
        const off = run_profile(records, { ...BASELINE_CRITERIA, nickname_enabled: false, label: 'off' });
        const d = diff_profiles(base.edges, off.edges);
        assert.equal(d.only_in_b, 0);     // nothing new when removing a signal
        assert.ok(d.only_in_a > 0);       // baseline had nickname edges off-profile lacks
        assert.ok(d.common >= 1);         // exact + fuzzy edges shared
    });

    test('identical edge sets diff to all-common', () => {
        const records = pool();
        const a = run_profile(records, { ...BASELINE_CRITERIA, label: 'a' });
        const b = run_profile(records, { ...BASELINE_CRITERIA, label: 'b' });
        const d = diff_profiles(a.edges, b.edges);
        assert.equal(d.only_in_a, 0);
        assert.equal(d.only_in_b, 0);
    });
});


describe('engine parity: in-memory records vs DB-round-tripped records', () => {
    const { COLUMNS, to_snapshot_row, record_from_row } = require('../src/database_snapshot');

    test('run_profile gives identical counts after a load->read round-trip', () => {
        const records = pool();
        // simulate: record -> stored row -> SELECTed object -> record
        const dbRecords = records.map((r) => {
            const row = to_snapshot_row(r);
            const o = {};
            COLUMNS.forEach((col, i) => { o[col] = row[i]; });
            return record_from_row(o);
        });
        const a = run_profile(records, { ...BASELINE_CRITERIA, label: 'orig' }).counts;
        const b = run_profile(dbRecords, { ...BASELINE_CRITERIA, label: 'db' }).counts;
        assert.deepEqual(b, a);
    });
});
