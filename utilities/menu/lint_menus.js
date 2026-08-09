#!/usr/bin/env node
'use strict';
/**
 * lint_menus.js — validates every module menu.js against the shared conventions so styling / naming /
 * numbering can't drift again. Run:  npm run lint_menus   (exit code 1 on any violation).
 *
 * Checks, per menu:
 *   - exports SECTIONS (non-empty array) + ALL or ALL_ITEMS
 *   - every section has a non-empty label + a non-empty items[]
 *   - NO item hand-writes an `id` (the kit numbers by position — hand-numbering is the drift bug)
 *   - every item has a non-empty label
 *   - every item declares exactly one action (run/bin/open/hit/status/note/info) OR an `action` slug
 *     (slug = dispatched by the menu's own onSelect handler)
 *   - the kit assigns sequential, unique ids 1..N across the flattened list
 *
 * See utilities/menu/menu_kit.js + plans_and_notes/MENU_CONVENTIONS.md.
 */
const path = require('path');
const kit = require('./menu_kit');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Every interactive module menu on the shared kit. Add new menus here.
const MENUS = [
  'src/usat_apps/menu.js',
  'src/usat_apps/modules/participation_maps/menu.js',
  'src/usat_apps/modules/event_coi/menu.js',
  'src/usat_apps/modules/salesforce_merge/menu.js',
  'src/usat_apps/modules/salesforce_email_queue/menu.js',
  'src/usat_apps/modules/chatbot/menu.js',
  'src/salesforce_duplicates/menu.js',
  'src/salesforce_email_queue_proof_of_concept/menu.js',
  'src/event_analysis/menu.js',
  'src/race_results_transform/menu.js',
];

// One declarative action field, or an `action` slug handled by the menu's own onSelect.
const ACTION_FIELDS = ['run', 'bin', 'open', 'hit', 'status', 'note', 'info', 'action'];

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
let total_failures = 0;

for (const rel of MENUS) {
  const problems = [];
  let mod;
  try { mod = require(path.join(REPO_ROOT, rel)); }
  catch (e) { console.log(`${C.r}✗${C.x} ${rel}\n    require failed: ${e.message}`); total_failures++; continue; }

  const SECTIONS = mod.SECTIONS;
  const ALL = mod.ALL || mod.ALL_ITEMS;
  if (!Array.isArray(SECTIONS) || SECTIONS.length === 0) problems.push('missing/empty SECTIONS export');
  if (!Array.isArray(ALL)) problems.push('missing ALL / ALL_ITEMS export');

  if (Array.isArray(SECTIONS)) {
    for (const s of SECTIONS) {
      if (typeof s.label !== 'string' || !s.label.trim()) problems.push(`section missing label: ${JSON.stringify(s.label)}`);
      if (!Array.isArray(s.items) || s.items.length === 0) problems.push(`section "${s.label}" has no items`);
    }
    const flat = SECTIONS.flatMap((s) => (Array.isArray(s.items) ? s.items : []));
    for (const it of flat) {
      const tag = it && it.label ? `"${it.label}"` : JSON.stringify(it);
      if (it && 'id' in it) problems.push(`item ${tag} hand-writes an id — the kit numbers by position`);
      if (!it || typeof it.label !== 'string' || !it.label.trim()) problems.push(`item ${tag} missing label`);
      const actions = ACTION_FIELDS.filter((k) => it && it[k] != null);
      if (actions.length === 0) problems.push(`item ${tag} has no action field (${ACTION_FIELDS.join('/')})`);
    }
    // Numbering: clone so we never mutate the menu's real objects.
    const numbered = kit.assign_ids(SECTIONS.map((s) => ({ ...s, items: (s.items || []).map((it) => ({ ...it })) })));
    const ids = numbered.map((i) => i.id);
    if (!ids.every((v, i) => v === i + 1)) problems.push('kit numbering is not sequential 1..N');
    if (new Set(ids).size !== ids.length) problems.push('kit numbering has duplicates');
  }

  if (problems.length) {
    total_failures += problems.length;
    console.log(`${C.r}✗${C.x} ${rel}`);
    for (const p of problems) console.log(`    ${C.y}- ${p}${C.x}`);
  } else {
    const n = SECTIONS.flatMap((s) => s.items).length;
    console.log(`${C.g}✓${C.x} ${rel} ${C.d}(${n} items)${C.x}`);
  }
}

console.log('');
if (total_failures) { console.log(`${C.r}${total_failures} problem(s) across ${MENUS.length} menus.${C.x}`); process.exit(1); }
console.log(`${C.g}All ${MENUS.length} menus conform to the shared conventions.${C.x}`);
