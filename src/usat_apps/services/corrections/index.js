'use strict';
// Operator corrections — DB-backed, scope-aware (me | queue | global; extensible to an embed-key scope
// for the chatbot). Storage is INJECTED (a { insert, all } store) so the scope logic stays pure and is
// unit-tested with no database; production uses the MySQL store in ./mysql_store.js.

function make_record(entry) {
  const e = entry || {};
  const note = String(e.note || '').trim();
  if (!note) return null;
  return {
    id: Date.now() + '-' + Math.floor(Math.random() * 1000),
    created_at: new Date().toISOString(),
    active: 1,
    scope: e.scope || 'global',
    author: e.author || '',
    queue: e.queue || '',
    case_id: e.case_id || '',
    question: e.question || '',
    note: note
  };
}

// Pure scope filter. opts: { queue, user }.
function filter_scope(rows, opts) {
  opts = opts || {};
  return (rows || []).filter(function (r) {
    const scope = r.scope || 'global';
    if (scope === 'me') return !opts.user || r.author === opts.user;
    if (scope === 'queue') return !opts.queue || !r.queue || r.queue === opts.queue;
    return true; // global
  });
}
function format_lines(rows, n) {
  return (rows || []).slice(-(Number(n) || 12)).map(function (r) {
    return r.note + (r.question ? '  (re: ' + String(r.question).slice(0, 80) + ')' : '');
  });
}

async function add(entry, store) {
  const rec = make_record(entry);
  if (!rec) return null;
  await store.insert(rec);
  return rec;
}
async function list(store, active_only) {
  const rows = await store.all();
  return active_only === false ? rows : rows.filter(function (r) { return r.active; });
}
async function grounding_lines(store, n, opts) {
  const rows = await list(store, true);
  return format_lines(filter_scope(rows, opts), n);
}

module.exports = { add, list, grounding_lines, make_record, filter_scope, format_lines };
