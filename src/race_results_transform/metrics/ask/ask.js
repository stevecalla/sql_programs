'use strict';
// The "brain": ask(question, opts) -> plan a READ-ONLY SELECT, run it (guarded),
// repair once on error, then synthesize a concise answer from the rows.
// READ ONLY end to end. provider_impl / pool / schema are injectable for tests.
const { run_query, get_schema_text } = require('./tools');
const ctx = require('./context');

function pick_provider(name) {
  if (name === 'anthropic' || name === 'claude') return require('./providers/anthropic');
  return require('./providers/openai');   // default
}

// Pull one SQL statement out of the model's reply (strip code fences / prose).
function extract_sql(text) {
  let s = String(text || '');
  const fence = s.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const m = s.match(/\b(?:with|select)\b[\s\S]*/i);
  s = (m ? m[0] : s).trim();
  return s.replace(/;\s*$/, '');
}

async function ask(question, opts) {
  opts = opts || {};
  const provider = opts.provider_impl || pick_provider(opts.provider);
  const model = opts.model || (provider.default_model && provider.default_model());
  const schema = opts.schema || await get_schema_text(undefined, opts);
  const max_attempts = opts.max_attempts || 2;
  const steps = [];
  let sql = null, result = null, prev_error = null;

  for (let attempt = 1; attempt <= max_attempts; attempt++) {
    const reply = await provider.chat({ system: ctx.PLAN_SYSTEM, user: ctx.build_plan_prompt(question, schema, prev_error), model: model });
    // definitional question (no data lookup) -> answer from the grounding context, no SQL
    if (/^\s*no_sql\b/i.test(reply) || !/\b(?:select|with|insert|update|delete|drop|alter|create|truncate|replace|merge)\b/i.test(reply)) {
      steps.push({ step: attempt, kind: 'definition' });
      const dans = await provider.chat({ system: ctx.DEFINE_SYSTEM, user: ctx.build_define_prompt(question), model: model });
      return { ok: true, mode: 'definition', provider: provider.id, model: model, sql: null, steps: steps, answer: String(dans || '').trim() };
    }
    sql = extract_sql(reply);
    steps.push({ step: attempt, kind: 'plan', sql: sql });
    try {
      result = await run_query(sql, opts);          // guards (read-only/allowlist/LIMIT) + executes + caps
      break;
    } catch (e) {
      prev_error = e.message;
      steps.push({ step: attempt, kind: 'error', error: e.message });
    }
  }

  if (!result) {
    return { ok: false, provider: provider.id, model: model, sql: sql, steps: steps,
      answer: 'Could not produce a valid read-only query for that question.' + (prev_error ? ' (' + prev_error + ')' : '') };
  }
  const answer = await provider.chat({ system: ctx.ANSWER_SYSTEM, user: ctx.build_answer_prompt(question, result), model: model });
  return { ok: true, provider: provider.id, model: model, sql: result.sql, rows: result.rows,
    row_count: result.row_count, truncated: result.truncated, steps: steps, answer: String(answer || '').trim() };
}

module.exports = { ask, extract_sql, pick_provider };
