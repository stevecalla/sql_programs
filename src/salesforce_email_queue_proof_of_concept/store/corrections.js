'use strict';
// Operator corrections store (in-memory + JSON file). Active corrections are injected into the AI
// grounding so future drafts honor them. scope is 'me' | 'queue' | 'global':
//   me     -> applies only to that operator's drafts (matched by author)
//   queue  -> applies to all users, but only on that queue
//   global -> applies to all users on every queue
// File path override via EQ_CORRECTIONS_FILE for tests.
const fs = require('fs');
const path = require('path');
const data_dir = require('../data_dir');
// Corrections live OUTSIDE the repo: <determineOSPath()>/usat_email_queue/corrections.json (override:
// EQ_CORRECTIONS_FILE). Slated to move to a DB table (see plans_and_notes/path_to_production.md, Track C).
const FILE = process.env.EQ_CORRECTIONS_FILE || data_dir.file_sync('corrections.json');

let _items = null;
function load() {
  if (_items) return _items;
  try { _items = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!Array.isArray(_items)) _items = []; }
  catch (e) { _items = []; }
  return _items;
}
function save() { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(load(), null, 2) + '\n'); } catch (e) { /* ignore */ } }

function add(e) {
  const items = load();
  const note = String((e && e.note) || '').trim();
  if (!note) return null;
  const rec = {
    id: Date.now() + '-' + Math.floor(Math.random() * 1000),
    created_at: new Date().toISOString(),
    active: 1,
    scope: (e && e.scope) || 'global',
    author: (e && e.author) || '',
    queue: (e && e.queue) || '',
    case_id: (e && e.case_id) || '',
    question: (e && e.question) || '',
    note: note
  };
  items.push(rec); save(); return rec;
}
function list(active_only) { return load().filter(function (r) { return active_only === false || r.active; }); }

// scope-aware. opts: { queue, user }. With no opts, returns all active (back-compat).
function grounding_lines(n, opts) {
  opts = opts || {};
  const filtered = list(true).filter(function (r) {
    const scope = r.scope || 'global';
    if (scope === 'me') return !opts.user || r.author === opts.user;
    if (scope === 'queue') return !opts.queue || !r.queue || r.queue === opts.queue;
    return true; // global
  });
  return filtered.slice(-(Number(n) || 12)).map(function (r) {
    return r.note + (r.question ? '  (re: ' + String(r.question).slice(0, 80) + ')' : '');
  });
}
function _reset() { _items = []; }

module.exports = { add, list, grounding_lines, _reset };
