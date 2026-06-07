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
  'Read-only (SELECT only). PREFER aggregation (COUNT/SUM/AVG/GROUP BY); but for list/show/recent/last/"in a table" requests a small ORDER BY ... LIMIT row listing IS allowed and you must NOT refuse it (the LIMIT cap prevents dumps);',
  'always express dates/times in Mountain Time by formatting with DATE_FORMAT(created_at_mtn, ...) so the result is a MT string (never created_at_utc, never a raw DATE/DATETIME which serializes as UTC); reference only the allowed table; never identify individuals.',
  'If the question asks what the data MEANS (the definition of a column, event, or metric) rather than a data lookup, reply with exactly: NO_SQL',
  'If the question requires data NOT in this events table (membership, sales, payments, or any table not described above), reply with exactly: OUT_OF_SCOPE -- never substitute an unrelated query.'
].join(' ');

const ANSWER_SYSTEM = [
  'You are a concise analytics assistant. Answer the question from the SQL result rows only.',
  'Lead with the headline number(s) in **bold**, then one short line of context. When the result is multiple rows, render a compact markdown table.',
  'State the number(s) plainly with brief context. ONLY say "showing first N" if the data explicitly notes the results were truncated; otherwise present the figures as the complete answer.',
  'Report ONLY what the result rows show; never invent SQL clauses, filters, or reasons. If there are no rows, say there were no matching rows -- do not speculate why.',
  'Present any dates/times in Mountain Time (created_at_mtn is already MT); do not report UTC.',
  'Never claim or imply the identity of any person (visitor_id is anonymous). Do not invent data.',
  'CHART HINT: when the rows are chartable -- i.e. there is more than one row and they have a label/category column plus a numeric column -- append, on the VERY LAST line and nowhere else, a fenced block exactly like ```chart\\n{"type":"bar","x":"<label_column>","y":"<numeric_column>"}\\n```. Use "bar" for categories, "line" for a time series (a date/hour x), "pie" for parts of a whole. x and y MUST be exact column names from the rows. Omit the block entirely for a single value or non-chartable data. Never mention the chart block in prose.'
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
