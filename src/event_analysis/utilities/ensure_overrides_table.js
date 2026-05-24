/**
 * ensure_overrides_table.js — guarantees the event_analysis_overrides table
 * exists in usat_sales_db. Called from build_all.js at the top of main()
 * so the table is in place before anything else runs.
 *
 * Idempotent. Uses CREATE TABLE IF NOT EXISTS, so re-runs are a no-op once
 * the table exists. Safe to call on every build.
 *
 * Standalone usage:
 *   node src/event_analysis/utilities/ensure_overrides_table.js
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');

// Load .env from project root regardless of cwd.
// __dirname = sql_programs/src/event_analysis/utilities  →  3 levels up to root.
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');
const { query_create_event_analysis_overrides_table }
  = require('../../queries/create_drop_db_table/query_create_event_analysis_overrides_table');

const TABLE_NAME = 'event_analysis_overrides';

/**
 * Ensure the overrides table exists. Returns true if a fresh CREATE happened,
 * false if the table was already there.
 * @param {object} [opts]
 * @param {boolean} [opts.silent=false] — suppress console output
 */
/**
 * Check whether a specific column exists on a table. Used to make ALTER TABLE
 * ADD COLUMN idempotent without relying on MySQL's "IF NOT EXISTS" clause
 * (which is only supported on newer server versions).
 */
async function column_exists(conn, db, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [db, table, column]
  );
  return rows.length > 0;
}

/** Check whether a specific index exists on a table (idempotent ADD INDEX guard). */
async function index_exists(conn, db, table, index_name) {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    [db, table, index_name]
  );
  return rows.length > 0;
}

async function ensure_overrides_table({ silent = false } = {}) {
  const cfg  = await local_usat_sales_db_config();
  const conn = await mysqlP.createConnection(cfg);
  try {
    // ── Step A: ensure the table exists at all ───────────────────────────
    const [pre] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [cfg.database, TABLE_NAME]
    );
    const existed_before = pre.length > 0;

    const ddl = await query_create_event_analysis_overrides_table(TABLE_NAME);
    await conn.query(ddl);

    if (!silent) {
      if (existed_before) {
        console.log(`  ✓ \`${TABLE_NAME}\` already exists — no action.`);
      } else {
        console.log(`  ✓ \`${TABLE_NAME}\` created in \`${cfg.database}\`.`);
      }
    }

    // ── Step B: idempotent year-scoping upgrade ───────────────────────────
    // Tables created before Step 2.5 won't have the year columns. Add them
    // if missing, then add the supporting index. Both checks are cheap.
    const upgrades = [];

    // Old-schema rename: sid_25 → sid_baseline, sid_26 → sid_analysis
    if (await column_exists(conn, cfg.database, TABLE_NAME, 'sid_25')) {
      await conn.query(`ALTER TABLE \`${TABLE_NAME}\` RENAME COLUMN sid_25 TO sid_baseline`);
      upgrades.push('+ renamed column sid_25 → sid_baseline');
    }
    if (await column_exists(conn, cfg.database, TABLE_NAME, 'sid_26')) {
      await conn.query(`ALTER TABLE \`${TABLE_NAME}\` RENAME COLUMN sid_26 TO sid_analysis`);
      upgrades.push('+ renamed column sid_26 → sid_analysis');
    }
    if (await index_exists(conn, cfg.database, TABLE_NAME, 'idx_sid_25')) {
      await conn.query(`ALTER TABLE \`${TABLE_NAME}\` DROP INDEX idx_sid_25`);
      await conn.query(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_sid_baseline (sid_baseline)`);
      upgrades.push('+ renamed index idx_sid_25 → idx_sid_baseline');
    }
    if (await index_exists(conn, cfg.database, TABLE_NAME, 'idx_sid_26')) {
      await conn.query(`ALTER TABLE \`${TABLE_NAME}\` DROP INDEX idx_sid_26`);
      await conn.query(`ALTER TABLE \`${TABLE_NAME}\` ADD INDEX idx_sid_analysis (sid_analysis)`);
      upgrades.push('+ renamed index idx_sid_26 → idx_sid_analysis');
    }

    if (!await column_exists(conn, cfg.database, TABLE_NAME, 'baseline_year')) {
      await conn.query(
        `ALTER TABLE \`${TABLE_NAME}\`
           ADD COLUMN baseline_year SMALLINT UNSIGNED NULL AFTER override_type`
      );
      upgrades.push('+ column baseline_year');
    }
    if (!await column_exists(conn, cfg.database, TABLE_NAME, 'analysis_year')) {
      await conn.query(
        `ALTER TABLE \`${TABLE_NAME}\`
           ADD COLUMN analysis_year SMALLINT UNSIGNED NULL AFTER baseline_year`
      );
      upgrades.push('+ column analysis_year');
    }
    if (!await index_exists(conn, cfg.database, TABLE_NAME, 'idx_year_pair')) {
      await conn.query(
        `ALTER TABLE \`${TABLE_NAME}\`
           ADD INDEX idx_year_pair (baseline_year, analysis_year, active)`
      );
      upgrades.push('+ index idx_year_pair');
    }

    // ── Step 6: stale-approval signature columns ──────────────────────────
    // Approve captures `{name}|{month}|{type}|{status}` for each side. The
    // build recomputes these from current event state; a mismatch flips
    // approval_state to 'stale' and emits a warning.
    if (!await column_exists(conn, cfg.database, TABLE_NAME, 'event_signature_baseline')) {
      await conn.query(
        `ALTER TABLE \`${TABLE_NAME}\`
           ADD COLUMN event_signature_baseline VARCHAR(255) NULL AFTER approved_at`
      );
      upgrades.push('+ column event_signature_baseline');
    }
    if (!await column_exists(conn, cfg.database, TABLE_NAME, 'event_signature_analysis')) {
      await conn.query(
        `ALTER TABLE \`${TABLE_NAME}\`
           ADD COLUMN event_signature_analysis VARCHAR(255) NULL AFTER event_signature_baseline`
      );
      upgrades.push('+ column event_signature_analysis');
    }

    // ── Step 10: per-side segment columns for force_no_match unlink ────────
    // When force_no_match carries both sids, these control which segment
    // each side lands in (default Lost / New).
    if (!await column_exists(conn, cfg.database, TABLE_NAME, 'segment_baseline')) {
      await conn.query(
        `ALTER TABLE \`${TABLE_NAME}\`
           ADD COLUMN segment_baseline ENUM('Retained','Shifted','Lost','New','Recovered','Tried to Return') NULL AFTER segment`
      );
      upgrades.push('+ column segment_baseline');
    }
    if (!await column_exists(conn, cfg.database, TABLE_NAME, 'segment_analysis')) {
      await conn.query(
        `ALTER TABLE \`${TABLE_NAME}\`
           ADD COLUMN segment_analysis ENUM('Retained','Shifted','Lost','New','Recovered','Tried to Return') NULL AFTER segment_baseline`
      );
      upgrades.push('+ column segment_analysis');
    }

    // ── Invariant backfill: not active ⇒ not approved ───────────────────────
    // An inactive override should never carry approved=1 -- that's a
    // contradiction (you cannot endorse an override that no longer applies).
    // Older soft-delete code only set active=0 and left approved=1 in place.
    // This UPDATE cleans up any historical rows that violate the invariant.
    // Idempotent: subsequent builds find 0 rows and noop.
    const [inv_rows] = await conn.query(
      `UPDATE \`${TABLE_NAME}\`
          SET approved = 0, approval_state = NULL
        WHERE active = 0
          AND (approved = 1 OR approval_state IS NOT NULL)`
    );
    if (inv_rows.affectedRows > 0) {
      upgrades.push(`backfilled ${inv_rows.affectedRows} inactive row(s) approved->0`);
    }

    if (upgrades.length && !silent) {
      console.log(`  ✓ Schema upgrade applied: ${upgrades.join(', ')}`);
    }

    // ── Step C: backfill year columns on any existing rows that are NULL ──
    // Uses the current build's BASELINE_YEAR / ANALYSIS_YEAR. Rows added
    // before Step 2.5 had no year scope; the safest assumption is that
    // they were created during the currently-active comparison.
    const baseline_year = Number(process.env.BASELINE_YEAR)
      || (Number(process.env.ANALYSIS_YEAR) ? Number(process.env.ANALYSIS_YEAR) - 1 : new Date().getFullYear() - 1);
    const analysis_year = Number(process.env.ANALYSIS_YEAR) || new Date().getFullYear();

    const [filled] = await conn.query(
      `UPDATE \`${TABLE_NAME}\`
          SET baseline_year = ?, analysis_year = ?
        WHERE baseline_year IS NULL
          AND analysis_year IS NULL
          AND active = 1`,
      [baseline_year, analysis_year]
    );
    if (filled.affectedRows > 0 && !silent) {
      console.log(`  ✓ Backfilled ${filled.affectedRows} active row(s) with (baseline_year=${baseline_year}, analysis_year=${analysis_year}).`);
    }

    return !existed_before;
  } finally {
    await conn.end();
  }
}

// CLI entry point: `node ensure_overrides_table.js`
if (require.main === module) {
  ensure_overrides_table().catch(err => {
    console.error('✗ Failed:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { ensure_overrides_table };
