#!/usr/bin/env node
/**
 * Step 1 — Create the event_analysis_overrides table in usat_sales_db.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS. Safe to run multiple times.
 * Approval columns are included from day one so we never need a follow-up
 * migration to add them.
 *
 * Run from anywhere:
 *   node src/event_analysis/db_setup/create_overrides_table.js
 *
 * After it succeeds, verify with:
 *   SHOW CREATE TABLE event_analysis_overrides;
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');

// Load .env from project root regardless of cwd.
// __dirname = sql_programs/src/event_analysis/db_setup  →  3 levels up to root.
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');

const TABLE_NAME = 'event_analysis_overrides';

// ── DDL ─────────────────────────────────────────────────────────────────────
// Columns are grouped so future readers can see the rationale:
//
//   identity ......... id
//   override payload . override_type, sid_25, sid_26, segment, note
//   lifecycle ........ active, approved, approval_state, approved_by, approved_at
//   audit ............ created_at, created_by, updated_at
//
// Indexes cover the two most common access patterns:
//   - "fetch overrides for a sanction ID"     → idx_sid_25, idx_sid_26
//   - "fetch all active overrides of a type"  → idx_type_active
//   - "fetch approved/stale rows"             → idx_approved
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS \`${TABLE_NAME}\` (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    override_type ENUM('force_match', 'force_no_match', 'force_segment') NOT NULL,
    sid_25 VARCHAR(64) NULL,
    sid_26 VARCHAR(64) NULL,
    segment ENUM('Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return') NULL,
    note TEXT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    approved TINYINT(1) NOT NULL DEFAULT 0,
    approval_state ENUM('approved', 'stale', 'revoked') NULL,
    approved_by VARCHAR(128) NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(128) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_sid_25 (sid_25),
    INDEX idx_sid_26 (sid_26),
    INDEX idx_type_active (override_type, active),
    INDEX idx_approved (approved),
    CONSTRAINT chk_match_requires_pair CHECK (
      override_type <> 'force_match' OR (sid_25 IS NOT NULL AND sid_26 IS NOT NULL)
    ),
    CONSTRAINT chk_segment_requires_value CHECK (
      override_type <> 'force_segment' OR segment IS NOT NULL
    )
  ) ENGINE = InnoDB
    DEFAULT CHARSET = utf8mb4
    COLLATE = utf8mb4_unicode_ci
    COMMENT = 'Manual matching/segment overrides for event_analysis. Replaces data/overrides.json.';
`;

async function main() {
  const cfg = await local_usat_sales_db_config();
  const conn = await mysqlP.createConnection(cfg);
  try {
    console.log(`Creating \`${TABLE_NAME}\` in \`${cfg.database}\`...`);
    await conn.query(CREATE_TABLE_SQL);

    // Confirm it exists (idempotent check).
    const [rows] = await conn.query(
      `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [cfg.database, TABLE_NAME]
    );
    if (rows.length === 0) {
      throw new Error(`Table \`${TABLE_NAME}\` was not created — check DDL or permissions.`);
    }
    console.log(`✓ Table \`${TABLE_NAME}\` is in place (estimated rows: ${rows[0].TABLE_ROWS}).`);

    // Show the columns so the user can sanity-check the schema.
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [cfg.database, TABLE_NAME]
    );
    console.log('\nColumns:');
    for (const c of cols) {
      console.log(
        `  ${c.COLUMN_NAME.padEnd(18)} ${c.COLUMN_TYPE.padEnd(70)}` +
        ` ${c.IS_NULLABLE === 'YES' ? 'NULL    ' : 'NOT NULL'}` +
        ` default=${c.COLUMN_DEFAULT === null ? '(none)' : c.COLUMN_DEFAULT}`
      );
    }

    // Show the indexes so the user can confirm they all landed.
    const [idx] = await conn.query(
      `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        GROUP BY INDEX_NAME`,
      [cfg.database, TABLE_NAME]
    );
    console.log('\nIndexes:');
    for (const i of idx) {
      console.log(`  ${i.INDEX_NAME.padEnd(22)} (${i.cols})`);
    }
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('✗ Failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
