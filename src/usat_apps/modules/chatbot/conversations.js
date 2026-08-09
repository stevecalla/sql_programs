'use strict';
// conversations.js — transcript + counts store for the chatbot POC. One row per TURN, grouped by a stable
// conversation_id (the unique per-conversation identifier), and keyed by (channel, queue) so ONE table scales
// across bot surfaces (channel) and SF email-queue queues (queue). Stores the message text (transcript tier) AND
// the metadata needed for counts (model, grounded, latency, context sizes). Follows the platform analytics
// convention: TWO canonical timestamps, created_at_utc + created_at_mtn (America/Denver), stamped in Node
// via utilities/analytics/event_ingest.fmt_in_tz — no dependence on MySQL CONVERT_TZ tables.
//
// is_test policy: the INTERNAL POC surface is staff testing, so rows default is_test=1. The future public
// widget passes is_test=0. Logging is FIRE-AND-FORGET: it must never throw or block a chat response.
//
// PII note: this is the internal test surface (session-authed staff). When the public GTM widget ships, its
// transcript tier needs scrubbing/consent before it writes here — that's why the public server stays separate.
const crypto = require('crypto');
const db = require('../../store/db');
const { ensure_table } = require('../../../../utilities/analytics/ensure_table');
const { fmt_in_tz } = require('../../../../utilities/analytics/event_ingest');

const TABLE = 'chatbot_conversations';
const REPORTING_TZ = 'America/Denver';
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id VARCHAR(40) NOT NULL,
  turn INT NOT NULL DEFAULT 0,
  role VARCHAR(8) NOT NULL,
  text MEDIUMTEXT NULL,
  channel VARCHAR(60) NOT NULL DEFAULT 'internal-poc',
  queue VARCHAR(120) NULL,
  provider VARCHAR(32) NULL,
  model VARCHAR(120) NULL,
  grounded TINYINT NULL,
  knowledge_chars INT NULL,
  context_files INT NULL,
  corrections_used INT NULL,
  latency_ms INT NULL,
  prompt_tokens INT NULL,
  completion_tokens INT NULL,
  cost_usd DECIMAL(12,6) NULL,
  actor VARCHAR(120) NULL,
  is_test TINYINT NOT NULL DEFAULT 1,
  created_at_mtn DATETIME NOT NULL,
  created_at_utc DATETIME NOT NULL,
  INDEX idx_convo (conversation_id),
  INDEX idx_created (created_at_utc),
  INDEX idx_is_test (is_test),
  INDEX idx_channel (channel),
  INDEX idx_queue (queue)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

// Stable, collision-resistant conversation identifier (UUID v4).
function new_conversation_id() {
  try { return crypto.randomUUID(); } catch (e) { return 'c_' + crypto.randomBytes(16).toString('hex'); }
}

let _ready = null;
async function ensure() {
  if (_ready) return _ready;
  _ready = (async () => {
    const pool = await db.get_pool();
    await ensure_table(pool, DDL);
    // Idempotent migration: add the token/cost columns to a pre-existing table (MySQL has no
    // ADD COLUMN IF NOT EXISTS, so check information_schema first). Auto-applies on first use after deploy.
    // Placement matters: the platform convention keeps created_at_mtn + created_at_utc as the LAST columns,
    // so new columns are inserted AFTER latency_ms (before actor/is_test/created_at_*), matching the DDL.
    try {
      const cols = await db.query(
        'SELECT COLUMN_NAME, ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [TABLE]);
      const pos = {}; (cols || []).forEach(function (c) { pos[String(c.COLUMN_NAME)] = Number(c.ORDINAL_POSITION); });
      const have = new Set(Object.keys(pos));
      const adds = [];
      if (!have.has('prompt_tokens')) adds.push('ADD COLUMN prompt_tokens INT NULL AFTER latency_ms');
      if (!have.has('completion_tokens')) adds.push('ADD COLUMN completion_tokens INT NULL AFTER prompt_tokens');
      if (!have.has('cost_usd')) adds.push('ADD COLUMN cost_usd DECIMAL(12,6) NULL AFTER completion_tokens');
      if (adds.length) await db.query('ALTER TABLE ' + TABLE + ' ' + adds.join(', '));
      // Repair pass: if an earlier migration appended these columns at the END (after created_at_utc),
      // move them back in front of created_at_* so the two timestamps stay last (convention).
      const tail = pos['created_at_utc'] || 0;
      const misplaced = ['prompt_tokens', 'completion_tokens', 'cost_usd'].some(function (c) { return have.has(c) && pos[c] > tail; });
      if (misplaced) {
        await db.query('ALTER TABLE ' + TABLE + ' ' +
          'MODIFY COLUMN prompt_tokens INT NULL AFTER latency_ms, ' +
          'MODIFY COLUMN completion_tokens INT NULL AFTER prompt_tokens, ' +
          'MODIFY COLUMN cost_usd DECIMAL(12,6) NULL AFTER completion_tokens');
      }
    } catch (e) { /* boot race / perms — non-fatal, metrics cost just stays null until columns exist */ }
  })();
  return _ready;
}

// Fire-and-forget: log ONE turn. Never throws (analytics can't break a chat).
async function log_turn(rec) {
  try {
    await ensure();
    const now = new Date();
    const r = rec || {};
    await db.query(
      'INSERT INTO ' + TABLE + ' (conversation_id, turn, role, text, channel, queue, provider, model, grounded, ' +
      'knowledge_chars, context_files, corrections_used, latency_ms, prompt_tokens, completion_tokens, cost_usd, actor, is_test, created_at_mtn, created_at_utc) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        String(r.conversation_id || ''), Number(r.turn || 0), String(r.role || ''),
        (r.text == null ? null : String(r.text)),
        (r.channel || 'internal-poc'), (r.queue || null), r.provider || null, r.model || null,
        (r.grounded == null ? null : (r.grounded ? 1 : 0)),
        (r.knowledge_chars == null ? null : Number(r.knowledge_chars)),
        (r.context_files == null ? null : Number(r.context_files)),
        (r.corrections_used == null ? null : Number(r.corrections_used)),
        (r.latency_ms == null ? null : Number(r.latency_ms)),
        (r.prompt_tokens == null ? null : Number(r.prompt_tokens)),
        (r.completion_tokens == null ? null : Number(r.completion_tokens)),
        (r.cost_usd == null ? null : Number(r.cost_usd)),
        r.actor || null,
        (r.is_test == null ? 1 : (r.is_test ? 1 : 0)),
        fmt_in_tz(now, REPORTING_TZ), fmt_in_tz(now, 'UTC'),
      ]
    );
    return true;
  } catch (e) { return false; }   // swallow — logging must never break the response
}

// Read helpers for a future review/train console.
// Conversation THREADS for a queue (left-rail list): grouped by conversation_id, newest first, each with a
// preview (first user message) + counts. Optional is_test filter + a light text search over the preview.
async function list_threads(queue, opts) {
  opts = opts || {};
  // Match the queue by NORMALIZED name (strip case + non-alphanumerics) so historical rows logged under an
  // older spelling (e.g. 'TeamUSA') still show alongside the SF-canonical 'Team USA'. MySQL 8 REGEXP_REPLACE.
  const nq = String(queue || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const where = ["REGEXP_REPLACE(LOWER(queue), '[^a-z0-9]', '') = ?"]; const params = [nq];
  if (opts.is_test === 0 || opts.is_test === 1) { where.push('is_test = ?'); params.push(opts.is_test); }
  const lim = Math.max(1, Math.min(200, Number(opts.limit) || 60));
  // Date range filters on the MTN wall-clock (what the user sees). A conversation matches if it OVERLAPS the
  // [from, to] window: its latest turn is on/after `from` AND its earliest turn is on/before `to`.
  const having = []; const hParams = [];
  if (opts.from) { having.push('MAX(created_at_mtn) >= ?'); hParams.push(String(opts.from).slice(0, 10) + ' 00:00:00'); }
  if (opts.to) { having.push('MIN(created_at_mtn) <= ?'); hParams.push(String(opts.to).slice(0, 10) + ' 23:59:59'); }
  const havingSql = having.length ? (' HAVING ' + having.join(' AND ')) : '';
  const groups = await db.query(
    'SELECT conversation_id, MIN(id) first_id, COUNT(*) turns, SUM(role = \'bot\') answers, ' +
    "MIN(created_at_utc) started_utc, DATE_FORMAT(MAX(created_at_utc), '%Y-%m-%dT%H:%i:%sZ') last_utc, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %H:%i:%s') last_mtn, DATE_FORMAT(MIN(created_at_mtn), '%Y-%m-%d %H:%i:%s') started_mtn, " +
    'MAX(is_test) is_test ' +
    'FROM ' + TABLE + ' WHERE ' + where.join(' AND ') + ' GROUP BY conversation_id' + havingSql +
    ' ORDER BY last_utc DESC LIMIT ' + lim,
    params.concat(hParams));
  if (!groups.length) return [];
  const firstIds = groups.map(function (g) { return g.first_id; });
  const previews = await db.query('SELECT id, text FROM ' + TABLE + ' WHERE id IN (' + firstIds.map(function () { return '?'; }).join(',') + ')', firstIds);
  const pmap = {}; previews.forEach(function (r) { pmap[r.id] = r.text; });
  let out = groups.map(function (g) {
    return {
      conversation_id: g.conversation_id, turns: Number(g.turns) || 0, answers: Number(g.answers) || 0,
      started_utc: g.started_utc, last_utc: g.last_utc, last_mtn: g.last_mtn, started_mtn: g.started_mtn, is_test: Number(g.is_test) || 0,
      preview: String(pmap[g.first_id] || '').slice(0, 140),
    };
  });
  if (opts.q) { const ql = String(opts.q).toLowerCase(); out = out.filter(function (o) { return o.preview.toLowerCase().indexOf(ql) >= 0 || o.conversation_id.toLowerCase().indexOf(ql) >= 0; }); }
  return out;
}

async function by_conversation(conversation_id) {
  return await db.query(
    "SELECT id, turn, role, text, model, grounded, latency_ms, DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') created_at_mtn, DATE_FORMAT(created_at_utc, '%Y-%m-%dT%H:%i:%sZ') created_at_utc FROM " + TABLE +
    ' WHERE conversation_id = ? ORDER BY id ASC', [String(conversation_id || '')]);
}
async function recent_conversations(limit) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  return await db.query(
    'SELECT conversation_id, COUNT(*) turns, MIN(created_at_utc) started_utc, MAX(created_at_utc) last_utc, ' +
    'MAX(is_test) is_test FROM ' + TABLE + ' GROUP BY conversation_id ORDER BY last_utc DESC LIMIT ' + n);
}
async function stats() {
  const rows = await db.query(
    'SELECT COUNT(DISTINCT conversation_id) conversations, COUNT(*) turns, ' +
    "SUM(role='bot') answers, SUM(role='bot' AND grounded=1) grounded_answers FROM " + TABLE);
  return (rows && rows[0]) || { conversations: 0, turns: 0, answers: 0, grounded_answers: 0 };
}

// Delete TEST conversations only (is_test = 1). Live/member conversations are NEVER deletable here — the
// `is_test = 1` guard is enforced in SQL, so a request for a live conversation deletes nothing.
async function delete_conversation(conversation_id) {
  await ensure();
  const r = await db.query('DELETE FROM ' + TABLE + ' WHERE conversation_id = ? AND is_test = 1', [String(conversation_id || '')]);
  return (r && r.affectedRows) || 0;
}
// Delete ALL test conversations for one queue (normalized match, like list_threads).
async function delete_test(queue) {
  await ensure();
  const nq = String(queue || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = await db.query("DELETE FROM " + TABLE + " WHERE is_test = 1 AND REGEXP_REPLACE(LOWER(queue), '[^a-z0-9]', '') = ?", [nq]);
  return (r && r.affectedRows) || 0;
}

module.exports = { TABLE, DDL, REPORTING_TZ, ensure, log_turn, by_conversation, recent_conversations, list_threads, stats, new_conversation_id, delete_conversation, delete_test };
