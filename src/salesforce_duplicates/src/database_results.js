/**
 * database_results.js — Phase 3: persist run metadata (and, later, result tables) to
 * the local DB.
 *
 * The unified RUN table (`salesforce_duplicate_detection_run`) is written by BOTH the
 * finder and the tuning sweep — one row per run — so a single table describes "the
 * entire process" and `status` can read the latest run regardless of which produced
 * it. Unlike the snapshot table (dropped each run), the run table ACCUMULATES history
 * (CREATE IF NOT EXISTS, one row per run_id).
 *
 * All SQL goes through an injectable `executor(sql, params) -> rows`, so the logic is
 * unit-testable without a live MySQL.
 */

'use strict';

const {
    RUN_TABLE_NAME,
    RESULT_EXACT_GROUP_TABLE,
    RESULT_FUZZY_PAIR_TABLE,
    RESULT_FUZZY_GROUP_TABLE,
    RESULT_NICKNAME_PAIR_TABLE,
    RESULT_NICKNAME_GROUP_TABLE,
    RESULT_CONSOLIDATED_TABLE,
} = require('../config');

const RESULT_INSERT_BATCH_SIZE = 2000;

// Column order is the single source of truth for the CREATE and the INSERT.
const RUN_COLUMNS = [
    'run_id',
    'run_type',                 // 'finder' | 'snapshot'
    'mode',                     // 'test' | 'prod'
    'is_full',
    'is_partial',
    'run_at',                   // ISO timestamp string
    'run_seconds',              // wall-clock duration of the run, in seconds
    'total_records_scanned',
    'salesforce_total_size',
    'exact_duplicate_groups',
    'fuzzy_pair_matches',
    'fuzzy_groups',
    'nickname_pair_matches',
    'nickname_groups',
    'consolidated_clusters',
];

function create_run_table_sql(table = RUN_TABLE_NAME) {
    return `CREATE TABLE IF NOT EXISTS \`${table}\` (
  run_id                   VARCHAR(64) NOT NULL,
  run_type                 VARCHAR(16),
  mode                     VARCHAR(16),
  is_full                  TINYINT,
  is_partial               TINYINT,
  run_at                   VARCHAR(40),
  run_seconds              INT,
  total_records_scanned    INT,
  salesforce_total_size    INT,
  exact_duplicate_groups   INT,
  fuzzy_pair_matches       INT,
  fuzzy_groups             INT,
  nickname_pair_matches    INT,
  nickname_groups          INT,
  consolidated_clusters    INT,
  PRIMARY KEY (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

async function ensure_run_table(executor, table = RUN_TABLE_NAME) {
    await executor(create_run_table_sql(table), []);
    // Additive migration: tables created before run_seconds existed need the column added so the
    // REPLACE below (which lists every RUN_COLUMN) doesn't fail. Wrapped so it's a no-op once present.
    try { await executor(`ALTER TABLE \`${table}\` ADD COLUMN run_seconds INT`, []); } catch (e) { /* column already exists */ }
}

function run_row_params(run) {
    return [
        String(run.run_id || ''),
        run.run_type || '',
        run.mode || '',
        run.is_full ? 1 : 0,
        run.is_partial ? 1 : 0,
        run.run_at || new Date().toISOString(),
        num(run.run_seconds),
        num(run.total_records_scanned),
        num(run.salesforce_total_size),
        num(run.exact_duplicate_groups),
        num(run.fuzzy_pair_matches),
        num(run.fuzzy_groups),
        num(run.nickname_pair_matches),
        num(run.nickname_groups),
        num(run.consolidated_clusters),
    ];
}

function num(v) {
    return v === null || v === undefined || v === '' ? null : Number(v);
}

// Write one run row (idempotent by run_id via REPLACE). Ensures the table first.
async function write_run(executor, run, table = RUN_TABLE_NAME) {
    await ensure_run_table(executor, table);
    const placeholders = RUN_COLUMNS.map(() => '?').join(', ');
    await executor(
        `REPLACE INTO \`${table}\` (${RUN_COLUMNS.join(', ')}) VALUES (${placeholders})`,
        run_row_params(run));
}

// Read the most recent run (by run_at), or null if the table is empty / missing.
async function read_latest_run(executor, { table = RUN_TABLE_NAME, run_type } = {}) {
    let rows;
    const where = run_type ? 'WHERE run_type = ?' : '';
    const params = run_type ? [run_type] : [];
    try {
        rows = await executor(`SELECT ${RUN_COLUMNS.join(', ')} FROM \`${table}\` ${where} ORDER BY run_at DESC LIMIT 1`, params);
    } catch (e) {
        if (/doesn't exist|Unknown table/i.test(e.message)) return null;
        throw e;
    }
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
        ...r,
        is_full: !!r.is_full,
        is_partial: !!r.is_partial,
    };
}

// --- Result tables (Phase 3) -------------------------------------------------------
// Persist one output view (an array of flat {__c: value} rows) into its own table.
// REFRESH semantics: drop + recreate each run (no history; the run table holds that).
// Columns are inferred from the row keys; every column is TEXT (the rows are already
// CSV-shaped strings/numbers). An empty view drops the table and creates nothing.
function to_cell(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
}

async function write_result_table(executor, table, rows, { batch_size = RESULT_INSERT_BATCH_SIZE } = {}) {
    await executor(`DROP TABLE IF EXISTS \`${table}\``, []);
    if (!rows || rows.length === 0) return 0;

    const columns = Object.keys(rows[0]);
    const col_defs = columns.map((c) => `\`${c}\` TEXT`).join(',\n  ');
    await executor(`CREATE TABLE \`${table}\` (\n  ${col_defs}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, []);

    const placeholder = `(${columns.map(() => '?').join(', ')})`;
    const col_list = columns.map((c) => `\`${c}\``).join(', ');
    let written = 0;
    for (let i = 0; i < rows.length; i += batch_size) {
        const batch = rows.slice(i, i + batch_size);
        const sql = `INSERT INTO \`${table}\` (${col_list}) VALUES ${batch.map(() => placeholder).join(', ')}`;
        const params = batch.flatMap((r) => columns.map((c) => to_cell(r[c])));
        await executor(sql, params);
        written += batch.length;
    }
    return written;
}

// Write all six output views to their per-view tables. `sets` keys map to config names.
async function write_all_result_tables(executor, sets = {}) {
    const map = [
        [RESULT_EXACT_GROUP_TABLE, sets.exact_group],
        [RESULT_FUZZY_PAIR_TABLE, sets.fuzzy_pair],
        [RESULT_FUZZY_GROUP_TABLE, sets.fuzzy_group],
        [RESULT_NICKNAME_PAIR_TABLE, sets.nickname_pair],
        [RESULT_NICKNAME_GROUP_TABLE, sets.nickname_group],
        [RESULT_CONSOLIDATED_TABLE, sets.consolidated],
    ];
    const counts = {};
    for (const [table, rows] of map) {
        counts[table] = await write_result_table(executor, table, rows || []);
    }
    return counts;
}

module.exports = {
    RUN_COLUMNS,
    write_result_table,
    write_all_result_tables,
    create_run_table_sql,
    ensure_run_table,
    run_row_params,
    write_run,
    read_latest_run,
};
