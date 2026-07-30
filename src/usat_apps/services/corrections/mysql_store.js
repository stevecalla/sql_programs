'use strict';
// Production storage for operator corrections. Table: salesforce_email_queue_corrections.
// NOTE: wired + verified against the live pool in Phase 2 (module API). Phase 1 unit tests use an
// in-memory store, so this file is not exercised by run_tests.js yet.
const { ensure_table } = require('../../../../utilities/analytics/ensure_table');
const db = require('../../store/db');

const TABLE = 'salesforce_email_queue_corrections';
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

async function create_store() {
  const pool = await db.get_pool();
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
