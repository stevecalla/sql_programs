'use strict';
// eval/store.js — persistence for the chatbot stress-test / training harness. Three tables:
//   chatbot_eval_questions — the HUMAN-curated question bank (golden must-answer + off-topic/adversarial).
//                            AI-generated pools (knowledge- / log-derived) are produced at run time, NOT stored.
//   chatbot_eval_runs      — one row per stress-test run: scorecard headline + cost + status.
//   chatbot_eval_results   — one row per graded question in a run (the review queue + trend detail).
// Follows the platform analytics convention: two canonical timestamps (created_at_utc + created_at_mtn),
// stamped in Node, kept as the LAST columns. Fire-and-forget-safe reads; all writes are explicit/admin-gated.
const db = require('../../../store/db');
const { ensure_table } = require('../../../../../utilities/analytics/ensure_table');
const { fmt_in_tz } = require('../../../../../utilities/analytics/event_ingest');

const Q = 'chatbot_eval_questions';
const RUNS = 'chatbot_eval_runs';
const RES = 'chatbot_eval_results';
const REPORTING_TZ = 'America/Denver';

const DDL_Q = `CREATE TABLE IF NOT EXISTS ${Q} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  bucket VARCHAR(16) NOT NULL DEFAULT 'golden',
  question VARCHAR(600) NOT NULL,
  expected VARCHAR(8) NOT NULL DEFAULT 'answer',
  topic VARCHAR(120) NULL,
  expected_answer MEDIUMTEXT NULL,
  queue VARCHAR(120) NULL,
  locked TINYINT NOT NULL DEFAULT 0,
  is_active TINYINT NOT NULL DEFAULT 1,
  created_at_mtn DATETIME NOT NULL,
  created_at_utc DATETIME NOT NULL,
  INDEX idx_bucket (bucket),
  INDEX idx_queue (queue),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const DDL_RUNS = `CREATE TABLE IF NOT EXISTS ${RUNS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(40) NOT NULL,
  queue VARCHAR(120) NULL,
  answer_model VARCHAR(120) NULL,
  judge_model VARCHAR(120) NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'running',
  total INT NOT NULL DEFAULT 0,
  graded INT NOT NULL DEFAULT 0,
  on_topic INT NOT NULL DEFAULT 0,
  off_topic INT NOT NULL DEFAULT 0,
  score_overall INT NULL,
  coverage_pct INT NULL,
  safety_pct INT NULL,
  prompt_tokens INT NULL,
  completion_tokens INT NULL,
  cost_usd DECIMAL(12,6) NULL,
  error VARCHAR(400) NULL,
  created_at_mtn DATETIME NOT NULL,
  created_at_utc DATETIME NOT NULL,
  UNIQUE KEY uq_run (run_id),
  INDEX idx_created (created_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const DDL_RES = `CREATE TABLE IF NOT EXISTS ${RES} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(40) NOT NULL,
  question VARCHAR(600) NOT NULL,
  bucket VARCHAR(16) NULL,
  expected VARCHAR(8) NULL,
  topic VARCHAR(120) NULL,
  source VARCHAR(24) NULL,
  answer MEDIUMTEXT NULL,
  grounded TINYINT NULL,
  category VARCHAR(24) NULL,
  score INT NULL,
  reason VARCHAR(500) NULL,
  latency_ms INT NULL,
  cost_usd DECIMAL(12,6) NULL,
  human_verdict VARCHAR(16) NULL,
  human_score INT NULL,
  sources MEDIUMTEXT NULL,
  created_at_mtn DATETIME NOT NULL,
  created_at_utc DATETIME NOT NULL,
  INDEX idx_run (run_id),
  INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

let _ready = null;
async function ensure() {
  if (_ready) return _ready;
  _ready = (async () => {
    const pool = await db.get_pool();
    await ensure_table(pool, DDL_Q);
    await ensure_table(pool, DDL_RUNS);
    await ensure_table(pool, DDL_RES);
    // Migrate a pre-existing results table to carry the human-override columns (placed before created_at_*).
    try {
      const cols = await db.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [RES]);
      const have = new Set((cols || []).map(function (c) { return String(c.COLUMN_NAME); }));
      if (!have.has('human_verdict')) await db.query('ALTER TABLE ' + RES + ' ADD COLUMN human_verdict VARCHAR(16) NULL AFTER cost_usd');
      if (!have.has('human_score')) await db.query('ALTER TABLE ' + RES + ' ADD COLUMN human_score INT NULL AFTER human_verdict');
      if (!have.has('sources')) await db.query('ALTER TABLE ' + RES + ' ADD COLUMN sources MEDIUMTEXT NULL AFTER human_score');
    } catch (e) { /* perms/boot race — non-fatal, override just unavailable until columns exist */ }
  })();
  return _ready;
}
// The EFFECTIVE category/score for a result — a human override wins over the judge.
function effective(r) {
  if (r.human_verdict === 'correct') return { category: (r.expected === 'deflect' ? 'correct-deflected' : 'correct-grounded'), score: (r.human_score == null ? 100 : Number(r.human_score)) };
  if (r.human_verdict === 'wrong') return { category: 'wrong', score: (r.human_score == null ? 0 : Number(r.human_score)) };
  return { category: r.category, score: Number(r.score) || 0 };
}
function stamps() { const now = new Date(); return [fmt_in_tz(now, REPORTING_TZ), fmt_in_tz(now, 'UTC')]; }

// ---- question bank (curated) ----
async function list_questions(opts) {
  await ensure();
  opts = opts || {};
  const w = []; const a = [];
  if (opts.bucket) { w.push('bucket = ?'); a.push(String(opts.bucket)); }
  if (opts.active !== false) { w.push('is_active = 1'); }
  if (opts.queue) { w.push('(queue IS NULL OR queue = ?)'); a.push(String(opts.queue)); }
  const where = w.length ? ('WHERE ' + w.join(' AND ')) : '';
  return db.query('SELECT id, bucket, question, expected, topic, expected_answer, queue, locked, is_active FROM ' + Q + ' ' + where + ' ORDER BY bucket, id', a);
}
function clean_q(r) {
  r = r || {};
  const bucket = (r.bucket === 'offtopic') ? 'offtopic' : 'golden';
  const question = String(r.question || '').trim().slice(0, 600);
  if (!question) return null;
  const expected = (r.expected === 'deflect') ? 'deflect' : (bucket === 'offtopic' ? 'deflect' : 'answer');
  return {
    bucket: bucket, question: question, expected: expected,
    topic: r.topic ? String(r.topic).slice(0, 120) : null,
    expected_answer: r.expected_answer ? String(r.expected_answer) : null,
    queue: r.queue ? String(r.queue).slice(0, 120) : null,
    locked: r.locked ? 1 : 0,
  };
}
async function add_question(rec) {
  await ensure();
  const c = clean_q(rec); if (!c) throw new Error('question text required');
  const [mtn, utc] = stamps();
  const r = await db.query(
    'INSERT INTO ' + Q + ' (bucket, question, expected, topic, expected_answer, queue, locked, is_active, created_at_mtn, created_at_utc) VALUES (?,?,?,?,?,?,?,1,?,?)',
    [c.bucket, c.question, c.expected, c.topic, c.expected_answer, c.queue, c.locked, mtn, utc]);
  return { id: (r && r.insertId) || null };
}
async function bulk_add(rows) {
  await ensure();
  const cleaned = (Array.isArray(rows) ? rows : []).map(clean_q).filter(Boolean);
  let added = 0;
  for (const c of cleaned) { await add_question(c); added++; }
  return { added: added, skipped: (rows || []).length - added };
}
async function update_question(id, patch) {
  await ensure();
  const c = clean_q(Object.assign({ bucket: 'golden' }, patch || {}, { question: (patch && patch.question) || 'x' }));
  const sets = []; const a = [];
  ['bucket', 'question', 'expected', 'topic', 'expected_answer', 'queue', 'locked'].forEach(function (k) {
    if (patch && patch[k] !== undefined) { sets.push(k + ' = ?'); a.push(c[k]); }
  });
  if (patch && patch.is_active !== undefined) { sets.push('is_active = ?'); a.push(patch.is_active ? 1 : 0); }
  if (!sets.length) return { updated: 0 };
  a.push(Number(id));
  const r = await db.query('UPDATE ' + Q + ' SET ' + sets.join(', ') + ' WHERE id = ?', a);
  return { updated: (r && r.affectedRows) || 0 };
}
async function delete_question(id) {
  await ensure();
  const r = await db.query('DELETE FROM ' + Q + ' WHERE id = ? AND locked = 0', [Number(id)]);
  return { deleted: (r && r.affectedRows) || 0 };
}
async function count_questions() {
  await ensure();
  const rows = await db.query("SELECT bucket, COUNT(*) n FROM " + Q + ' WHERE is_active=1 GROUP BY bucket');
  const out = { golden: 0, offtopic: 0 };
  rows.forEach(function (r) { out[r.bucket] = Number(r.n) || 0; });
  return out;
}

// ---- runs + results ----
async function create_run(rec) {
  await ensure();
  rec = rec || {};
  const [mtn, utc] = stamps();
  await db.query(
    'INSERT INTO ' + RUNS + ' (run_id, queue, answer_model, judge_model, status, total, on_topic, off_topic, created_at_mtn, created_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [rec.run_id, rec.queue || null, rec.answer_model || null, rec.judge_model || null, 'running',
     Number(rec.total) || 0, Number(rec.on_topic) || 0, Number(rec.off_topic) || 0, mtn, utc]);
  return rec.run_id;
}
async function update_run(run_id, patch) {
  await ensure();
  patch = patch || {};
  const cols = ['status', 'graded', 'score_overall', 'coverage_pct', 'safety_pct', 'prompt_tokens', 'completion_tokens', 'cost_usd', 'error', 'total', 'on_topic', 'off_topic'];
  const sets = []; const a = [];
  cols.forEach(function (k) { if (patch[k] !== undefined) { sets.push(k + ' = ?'); a.push(patch[k]); } });
  if (!sets.length) return;
  a.push(String(run_id));
  await db.query('UPDATE ' + RUNS + ' SET ' + sets.join(', ') + ' WHERE run_id = ?', a);
}
async function insert_results(run_id, arr) {
  await ensure();
  for (const r of (arr || [])) {
    const [mtn, utc] = stamps();
    await db.query(
      'INSERT INTO ' + RES + ' (run_id, question, bucket, expected, topic, source, answer, grounded, category, score, reason, latency_ms, cost_usd, sources, created_at_mtn, created_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [String(run_id), String(r.question || '').slice(0, 600), r.bucket || null, r.expected || null, r.topic || null, r.source || null,
       r.answer == null ? null : String(r.answer), r.grounded == null ? null : (r.grounded ? 1 : 0),
       r.category || null, r.score == null ? null : Number(r.score), r.reason ? String(r.reason).slice(0, 500) : null,
       r.latency_ms == null ? null : Number(r.latency_ms), r.cost_usd == null ? null : Number(r.cost_usd), (r.sources == null ? null : String(r.sources)), mtn, utc]);
  }
}
async function get_run(run_id) {
  await ensure();
  return (await db.query('SELECT * FROM ' + RUNS + ' WHERE run_id = ?', [String(run_id)]))[0] || null;
}
async function last_run() {
  await ensure();
  return (await db.query("SELECT * FROM " + RUNS + " WHERE status='done' ORDER BY created_at_utc DESC LIMIT 1"))[0] || null;
}
async function list_runs(limit, queue) {
  await ensure();
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  const where = queue ? ' WHERE queue = ?' : '';
  const args = queue ? [String(queue)] : [];
  return db.query('SELECT run_id, queue, answer_model, judge_model, status, total, score_overall, coverage_pct, safety_pct, cost_usd, ' +
    "DATE_FORMAT(created_at_mtn,'%Y-%m-%d %H:%i') created_at_mtn FROM " + RUNS + where + ' ORDER BY created_at_utc DESC LIMIT ' + n, args);
}
async function results_for(run_id, opts) {
  await ensure();
  opts = opts || {};
  const w = ['run_id = ?']; const a = [String(run_id)];
  if (opts.category) { w.push('category = ?'); a.push(String(opts.category)); }
  return db.query('SELECT id, question, bucket, expected, topic, source, answer, grounded, category, score, reason, latency_ms, cost_usd, sources, human_verdict, human_score FROM ' + RES +
    ' WHERE ' + w.join(' AND ') + ' ORDER BY score ASC, id ASC', a);
}

// Human override of the judge on one result. verdict: 'correct' | 'wrong' | null(reset). Optional explicit score.
async function set_override(result_id, verdict, score) {
  await ensure();
  const v = (verdict === 'correct' || verdict === 'wrong') ? verdict : null;
  const rows = await db.query('SELECT run_id FROM ' + RES + ' WHERE id = ?', [Number(result_id)]);
  const run_id = rows && rows[0] ? rows[0].run_id : null;
  await db.query('UPDATE ' + RES + ' SET human_verdict = ?, human_score = ? WHERE id = ?', [v, (score == null || score === '' ? null : Number(score)), Number(result_id)]);
  if (run_id) await recompute_run(run_id);
  return { run_id: run_id };
}
// Recompute a run's scorecard from its results, honoring human overrides, and persist it (keeps trend accurate).
async function recompute_run(run_id) {
  await ensure();
  const rows = await results_for(run_id, {});
  const eff = rows.map(function (r) { return Object.assign({}, r, effective(r)); });
  const on = eff.filter(function (r) { return r.expected !== 'deflect'; });
  const off = eff.filter(function (r) { return r.expected === 'deflect'; });
  const grounded_ok = on.filter(function (r) { return r.category === 'correct-grounded'; }).length;
  const deflect_ok = off.filter(function (r) { return r.category === 'correct-deflected'; }).length;
  const avg = eff.length ? Math.round(eff.reduce(function (s, r) { return s + (Number(r.score) || 0); }, 0) / eff.length) : 0;
  const card = { score_overall: avg, coverage_pct: on.length ? Math.round((grounded_ok / on.length) * 100) : 0, safety_pct: off.length ? Math.round((deflect_ok / off.length) * 100) : 0 };
  await update_run(run_id, card);
  return card;
}

module.exports = {
  Q, RUNS, RES, REPORTING_TZ, DDL_Q, DDL_RUNS, DDL_RES, ensure, effective,
  list_questions, add_question, bulk_add, update_question, delete_question, count_questions,
  create_run, update_run, insert_results, get_run, last_run, list_runs, results_for, set_override, recompute_run,
};
