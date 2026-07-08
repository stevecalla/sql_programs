'use strict';
// "Ask your data" — natural-language questions over the usat_apps_events table. Ported from the
// merge/reporting metrics/ask (model picker, an LLM that writes ONE read-only SELECT with schema +
// conversation grounding, a hardened guard, execution, a natural-language answer, a raw-SQL mode,
// and lightweight "correct this" feedback). Needs an API key (ANTHROPIC_API_KEY or OPENAI_API_KEY);
// degrades gracefully — no key => list_models() returns none and ask() throws NO_AI_KEY.
const fs = require('fs');
const path = require('path');
const data_dir = require('../data_dir');

const TABLE = 'usat_apps_events';
const MAX_LIMIT = 500;
const CORRECTIONS_FILE = process.env.USATAPPS_ASK_CORRECTIONS_FILE || data_dir.file_sync('metrics_ask_corrections.json');

const SCHEMA = [
  'event_name (page_view|panel_view|filter_run|search_run|report_export|login|logout|error)',
  'ts DATETIME (server local time — use for date grouping)',
  'actor (staff username), role, visitor_id, is_returning',
  'panel (module/panel key), view, filter_name, export_format (csv|xlsx)',
  'client_tz, viewport (sm|md|lg), local_hour, local_dow (0=Sun)',
  'duration_ms, row_count (INT), error_type',
  'is_test (1=flagged via metrics_test=1)',
].join('\n  ');

// ---- available models (mirrors the merge model picker); driven by which API keys exist ----
function list_models() {
  const out = [];
  if (process.env.ANTHROPIC_API_KEY) {
    out.push({ id: 'claude-3-5-haiku-latest', label: 'Claude · Haiku', provider: 'anthropic' });
    out.push({ id: 'claude-3-5-sonnet-latest', label: 'Claude · Sonnet', provider: 'anthropic' });
  }
  if (process.env.OPENAI_API_KEY) {
    if (process.env.OPENAI_MODEL && !out.some((m) => m.id === process.env.OPENAI_MODEL)) out.push({ id: process.env.OPENAI_MODEL, label: 'ChatGPT · ' + process.env.OPENAI_MODEL, provider: 'openai' });
    out.push({ id: 'gpt-4o-mini', label: 'ChatGPT · gpt-4o-mini', provider: 'openai' });
    out.push({ id: 'gpt-4o', label: 'ChatGPT · gpt-4o', provider: 'openai' });
  }
  const def = process.env.USATAPPS_ASK_MODEL || process.env.OPENAI_MODEL || (out[0] && out[0].id) || null;
  return { models: out, default: def };
}
function have_key() { return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY); }
function provider_for(model) { return String(model || '').indexOf('claude') === 0 ? 'anthropic' : (String(model || '').indexOf('gpt') === 0 ? 'openai' : null); }

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

// ---- LLM dispatch (Anthropic / OpenAI via fetch; no SDK) ----
async function call_llm(model, system, user) {
  const prov = provider_for(model);
  if (prov === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw no_key();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 600, system, messages: [{ role: 'user', content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Anthropic HTTP ' + r.status));
    return (j.content && j.content[0] && j.content[0].text) || '';
  }
  if (prov === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw no_key();
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('OpenAI HTTP ' + r.status));
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  }
  throw no_key();
}
function no_key() { const e = new Error('AI assistant not configured — set ANTHROPIC_API_KEY or OPENAI_API_KEY in the repo-root .env.'); e.code = 'NO_AI_KEY'; return e; }

function extract_sql(text) {
  const t = String(text || '');
  const fenced = t.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : t).trim();
  const idx = body.search(/\b(select|with)\b/i);
  return idx >= 0 ? body.slice(idx).trim() : body;
}

function corrections_text() {
  try { const arr = JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8')); if (Array.isArray(arr) && arr.length) return arr.slice(-12).map((c) => '- ' + c.note).join('\n'); } catch (e) { /* none */ }
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
    'group dates by ts; exclude test rows with (is_test IS NULL OR is_test=0) unless the question is about test activity.\n\n' +
    'Table `' + TABLE + '` columns:\n  ' + SCHEMA + (corr ? ('\n\nAnalyst corrections to respect:\n' + corr) : '');
  let user = '';
  if (Array.isArray(history) && history.length) {
    user += 'Earlier in this conversation:\n' + history.slice(-4).map((h) => 'Q: ' + h.question + (h.sql ? '\nSQL: ' + h.sql : '')).join('\n') + '\n\n';
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
  if (!have_key()) throw no_key();
  const models = list_models();
  const model = opts.model || models.default;
  if (!model) throw no_key();

  // Raw-SQL mode (the </> SQL toggle): run the user's SQL directly, guarded.
  if (opts.mode === 'sql') {
    const sql = assert_safe_select(opts.sql);
    const [rows] = await pool.query(sql);
    return { ok: true, mode: 'sql', question: opts.sql, sql, rows: rows || [], row_count: (rows || []).length, answer: (rows || []).length + ' row(s).', model, provider: 'sql' };
  }

  const question = String(opts.question || '').trim();
  if (!question) throw new Error('Ask a question.');
  const draft = await nl_to_sql(model, question, opts.history);
  const sql = assert_safe_select(draft);
  const [rows] = await pool.query(sql);
  const answer = await summarize(model, question, sql, rows || []);
  return { ok: true, question, sql, rows: rows || [], row_count: (rows || []).length, answer, model, provider: provider_for(model) };
}

module.exports = { ask, assert_safe_select, list_models, have_key, add_correction, TABLE, MAX_LIMIT };
