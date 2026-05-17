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
async function ensure_overrides_table({ silent = false } = {}) {
  const cfg  = await local_usat_sales_db_config();
  const conn = await mysqlP.createConnection(cfg);
  try {
    // Check whether the table already exists so we can report it cleanly.
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
