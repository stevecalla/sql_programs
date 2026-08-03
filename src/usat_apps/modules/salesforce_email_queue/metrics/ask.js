'use strict';
// "Ask your data" — natural-language questions over the salesforce_email_queue_events table. Mirrors
// modules/salesforce_merge/metrics/ask.js: model picker, an LLM that writes ONE read-only SELECT
// (schema + conversation grounding), a hardened guard, execution, a natural-language answer, a raw-SQL
// mode, and lightweight "correct this" feedback. Reuses services/ai for models + dispatch (the SAME
// registry the operator app uses). Degrades gracefully without an API key.
const fs = require('fs');
const path = require('path');
const cfg = require('./metrics_config');
const ai = require('../../../services/ai');
const data_dir = require('../../../services/knowledge/data_dir');

const TABLE = cfg.TABLE;
const MAX_LIMIT = 500;
const CORRECTIONS_FILE = process.env.EQ_ASK_CORRECTIONS_FILE || data_dir.file_sync('metrics_ask_corrections.json');

const SCHEMA = [
  'event_name (ai_call|page_view|thread_opened|queue_viewed|cases_listed|attachment_viewed|context_viewed|context_changed|correction_added|reply_copied|soql_run|model_selected|link_previewed|send_email|status_change|error)',
  'created_at_utc DATETIME, created_at_mtn DATETIME (Mountain time — use for date grouping)',
  'actor (staff username), visitor_id, session_id, is_returning',
  'queue, queue_id, case_id, case_number (Salesforce pointers), thread_msg_count INT, has_attachment (0/1)',
  'ai_action (respond|ask|acknowledge|triage), ai_provider (claude|chatgpt), ai_model, ai_verdict (DRAFT|NEED_INFO for respond; a triage status otherwise), ai_intent',
  'ai_latency_ms, ai_prompt_chars, ai_reply_chars, ai_prompt_tokens, ai_completion_tokens (INT), ai_cost_usd DECIMAL, ai_used_images (0/1), ai_grounded (0/1), ai_correction_count, ai_ok (1=success/0=failed), ai_error',
  'sf_action (send|status_change), sf_ok (0 in this read-only build), sf_error, status_to',
  'attachment_type, correction_scope (me|queue|global), context_action (upload|exclude|include), soql_chars',
  'local_hour, local_dow (0=Sun), env (prod|sandbox), is_test (1=flagged via metrics_test=1), viewport, client_tz, theme',
].join('\n  ');

// ---- available models (reuse the operator app's shared AI registry) ----
function list_models() {
  const arr = (ai.list_models && ai.list_models()) || [];
  const models = arr.map(function (m) { return { id: m.model, label: m.label || m.model, provider: m.provider }; });
  const def = (arr.filter(function (m) { return m.is_default; })[0] || arr[0] || {}).model || null;
  return { models: models, default: def };
}
function provider_for(model) {
  const arr = (ai.list_models && ai.list_models()) || [];
  const hit = arr.filter(function (m) { return m.model === model; })[0];
  if (hit) return hit.provider;
  return String(model || '').indexOf('claude') === 0 ? 'anthropic' : 'openai';
}
function no_key() { const e = new Error('Ask-your-data needs an AI key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in the repo-root .env.'); e.code = 'NO_AI_KEY'; return e; }

// ---- read-only guard (single SELECT over the events table only, LIMIT enforced) ----
const BLOCKED = ['insert', 'update', 'delete', 'merge', 'create', 'drop', 'alter', 'truncate',
  'grant', 'revoke', 'rename', 'call', 'do', 'load', 'set', 'handler', 'prepare', 'execute',
  'deallocate', 'lock', 'unlock', 'into', 'outfile', 'dumpfile', 'load_file', 'sleep', 'benchmark'];
function scrub(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/#[^\n]*/g, ' ')
    .replace(/'(?:\\.|''|[^'])*'/g, "''").replace(/"(?:\\.|""|[^"])*"/g, '""');
}
function assert_safe_select(sql) {
  let raw = String(sql || '').trim().replace(/;\s*$/, '');
  if (!raw) throw new Error('Empty query.');
  const scan = scrub(raw);
  if (scan.indexOf(';') >= 0) throw new Error('Only a single statement is allowed.');
  const lower = scan.trim().toLowerCase();
  if (lower.indexOf('select') !== 0 && lower.indexOf('with') !== 0) throw new Error('Read-only: only SELECT/WITH allowed.');
  for (const kw of BLOCKED) if (new RegExp('\\b' + kw + '\\b', 'i').test(scan)) throw new Error('Read-only: blocked keyword "' + kw + '".');
  const refs = []; const re = /\b(?:from|join)\s+`?([A-Za-z0-9_$.]+)`?/gi; let m;
  while ((m = re.exec(scan)) !== null) refs.push(m[1].replace(/`/g, '').split('.').pop().toLowerCase());
  for (const t of refs) if (t !== TABLE.toLowerCase()) throw new Error('Only the ' + TABLE + ' table is allowed (got "' + t + '").');
  const lim = scan.match(/\blimit\s+(\d+)\b/i);
  if (!lim) raw += ' LIMIT ' + MAX_LIMIT;
  else if (Number(lim[1]) > MAX_LIMIT) raw = raw.replace(/\blimit\s+\d+\b/i, 'LIMIT ' + MAX_LIMIT);
  return raw;
}

async function call_llm(model, system, user) {
  const provider = provider_for(model);
  const raw = await ai.complete({ provider: provider, model: model, system: system, prompt: user });
  const c = ai.norm_completion(raw, model);
  return (c && c.text) || '';
}

function extract_sql(text) {
  const t = String(text || '');
  const fenced = t.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : t).trim();
  const idx = body.search(/\b(select|with)\b/i);
  return idx >= 0 ? body.slice(idx).trim() : body;
}

function corrections_text() {
  try { const arr = JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8')); if (Array.isArray(arr) && arr.length) return arr.slice(-12).map(function (c) { return '- ' + c.note; }).join('\n'); } catch (e) { /* none */ }
  return '';
}
function add_correction(note, question, answer, author) {
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8')) || []; } catch (e) { arr = []; }
  arr.push({ at: new Date().toISOString(), note: String(note || '').slice(0, 2000), question: question || '', answer: answer || '', author: author || '' });
  try { fs.mkdirSync(path.dirname(CORRECTIONS_FILE), { recursive: true }); fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(arr.slice(-200), null, 2) + '\n', { mode: 0o600 }); } catch (e) { /* ignore */ }
  return arr.length;
}

async function nl_to_sql(model, question, history) {
  const corr = corrections_text();
  const sys = 'You translate a question into ONE read-only MySQL query over a single table. Output ONLY the SQL ' +
    '(no prose); a single SELECT (or WITH); read ONLY the table `' + TABLE + '`; always include a LIMIT (<= ' + MAX_LIMIT + '); ' +
    'group dates by created_at_mtn; exclude test rows with (is_test IS NULL OR is_test=0) unless the question is about test/sandbox activity.\n\n' +
    'Table `' + TABLE + '` columns:\n  ' + SCHEMA + (corr ? ('\n\nAnalyst corrections to respect:\n' + corr) : '');
  let user = '';
  if (Array.isArray(history) && history.length) {
    user += 'Earlier in this conversation:\n' + history.slice(-4).map(function (h) { return 'Q: ' + h.question + (h.sql ? '\nSQL: ' + h.sql : ''); }).join('\n') + '\n\n';
  }
  user += 'Question: ' + question;
  return extract_sql(await call_llm(model, sys, user));
}
async function summarize(model, question, sql, rows) {
  const sample = JSON.stringify((rows || []).slice(0, 20));
  const sys = 'You are a concise analytics assistant. Given a question and the JSON result rows, answer in 1-2 short ' +
    'sentences. Use plain numbers; do not restate the SQL. If there are no rows, say so plainly.';
  const user = 'Question: ' + question + '\nRows (up to 20 shown): ' + sample;
  try { return (await call_llm(model, sys, user)).trim(); } catch (e) { return (rows && rows.length) ? (rows.length + ' row(s).') : 'No matching rows.'; }
}

async function ask(pool, opts) {
  opts = opts || {};
  const models = list_models();
  const model = opts.model || models.default;
  if (!model) throw no_key();

  if (opts.mode === 'sql') {
    const sql = assert_safe_select(opts.sql);
    const [rows] = await pool.query(sql);
    return { ok: true, mode: 'sql', question: opts.sql, sql: sql, rows: rows || [], row_count: (rows || []).length, answer: (rows || []).length + ' row(s).', model: model, provider: 'sql' };
  }

  const question = String(opts.question || '').trim();
  if (!question) throw new Error('Ask a question.');
  const draft = await nl_to_sql(model, question, opts.history);
  const sql = assert_safe_select(draft);
  const [rows] = await pool.query(sql);
  const answer = await summarize(model, question, sql, rows || []);
  return { ok: true, question: question, sql: sql, rows: rows || [], row_count: (rows || []).length, answer: answer, model: model, provider: provider_for(model) };
}

module.exports = { ask, assert_safe_select, list_models, add_correction, TABLE, MAX_LIMIT };
