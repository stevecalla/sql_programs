'use strict';
// Loads the grounding (events_context.yaml) and builds the plan/answer prompts.
// Prompts can optionally include: conversation history (B1), a live metrics
// snapshot (G1), and operator clarifications/corrections (G2) via an `extra` object:
//   extra = { history: <string>, live: <string>, corrections: <string> }
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
  'If a conversation history is provided, treat the new question as a possible FOLLOW-UP: resolve pronouns and references ("that", "those", "it", "last month", "now break it down", "same but for mobile") against the most recent turn and its SQL.',
  'If operator clarifications/corrections are provided, honor them over your own assumptions about what columns/metrics mean.',
  'If the question asks what the data MEANS (the definition of a column, event, or metric) rather than a data lookup, reply with exactly: NO_SQL',
  'If the question requires data NOT in this events table (membership, sales, payments, or any table not described above), reply with exactly: OUT_OF_SCOPE -- never substitute an unrelated query.'
].join(' ');

const ANSWER_SYSTEM = [
  'You are a concise analytics assistant. Answer the question from the SQL result rows only.',
  'Lead with the headline number(s) in **bold**, then one short line of context. When the result is multiple rows, render a compact markdown table.',
  'State the number(s) plainly with brief context. ONLY say "showing first N" if the data explicitly notes the results were truncated; otherwise present the figures as the complete answer.',
  'Report ONLY what the result rows show; never invent SQL clauses, filters, or reasons. If there are no rows, say there were no matching rows -- do not speculate why.',
  'Present any dates/times in Mountain Time (created_at_mtn is already MT); do not report UTC.',
  'If operator clarifications/corrections are provided, honor them over your own assumptions.',
  'Never claim or imply the identity of any person (visitor_id is anonymous). Do not invent data.',
  'CHART HINT: when the rows are chartable -- i.e. there is more than one row and they have a label/category column plus a numeric column -- append, on the VERY LAST line and nowhere else, a fenced block exactly like ```chart\\n{"type":"bar","x":"<label_column>","y":"<numeric_column>"}\\n```. Use "bar" for categories, "line" for a time series (a date/hour x), "pie" for parts of a whole. x and y MUST be exact column names from the rows. Omit the block entirely for a single value or non-chartable data. Never mention the chart block in prose.'
].join(' ');

// Shared optional grounding blocks (history / live snapshot / corrections).
function extra_blocks(extra) {
  const e = extra || {};
  const parts = [];
  if (e.corrections) parts.push('Operator clarifications & corrections (authoritative grounding written by a human; honor over your own assumptions, but these are NOT data rows):\n' + e.corrections);
  if (e.live) parts.push('Live metrics snapshot (current aggregates, for orientation only -- for any EXACT figure write SQL against the table rather than quoting this):\n' + e.live);
  if (e.history) parts.push('Conversation so far (oldest first; resolve follow-up references against the most recent turn):\n' + e.history);
  return parts;
}

function build_plan_prompt(question, schema_text, prev_error, extra) {
  const parts = ['Grounding context:\n' + context_text()]
    .concat(extra_blocks(extra))
    .concat(['Live schema:\n' + schema_text, 'Question: ' + question]);
  if (prev_error) parts.push('Your previous attempt failed with: ' + prev_error + '\nReturn a corrected single SELECT.');
  return parts.join('\n\n');
}
function build_answer_prompt(question, result, extra) {
  const e = extra || {};
  const head = e.corrections ? ['Operator clarifications & corrections (honor these):\n' + e.corrections] : [];
  return head.concat([
    'Question: ' + question,
    'SQL: ' + result.sql,
    'Rows (JSON): ' + JSON.stringify((result.rows || []).slice(0, 50)),
    ((result.rows || []).length === 0 ? '(no rows matched — the count/result for that filter is zero / none).' : ''),
    (result.truncated ? '(note: results were truncated to ' + (result.rows || []).length + ' rows)' : '')
  ]).join('\n');
}

const DEFINE_SYSTEM = [
  'You answer questions about what this usage-analytics data MEANS, using ONLY the grounding context provided.',
  'If operator clarifications/corrections are provided, honor them over your own assumptions.',
  'Be concise and accurate. Do not write SQL or invent fields. If the context does not cover it, say so plainly.'
].join(' ');

function build_define_prompt(question, extra) {
  const e = extra || {};
  const parts = ['Grounding context:\n' + context_text()];
  if (e.corrections) parts.push('Operator clarifications & corrections (honor these):\n' + e.corrections);
  if (e.live) parts.push('Live metrics snapshot (orientation only):\n' + e.live);
  if (e.history) parts.push('Conversation so far (oldest first):\n' + e.history);
  parts.push('Question: ' + question);
  return parts.join('\n\n');
}

module.exports = { load_context, context_text, PLAN_SYSTEM, ANSWER_SYSTEM, DEFINE_SYSTEM, extra_blocks, build_plan_prompt, build_answer_prompt, build_define_prompt };
