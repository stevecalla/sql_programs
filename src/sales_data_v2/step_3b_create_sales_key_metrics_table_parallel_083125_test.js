// Load environment variables
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP = require('mysql2/promise');

const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { step_1_member_minimum_first_created_at_dates_query } = require('../queries/sales_data_key_metrics/step_1_get_sales_data_010425');
const { step_2_member_min_created_at_date_query } = require('../queries/sales_data_key_metrics/step_2_get_sales_data_010425');
const { step_3_member_total_life_time_purchases_query } = require('../queries/sales_data_key_metrics/step_3_get_sales_data_010425');
const { step_4_member_age_dimensions_query } = require('../queries/sales_data_key_metrics/step_4_get_sales_data_010425');
const { step_5_member_age_at_sale_date_query } = require('../queries/sales_data_key_metrics/step_5_get_sales_data_010425');
const { step_5a_member_age_at_end_of_year_of_sale_query } = require('../queries/sales_data_key_metrics/step_5a_get_sales_data_010425');
const { step_6_membership_period_stats_query } = require('../queries/sales_data_key_metrics/step_6_get_sales_data_010425');
const { step_7_prior_purchase_query_v2 } = require('../queries/sales_data_key_metrics/step_7_get_sales_data_010425');
const { step_8_sales_key_stats_2015_query } = require('../queries/sales_data_key_metrics/step_8a_get_sales_data_082925_query');
const { step_8b_create_indexes } = require('../queries/sales_data_key_metrics/step_8b_get_sales_data_010425_indexes');

// ------ helpers to introspect columns ------
function stripTrailingSemicolons(sql) {
  return sql.replace(/;+\s*$/g, '');
}

async function logServerConnections(dstConn) {
  const [vars] = await dstConn.query("SHOW VARIABLES LIKE 'max_connections'");
  const [status] = await dstConn.query("SHOW STATUS LIKE 'Threads_connected'");
  const [userMax] = await dstConn.query("SHOW VARIABLES LIKE 'max_user_connections'");

  const maxConnections = vars[0]?.Value ?? vars[0]?.value;
  const threadsConnected = status[0]?.Value ?? status[0]?.value;
  const maxUserConn = userMax[0]?.Value ?? userMax[0]?.value;

  console.log(`max_connections     = ${maxConnections}`);
  console.log(`Threads_connected   = ${threadsConnected}`);
  console.log(`max_user_connections= ${maxUserConn}  (0 means unlimited)`);
}

/**
 * Create a throwaway VIEW from your SELECT (with WHERE 1=0) to learn its output columns,
 * then intersect with target table columns (ordered by target's ORDINAL_POSITION).
 * Returns { columns: string[], pkColumns: string[] }
 */
// async function computeInsertAndPkColumns(conn, targetTable, selectForColumnsSql) {
//   const viewName = `__v_src_${targetTable}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

//   // 1) Create a view with zero rows (structure only)
//   const ddl = `CREATE OR REPLACE VIEW \`${viewName}\` AS ${stripTrailingSemicolons(selectForColumnsSql)}`;
//   await conn.query(`DROP VIEW IF EXISTS \`${viewName}\``);
//   await conn.query(ddl);

//   try {
//     // 2) Columns in the target table (ordered)
//     const [targetCols] = await conn.query(
//       `
//       SELECT COLUMN_NAME
//       FROM INFORMATION_SCHEMA.COLUMNS
//       WHERE TABLE_SCHEMA = DATABASE()
//         AND TABLE_NAME   = ?
//         AND UPPER(COALESCE(EXTRA,'')) NOT LIKE '%GENERATED%'
//       ORDER BY ORDINAL_POSITION
//       `,
//       [targetTable]
//     );

//     // 3) Columns exposed by the view (same names as your SELECT aliases)
//     const [viewCols] = await conn.query(
//       `
//       SELECT COLUMN_NAME
//       FROM INFORMATION_SCHEMA.COLUMNS
//       WHERE TABLE_SCHEMA = DATABASE()
//         AND TABLE_NAME   = ?
//       ORDER BY ORDINAL_POSITION
//       `,
//       [viewName]
//     );

//     const viewSet = new Set(viewCols.map(r => r.COLUMN_NAME));
//     const columns = targetCols
//       .map(r => r.COLUMN_NAME)
//       .filter(c => viewSet.has(c));  // intersection in target order

//     if (columns.length === 0) {
//       throw new Error(`No overlapping columns between target table ${targetTable} and SELECT.`);
//     }

//     // 4) Primary key columns (to exclude from UPDATE list)
//     const [pkRows] = await conn.query(
//       `
//       SELECT COLUMN_NAME
//       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
//       WHERE TABLE_SCHEMA   = DATABASE()
//         AND TABLE_NAME     = ?
//         AND CONSTRAINT_NAME = 'PRIMARY'
//       ORDER BY ORDINAL_POSITION
//       `,
//       [targetTable]
//     );
//     const pkColumns = pkRows.map(r => r.COLUMN_NAME);

//     return { columns, pkColumns };
//   } finally {
//     await conn.query(`DROP VIEW IF EXISTS \`${viewName}\``);
//   }
// }
async function computeInsertAndPkColumns(conn, targetTable, selectForColumnsSql) {
  // 1) Get source column names by executing the SELECT as a derived table with zero rows
  const metaSql = `
    SELECT *
    FROM (
      ${stripTrailingSemicolons(selectForColumnsSql)}
    ) AS __src
    WHERE 1 = 0
  `;
  const [_, fields] = await conn.query(metaSql); // fields has column metadata
  const srcCols = new Set(fields.map(f => f.name));

  // 2) Target columns in table order (skip generated)
  const [targetCols] = await conn.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = ?
      AND UPPER(COALESCE(EXTRA,'')) NOT LIKE '%GENERATED%'
    ORDER BY ORDINAL_POSITION
  `, [targetTable]);

  const columns = targetCols.map(r => r.COLUMN_NAME).filter(c => srcCols.has(c));
  if (!columns.length) {
    throw new Error(`No overlapping columns between target table ${targetTable} and SELECT.`);
  }

  // 3) Primary key columns
  const [pkRows] = await conn.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA   = DATABASE()
      AND TABLE_NAME     = ?
      AND CONSTRAINT_NAME = 'PRIMARY'
    ORDER BY ORDINAL_POSITION
  `, [targetTable]);

  const pkColumns = pkRows.map(r => r.COLUMN_NAME);
  return { columns, pkColumns };
}

/** Build the ON DUPLICATE KEY UPDATE clause using VALUES(col) (simple & compatible). */
function buildUpdateList(columns, pkColumns) {
  const pkSet = new Set(pkColumns);
  const updatable = columns.filter(c => !pkSet.has(c));
  if (updatable.length === 0) return '';
  return updatable.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ');
}

// Estimate how many source rows fall into each [lo,hi] range bucket,
// using only am.id_profiles so MySQL can satisfy it via index/PK.
async function estimateRangeCounts(conn, fromForSelect, lo, hi, span) {
  const sql = `
    SELECT
      CAST(FLOOR((am.id_profiles - ?) / ?) AS UNSIGNED) AS b,
      COUNT(*) AS cnt
    ${fromForSelect} AS am
    WHERE am.id_profiles BETWEEN ? AND ?
    GROUP BY b
  `;
  const params = [lo, span, lo, hi];
  const [rows] = await conn.query(sql, params);

  const m = new Map();
  for (const r of rows) m.set(Number(r.b), Number(r.cnt));
  return m;
}

// Build a histogram of counts inside [lo, hi] using fixed-size buckets.
// Returns [{ lo, hi, cnt }, ...] sorted by lo.
async function estimateSubrangeHistogram(conn, fromForSelect, lo, hi, bucketSpan) {
  const sql = `
    SELECT
      CAST(FLOOR((am.id_profiles - ?) / ?) AS UNSIGNED) AS b,
      COUNT(*) AS cnt
    ${fromForSelect} AS am
    WHERE am.id_profiles BETWEEN ? AND ?
    GROUP BY b
    ORDER BY b
  `;
  const [rows] = await conn.query(sql, [lo, bucketSpan, lo, hi]);

  const hist = [];
  for (const r of rows) {
    const b = Number(r.b);
    const cnt = Number(r.cnt);
    const bucketLo = lo + b * bucketSpan;
    const bucketHi = Math.min(lo + (b + 1) * bucketSpan - 1, hi);
    hist.push({ lo: bucketLo, hi: bucketHi, cnt });
  }
  return hist;
}

// Choose (parts-1) split points so each part has ~equal total cnt.
// Respects minPartSpan so no subrange gets too tiny. Falls back to id-even splits.
function chooseBalancedBoundaries(lo, hi, hist, parts, minPartSpan) {
  const totals = hist.reduce((s, h) => s + h.cnt, 0);
  if (!totals) {
    // No counts available → even ID splits
    const out = [];
    const span = hi - lo + 1;
    for (let i = 1; i < parts; i++) {
      out.push(lo + Math.floor((span * i) / parts) - 1);
    }
    return out;
  }

  const targets = [];
  for (let i = 1; i < parts; i++) targets.push((totals * i) / parts);

  const boundaries = [];
  let running = 0;
  let segStart = lo;

  let tIdx = 0;
  for (const bucket of hist) {
    const before = running;
    running += bucket.cnt;

    while (tIdx < targets.length && running >= targets[tIdx]) {
      // Propose boundary at the end of this bucket
      const candidate = bucket.hi;

      // Enforce minPartSpan on both sides
      const leftOk = (candidate - segStart + 1) >= minPartSpan;
      const rightOk = (hi - (candidate + 1) + 1) >= minPartSpan;

      if (leftOk && rightOk) {
        boundaries.push(candidate);
        segStart = candidate + 1;
        tIdx++;
      } else {
        // If too close, try moving forward to next buckets until constraints satisfied
        // (or we’ll give up and handle remaining boundaries later)
        break;
      }
    }
  }

  // If we didn't get enough boundaries, fill the rest with even ID splits that respect minPartSpan
  while (boundaries.length < parts - 1) {
    const remaining = parts - 1 - boundaries.length;
    const last = boundaries.length ? boundaries[boundaries.length - 1] + 1 : lo;
    const segSpan = hi - last + 1;
    if (segSpan < remaining * minPartSpan) break; // cannot place more valid boundaries

    const step = Math.floor(segSpan / (remaining + 1));
    if (step < minPartSpan) break;

    const next = last + step - 1;
    boundaries.push(next);
  }

  return boundaries.sort((a, b) => a - b);
}

// Balanced heavy splitter:
// - Detects outliers via estCount > factor * median
// - Decides parts (2–4) based on heaviness ratio
// - Uses a histogram within [lo,hi] to pick balanced boundaries by row count
// - Rebuilds SQL for each subrange via buildSqlForRange
async function splitTopHeaviesBalanced(items, {
  conn,
  fromForSelect,
  buildSqlForRange,
  factor = 2,
  maxParts = 4,
  minSpan = 20_000,
  minPartSpan = 10_000,
}) {
  const ests = items.map(i => i.estCount).filter(n => n > 0).sort((a, b) => a - b);
  const median = ests.length ? ests[Math.floor(ests.length / 2)] : 0;
  const threshold = median ? factor * median : Number.MAX_SAFE_INTEGER;

  const out = [];
  const labels = ['A', 'B', 'C', 'D']; // up to 4 parts

  for (const it of items) {
    const lo = it.meta?.lo;
    const hi = it.meta?.hi;
    const span = (Number.isFinite(lo) && Number.isFinite(hi)) ? (hi - lo + 1) : 0;

    if (!(it.estCount > threshold && span > minSpan)) {
      out.push(it);
      continue;
    }

    // Decide number of parts (2–4) by heaviness ratio
    const ratio = median ? (it.estCount / median) : 0;
    let parts = 2;
    if (ratio >= 4) parts = 4;
    else if (ratio >= 3) parts = 3;
    parts = Math.min(maxParts, Math.max(2, parts));

    // Bucket size for histogram: ~64 buckets across the range, bounded by minPartSpan/4
    const approxBuckets = 64;
    const bucketSpan = Math.max(
      1,
      Math.floor(span / approxBuckets),
      Math.floor(minPartSpan / 4)
    );

    const hist = await estimateSubrangeHistogram(conn, fromForSelect, lo, hi, bucketSpan);
    const boundaries = chooseBalancedBoundaries(lo, hi, hist, parts, minPartSpan);

    // Turn boundaries into subranges
    const subRanges = [];
    let start = lo;
    for (const b of boundaries) {
      subRanges.push([start, b]);
      start = b + 1;
    }
    subRanges.push([start, hi]);

    // Estimated rows per subrange from histogram
    const estByRange = (rlo, rhi) =>
      hist.reduce((sum, h) => {
        if (h.hi < rlo || h.lo > rhi) return sum;
        // overlap proportion for a rough apportioning
        const overlapLo = Math.max(h.lo, rlo);
        const overlapHi = Math.min(h.hi, rhi);
        const overlap = Math.max(0, overlapHi - overlapLo + 1);
        const bucketSpan = (h.hi - h.lo + 1) || 1;
        return sum + Math.round(h.cnt * (overlap / bucketSpan));
      }, 0);

    // Build items for each subrange
    for (let idx = 0; idx < subRanges.length; idx++) {
      const [rlo, rhi] = subRanges[idx];
      const sql = await buildSqlForRange(rlo, rhi);
      const est = estByRange(rlo, rhi);
      const suffix = labels[idx] ?? String(idx + 1);
      out.push({
        sql,
        estCount: est,
        label: `${it.label} [${suffix}]`,
        meta: { lo: rlo, hi: rhi },
      });
    }
  }

  return out;
}

// ---------- utils ----------
function log_duration(startTime) {
  const s = (Date.now() - startTime) / 1000;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  console.log(`\nDuration: ${hh}:${mm}:${ss}`);
}

function fmtHMS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return mysqlP.createConnection(cfg);
}

async function get_dst_pool(CONCURRENCY) {
  const cfg = await local_usat_sales_db_config();
  const connectionLimit = Math.max(1, Number(CONCURRENCY) || 4); // never below 1; min 1 else 4 or more

  return mysqlP.createPool({
    ...cfg,
    waitForConnections: true,
    connectionLimit,
    queueLimit: 0
  });
}

async function ensurePrimaryKey(conn, table, cols) {
  if (!Array.isArray(cols) || cols.length === 0) return;

  const [hasPk] = await conn.query(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name=? AND constraint_type='PRIMARY KEY' LIMIT 1
  `, [table]);
  if (hasPk.length) return;

  const [uniq] = await conn.query(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name=? AND constraint_type='UNIQUE' LIMIT 1
  `, [table]);
  if (uniq.length) return;

  const placeholders = cols.map(() => '?').join(',');
  const [defs] = await conn.query(`
    SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (${placeholders})
  `, [table, ...cols]);

  const byName = Object.fromEntries(defs.map(d => [d.COLUMN_NAME, d]));
  const alters = [];
  for (const c of cols) {
    const d = byName[c];
    if (!d) throw new Error(`Primary key column ${c} not found on ${table}`);
    if (d.IS_NULLABLE === 'YES') {
      alters.push(`MODIFY \`${c}\` ${d.COLUMN_TYPE} NOT NULL`);
    }
  }
  alters.push(`ADD PRIMARY KEY (${cols.map(c => `\`${c}\``).join(', ')})`);
  await conn.query(`ALTER TABLE \`${table}\`\n  ${alters.join(',\n  ')}`);
}

function parseInfo(info) {
  const m = (info || '').match(/Records:\s*(\d+)\s+Duplicates:\s*(\d+)\s+Warnings:\s*(\d+)/i);
  return m ? { records: +m[1], duplicates: +m[2], warnings: +m[3] } : {};
}

// ---------- table bootstrap ----------
async function create_target_table(dstConn, query, primary_key, drop_table, options, where_statement, FROM_STATEMENT) {
  const { TARGET_TABLE_NAME } = options;

  if (drop_table) {
    await dstConn.execute(`DROP TABLE IF EXISTS \`${TARGET_TABLE_NAME}\``);
  } else {
    console.log(`\nNote: drop_table = ${drop_table} → not dropping current table ${TARGET_TABLE_NAME}.`);
  }

  // Create empty structure using your SELECT (WHERE 1=0)
  await dstConn.execute(`
    CREATE TABLE IF NOT EXISTS \`${TARGET_TABLE_NAME}\`
    ENGINE=InnoDB
    AS
    ${await query(FROM_STATEMENT, where_statement, '')}
    `);

  // Always ensure PK exists; if not add it
  await ensurePrimaryKey(dstConn, TARGET_TABLE_NAME, primary_key);
}

// ---------- range helpers ----------
async function get_min_max_id(dstConn, fromForScan) {
  // fromForScan should be a FROM clause that yields am.id_profiles (e.g., FROM `table` or FROM step_0a_create_updated_at_data)
  const [rows] = await dstConn.query(`
    SELECT MIN(am.id_profiles) AS lo, MAX(am.id_profiles) AS hi
    ${fromForScan} AS am
  `);
  return { lo: rows[0].lo || 0, hi: rows[0].hi || -1 };
}

function chunkRanges(lo, hi, span) {
  const ranges = [];
  if (lo == null || hi == null || hi < lo) return ranges;
  for (let start = lo; start <= hi; start += span) {
    const end = Math.min(start + span - 1, hi);
    ranges.push([start, end]);
  }
  return ranges;
}

// ---------- SQL builders (server-side, no streams) ----------
async function build_insert_sql(query, update_mode, TARGET_TABLE_NAME, fromForSelect, lo, hi, insertCols, updateList) {
  const WHERE_RANGE = `WHERE am.id_profiles BETWEEN ${lo} AND ${hi}`;
  const rawSelectRange = await query(fromForSelect, WHERE_RANGE, '');
  const selectRange = stripTrailingSemicolons(rawSelectRange);

  const insColsSql = insertCols.map(c => `\`${c}\``).join(', ');
  const projectionSql = insertCols.map(c => `\`${c}\``).join(', ');

  // We re-project into the agreed order so INSERT col order == SELECT col order.
  const orderedSelect = `
    SELECT ${projectionSql}
    FROM (
      ${selectRange}
    ) AS src
  `;

  if (update_mode === 'updated_at') {
    return `
      REPLACE INTO \`${TARGET_TABLE_NAME}\` (${insColsSql})
      ${orderedSelect}
    `;
  }

  if (update_mode === 'full' || update_mode === 'partial') {
    const dup = updateList ? `ON DUPLICATE KEY UPDATE ${updateList}` : '';
    return `
      INSERT INTO \`${TARGET_TABLE_NAME}\` (${insColsSql})
      ${orderedSelect}
      ${dup}
    `;
  }

  throw new Error(`Unknown mode: ${update_mode}`);
}

// ---------- parallel executor (no streams) ----------
class Semaphore {
  constructor(max) { this.max = max; this.inUse = 0; this.queue = []; }
  async acquire() {
    if (this.inUse < this.max) { this.inUse++; return; }
    await new Promise(res => this.queue.push(res));
    this.inUse++;
  }
  release() {
    this.inUse--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------- parallel runner that logs each batch AFTER it finishes
async function run_ranges_parallel(pool, items, concurrency = 8) {
  // items are processed in the order provided (heavy-first is decided upstream)
  const overallStart = Date.now();

  const queue = [...items];
  const total = queue.length;
  let done = 0;

  const MAX_RETRIES = 3;
  const RETRIABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function worker() {
    while (true) {
      const job = queue.shift();
      if (!job) break;

      const started = Date.now();
      let attempt = 0;

      for (; ;) {
        let conn;
        try {
          conn = await pool.getConnection();

          // Soften locking per session
          await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
          await conn.query("SET SESSION innodb_lock_wait_timeout = 120");

          const [res] = await conn.query(job.sql);

          // >>> This is the "success block" <<<
          const affected = (res && typeof res.affectedRows === 'number') ? res.affectedRows : null;
          const { records, duplicates, warnings } = parseInfo(res?.info);

          done++;
          // console.log(
          //   `✓ ${done}/${total} completed: ${job.label} | affected=${affected ?? 'n/a'} | ` +
          //   `duration=${fmtHMS(Date.now() - started)} | total=${fmtHMS(Date.now() - overallStart)}`
          // );         
          console.log(
            `✓ ${done}/${total} completed: ${job.label}` +
            (records != null ? ` | records=${records}` : '') +
            (duplicates != null ? ` | dupes=${duplicates}` : '') +
            (warnings != null ? ` | warnings=${warnings}` : '') +
            (affected != null ? ` | affected=${affected}` : '') +
            ` | duration=${fmtHMS(Date.now() - started)} | total=${fmtHMS(Date.now() - overallStart)}`
          );
          break;
          // >>> This is the end of the "success block" <<<

        } catch (err) {
          attempt++;
          const code = err?.code || 'UNKNOWN_ERROR';
          const canRetry = RETRIABLE.has(code) && attempt <= MAX_RETRIES;

          if (canRetry) {
            await sleep(200 * attempt + Math.floor(Math.random() * 300)); // backoff + jitter
            continue;
          }

          done++;
          console.log(
            `✗ ${done}/${total} FAILED: ${job.label} | ${code} after ${attempt} attempt(s) | ` +
            `duration=${fmtHMS(Date.now() - started)} | total=${fmtHMS(Date.now() - overallStart)}`
          );
          break;

        } finally {
          try { await conn?.release(); } catch { }
        }
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, total));
  await Promise.allSettled(Array.from({ length: n }, () => worker()));

  // Final overall runtime summary
  console.log(`All batches finished in ${fmtHMS(Date.now() - overallStart)}`);
}

// ================= MAIN (with completion logs) =================
async function step_3b_create_sales_key_metrics_table_parallel(query, primary_key, drop_table, FROM_STATEMENT, pool, update_mode = 'updated_at', options) {
  // Tunables
  const CONCURRENCY = 10;       // number of parallel batches
  const RANGE_SIZE = 100_000; // id_profiles per batch

  let result = 'Transfer Failed';
  const { TABLE_NAME, TARGET_TABLE_NAME } = options;

  // Connections
  const dstConn = await get_dst_connection();
  const dstPool = await get_dst_pool(CONCURRENCY);
  await logServerConnections(dstConn); // logs max connections

  try {
    // runTimer('timer'); // If this is noisy, you can comment it out during the parallel run.
    console.log('\nTABLE NAME:', TARGET_TABLE_NAME);
    console.log('UPDATE MODE:', update_mode);

    const startTime = Date.now();

    try {
      // 1) Create/ensure target table structure
      const where_statement = `WHERE 1 = 0`;
      const fromForSelect = update_mode === 'full' ? `FROM \`${TABLE_NAME}\`` : `FROM step_0a_create_updated_at_data`;

      await create_target_table(
        dstConn,
        query,
        primary_key,
        drop_table,
        options,
        where_statement,
        fromForSelect
      );

      // 2) Auto-build INSERT + UPDATE columns (based on SELECT structure)  
      const selectForColumns = await query(
        fromForSelect,
        `WHERE 1 = 0`,
        ''
      );

      const { columns: insertCols, pkColumns } =
        await computeInsertAndPkColumns(
          dstConn,
          TARGET_TABLE_NAME,
          selectForColumns
        );

      if (!insertCols.length) {
        throw new Error(`No matching columns between SELECT and ${TARGET_TABLE_NAME}.`);
      }

      const updateList = buildUpdateList(insertCols, pkColumns);

      console.log(`Auto-detected ${insertCols.length} insertable columns.`);
      console.log(`PK columns: ${pkColumns.join(', ') || '(none)'}`);

      // 3) Compute ranges from source
      const { lo, hi } = await get_min_max_id(dstConn, fromForSelect);
      if (hi < lo) {
        console.log('No rows to process.');
        return 'No work';
      }

      // Optional: total row count (can be heavy; safe-guarded)
      let totalRows = 0;
      try {
        const [countRows] = await dstConn.query(`
          SELECT COUNT(*) AS total_rows
          ${fromForSelect} AS am
        `);
        totalRows = countRows?.[0]?.total_rows || 0;
      } catch (e) {
        console.warn('Could not compute total rows:', e.message);
      }

      const ranges = chunkRanges(lo, hi, RANGE_SIZE);
      console.log(`Planned ${ranges.length} batches from ${lo} to ${hi} (span=${RANGE_SIZE}).`);
      if (totalRows) console.log(`Total source rows: ${totalRows.toLocaleString()}`);

      // Heavy-first: estimate per-batch row counts
      let estMap = new Map();
      try {
        estMap = await estimateRangeCounts(dstConn, fromForSelect, lo, hi, RANGE_SIZE);
      } catch (e) {
        console.warn('Could not estimate per-batch counts. Proceeding without weighting:', e.message);
      }

      // Build items normally (attach estCount + meta so we can split later)
      // Build items normally (attach estCount + meta so we can split later)
      let items = [];
      for (let i = 0; i < ranges.length; i++) {
        const [rlo, rhi] = ranges[i];
        const sql = await build_insert_sql(
          query,
          update_mode,
          TARGET_TABLE_NAME,
          fromForSelect,
          rlo,
          rhi,
          insertCols,
          updateList
        );
        const est = estMap.get(i) ?? 0;
        items.push({
          sql,
          estCount: est,
          label: `Batch ${i + 1}/${ranges.length}: id_profiles ${rlo}–${rhi}`,
          meta: { lo: rlo, hi: rhi },
        });
      }

      // 🔥 Balanced split for very heavy batches (2–4 parts), then heavy-first sort
      items = await splitTopHeaviesBalanced(items, {
        conn: dstConn,
        fromForSelect,
        buildSqlForRange: async (subLo, subHi) =>
          build_insert_sql(
            query,
            update_mode,
            TARGET_TABLE_NAME,
            fromForSelect,
            subLo,
            subHi,
            insertCols,
            updateList
          ),
        factor: 2,          // outlier threshold = 2× median estCount
        maxParts: 4,        // at most 4 chunks per heavy batch
        minSpan: 20_000,    // only split if ID span is at least this large
        minPartSpan: 10_000 // each subrange must be at least this wide
      });

      // Heavy-first ordering
      items.sort((a, b) => b.estCount - a.estCount);
      console.log('Heavy-first ordering enabled (balanced split where applicable). Top 5:');
      items.slice(0, 5).forEach((it, idx) => {
        console.log(`  ${idx + 1}. ${it.label} (est=${it.estCount.toLocaleString()})`);
      });

      // 5) Execute in parallel; logs appear as each batch completes
      const results = await run_ranges_parallel(dstPool, items, CONCURRENCY);

      // Optional summary (runner may not return results; guard it)
      const failed = Array.isArray(results)
        ? results.filter(r => r.status === 'rejected').length
        : 0;

      if (failed) {
        console.warn(`Completed with ${failed} failed batch(es).`);
        result = 'Transfer Completed With Errors';
      } else {
        console.log('All batches completed successfully.');
        result = 'Transfer Successful';
      }

    } finally {
      log_duration(startTime);
      // stopTimer('timer');
    }
  } catch (err) {
    console.error('Transfer failed:', err);
    throw err;
  } finally {
    try {
      await dstConn.end();
      console.log('✅ Destination DB connection closed.');
      await dstPool.end();
      console.log('✅ Destination DB pool closed.');
      // stopTimer('timer');
    } catch (e) {
      console.warn('Error during cleanup:', e);
    }
  }

  return result;
}

// async function step_3b_create_sales_key_metrics_tables_loop_parallel(FROM_STATEMENT, pool, update_mode, options) {
//   const query_list = [
//     {
//       query: step_1_member_minimum_first_created_at_dates_query,
//       target_table: `step_1_member_minimum_first_created_at_dates`,
//       primary_key: ['id_profiles'],
//       drop_table: true,
//     },
//     {
//       query: step_2_member_min_created_at_date_query,
//       target_table: `step_2_member_min_created_at_date`,
//       primary_key: ['id_profiles', 'min_created_at'],
//       drop_table: true,
//     },
//     {
//       query: step_3_member_total_life_time_purchases_query,
//       target_table: `step_3_member_total_life_time_purchases`,
//       primary_key: ['id_profiles'],
//       drop_table: true,
//     },
//     {
//       query: step_4_member_age_dimensions_query,
//       target_table: `step_4_member_age_dimensions`,
//       primary_key: ['id_profiles'],
//       drop_table: true,
//     },
//     {
//       query: step_5_member_age_at_sale_date_query,
//       target_table: `step_5_member_age_at_sale_date`,
//       primary_key: ['id_membership_periods_sa', 'age_as_of_sale_date'],
//       drop_table: true,
//     },
//     {
//       query: step_5a_member_age_at_end_of_year_of_sale_query,
//       target_table: `step_5a_member_age_at_end_of_year_of_sale`,
//       primary_key: ['id_profiles', 'id_membership_periods_sa', 'age_at_end_of_year'],
//       drop_table: true,
//     },
//     {
//       query: step_6_membership_period_stats_query,
//       target_table: `step_6_membership_period_stats`,
//       primary_key: ['id_membership_periods_sa', 'actual_membership_fee_6_rule_sa', 'sales_units', 'sales_revenue'],
//       drop_table: true,
//     },
//     {
//       query: step_7_prior_purchase_query_v2,
//       target_table: `step_7_prior_purchase`,
//       primary_key: ['id_profiles', 'id_membership_periods_sa'],
//       drop_table: true,
//     },
//     {
//       query: step_8_sales_key_stats_2015_query,
//       target_table: `sales_key_stats_2015`,
//       primary_key: ['id_profiles', 'id_membership_periods_sa'],
//       drop_table: update_mode === 'full' ? true : false,
//     },
//   ];

//   for (const { query, primary_key, drop_table, target_table } of query_list) {

//     const opts = { ...options, TARGET_TABLE_NAME: target_table }; // keep TABLE_NAME from outer options

//     console.log(query)
//     console.log(opts);

//     await step_3b_create_sales_key_metrics_table_parallel(query, primary_key, drop_table, FROM_STATEMENT, pool, update_mode, opts);
//   }

//   // Only add indexes to sales key metrics on full load
//   if (update_mode === 'full') {
//     try {
//       runTimer('timer');
//       console.log('Create indexes for sales key metrics');

//       const dstConn = await get_dst_connection();

//       // Faster builds for this session
//       await dstConn.query('SET SESSION innodb_sort_buffer_size = 268435456');
//       await dstConn.query('SET SESSION tmp_table_size = 268435456');
//       await dstConn.query('SET SESSION max_heap_table_size = 268435456');
//       await dstConn.query('SET SESSION sql_log_bin = 0'); // if safe

//       const sql = step_8b_create_indexes();   // ✅ CALL the function
//       await dstConn.query(sql);               // or await dstConn.execute(sql);

//     } catch (err) {
//       console.error('Transfer failed:', err);
//       throw err;
//     } finally {
//       try {
//         if (dstConn) {                        // ✅ guard against “dstConn is not defined”
//           await dstConn.end();
//           console.log('✅ Destination DB connection closed.');
//         }
//         stopTimer('timer');
//       } catch (e) {
//         console.warn('Error during cleanup:', e);
//       }
//     }
//   }
// }

// existing helper
function fmtHMS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

async function step_3b_create_sales_key_metrics_tables_loop_parallel(FROM_STATEMENT, pool, update_mode, options) {
  // ✱ total timer start
  const totalStartMs = Date.now();
  const totalStartStr = new Date(totalStartMs).toLocaleString(); // local time; use toISOString() if you prefer UTC
  console.log(`\n[TOTAL] Start: ${totalStartStr}`);

  const query_list = [
    { query: step_1_member_minimum_first_created_at_dates_query, target_table: `step_1_member_minimum_first_created_at_dates`, primary_key: ['id_profiles'], drop_table: true },
    { query: step_2_member_min_created_at_date_query, target_table: `step_2_member_min_created_at_date`, primary_key: ['id_profiles', 'min_created_at'], drop_table: true },
    { query: step_3_member_total_life_time_purchases_query, target_table: `step_3_member_total_life_time_purchases`, primary_key: ['id_profiles'], drop_table: true },
    { query: step_4_member_age_dimensions_query, target_table: `step_4_member_age_dimensions`, primary_key: ['id_profiles'], drop_table: true },
    { query: step_5_member_age_at_sale_date_query, target_table: `step_5_member_age_at_sale_date`, primary_key: ['id_membership_periods_sa', 'age_as_of_sale_date'], drop_table: true },
    { query: step_5a_member_age_at_end_of_year_of_sale_query, target_table: `step_5a_member_age_at_end_of_year_of_sale`, primary_key: ['id_profiles', 'id_membership_periods_sa', 'age_at_end_of_year'], drop_table: true },
    { query: step_6_membership_period_stats_query, target_table: `step_6_membership_period_stats`, primary_key: ['id_membership_periods_sa', 'actual_membership_fee_6_rule_sa', 'sales_units', 'sales_revenue'], drop_table: true },
    { query: step_7_prior_purchase_query_v2, target_table: `step_7_prior_purchase`, primary_key: ['id_profiles', 'id_membership_periods_sa'], drop_table: true },
    { query: step_8_sales_key_stats_2015_query, target_table: `sales_key_stats_2015`, primary_key: ['id_profiles', 'id_membership_periods_sa'], drop_table: update_mode === 'full' },
  ];

  for (const { query, primary_key, drop_table, target_table } of query_list) {
    const opts = { ...options, TARGET_TABLE_NAME: target_table }; // keep TABLE_NAME from outer options

    console.log(query);
    console.log(opts);

    await step_3b_create_sales_key_metrics_table_parallel(query, primary_key, drop_table, FROM_STATEMENT, pool, update_mode, opts);

    // ✱ per-iteration time summary
    const nowMs = Date.now();
    const nowStr = new Date(nowMs).toLocaleString();
    console.log(`[STEP ${stepNo}/${totalSteps}] Start: ${totalStartStr} | Now: ${nowStr} | Elapsed: ${fmtHMS(nowMs - totalStartMs)}`);
  }
}

// Only add indexes to sales key metrics on full load
if (update_mode === 'full') {
  // ✱ declare outside try so finally can close it
  let dstConn;
  try {
    runTimer('timer');
    console.log('Create indexes for sales key metrics');

    dstConn = await get_dst_connection();

    // Faster builds for this session
    await dstConn.query('SET SESSION innodb_sort_buffer_size = 268435456');
    await dstConn.query('SET SESSION tmp_table_size = 268435456');
    await dstConn.query('SET SESSION max_heap_table_size = 268435456');
    await dstConn.query('SET SESSION sql_log_bin = 0'); // if safe

    const sql = step_8b_create_indexes();   // ✅ CALL the function
    await dstConn.query(sql);               // or await dstConn.execute(sql);

  } catch (err) {
    console.error('Transfer failed:', err);
    throw err;
  } finally {
    try {
      if (dstConn) {
        await dstConn.end();
        console.log('✅ Destination DB connection closed.');
      }
      stopTimer('timer');
    } catch (e) {
      console.warn('Error during cleanup:', e);
    }
  }
}

// ✱ total timer end + summary
const totalEndMs = Date.now();
const totalEndStr = new Date(totalEndMs).toLocaleString();
console.log(`[TOTAL] Start: ${totalStartStr} | End: ${totalEndStr} | Duration: ${fmtHMS(totalEndMs - totalStartMs)}`);
}

if (require.main === module) {
  let FROM_STATEMENT = '';
  let pool = '';

  const options = {
    TABLE_NAME: `all_membership_sales_data_2015_left`,
    TARGET_TABLE_NAME: `sales_key_stats_2015_test`,
    // membership_period_ends: '2008-01-01',
    // start_year_mtn: 2010, // Default = 2010
    // start_date_mtn: update_mode === 'partial' ? await get_first_day_of_prior_year() : '2010-01-01',
    // end_date_mtn: await get_last_day_of_year(),
    // updated_at_date_mtn: await get_yesterdays_date(),
  };

  const update_mode = 'full';        // Update 2010 forward, drop table
  // const update_mode = 'partial';     // Update using current & prior year, dont drop
  // const update_mode = 'updated_at';     // Update based on the 'updated_at' date, dont drop

  step_3b_create_sales_key_metrics_tables_loop_parallel(FROM_STATEMENT, pool, update_mode, options);
}


module.exports = {
  step_3b_create_sales_key_metrics_tables_loop_parallel,
};
