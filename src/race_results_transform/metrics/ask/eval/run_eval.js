'use strict';
// Live-eval harness (review + record). Requires an API key (OPENAI_API_KEY or
// ANTHROPIC_API_KEY) and a reachable analytics DB; otherwise returns {skipped:true}.
// Writes a timestamped markdown report under the data dir and returns a summary.
const fs = require('fs');
const path = require('path');
const { ask } = require('../ask');
const { SCENARIOS } = require('./scenarios');

function has_key(provider) {
  if (provider === 'anthropic' || provider === 'claude') return !!process.env.ANTHROPIC_API_KEY;
  return !!process.env.OPENAI_API_KEY;
}

async function run_eval(opts) {
  opts = opts || {};
  const provider = opts.provider || 'openai';
  const model = opts.model || null;
  if (!has_key(provider)) return { skipped: true, reason: 'no API key for provider ' + provider };

  const results = [];
  for (const sc of SCENARIOS) {
    const turns = [];
    let history = [];
    let ok = true, note = '';
    for (const t of sc.turns) {
      let r;
      try {
        r = await ask(t.q, { provider: provider, model: model, corrections: sc.correction || null, history: history.slice(-4) });
      } catch (e) { ok = false; note = 'ask threw: ' + e.message; turns.push({ q: t.q, error: e.message }); break; }
      const passed_sql = t.expect_sql ? t.expect_sql.test(r.sql || '') : true;
      const passed_mode = t.expect_mode ? (r.mode === t.expect_mode) : true;
      if (!passed_sql || !passed_mode) ok = false;
      turns.push({ q: t.q, sql: r.sql || null, mode: r.mode || null, answer: (r.answer || '').slice(0, 200),
        expect_sql: t.expect_sql ? String(t.expect_sql) : null, expect_mode: t.expect_mode || null,
        passed: passed_sql && passed_mode });
      history.push({ q: t.q, sql: r.sql || null, answer: r.answer || '' });
    }
    results.push({ id: sc.id, kind: sc.kind, why: sc.why, ok: ok, note: note, turns: turns });
  }

  const passed = results.filter(function (r) { return r.ok; }).length;
  const report = render_report(provider, model, results, passed);
  let report_path = null;
  try {
    const dir = path.join(require('../../../src/data_dir').outputs(), 'ask_eval');
    fs.mkdirSync(dir, { recursive: true });
    report_path = path.join(dir, 'ask_eval_' + new Date().toISOString().replace(/[:.]/g, '-') + '.md');
    fs.writeFileSync(report_path, report, 'utf8');
  } catch (e) { /* recording is best-effort */ }
  return { skipped: false, provider: provider, model: model, total: results.length, passed: passed, results: results, report: report, report_path: report_path };
}

function render_report(provider, model, results, passed) {
  const lines = ['# AI ask eval — ' + new Date().toISOString(),
    '', 'Provider: ' + provider + (model ? ' · ' + model : '') + '  ·  Passed ' + passed + ' / ' + results.length, ''];
  results.forEach(function (r) {
    lines.push('## ' + (r.ok ? '✅' : '❌') + ' ' + r.id + ' (' + r.kind + ')');
    lines.push('_' + r.why + '_');
    if (r.note) lines.push('> ' + r.note);
    r.turns.forEach(function (t) {
      lines.push('- Q: ' + t.q);
      if (t.sql) lines.push('  - SQL: `' + String(t.sql).replace(/\s+/g, ' ').trim() + '`');
      if (t.mode) lines.push('  - mode: ' + t.mode);
      if (t.expect_sql) lines.push('  - expect SQL ~ ' + t.expect_sql + ' -> ' + (t.passed ? 'pass' : 'FAIL'));
      if (t.expect_mode) lines.push('  - expect mode = ' + t.expect_mode + ' -> ' + (t.passed ? 'pass' : 'FAIL'));
      if (t.answer) lines.push('  - A: ' + t.answer.replace(/\n/g, ' '));
    });
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = { run_eval, render_report };
