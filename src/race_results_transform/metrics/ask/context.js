'use strict';
// Loads the grounding (events_context.yaml) and builds the plan/answer prompts.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let _ctx = null;
function load_context() {
  if (!_ctx) _ctx = yaml.load(fs.readFileSync(path.join(__dirname, 'context', 'events_context.yaml'), 'utf8'));
  return _ctx;
}
function context_text() { return yaml.dump(load_context()); }

const PLAN_SYSTEM = [
  'You are a careful, READ-ONLY analytics assistant for a MySQL usage-events table.',
  'Return EXACTLY ONE MySQL SELECT (or WITH ... SELECT) and nothing else: no prose, no markdown fences.',
  'Read-only (SELECT only); ALWAYS aggregate (COUNT/SUM/AVG/GROUP BY), never dump raw rows;',
  'use created_at_mtn for dates; reference only the allowed table; never identify individuals.',
  'If the question asks what the data MEANS (the definition of a column, event, or metric) rather than a data lookup, reply with exactly: NO_SQL'
].join(' ');

const ANSWER_SYSTEM = [
  'You are a concise analytics assistant. Answer the question from the SQL result rows only.',
  'State the number(s) plainly with brief context. ONLY say "showing first N" if the data explicitly notes the results were truncated; otherwise present the figures as the complete answer.',
  'Never claim or imply the identity of any person (visitor_id is anonymous). Do not invent data.'
].join(' ');

function build_plan_prompt(question, schema_text, prev_error) {
  const parts = [
    'Grounding context:\n' + context_text(),
    'Live schema:\n' + schema_text,
    'Question: ' + question
  ];
  if (prev_error) parts.push('Your previous attempt failed with: ' + prev_error + '\nReturn a corrected single SELECT.');
  return parts.join('\n\n');
}
function build_answer_prompt(question, result) {
  return [
    'Question: ' + question,
    'SQL: ' + result.sql,
    'Rows (JSON): ' + JSON.stringify((result.rows || []).slice(0, 50)),
    ((result.rows || []).length === 0 ? '(no rows matched — the count/result for that filter is zero / none).' : ''),
    (result.truncated ? '(note: results were truncated to ' + (result.rows || []).length + ' rows)' : '')
  ].join('\n');
}

const DEFINE_SYSTEM = [
  'You answer questions about what this usage-analytics data MEANS, using ONLY the grounding context provided.',
  'Be concise and accurate. Do not write SQL or invent fields. If the context does not cover it, say so plainly.'
].join(' ');

function build_define_prompt(question) {
  return 'Grounding context:\n' + context_text() + '\n\nQuestion: ' + question;
}

module.exports = { load_context, context_text, PLAN_SYSTEM, ANSWER_SYSTEM, DEFINE_SYSTEM, build_plan_prompt, build_answer_prompt, build_define_prompt };
