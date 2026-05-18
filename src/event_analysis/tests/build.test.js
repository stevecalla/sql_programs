/**
 * build.test.js — Coverage for the build pipeline's cache + hash logic.
 *
 * The expensive part of a build is the AI commentary call (~70s). To avoid
 * re-spending tokens when nothing material changed, build_all.js hashes a
 * whitelist of fields and reuses the prior commentary.json on hash-match.
 * This suite verifies the contract:
 *
 *   1. Hash STABILITY — same fixture twice produces the same hash.
 *   2. Hash SENSITIVITY — touching a whitelisted field (segments, by_type,
 *      monthly aggregates, organic, calendar impact, override count, year
 *      scope, NO_AI flag) changes the hash.
 *   3. Hash INSENSITIVITY — touching a non-whitelisted field (event names,
 *      sanction IDs, confidence scores, day-of-week) does NOT change the
 *      hash. This is what protects you from "I fixed a typo, re-ran the
 *      build, why did it just spend 70s on Claude?"
 *   4. Cache loader — returns null on missing file, parsed JSON on valid
 *      file, null on malformed JSON.
 *
 * Doesn't actually run build_all.js or call Claude — just tests the pure
 * helpers exported from build_all.js. Cheap, no DB, no API key required.
 *
 * Run via:
 *   node --test tests/build.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { compute_commentary_input_hash, try_load_cached_commentary } = require('../build_all');

// ── Fixture builder ─────────────────────────────────────────────────────────
//
// Returns a fresh results-shaped object every call so tests can mutate one
// field at a time and re-hash. Keeps the shape close to what run_analysis()
// actually produces — close enough for the whitelist to evaluate
// realistically without dragging in the full analysis dependency.

function make_fixture() {
  return {
    years: { BASELINE_YEAR: 2025, ANALYSIS_YEAR: 2026 },
    segSummary: {
      Retained: 746, Shifted: 124, Lost: 297, New: 268, Recovered: 31, 'Tried to Return': 13,
    },
    typeAnnual: {
      'Adult Race':   { n_baseline: 800, n_analysis: 780, delta: -20 },
      'Youth Race':   { n_baseline: 200, n_analysis: 210, delta: 10 },
      'Adult Clinic': { n_baseline: 100, n_analysis: 95,  delta: -5 },
      'Youth Clinic': { n_baseline:  78, n_analysis:  81, delta: 3 },
    },
    monthly: {
      1: { n_baseline: 12, n_analysis: 14, netDelta:  2, netShift: 0, attr: 3 },
      2: { n_baseline: 18, n_analysis: 17, netDelta: -1, netShift: 0, attr: 4 },
      5: { n_baseline: 80, n_analysis: 70, netDelta: -10, netShift: 1, attr: 12 },
    },
    organicByType: {
      'Adult Race':   { orgTotal: -15, tot25: 800 },
      'Youth Race':   { orgTotal:   8, tot25: 200 },
    },
    calImpact: [
      { calTotal: -2, orgTotal: -8 },   // Jan
      { calTotal:  0, orgTotal: -1 },   // Feb
    ],
    override_summary: { total_applied: 7, applied: [], warnings: [] },

    // Fields below are deliberately NOT in the whitelist — they exist in
    // real results but should NEVER affect the hash. The "insensitivity"
    // tests mutate these and expect the hash to stay the same.
    roster_events: [
      { name: 'Alpha Win Sarasota FL', sanctionId: '311655-Adult Race', conf: 'Exact', day: 'Sat' },
      { name: 'Eighth Annual Du It By The Bay', sanctionId: '310848-Adult Race', conf: 'Exact', day: 'Sat' },
    ],
    match_records: [{ score: 0.97, df: 1 }],
    generated_at: '2026-05-18T19:56:16Z',
  };
}

// ── 1. Hash stability ──────────────────────────────────────────────────────

describe('build: commentary hash — stability', () => {

  test('same fixture produces the same hash on repeated calls', () => {
    const a = compute_commentary_input_hash(make_fixture(), false);
    const b = compute_commentary_input_hash(make_fixture(), false);
    assert.equal(a, b, 'identical fixtures must hash identically');
    assert.match(a, /^[0-9a-f]{64}$/, 'expected a SHA256 hex digest (64 hex chars)');
  });

  test('hash is a 64-char hex string (SHA256)', () => {
    const h = compute_commentary_input_hash(make_fixture(), false);
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]+$/);
  });
});

// ── 2. Hash sensitivity (whitelisted fields) ───────────────────────────────

describe('build: commentary hash — sensitivity to whitelisted fields', () => {

  // Each test mutates exactly one whitelisted field and asserts the hash
  // changes. If any of these silently produces the same hash, the cache
  // would serve stale commentary — the exact failure we built this to
  // prevent.

  test('segment count change → hash changes', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.segSummary.Lost += 1;   // 297 → 298
    assert.notEqual(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false),
      'a 1-event segment shift must invalidate the cache'
    );
  });

  test('year scope change → hash changes', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.years.ANALYSIS_YEAR = 2027;
    assert.notEqual(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('type delta change → hash changes', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.typeAnnual['Adult Race'].delta = -30;   // was -20
    assert.notEqual(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('monthly netDelta change → hash changes', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.monthly[5].netDelta = -15;   // was -10
    assert.notEqual(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('organic-by-type change → hash changes', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.organicByType['Adult Race'].orgTotal = -25;
    assert.notEqual(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('calendar impact change → hash changes', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.calImpact[0].calTotal = -5;
    assert.notEqual(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('override-count change → hash changes', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.override_summary.total_applied = 8;
    assert.notEqual(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('NO_AI flag flip → hash changes (rule-based vs AI cache cannot collide)', () => {
    const fixture = make_fixture();
    assert.notEqual(
      compute_commentary_input_hash(fixture, false),
      compute_commentary_input_hash(fixture, true),
      'NO_AI=1 must produce a different cache key than NO_AI off'
    );
  });
});

// ── 3. Hash insensitivity (non-whitelisted fields) ─────────────────────────

describe('build: commentary hash — insensitivity to non-whitelisted fields', () => {

  // These are the changes that should NEVER invalidate the cache. If the
  // hash flips because of a non-whitelisted field, you'd burn 70s of AI
  // tokens for nothing — exactly what this suite exists to catch.

  test('event-name change in roster → hash UNCHANGED', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.roster_events[0].name = 'Alpha Win Sarasota Florida';   // typo fix
    assert.equal(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false),
      'event-name typo fixes must not invalidate the commentary cache'
    );
  });

  test('sanction-ID renumbering → hash UNCHANGED', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.roster_events[0].sanctionId = '311655-Adult Race RENAMED';
    assert.equal(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('confidence-score drift in a match record → hash UNCHANGED', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.match_records[0].score = 0.99;
    assert.equal(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('day-of-week change on a roster event → hash UNCHANGED', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.roster_events[0].day = 'Sun';
    assert.equal(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false)
    );
  });

  test('different generated_at timestamp → hash UNCHANGED', () => {
    const base    = make_fixture();
    const mutated = make_fixture();
    mutated.generated_at = '2027-01-01T00:00:00Z';
    assert.equal(
      compute_commentary_input_hash(base, false),
      compute_commentary_input_hash(mutated, false),
      'rebuilding 5 seconds later should never invalidate the cache'
    );
  });
});

// ── 4. Cache loader ─────────────────────────────────────────────────────────

describe('build: try_load_cached_commentary', () => {

  test('returns null when commentary.json is missing', () => {
    // Use a fresh tmp dir guaranteed to be empty.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-test-empty-'));
    try {
      assert.equal(try_load_cached_commentary(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns parsed JSON when commentary.json is valid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-test-valid-'));
    try {
      const payload = { _input_hash: 'abc', mode: 'ai_claude', slide_1_subtitle: 'hi' };
      fs.writeFileSync(path.join(dir, 'commentary.json'), JSON.stringify(payload));
      const loaded = try_load_cached_commentary(dir);
      assert.ok(loaded);
      assert.equal(loaded._input_hash, 'abc');
      assert.equal(loaded.mode, 'ai_claude');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns null on malformed JSON (does not throw)', () => {
    // The cache loader must NEVER throw — a corrupted commentary.json
    // should degrade to "no cache" and let the build run AI fresh, not
    // crash the whole build.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-test-malformed-'));
    try {
      fs.writeFileSync(path.join(dir, 'commentary.json'), '{ not valid json');
      assert.equal(try_load_cached_commentary(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
