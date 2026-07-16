/**
 * database_snapshot.js — Phase 0 of the SQL backbone (see plans_and_notes/README_SQL.md).
 *
 * Loads the fetched Salesforce Account records into a FRESH local MySQL table
 * (`salesforce_account_duplicate_snapshot` in `usat_sales_db`), which the duplicate
 * detection then reads from. The table is dropped and recreated on every run, so it
 * never accumulates in that shared database.
 *
 * Design notes:
 *   - Normalized keys are computed HERE in Node, reusing normalize.js, and stored as
 *     their own columns. SQL never re-normalizes — so a SQL `GROUP BY
 *     exact_duplicate_key` is guaranteed to match the in-memory JS result (no
 *     collation/charset drift). This is the safety guarantee from plans_and_notes/README_SQL.md.
 *   - Records are inserted in BATCHES (multi-row INSERT). The loader is built so the
 *     real pipeline can feed it batches straight off the Salesforce Bulk stream
 *     (insert_batch as each batch fills), keeping Node memory flat at any scale.
 *   - All SQL goes through an injectable `executor(sql, params) -> rows` so the logic
 *     is unit-testable WITHOUT a live MySQL (tests pass a fake executor). The real
 *     executor is built from the existing local-DB helpers.
 */

'use strict';

const {
    norm,
    clean_name,
    composite_zip,
    make_exact_duplicate_key,
    make_rule_key,
} = require('./normalize');
const { SNAPSHOT_TABLE_NAME, DB_INSERT_BATCH_SIZE } = require('../config');

// Column order is the single source of truth for both the CREATE and the INSERT.
// Grouped for readability: identity -> contact info -> demographics -> flags/merge
// -> audit dates -> derived detection keys -> load metadata.
const COLUMNS = [
    // identity
    'salesforce_account_id',
    'name',
    'first_name',
    'last_name',
    'member_number',
    // contact info
    'email',
    'phone',
    'mailing_street',
    'mailing_city',
    'mailing_state',
    'person_mailing_postal_code',
    'billing_postal_code',
    // demographics
    'gender_identity',
    'person_birthdate',
    // flags / merge
    'foundation_constituent',
    'salesforce_merge_id',
    // audit — who/when created and last modified
    'created_date',
    'created_by_id',
    'created_by_name',
    'last_modified_date',
    'last_modified_by_id',
    'last_modified_by_name',
    // derived detection keys (precomputed via normalize.js)
    'clean_first_name',
    'clean_last_name',
    'gender_normalized',
    'birthdate_normalized',
    'composite_zip_five_digit',
    'exact_duplicate_key',
    'rule_block_key',
    // detection result — filled by a post-detection write-back (blank/NULL at load);
    // copied from the consolidated cluster (Match_Composition__c label, best fuzzy name
    // score 0-100, and confidence tier). match_score is 100 for exact-only clusters.
    'match_composition',
    'match_score',
    'confidence_tier',
    'cluster_key',
    'cluster_size',
    // source provenance + load metadata (same for every row in a snapshot:
    // one snapshot = one run = one environment + one org)
    'environment',
    'org_id',
    'org_host',
    'loaded_at',
    'load_sequence',
];

// Salesforce returns ISO timestamps like "2025-05-22T01:59:50.000+0000". Convert to
// the MySQL DATETIME literal "2025-05-22 01:59:50" (the +0000 means it's already UTC).
// Returns null for a blank/missing value so the column stores NULL, not "".
function to_mysql_datetime(iso) {
    const s = (iso || '').trim();
    if (!s) return null;
    return s.slice(0, 19).replace('T', ' ');
}

// Map one fetched Salesforce record to the ordered row of column values. Pure — the
// keys come straight from normalize.js, so they match the in-memory detection exactly.
function to_snapshot_row(record, loaded_at = new Date(), load_sequence = null, meta = {}) {
    return [
        // identity
        record.Id || '',
        record.Name || '',
        record.FirstName || '',
        record.LastName || '',
        record.cfg_Member_Number__pc || '',
        // contact info
        record.PersonEmail || '',
        record.Phone || '',
        record.PersonMailingStreet || '',
        record.PersonMailingCity || '',
        record.PersonMailingState || '',
        record.PersonMailingPostalCode || '',
        record.BillingPostalCode || '',
        // demographics
        record.cfg_Gender_Identity__pc || '',
        record.PersonBirthdate || '',
        // flags / merge
        record.usat_Foundation_Constituent__c || '',
        record.usat_Salesforce_Merge_Id__pc || '',
        // audit — who/when created and last modified
        to_mysql_datetime(record.CreatedDate),
        record.CreatedById || '',
        record.CreatedByName || '',
        to_mysql_datetime(record.LastModifiedDate),
        record.LastModifiedById || '',
        record.LastModifiedByName || '',
        // derived detection keys (computed via normalize.js, so they match in-memory exactly)
        clean_name(record.FirstName),
        clean_name(record.LastName),
        norm(record.cfg_Gender_Identity__pc),
        norm(record.PersonBirthdate),
        composite_zip(record),
        make_exact_duplicate_key(record),
        make_rule_key(record),
        '', // match_composition — blank at load; filled by the post-detection write-back
        null, // match_score — NULL at load (numeric); filled by the write-back
        '', // confidence_tier — blank at load; filled by the write-back
        '', // cluster_key — blank at load; filled by the write-back (its consolidated cluster)
        null, // cluster_size — NULL at load; filled by the write-back
        // source provenance + load metadata (constant across the snapshot)
        meta.environment || '',
        meta.org_id || '',
        meta.org_host || '',
        loaded_at,
        load_sequence,
    ];
}

// DROP + CREATE the fresh table. Key columns use a binary collation so grouping is an
// exact byte match. Indexes are added AFTER the load (faster) via add_indexes().
function create_table_sql(table = SNAPSHOT_TABLE_NAME) {
    return `CREATE TABLE \`${table}\` (
  salesforce_account_id        VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name                         VARCHAR(255),
  first_name                   VARCHAR(255),
  last_name                    VARCHAR(255),
  member_number                VARCHAR(255),
  email                        VARCHAR(255),
  phone                        VARCHAR(64),
  mailing_street               VARCHAR(255),
  mailing_city                 VARCHAR(128),
  mailing_state                VARCHAR(64),
  person_mailing_postal_code   VARCHAR(32),
  billing_postal_code          VARCHAR(32),
  gender_identity              VARCHAR(255),
  person_birthdate             VARCHAR(32),
  foundation_constituent       VARCHAR(32),
  salesforce_merge_id          VARCHAR(255),
  created_date                 DATETIME,
  created_by_id                VARCHAR(20),
  created_by_name              VARCHAR(255),
  last_modified_date           DATETIME,
  last_modified_by_id          VARCHAR(20),
  last_modified_by_name        VARCHAR(255),
  clean_first_name             VARCHAR(255),
  clean_last_name              VARCHAR(255),
  gender_normalized            VARCHAR(255),
  birthdate_normalized         VARCHAR(64),
  composite_zip_five_digit     VARCHAR(32),
  exact_duplicate_key          VARCHAR(800) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  rule_block_key               VARCHAR(600) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  match_composition            VARCHAR(64),
  match_score                  SMALLINT,
  confidence_tier              VARCHAR(16),
  cluster_key                  TEXT,
  cluster_size                 SMALLINT,
  environment                  VARCHAR(16),
  org_id                       VARCHAR(32),
  org_host                     VARCHAR(255),
  loaded_at                    DATETIME,
  load_sequence                INT,
  PRIMARY KEY (salesforce_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

async function recreate_table(executor, table = SNAPSHOT_TABLE_NAME) {
    await executor(`DROP TABLE IF EXISTS \`${table}\``, []);
    await executor(create_table_sql(table), []);
}

// Prefix indexes: a utf8mb4 column indexed in full can exceed InnoDB's 3072-byte
// key limit (800 chars * 4 bytes = 3200). Indexing the first 255 characters stays
// well under the limit and is plenty selective; the column stays full-length so
// GROUP BY on the whole value is still exact.
const KEY_INDEX_PREFIX = 255;

async function add_indexes(executor, table = SNAPSHOT_TABLE_NAME) {
    // Detection keys (used by the SQL backbone / exact grouping).
    await executor(`CREATE INDEX idx_exact_duplicate_key ON \`${table}\` (exact_duplicate_key(${KEY_INDEX_PREFIX}))`, []);
    await executor(`CREATE INDEX idx_rule_block_key ON \`${table}\` (rule_block_key(${KEY_INDEX_PREFIX}))`, []);
    await executor(`CREATE INDEX idx_load_sequence ON \`${table}\` (load_sequence)`, []);
    // R1a — review-page sort/filter/search columns (merge tool's All-accounts view over ~700k rows).
    // Prefix lengths keep each key well under InnoDB's 3072-byte limit. These speed ORDER BY,
    // equality/prefix filters, and the has-merge-id filter; they don't change detection output.
    // last_name is FULL (no prefix) so the All Accounts default `ORDER BY last_name LIMIT 25`
    // reads 25 rows from the index instead of filesorting all ~700k rows; first_name stays a
    // prefix (keeps the key small + still serves prefix name search).
    await executor(`CREATE INDEX idx_last_first ON \`${table}\` (last_name, first_name(100))`, []);
    await executor(`CREATE INDEX idx_salesforce_merge_id ON \`${table}\` (salesforce_merge_id(64))`, []);
    await executor(`CREATE INDEX idx_member_number ON \`${table}\` (member_number(64))`, []);
    await executor(`CREATE INDEX idx_composite_zip5 ON \`${table}\` (composite_zip_five_digit)`, []);
    await executor(`CREATE INDEX idx_birthdate_normalized ON \`${table}\` (birthdate_normalized)`, []);
    await executor(`CREATE INDEX idx_gender_identity ON \`${table}\` (gender_identity(32))`, []);
    // Full single-column indexes (no prefix) so the merge tool's "Match" and "Foundation"
    // facet dropdowns use a loose index scan (a few index reads) instead of a ~700k table
    // scan per GROUP BY — this is what made All Accounts slow once these facets were added.
    await executor(`CREATE INDEX idx_match_composition ON \`${table}\` (match_composition)`, []);
    await executor(`CREATE INDEX idx_foundation_constituent ON \`${table}\` (foundation_constituent)`, []);
    // match_score (SMALLINT) — serves ORDER BY / range filters on the All Accounts "Match score" column.
    await executor(`CREATE INDEX idx_match_score ON \`${table}\` (match_score)`, []);
    // cluster_size (SMALLINT) — serves the All Accounts "in a duplicate cluster" filter + Matches sort.
    await executor(`CREATE INDEX idx_cluster_size ON \`${table}\` (cluster_size)`, []);
    // first_name (prefix) so the global name search — first_name LIKE 'term%' — is index-served,
    // not a full scan (idx_last_first has first_name only as its 2nd column, unusable alone).
    await executor(`CREATE INDEX idx_first_name ON \`${table}\` (first_name(100))`, []);
}

// Build one multi-row INSERT for a batch of already-mapped rows. Returns { sql, params }.
function build_insert(rows, table = SNAPSHOT_TABLE_NAME) {
    const placeholder = `(${COLUMNS.map(() => '?').join(', ')})`;
    const sql = `INSERT INTO \`${table}\` (${COLUMNS.join(', ')}) VALUES ${rows.map(() => placeholder).join(', ')}`;
    const params = rows.flat();
    return { sql, params };
}

async function insert_batch(executor, rows, table = SNAPSHOT_TABLE_NAME) {
    if (rows.length === 0) return 0;
    const { sql, params } = build_insert(rows, table);
    await executor(sql, params);
    return rows.length;
}

// Recreate the table, then stream the records in as batched multi-row INSERTs, then
// add indexes. `records` may be any iterable. Returns the number of rows loaded.
async function load_snapshot(records, {
    executor,
    table = SNAPSHOT_TABLE_NAME,
    batch_size = DB_INSERT_BATCH_SIZE,
    loaded_at = new Date(),
    progress_every = 0,
    on_progress,
    transaction,
    meta = {},   // { environment, org_id, org_host } stamped on every row
} = {}) {
    if (typeof executor !== 'function') throw new Error('load_snapshot requires an executor(sql, params) function');

    await recreate_table(executor, table);

    const total = Array.isArray(records) ? records.length : null;
    let next_mark = progress_every;
    const maybe_progress = () => {
        if (progress_every && typeof on_progress === 'function' && loaded >= next_mark) {
            on_progress(loaded, total);
            next_mark += progress_every;
        }
    };

    if (transaction) await transaction.begin();

    let loaded = 0;
    let batch = [];
    const seen = new Set();
    try {
    for (const record of records) {
        const id = record && record.Id;
        // Skip blank Ids and the Bulk API CSV header row, which jsforce can leak as a
        // record ({ Id: 'Id', ... }) — once per result chunk on large extracts.
        if (!id || id === 'Id') continue;
        // Dedupe by exact (case-sensitive) Id, guarding against any repeated rows
        // across Bulk download chunks. Distinct IDs differing only by case are kept.
        if (seen.has(id)) continue;
        seen.add(id);
        batch.push(to_snapshot_row(record, loaded_at, loaded + batch.length, meta));
        if (batch.length >= batch_size) {
            loaded += await insert_batch(executor, batch, table);
            batch = [];
            maybe_progress();
        }
    }
    if (batch.length > 0) loaded += await insert_batch(executor, batch, table);
    if (transaction) await transaction.commit();
    } catch (e) {
        if (transaction) { try { await transaction.rollback(); } catch (_) { /* ignore */ } }
        throw e;
    }

    await add_indexes(executor, table);
    return loaded;
}

// --- Reading back: DB rows -> the record shape the sweep/detection engine expects ---
// The inverse of to_snapshot_row's raw columns. The engine recomputes keys from these
// raw fields, so only the raw columns are needed (not the precomputed key columns).
function record_from_row(row) {
    return {
        Id: row.salesforce_account_id || '',
        LastName: row.last_name || '',
        FirstName: row.first_name || '',
        cfg_Member_Number__pc: row.member_number || '',
        cfg_Gender_Identity__pc: row.gender_identity || '',
        usat_Foundation_Constituent__c: row.foundation_constituent || '',
        usat_Salesforce_Merge_Id__pc: row.salesforce_merge_id || '',
        PersonBirthdate: row.person_birthdate || '',
        BillingPostalCode: row.billing_postal_code || '',
        PersonMailingPostalCode: row.person_mailing_postal_code || '',
    };
}

async function read_records(executor, table = SNAPSHOT_TABLE_NAME) {
    const rows = await executor(
        `SELECT salesforce_account_id, last_name, first_name, member_number, gender_identity,
                foundation_constituent, salesforce_merge_id, person_birthdate,
                billing_postal_code, person_mailing_postal_code
         FROM \`${table}\` ORDER BY load_sequence`, []);
    return rows.map(record_from_row);
}

async function count_rows(executor, table = SNAPSHOT_TABLE_NAME) {
    const rows = await executor(`SELECT COUNT(*) AS n FROM \`${table}\``, []);
    return Number(rows[0] ? rows[0].n : 0);
}

// Post-detection write-back: stamp each account in a consolidated cluster with its
// cluster's Match_Composition__c (e.g. "exact only", "fuzzy + nickname"). Accounts in
// no cluster keep the blank loaded default. Updates only matched accounts (a small
// fraction), grouped by composition so each value is one batched UPDATE. Returns the
// number of accounts updated.
async function update_match_composition(executor, clusters, table = SNAPSHOT_TABLE_NAME, batch = 1000) {
    // Stamp each account with its consolidated cluster's fields: the Match_Composition label, the best
    // fuzzy name score 0-100 (exact-only clusters have no fuzzy link, so surface those as 100), the
    // confidence tier, and the cluster key + size (so All Accounts can badge/open the cluster). One
    // UPDATE per cluster (its record_ids), chunked only for very large clusters.
    let updated = 0;
    for (const c of clusters || []) {
        const ids = String(c.record_ids || '').split(';').filter(Boolean);
        if (!ids.length) continue;
        const comp = c.match_composition || '';
        const tier = c.confidence_tier || '';
        const score = (c.best_pair_score === '' || c.best_pair_score == null)
            ? (tier === 'exact' ? 100 : null)
            : Number(c.best_pair_score);
        const cluster_key = c.consolidated_group_key || '';
        const cluster_size = c.group_record_count != null ? Number(c.group_record_count) : ids.length;
        for (let i = 0; i < ids.length; i += batch) {
            const chunk = ids.slice(i, i + batch);
            const placeholders = chunk.map(() => '?').join(',');
            await executor(
                `UPDATE \`${table}\` SET match_composition = ?, match_score = ?, confidence_tier = ?, cluster_key = ?, cluster_size = ? WHERE salesforce_account_id IN (${placeholders})`,
                [comp, score, tier, cluster_key, cluster_size, ...chunk]);
            updated += chunk.length;
        }
    }
    return updated;
}
// --- Real connection (not exercised by unit tests; used by the pipeline) ----------
// A DEDICATED single-connection executor (transactions live on one connection, so a
// pooled query-per-call executor can't hold a transaction). close() releases + ends.
async function open_local_connection() {
    const { create_local_db_connection } = require('../../../utilities/connectionLocalDB');
    const { local_usat_sales_db_config } = require('../../../utilities/config');
    const pool = await create_local_db_connection(await local_usat_sales_db_config());
    const conn = await pool.promise().getConnection();
    const executor = async (sql, params) => {
        const [rows] = await conn.query(sql, params);
        return rows;
    };
    const close = () => {
        try { conn.release(); } catch (_) { /* ignore */ }
        try { pool.end(); } catch (_) { /* ignore */ }
    };
    return { conn, executor, close };
}

// Opens a pool on the local USAT database and returns { pool, executor }. The executor
// adapts mysql2's pool.query to the (sql, params) -> rows shape the loader expects.
async function open_local_executor() {
    // Lazy requires so importing this module (e.g. in tests) never needs mysql2/SSH.
    const { create_local_db_connection } = require('../../../utilities/connectionLocalDB');
    const { local_usat_sales_db_config } = require('../../../utilities/config');

    const pool = await create_local_db_connection(await local_usat_sales_db_config());
    const executor = async (sql, params) => {
        const [rows] = await pool.promise().query(sql, params);
        return rows;
    };
    return { pool, executor };
}

// Phase 2: stream records into the snapshot table, then read them back in fetch order
// (ORDER BY load_sequence). Used by the finder so detection runs OFF the database. The
// returned records carry the same raw fields in the same order as the input, so the
// finder's output is byte-identical to the in-memory path (proven by tests).

async function materialize_via_db(records, { progress_every = 0, on_progress, meta = {} } = {}) {
    const { conn, executor, close } = await open_local_connection();
    try {
        const loaded = await load_snapshot(records, {
            executor, progress_every, on_progress, meta,
            transaction: {
                begin: () => conn.beginTransaction(),
                commit: () => conn.commit(),
                rollback: () => conn.rollback(),
            },
        });
        const out = await read_records(executor);
        return { records: out, loaded };
    } finally {
        close();
    }
}

// Convenience: open the local DB, load the snapshot, close the pool. Returns the count.
async function load_snapshot_to_local_db(records, opts = {}) {
    const { pool, executor } = await open_local_executor();
    try {
        return await load_snapshot(records, { executor, ...opts });
    } finally {
        try { pool.end(); } catch (_) { /* ignore */ }
    }
}

module.exports = {
    COLUMNS,
    to_snapshot_row,
    create_table_sql,
    recreate_table,
    add_indexes,
    build_insert,
    insert_batch,
    load_snapshot,
    record_from_row,
    read_records,
    count_rows,
    update_match_composition,
    open_local_executor,
    open_local_connection,
    materialize_via_db,
    load_snapshot_to_local_db,
};
