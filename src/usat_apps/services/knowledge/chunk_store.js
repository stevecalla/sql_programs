'use strict';
// chunk_store.js — DB-backed store for knowledge CHUNKS + their SOURCES (URL context + files).
// The bot grounds on chunk rows; raw page snapshots live on disk (url_fetch writes them). Retrieval
// (select_chunks) loads the queue's candidate chunks and ranks them with the shared BM25-lite scorer
// in chunk.js, so only the relevant pieces are sent to the model instead of the whole corpus.
//
// Convention parity with modules/chatbot/conversations.js: store/db pool, ensure_table(DDL), and TWO
// canonical timestamps (created_at_mtn America/Denver + created_at_utc) stamped in Node via
// utilities/analytics/event_ingest.fmt_in_tz. Read paths use DATE_FORMAT so mysql2 doesn't reinterpret
// DATETIME as a UTC Date. Queue matching is NORMALIZED (strip case + non-alphanumerics) so a source saved
// under 'TeamUSA' still matches the SF-canonical 'Team USA' — same rule the conversations store uses.
const db = require('../../store/db');
const { ensure_table } = require('../../../../utilities/analytics/ensure_table');
const { fmt_in_tz } = require('../../../../utilities/analytics/event_ingest');
const chunker = require('./chunk');

const CHUNKS = 'knowledge_chunks';
const SOURCES = 'knowledge_sources';
const REPORTING_TZ = 'America/Denver';

const DDL_SOURCES = `CREATE TABLE IF NOT EXISTS ${SOURCES} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_ref VARCHAR(700) NOT NULL,
  source_type VARCHAR(16) NOT NULL DEFAULT 'url',
  source_title VARCHAR(300) NULL,
  scope VARCHAR(16) NOT NULL DEFAULT 'global',
  queue VARCHAR(120) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'ok',
  error TEXT NULL,
  needs_js TINYINT NOT NULL DEFAULT 0,
  chunk_count INT NOT NULL DEFAULT 0,
  bytes INT NULL,
  added_by VARCHAR(120) NULL,
  snapshot_path VARCHAR(500) NULL,
  fetched_at_mtn DATETIME NULL,
  fetched_at_utc DATETIME NULL,
  created_at_mtn DATETIME NOT NULL,
  created_at_utc DATETIME NOT NULL,
  UNIQUE KEY uniq_src (source_ref(300), scope, queue),
  INDEX idx_scope_queue (scope, queue),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const DDL_CHUNKS = `CREATE TABLE IF NOT EXISTS ${CHUNKS} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chunk_id VARCHAR(300) NOT NULL,
  source_ref VARCHAR(700) NOT NULL,
  source_type VARCHAR(16) NOT NULL DEFAULT 'url',
  source_title VARCHAR(300) NULL,
  scope VARCHAR(16) NOT NULL DEFAULT 'global',
  queue VARCHAR(120) NOT NULL DEFAULT '',
  category VARCHAR(500) NULL,
  seq INT NOT NULL DEFAULT 0,
  text MEDIUMTEXT NULL,
  char_len INT NULL,
  excluded TINYINT NOT NULL DEFAULT 0,
  embedding MEDIUMBLOB NULL,
  embed_model VARCHAR(80) NULL,
  fetched_at_mtn DATETIME NULL,
  fetched_at_utc DATETIME NULL,
  created_at_mtn DATETIME NOT NULL,
  created_at_utc DATETIME NOT NULL,
  INDEX idx_src (source_ref(300)),
  INDEX idx_scope_queue (scope, queue),
  INDEX idx_excluded (excluded)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

// Add a column to an existing table only if it's missing (fresh installs get it from the DDL above; older
// prod tables predate the embedding columns). Idempotent via information_schema.
async function ensure_column(table, column, coldef) {
  const rows = await db.query(
    'SELECT COUNT(*) c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]);
  if (rows && rows[0] && Number(rows[0].c) === 0) {
    try { await db.query('ALTER TABLE ' + table + ' ADD COLUMN ' + coldef); } catch (e) { /* concurrent add / perms — ignore */ }
  }
}

let _ready = null;
async function ensure() {
  if (_ready) return _ready;
  _ready = (async () => {
    const pool = await db.get_pool();
    await ensure_table(pool, DDL_SOURCES);
    await ensure_table(pool, DDL_CHUNKS);
    // Migrate older chunk tables to carry the embedding columns (semantic retrieval).
    await ensure_column(CHUNKS, 'embedding', 'embedding MEDIUMBLOB NULL');
    await ensure_column(CHUNKS, 'embed_model', 'embed_model VARCHAR(80) NULL');
  })();
  return _ready;
}

// global scope carries an empty queue string (so the UNIQUE key is reliable); queue scope keeps the name.
function norm_scope(scope) { return scope === 'queue' ? 'queue' : 'global'; }
function scope_queue(scope, queue) { return norm_scope(scope) === 'queue' ? String(queue || '') : ''; }
function nq(queue) { return String(queue || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Insert or update a source row (idempotent on source_ref+scope+queue). Returns the row's fields.
async function upsert_source(src) {
  await ensure();
  const now = new Date();
  const s = src || {};
  const scope = norm_scope(s.scope); const queue = scope_queue(scope, s.queue);
  await db.query(
    'INSERT INTO ' + SOURCES + ' (source_ref, source_type, source_title, scope, queue, status, error, needs_js, ' +
    'chunk_count, bytes, added_by, snapshot_path, fetched_at_mtn, fetched_at_utc, created_at_mtn, created_at_utc) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
    'ON DUPLICATE KEY UPDATE source_type=VALUES(source_type), source_title=VALUES(source_title), ' +
    'status=VALUES(status), error=VALUES(error), needs_js=VALUES(needs_js), chunk_count=VALUES(chunk_count), ' +
    'bytes=VALUES(bytes), snapshot_path=VALUES(snapshot_path), fetched_at_mtn=VALUES(fetched_at_mtn), ' +
    'fetched_at_utc=VALUES(fetched_at_utc)',
    [
      String(s.source_ref || ''), s.source_type || 'url', s.source_title || null, scope, queue,
      s.status || 'ok', s.error || null, s.needs_js ? 1 : 0, Number(s.chunk_count || 0),
      (s.bytes == null ? null : Number(s.bytes)), s.added_by || null, s.snapshot_path || null,
      s.fetched ? fmt_in_tz(now, REPORTING_TZ) : null, s.fetched ? fmt_in_tz(now, 'UTC') : null,
      fmt_in_tz(now, REPORTING_TZ), fmt_in_tz(now, 'UTC'),
    ]);
  return { source_ref: s.source_ref, scope: scope, queue: queue };
}

// Replace ALL chunks for one source (used on add + refresh): delete then batch-insert the new set.
// `meta` = { source_ref, source_type, source_title, scope, queue }; chunks from chunker.chunk().
async function replace_source_chunks(meta, chunks) {
  await ensure();
  const m = meta || {}; const list = chunks || [];
  const scope = norm_scope(m.scope); const queue = scope_queue(scope, m.queue);
  const now = new Date();
  const mtn = fmt_in_tz(now, REPORTING_TZ); const utc = fmt_in_tz(now, 'UTC');
  await db.query('DELETE FROM ' + CHUNKS + ' WHERE source_ref = ? AND scope = ? AND queue = ?', [String(m.source_ref || ''), scope, queue]);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    await db.query(
      'INSERT INTO ' + CHUNKS + ' (chunk_id, source_ref, source_type, source_title, scope, queue, category, seq, ' +
      'text, char_len, excluded, fetched_at_mtn, fetched_at_utc, created_at_mtn, created_at_utc) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        String(c.chunk_id || (m.source_ref + '#' + i)), String(m.source_ref || ''), m.source_type || 'url',
        m.source_title || null, scope, queue, c.category || null, Number(c.seq || i),
        (c.text == null ? null : String(c.text)), Number(c.char_len || (c.text ? c.text.length : 0)), 0,
        mtn, utc, mtn, utc,
      ]);
  }
  return list.length;
}

// Sources visible to a queue: its own (scope=queue, normalized match) + all globals. Newest first.
async function list_sources(queue) {
  await ensure();
  return await db.query(
    'SELECT id, source_ref, source_type, source_title, scope, queue, status, error, needs_js, chunk_count, bytes, ' +
    "added_by, DATE_FORMAT(fetched_at_mtn, '%Y-%m-%d %H:%i:%s') fetched_at_mtn, " +
    "DATE_FORMAT(fetched_at_utc, '%Y-%m-%dT%H:%i:%sZ') fetched_at_utc FROM " + SOURCES +
    " WHERE scope = 'global' OR (scope = 'queue' AND REGEXP_REPLACE(LOWER(queue), '[^a-z0-9]', '') = ?) " +
    'ORDER BY created_at_utc DESC', [nq(queue)]);
}

// Chunks for one source (the expandable "chunks view").
async function list_chunks(source_ref, scope, queue) {
  await ensure();
  const sc = norm_scope(scope); const q = scope_queue(sc, queue);
  return await db.query(
    'SELECT id, chunk_id, category, seq, char_len, excluded, LEFT(text, 400) preview FROM ' + CHUNKS +
    ' WHERE source_ref = ? AND scope = ? AND queue = ? ORDER BY seq ASC', [String(source_ref || ''), sc, q]);
}

async function set_excluded(id, excluded) {
  await ensure();
  await db.query('UPDATE ' + CHUNKS + ' SET excluded = ? WHERE id = ?', [excluded ? 1 : 0, Number(id)]);
  return true;
}

async function remove_source(source_ref, scope, queue) {
  await ensure();
  const sc = norm_scope(scope); const q = scope_queue(sc, queue);
  await db.query('DELETE FROM ' + CHUNKS + ' WHERE source_ref = ? AND scope = ? AND queue = ?', [String(source_ref || ''), sc, q]);
  await db.query('DELETE FROM ' + SOURCES + ' WHERE source_ref = ? AND scope = ? AND queue = ?', [String(source_ref || ''), sc, q]);
  return true;
}

// Retrieval: load the queue's candidate chunks (globals + this queue, not excluded) and rank top-n.
// Returns [{ chunk_id, source_ref, source_title, category, text, score, hits }].
async function select_chunks(queue, question, n) {
  await ensure();
  const top = Math.max(1, Math.min(50, Number(n) || 8));
  const rows = await db.query(
    'SELECT chunk_id, source_ref, source_title, category, text, char_len FROM ' + CHUNKS +
    " WHERE excluded = 0 AND (scope = 'global' OR (scope = 'queue' AND REGEXP_REPLACE(LOWER(queue), '[^a-z0-9]', '') = ?)) " +
    'LIMIT 5000', [nq(queue)]);
  const ranked = chunker.score(rows, question, top);
  return ranked.map(function (r) {
    return {
      chunk_id: r.chunk.chunk_id, source_ref: r.chunk.source_ref, source_title: r.chunk.source_title,
      category: r.chunk.category, text: r.chunk.text, score: r.score, hits: r.hits,
    };
  });
}

// Build a grounding block from selected chunks (mirrors knowledge.load_knowledge's shape).
function knowledge_from_chunks(selected) {
  const list = selected || [];
  if (!list.length) return '';
  const parts = ['=== KNOWLEDGE / CONTEXT (retrieved, most relevant first) ==='];
  list.forEach(function (c) {
    const label = (c.source_title || c.source_ref || 'source') + (c.category ? ' › ' + c.category : '');
    parts.push('-- ' + label + ' --\n' + (c.text || ''));
  });
  return parts.join('\n\n');
}

async function stats() {
  await ensure();
  const rows = await db.query('SELECT COUNT(*) chunks, COUNT(DISTINCT source_ref) sources, SUM(excluded=1) excluded FROM ' + CHUNKS);
  return (rows && rows[0]) || { chunks: 0, sources: 0, excluded: 0 };
}

// ---- embeddings (semantic retrieval) ----
// Candidate chunks for hybrid ranking: same visibility as select_chunks, but ALSO returns the stored vector
// bytes + which model produced them, so grounding can compute a semantic score. Curated text only.
async function candidates(queue) {
  await ensure();
  return await db.query(
    'SELECT chunk_id, source_ref, source_title, category, text, char_len, embedding, embed_model FROM ' + CHUNKS +
    " WHERE excluded = 0 AND (scope = 'global' OR (scope = 'queue' AND REGEXP_REPLACE(LOWER(queue), '[^a-z0-9]', '') = ?)) " +
    'LIMIT 5000', [nq(queue)]);
}
// Store one chunk's vector (Buffer) + the model that produced it. Pass buffer=null to clear.
async function set_chunk_embedding(id, buffer, model) {
  await ensure();
  await db.query('UPDATE ' + CHUNKS + ' SET embedding = ?, embed_model = ? WHERE id = ?', [buffer || null, model || null, Number(id)]);
  return true;
}
// Chunks that still need a vector for `model` (missing OR produced by a different model). For reindex/backfill.
async function chunks_missing_embedding(model, limit) {
  await ensure();
  const lim = Math.max(1, Math.min(1000, Number(limit) || 128));
  return await db.query(
    'SELECT id, text FROM ' + CHUNKS +
    " WHERE excluded = 0 AND text IS NOT NULL AND text <> '' AND (embedding IS NULL OR embed_model IS NULL OR embed_model <> ?) " +
    'ORDER BY id ASC LIMIT ' + lim, [String(model || '')]);
}
// The just-stored chunks for one source (used to embed right after ingest).
async function chunks_for_source(source_ref, scope, queue) {
  await ensure();
  const sc = norm_scope(scope); const q = scope_queue(sc, queue);
  return await db.query('SELECT id, text FROM ' + CHUNKS + ' WHERE source_ref = ? AND scope = ? AND queue = ? AND text IS NOT NULL',
    [String(source_ref || ''), sc, q]);
}
// Index coverage for the current model: total vs embedded / stale (other model) / missing.
async function embedding_status(model) {
  await ensure();
  const m = String(model || '');
  const rows = await db.query(
    'SELECT SUM(excluded = 0) total, ' +
    'SUM(excluded = 0 AND embedding IS NOT NULL AND embed_model = ?) embedded, ' +
    'SUM(excluded = 0 AND embedding IS NOT NULL AND (embed_model IS NULL OR embed_model <> ?)) stale, ' +
    'SUM(excluded = 0 AND embedding IS NULL) missing FROM ' + CHUNKS, [m, m]);
  const r = (rows && rows[0]) || {};
  return { model: m, total: Number(r.total || 0), embedded: Number(r.embedded || 0), stale: Number(r.stale || 0), missing: Number(r.missing || 0) };
}

module.exports = {
  CHUNKS, SOURCES, REPORTING_TZ, ensure,
  upsert_source, replace_source_chunks, list_sources, list_chunks, set_excluded, remove_source,
  select_chunks, knowledge_from_chunks, stats,
  candidates, set_chunk_embedding, chunks_missing_embedding, chunks_for_source, embedding_status,
};
