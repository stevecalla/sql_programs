// mysql2/promise expected
// 8.0.36-safe: uses "AS new" alias instead of VALUES().

async function getDefaultDatabase(dst) {
  const [rows] = await dst.execute('SELECT DATABASE() AS db');
  return rows[0]?.db || null;
}

function splitTableIdentifier(input) {
  // Accept "db.table" or "table"
  const parts = String(input).split('.');
  if (parts.length === 2) {
    return { schema: parts[0].replace(/`/g, ''), table: parts[1].replace(/`/g, '') };
  }
  return { schema: null, table: parts[0].replace(/`/g, '') };
}

async function get_table_columns(dst, tableName, explicitSchema = null) {
  const { schema: parsedSchema, table } = splitTableIdentifier(tableName);
  const schema = explicitSchema || parsedSchema || await getDefaultDatabase(dst);
  if (!schema) throw new Error('No schema/database selected. Pass opts.schema or use a qualified table name "db.table".');

  const sql = `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `;
  const [rows] = await dst.execute(sql, [schema, table]);
  return rows.map(r => r.COLUMN_NAME);
}

/**
 * Upsert rows into a table using INSERT ... ON DUPLICATE KEY UPDATE (no delete step),
 * with optional schema introspection for columns.
 *
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').Connection} dst
 * @param {string} tableName                        // "table" or "db.table"
 * @param {Array<Object>} rows
 * @param {Object} [opts]
 * @param {string[]} [opts.columns]                 // used only when schemaColumnsMode='explicit'
 * @param {'intersection'|'all'|'explicit'} [opts.schemaColumnsMode='intersection']
 * @param {string[]} [opts.skipUpdateColumns]       // columns to NOT update on duplicate
 * @param {number}   [opts.maxParams=60000]
 * @param {boolean}  [opts.transaction=false]
 * @param {string}   [opts.schema]                  // override schema/database if not in tableName
 * @returns {Promise<{inserted:number, updated:number, affectedRows:number, warnings:number, usedColumns:string[]}>}
 */
async function upsert_batch(dst, tableName, rows, opts = {}) {
  if (!rows?.length) return { inserted: 0, updated: 0, affectedRows: 0, warnings: 0, usedColumns: [] };

  const {
    columns,
    schemaColumnsMode = 'intersection',
    skipUpdateColumns = [],
    maxParams = 60000,
    transaction = false,
    schema: schemaOverride = null,
  } = opts;

  // Figure out the working column list
  const rowColumns = Object.keys(rows[0]);
  let tableColumns = null;

  if (schemaColumnsMode !== 'explicit') {
    tableColumns = await get_table_columns(dst, tableName, schemaOverride);
  }

  let workingColumns;
  if (schemaColumnsMode === 'explicit') {
    if (!columns?.length) throw new Error('opts.columns required when schemaColumnsMode="explicit".');
    workingColumns = [...columns];
  } else if (schemaColumnsMode === 'all') {
    // Use all table columns in physical order (you must supply values for them or they become NULL)
    workingColumns = tableColumns;
  } else {
    // 'intersection' (default): only columns that appear in both schema and the row objects
    const rowSet = new Set(rowColumns);
    workingColumns = tableColumns.filter(c => rowSet.has(c));
  }

  if (!workingColumns.length) throw new Error('No columns resolved for upsert (check schemaColumnsMode and input rows).');

  // Build update target list = all workingColumns minus skipped ones
  const updateCols = workingColumns.filter(c => !skipUpdateColumns.includes(c));

  const id = (s) => `\`${s}\``;
  const colList = workingColumns.map(id).join(',');
  const perRowParams = workingColumns.length;
  const maxRowsPerChunk = Math.max(1, Math.floor(maxParams / perRowParams));

  // Assignments using alias "new" (8.0.20+)
  const updateAssignments = updateCols.map(c => `${id(c)} = new.${id(c)}`).join(', ');

  const makeSql = (rowsCount) => `
    INSERT INTO ${id(tableName)} (${colList})
    VALUES ${Array.from({ length: rowsCount }, () => `(${Array(perRowParams).fill('?').join(',')})`).join(',')}
    AS new
    ON DUPLICATE KEY UPDATE
    ${updateAssignments || workingColumns.map(c => `${id(c)} = ${id(c)}`).join(', ')}
  `;

  const pushValues = (vals, row) => {
    for (const col of workingColumns) vals.push(row[col] ?? null);
  };

  const parseInfo = (infoStr) => {
    // "Records: 100  Duplicates: 30  Warnings: 0"
    const mRec = /Records:\s*(\d+)/.exec(infoStr || '');
    const mDup = /Duplicates:\s*(\d+)/.exec(infoStr || '');
    const mWar = /Warnings:\s*(\d+)/.exec(infoStr || '');
    const records = mRec ? Number(mRec[1]) : 0;
    const duplicates = mDup ? Number(mDup[1]) : 0;
    const warnings = mWar ? Number(mWar[1]) : 0;
    return {
      inserted: Math.max(0, records - duplicates),
      updated: Math.max(0, duplicates),
      warnings,
    };
  };

  let totals = { inserted: 0, updated: 0, affectedRows: 0, warnings: 0 };

  const execChunk = async (chunk) => {
    const sql = makeSql(chunk.length);
    const values = [];
    for (const r of chunk) pushValues(values, r);
    const [res] = await dst.execute(sql, values);
    const info = parseInfo(res.info);
    totals.inserted += info.inserted;
    totals.updated += info.updated;
    totals.affectedRows += Number(res.affectedRows || 0);
    totals.warnings += info.warnings;
  };

  const run = async () => {
    for (let i = 0; i < rows.length; i += maxRowsPerChunk) {
      const chunk = rows.slice(i, i + maxRowsPerChunk);
      await execChunk(chunk);
    }
    return { ...totals, usedColumns: workingColumns };
  };

  if (!transaction) return run();

  await dst.beginTransaction();
  try {
    const result = await run();
    await dst.commit();
    return result;
  } catch (e) {
    await dst.rollback();
    throw e;
  }
}

/* -------------------- Examples --------------------

// 1) Default (intersection): uses only columns present in both the table and your row objects
const res1 = await upsert_batch(pool, 'usat_sales_db.all_membership_sales_data_2015_left', rows, {
  // no columns passed
  // schemaColumnsMode: 'intersection' (default)
  skipUpdateColumns: ['created_at_ma', 'created_at_mp', 'created_at_members', 'created_at_mt', 'created_at_profiles', 'created_at_users'],
  transaction: true,
});
console.log(res1.usedColumns); // see which columns were used

// 2) All table columns: behaves more like a full replace (but still no delete)
//    If your rows omit some columns, those omitted columns will be inserted as NULL.
const res2 = await upsert_batch(pool, 'usat_sales_db.all_membership_sales_data_2015_left', rows, {
  schemaColumnsMode: 'all',
});

// 3) Explicit columns: you control the exact set/order
const res3 = await upsert_batch(pool, 'usat_sales_db.all_membership_sales_data_2015_left', rows, {
  schemaColumnsMode: 'explicit',
  columns: ['member_number_members_sa','id_membership_periods_sa', ...],
// });

// ---------------------------------------------------- */

module.exports = { upsert_batch, get_table_columns };
