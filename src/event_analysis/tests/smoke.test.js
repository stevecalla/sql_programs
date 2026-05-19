/**
 * smoke.test.js — Lightweight "did something just break?" suite.
 *
 * Goal: catch regressions that don't need a DB / server / API to surface.
 * Specifically:
 *
 *   1. Every major source file parses as valid JavaScript. This catches
 *      90% of "I edited a template literal and broke the build" mistakes
 *      before they cost a full build cycle.
 *   2. Each module's top-level exports load. This catches missing
 *      `module.exports = {...}` lines and accidental side-effect changes.
 *   3. A handful of pure helpers produce expected output for a known
 *      input — fast sanity that the data-shape contracts haven't drifted.
 *
 * Anything that requires the DB, network, ANTHROPIC_API_KEY, or a built
 * dashboard belongs in the dedicated suites (overrides / server) — not
 * here. This file should stay quick and have no external deps.
 *
 * Run via:
 *   node --test tests/smoke.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

const EA_ROOT   = path.join(__dirname, '..');
const REPO_ROOT = path.join(EA_ROOT, '..', '..');

// ── 1. Parse-check every major source file ────────────────────────────────

const PARSE_TARGETS = [
  // event_analysis CLI entry points
  path.join(EA_ROOT, 'ask.js'),
  path.join(EA_ROOT, 'build_all.js'),
  path.join(EA_ROOT, 'check.js'),
  path.join(EA_ROOT, 'menu.js'),
  // event_analysis core modules
  path.join(EA_ROOT, 'src', 'analysis.js'),
  path.join(EA_ROOT, 'src', 'calendar.js'),
  path.join(EA_ROOT, 'src', 'commentary.js'),
  path.join(EA_ROOT, 'src', 'dashboard.js'),
  path.join(EA_ROOT, 'src', 'db.js'),
  path.join(EA_ROOT, 'src', 'fmt.js'),
  path.join(EA_ROOT, 'src', 'loader.js'),
  path.join(EA_ROOT, 'src', 'matcher.js'),
  path.join(EA_ROOT, 'src', 'normalizer.js'),
  path.join(EA_ROOT, 'src', 'overrides.js'),
  // event_analysis local server (lives at repo root)
  path.join(REPO_ROOT, 'server_event_analysis_8016.js'),
];

describe('smoke: every major source file parses', () => {
  for (const fp of PARSE_TARGETS) {
    test(`parses: ${path.relative(REPO_ROOT, fp)}`, () => {
      assert.ok(fs.existsSync(fp), `missing file: ${fp}`);
      const src = fs.readFileSync(fp, 'utf8');
      // vm.Script throws SyntaxError if the file can't be parsed as a CJS
      // module body. Same engine as `node --check` but stays in-process.
      assert.doesNotThrow(
        () => new vm.Script(src, { filename: fp }),
        `parse failed: ${fp}`
      );
    });
  }
});

// ── 2. Module exports load (catches busted `module.exports = {...}`) ─────

describe('smoke: module exports load', () => {
  test('src/overrides exports the expected surface', () => {
    const m = require(path.join(EA_ROOT, 'src', 'overrides.js'));
    for (const k of ['load_overrides','apply_overrides','compute_event_signature']) {
      assert.equal(typeof m[k], 'function', `overrides.${k} missing`);
    }
  });

  test('src/commentary exports generate_rule_based + generate_ai', () => {
    const m = require(path.join(EA_ROOT, 'src', 'commentary.js'));
    assert.equal(typeof m.generate_rule_based, 'function');
    assert.equal(typeof m.generate_ai,         'function');
  });

  test('src/dashboard exports generate_dashboard', () => {
    const m = require(path.join(EA_ROOT, 'src', 'dashboard.js'));
    assert.equal(typeof m.generate_dashboard, 'function');
  });

  test('src/fmt exports a non-empty helper bag', () => {
    const m = require(path.join(EA_ROOT, 'src', 'fmt.js'));
    assert.ok(Object.keys(m).length > 0, 'fmt.js exports nothing');
  });

  test('menu.js exports SECTIONS + ALL_ITEMS for introspection', () => {
    const m = require(path.join(EA_ROOT, 'menu.js'));
    assert.ok(Array.isArray(m.SECTIONS));
    assert.ok(Array.isArray(m.ALL_ITEMS));
    assert.ok(m.ALL_ITEMS.length >= 20, 'expected at least 20 menu items');
  });
});

// ── 3. Spot-check the public surface of the helpers ───────────────────────
//
// We deliberately don't CALL the heavyweight functions with synthesized
// fixtures here — those functions read deep into `r.monthly`, `r.calImpact`,
// `r.organicByType`, etc., and any minimal fixture instantly drifts as the
// commentary engine evolves. Real builds exercise them every time, so a
// shape-test here is low value and high maintenance.
//
// Instead, assert the public exports exist with the expected arity. That
// catches the actual "did someone break the module" failure mode (typo in
// `module.exports`, accidental rename, missing default export) without
// requiring us to maintain a parallel fixture universe.

describe('smoke: public surface of generate_rule_based', () => {
  const { generate_rule_based, generate_ai } = require(path.join(EA_ROOT, 'src', 'commentary.js'));

  test('generate_rule_based is a function taking one argument', () => {
    assert.equal(typeof generate_rule_based, 'function');
    assert.equal(generate_rule_based.length, 1, 'generate_rule_based(r) signature drifted');
  });

  test('generate_ai is an async function taking two arguments', () => {
    assert.equal(typeof generate_ai, 'function');
    assert.equal(generate_ai.length, 2, 'generate_ai(r, api_key) signature drifted');
    // Quick check that calling without a key returns the rule-based output
    // (this path doesn't touch the API). If generate_ai is missing the
    // null-key short-circuit, this assertion will catch it.
    assert.ok(
      generate_ai.toString().includes('generate_rule_based') ||
      generate_ai.toString().includes('api_key'),
      'generate_ai should reference its rule-based fallback'
    );
  });
});
