/**
 * ensure_roster_table.js — guarantees the event_analysis_roster table exists
 * in usat_sales_db. Called from build_all.js at the top of main() so the
 * table is in place before the build's INSERT happens.
 *
 * Idempotent. Uses CREATE TABLE IF NOT EXISTS, so re-runs are a no-op once
 * the table exists. Safe to call on every build. Mirrors the pattern of
 * ensure_overrides_table.js.
 *
 * Standalone usage:
 *   node src/event_analysis/utilities/ensure_roster_table.js
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');

// Load .env from project root regardless of cwd.
// __dirname = sql_programs/src/event_analysis/utilities  →  3 levels up to root.
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');
const { query_create_event_analysis_roster_table }
  = require('../../queries/create_drop_db_table/query_create_event_analysis_roster_table');

const TABLE_NAME = 'event_analysis_roster';

/**
 * Read the current column type from information_schema. Used to decide
 * whether an idempotent ALTER widening is needed.
 */
async function column_type(conn, db, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [db, table, column]
  );
  return rows.length ? rows[0].COLUMN_TYPE : null;
}

/**
 * Idempotently widen a VARCHAR column to at least `target_len` characters.
 * No-op when the column is already wide enough. Logs the upgrade so the
 * build console shows when a real change happened.
 */
async function ensure_varchar_width(conn, db, table, column, target_len, nullable, upgrades) {
  const ctype = await column_type(conn, db, table, column);
  if (!ctype) return;   // column doesn't exist — handled by the CREATE TABLE step
  const m = ctype.match(/^varchar\((\d+)\)/i);
  if (m && Number(m[1]) >= target_len) return;
  const null_clause = nullable ? 'NULL' : 'NOT NULL';
  await conn.query(
    `ALTER TABLE \`${table}\` MODIFY \`${column}\` VARCHAR(${target_len}) ${null_clause}`
  );
  upgrades.push(`widened ${column} → VARCHAR(${target_len})`);
}

/**
 * Ensure the roster table exists. Returns true if a fresh CREATE happened,
 * false if the table was already there.
 * @param {object} [opts]
 * @param {boolean} [opts.silent=false] — suppress console output
 */
async function ensure_roster_table({ silent = false } = {}) {
  const cfg  = await local_usat_sales_db_config();
  const conn = await mysqlP.createConnection(cfg);
  try {
    const [pre] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [cfg.database, TABLE_NAME]
    );
    const existed_before = pre.length > 0;

    const ddl = await query_create_event_analysis_roster_table(TABLE_NAME);
    await conn.query(ddl);

    if (!silent) {
      if (existed_before) {
        console.log(`  ✓ \`${TABLE_NAME}\` already exists — no action.`);
      } else {
        console.log(`  ✓ \`${TABLE_NAME}\` created in \`${cfg.database}\`.`);
      }
    }

    // ── Idempotent column-width upgrades ──────────────────────────────────
    // Earlier schema sized status_* and conf too narrowly for real data
    // ('Data too long for column status_analysis' on insert). These ALTERs
    // widen the columns on existing installs. No-op once the columns are
    // already at target width, so safe to call on every build.
    const upgrades = [];
    await ensure_varchar_width(conn, cfg.database, TABLE_NAME, 'conf',            50, false, upgrades);
    await ensure_varchar_width(conn, cfg.database, TABLE_NAME, 'status_baseline', 64, true,  upgrades);
    await ensure_varchar_width(conn, cfg.database, TABLE_NAME, 'status_analysis', 64, true,  upgrades);
    if (upgrades.length && !silent) {
      console.log(`  ✓ Schema upgrade applied: ${upgrades.join(', ')}`);
    }

    return !existed_before;
  } finally {
    await conn.end();
  }
}

// CLI entry point: `node ensure_roster_table.js`
if (require.main === module) {
  ensure_roster_table().catch(err => {
    console.error('✗ Failed:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { ensure_roster_table, TABLE_NAME };
