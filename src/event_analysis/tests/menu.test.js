/**
 * menu.test.js — Verifies the interactive menu's structure and wiring.
 *
 * Doesn't spawn the readline loop — just imports menu.js's exports and
 * inspects them. Cheap (no I/O), runs in milliseconds, and catches the
 * three most common regressions when adding menu items:
 *
 *   1. Duplicate id (two items share the same number — the second is
 *      unreachable).
 *   2. Action name typo'd or removed (the handle_action switch will fall
 *      through to the default and print "Unknown action").
 *   3. Test items dropped or renamed (the test-runner menu only handles
 *      run_tests_all / overrides / server / menu / smoke).
 *
 * Run via:
 *   node --test tests/menu.test.js
 *   node --test tests/                # included in 'Run ALL tests'
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs   = require('fs');

const { SECTIONS, ALL_ITEMS } = require('../menu');

// ── Sanity: shape ──────────────────────────────────────────────────────────

describe('menu.js — structure', () => {
  test('SECTIONS is a non-empty array', () => {
    assert.ok(Array.isArray(SECTIONS));
    assert.ok(SECTIONS.length >= 1);
  });

  test('every section has label + color + items[]', () => {
    for (const s of SECTIONS) {
      assert.ok(typeof s.label === 'string' && s.label.length > 0, `section missing label: ${JSON.stringify(s)}`);
      assert.ok(typeof s.color === 'string' && s.color.length > 0, `section missing color: ${s.label}`);
      assert.ok(Array.isArray(s.items) && s.items.length > 0,      `section ${s.label} has no items`);
    }
  });

  test('every item has id + label + desc + action', () => {
    for (const it of ALL_ITEMS) {
      assert.equal(typeof it.id,     'number', `bad id: ${JSON.stringify(it)}`);
      assert.equal(typeof it.label,  'string', `bad label: ${JSON.stringify(it)}`);
      assert.equal(typeof it.desc,   'string', `bad desc: ${JSON.stringify(it)}`);
      assert.equal(typeof it.action, 'string', `bad action: ${JSON.stringify(it)}`);
      assert.ok(it.id >= 1,              `id must be >= 1: ${JSON.stringify(it)}`);
      assert.ok(it.label.trim().length,  `label must be non-empty: ${JSON.stringify(it)}`);
      assert.ok(it.action.trim().length, `action must be non-empty: ${JSON.stringify(it)}`);
    }
  });
});

// ── Uniqueness: ids and actions ────────────────────────────────────────────

describe('menu.js — uniqueness', () => {
  test('all ids are unique', () => {
    const ids = ALL_ITEMS.map(i => i.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dupes, [], `duplicate ids: ${dupes.join(', ')}`);
  });

  test('all actions are unique', () => {
    const actions = ALL_ITEMS.map(i => i.action);
    const dupes = actions.filter((a, i) => actions.indexOf(a) !== i);
    assert.deepEqual(dupes, [], `duplicate actions: ${dupes.join(', ')}`);
  });
});

// ── Coverage: known actions must remain wired ──────────────────────────────

describe('menu.js — known actions', () => {
  // Adding a NEW action? Add it here too so its disappearance becomes a
  // test failure rather than a silent break.
  const REQUIRED_ACTIONS = [
    'build', 'build_rule_based', 'check',
    'open_dashboard', 'open_excel', 'open_pptx',
    'list_overrides', 'suggest_overrides',
    'add_match', 'add_no_match', 'add_segment', 'remove_override',
    'ask', 'ask_save', 'update_commentary', 'what_changed',
    'view_changes', 'view_notes', 'view_readme',
    'start_server',
    'run_tests_all', 'run_tests_overrides', 'run_tests_server',
    'run_tests_menu', 'run_tests_smoke', 'run_tests_glossary',
  ];

  test('every REQUIRED_ACTIONS entry is present in the menu', () => {
    const actions = new Set(ALL_ITEMS.map(i => i.action));
    const missing = REQUIRED_ACTIONS.filter(a => !actions.has(a));
    assert.deepEqual(missing, [], `menu actions removed: ${missing.join(', ')}`);
  });

  test('Build (rule-based) is wired and sits in BUILD section', () => {
    const build_section = SECTIONS.find(s => s.label.startsWith('BUILD'));
    assert.ok(build_section, 'BUILD section not found');
    const item = build_section.items.find(i => i.action === 'build_rule_based');
    assert.ok(item, 'build_rule_based action missing from BUILD section');
    assert.match(item.label, /rule-based/i);
  });

  test('Test-runner items live in TESTING section', () => {
    const testing = SECTIONS.find(s => s.label.startsWith('TESTING'));
    assert.ok(testing, 'TESTING section not found');
    const test_actions = testing.items.map(i => i.action);
    for (const a of ['run_tests_all','run_tests_overrides','run_tests_server','run_tests_menu','run_tests_smoke','run_tests_glossary']) {
      assert.ok(test_actions.includes(a), `${a} not in TESTING section`);
    }
  });
});

// ── Sanity: each test action points to a test file that exists ─────────────

describe('menu.js — test files exist', () => {
  const TESTS_DIR = path.join(__dirname);

  const cases = [
    { action: 'run_tests_overrides', file: 'overrides.test.js' },
    { action: 'run_tests_server',    file: 'server.test.js' },
    { action: 'run_tests_menu',      file: 'menu.test.js' },
    { action: 'run_tests_smoke',     file: 'smoke.test.js' },
    { action: 'run_tests_glossary',  file: 'glossary.test.js' },
  ];

  for (const c of cases) {
    test(`${c.action} → tests/${c.file} exists`, () => {
      assert.ok(fs.existsSync(path.join(TESTS_DIR, c.file)), `missing ${c.file}`);
    });
  }
});
