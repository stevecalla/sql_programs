// const { step_8_sales_key_stats_2015_query } = require('./step_8a_get_sales_data_082925_query');

// // If you want to keep certain fields from being overwritten on conflict, list them here:
// const EXCLUDE_ON_UPDATE = [
//     // primary/unique key columns should usually be excluded
//     'id_profiles',
//     'id_membership_periods_sa',

//     // add any true “created_at” fields you don’t want changed:
//     // 'created_at_mtn', 'created_at_utc',
// ];

// async function getTableColumns(pool, TARGET_TABLE_NAME) {
//     const db = (typeof pool.promise === 'function') ? pool.promise() : pool;

//     const [rows] = await db.query(
//         `
//         SELECT COLUMN_NAME
//         FROM INFORMATION_SCHEMA.COLUMNS
//         WHERE TABLE_SCHEMA = DATABASE()
//             AND TABLE_NAME = ?
//             AND UPPER(COALESCE(EXTRA,'')) NOT LIKE '%GENERATED%'
//         ORDER BY ORDINAL_POSITION
//         `,
//         [TARGET_TABLE_NAME]
//     );
//     return rows.map(r => r.COLUMN_NAME);
// }

// async function buildInsertSelectUpsert({ TARGET_TABLE_NAME, columns, selectSql, excludeOnUpdate = [] }) {
//     const insertCols = columns.join(',\n  ');

//     const updateCols = columns
//         ?.filter(c => !excludeOnUpdate.includes(c))
//         ?.map(c => `${c} = VALUES(${c})`) // swap to alias style if you prefer (see note below)
//         ?.join(',\n  ');

//     const query = `
//         INSERT INTO ${TARGET_TABLE_NAME} (
//             ${insertCols}
//         )
//             ${selectSql}
//             ON DUPLICATE KEY UPDATE
//             ${updateCols};
//     `;

//     return query;
// }

// async function step_8a_sales_key_stats_2015_upsert(FROM_STATEMENT, pool, update_mode, options) {
//     // const TARGET_TABLE_NAME = 'sales_key_stats_2015';
//     const { TARGET_TABLE_NAME } = options;

//     // 1) Pull columns from the target TARGET_TABLE_NAME (in TARGET_TABLE_NAME order)
//     const columns = await getTableColumns(pool, TARGET_TABLE_NAME);
//     // console.log(columns);

//     // 2) Build your existing SELECT (must alias columns to match target names)
//     const selectSql = await step_8_sales_key_stats_2015_query(FROM_STATEMENT);

//     // 3) Build the final SQL exactly in your preferred shape
//     const sql = await buildInsertSelectUpsert({
//         TARGET_TABLE_NAME,
//         columns,
//         selectSql,
//         excludeOnUpdate: EXCLUDE_ON_UPDATE,
//     });

//     return sql;
// }

// module.exports = {
//     step_8a_sales_key_stats_2015_upsert
// };

