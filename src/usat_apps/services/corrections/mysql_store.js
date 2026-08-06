'use strict';
// Production storage for operator corrections. Table: knowledge_corrections (shared brain — used by the
// email queue AND the AI Chat Bot). Renamed from salesforce_email_queue_corrections (shared-brain plan,
// item 5): on first use the store auto-renames the old table to the new name (data preserved), so no
// manual SQL migration is needed. NOTE: wired + verified against the live pool in Phase 2 (module API).
const { ensure_table } = require('../../../../utilities/analytics/ensure_table');
const db = require('../../store/db');

const TABLE = 'knowledge_corrections';
const OLD_TABLE = 'salesforce_email_queue_corrections';
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  id VARCHAR(40) PRIMARY KEY,
  created_at DATETIME NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  scope VARCHAR(16) NOT NULL DEFAULT 'global',
  author VARCHAR(120) NOT NULL DEFAULT '',
  queue VARCHAR(120) NOT NULL DEFAULT '',
  case_id VARCHAR(40) NOT NULL DEFAULT '',
  question TEXT NULL,
  note TEXT NOT NULL,
  INDEX idx_active (active),
  INDEX idx_scope (scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function to_sql_dt(iso) { return String(iso || '').slice(0, 19).replace('T', ' ') || null; }

// One-time, self-healing rename: if the new table doesn't exist yet but the old one does, RENAME it
// (preserves data). If neither exists, ensure_table() creates the new one fresh. Safe to run every boot.
async function table_exists(pool, name) {
  const [rows] = await pool.query('SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [name]);
  return !!(rows && rows[0] && Number(rows[0].c) > 0);
}
async function migrate_if_needed(pool) {
  try {
    if (await table_exists(pool, TABLE)) return;
    if (await table_exists(pool, OLD_TABLE)) await pool.query('RENAME TABLE `' + OLD_TABLE + '` TO `' + TABLE + '`');
  } catch (e) { /* fall through — ensure_table creates the new table if the rename didn't happen */ }
}

async function create_store() {
  const pool = await db.get_pool();
  await migrate_if_needed(pool);
  await ensure_table(pool, DDL);
  return {
    async insert(rec) {
      await db.query(
        'INSERT INTO ' + TABLE + ' (id, created_at, active, scope, author, queue, case_id, question, note) VALUES (?,?,?,?,?,?,?,?,?)',
        [rec.id, to_sql_dt(rec.created_at), rec.active ? 1 : 0, rec.scope, rec.author, rec.queue, rec.case_id, rec.question, rec.note]
      );
      return rec;
    },
    async all() {
      return await db.query('SELECT id, created_at, active, scope, author, queue, case_id, question, note FROM ' + TABLE + ' ORDER BY created_at ASC');
    }
  };
}
module.exports = { create_store, TABLE, DDL };
