'use strict';
// The "brain": ask(question, opts) -> plan a READ-ONLY SELECT, run it (guarded), repair once on
// error, then synthesize a concise answer. READ ONLY end to end. Mirrors race_results_transform.
// opts may carry: history [{q,sql,answer}] (follow-ups), live <string>, corrections <string>.
const { run_query, get_schema_text } = require('./tools');
const ctx = require('./context');

function pick_provider(name) {
  if (name === 'anthropic' || name === 'claude') return require('./providers/anthropic');
  return require('./providers/openai');
}
function format_history(history) {
  if (!Array.isArray(history) || !history.length) return null;
  const out = history.slice(-4).map(function (t) {
    const q = String((t && (t.q || t.question)) || '').trim();
    if (!q) return null;
    const sql = t && t.sql ? '\n  SQL: ' + String(t.sql).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    const a = String((t && t.answer) || '').split('\n')[0].slice(0, 200);
    return 'Q: ' + q + sql + (a ? '\n  A: ' + a : '');
  }).filter(Boolean);
  return out.length ? out.join('\n') : null;
}
function build_extra(opts) { return { history: format_history(opts.history), live: opts.live || null, corrections: opts.corrections || null }; }

function extract_chart(answer, rows) {
  let text = String(answer || '');
  const m = text.match(/```chart\s*([\s\S]*?)```/i);
  if (!m) return { answer: text.trim(), chart: null };
  text = text.replace(m[0], '').trim();
  let spec = null;
  try { spec = JSON.parse(m[1].trim()); } catch (e) { return { answer: text, chart: null }; }
  const cols = (rows && rows[0]) ? Object.keys(rows[0]) : [];
  const types = ['bar', 'line', 'pie'];
  if (!spec || !spec.x || !spec.y || cols.indexOf(spec.x) < 0 || cols.indexOf(spec.y) < 0) return { answer: text, chart: null };
  if ((rows || []).length < 2) return { answer: text, chart: null };
  return { answer: text, chart: { type: types.indexOf(spec.type) >= 0 ? spec.type : 'bar', x: spec.x, y: spec.y } };
}
function extract_sql(text) {
  let s = String(text || '');
  const fence = s.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const m = s.match(/\b(?:with|select)\b[\s\S]*/i);
  s = (m ? m[0] : s).trim();
  return s.replace(/;\s*$/, '');
}
async function ask_sql(sql, opts) {
  opts = opts || {};
  const result = await run_query(sql, opts);
  return { ok: true, mode: 'sql', provider: null, model: null, sql: result.sql, rows: result.rows,
    row_count: result.row_count, truncated: result.truncated, steps: [{ kind: 'sql' }], answer: '', chart: null };
}
async function ask(question, opts) {
  opts = opts || {};
  const provider = opts.provider_impl || pick_provider(opts.provider);
  const model = opts.model || (provider.default_model && provider.default_model());
  const schema = opts.schema || await get_schema_text(undefined, opts);
  const max_attempts = opts.max_attempts || 2;
  const extra = build_extra(opts);
  const steps = [];
  let sql = null, result = null, prev_error = null;

  for (let attempt = 1; attempt <= max_attempts; attempt++) {
    const reply = await provider.chat({ system: ctx.PLAN_SYSTEM, user: ctx.build_plan_prompt(question, schema, prev_error, extra), model: model });
    if (/^\s*out_of_scope\b/i.test(reply)) {
      steps.push({ step: attempt, kind: 'out_of_scope' });
      return { ok: true, mode: 'out_of_scope', provider: provider.id, model: model, sql: null, steps: steps,
        answer: 'That data is not available here. I can only answer questions about the Salesforce Email Queue usage events (the ' + (require('./db').ALLOWED_TABLES[0] || 'events') + ' table) — e.g. AI calls by provider/verdict/latency, threads opened, acknowledgements, queues, operators, attachments, corrections, and errors.' };
    }
    if (/^\s*no_sql\b/i.test(reply) || !/\b(?:select|with|insert|update|delete|drop|alter|create|truncate|replace|merge)\b/i.test(reply)) {
      steps.push({ step: attempt, kind: 'definition' });
      const dans = await provider.chat({ system: ctx.DEFINE_SYSTEM, user: ctx.build_define_prompt(question, extra), model: model });
      return { ok: true, mode: 'definition', provider: provider.id, model: model, sql: null, steps: steps, answer: String(dans || '').trim() };
    }
    sql = extract_sql(reply);
    steps.push({ step: attempt, kind: 'plan', sql: sql });
    try { result = await run_query(sql, opts); break; }
    catch (e) { prev_error = e.message; steps.push({ step: attempt, kind: 'error', error: e.message }); }
  }
  if (!result) {
    return { ok: false, provider: provider.id, model: model, sql: sql, steps: steps,
      answer: 'Could not produce a valid read-only query for that question.' + (prev_error ? ' (' + prev_error + ')' : '') };
  }
  const answer = await provider.chat({ system: ctx.ANSWER_SYSTEM, user: ctx.build_answer_prompt(question, result, extra), model: model });
  const { answer: clean_answer, chart } = extract_chart(answer, result.rows);
  return { ok: true, provider: provider.id, model: model, sql: result.sql, rows: result.rows,
    row_count: result.row_count, truncated: result.truncated, steps: steps, answer: clean_answer, chart: chart };
}
module.exports = { ask, ask_sql, extract_sql, extract_chart, format_history, pick_provider };
