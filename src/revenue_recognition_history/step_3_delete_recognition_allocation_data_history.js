const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { execute_load_big_query_recognition_allocation_data_history } = require('./step_2_load_bq_recognition_allocation_data_history');

async function main(passed_snapshot_version) {
  const snapshot_version = passed_snapshot_version || 'revenue_month_2026_03';

  const connection_config = await local_usat_sales_db_config();
  const connection = await mysql.createConnection(connection_config);

  runTimer('timer');

  try {
    const preview_sql = `
      SELECT 
        snapshot_version,
        COUNT(*) AS count_rows
      FROM rev_recognition_allocation_data_history
      WHERE 1 = 1
        AND snapshot_version = ?
      GROUP BY snapshot_version
    `;

    const delete_sql = `
      DELETE FROM rev_recognition_allocation_data_history
      WHERE snapshot_version = ?
    `;

    // NOTE: [STEP 1 OF 3] Preview snapshot before delete
    console.log(`\n[STEP 1 OF 3] Preview snapshot before delete: ${snapshot_version}`);

    const [preview_rows] = await connection.execute(preview_sql, [snapshot_version]);

    if (preview_rows.length === 0) {
      console.log(`[INFO] No rows found for snapshot_version = ${snapshot_version}`);
      console.log('[INFO] Stopping process. Nothing to delete and nothing to reload to BigQuery.');
      return 0;
    }

    console.log('[INFO] Preview results:');
    console.table(preview_rows);

    // NOTE: [STEP 2 OF 3] Delete snapshot from rev_recognition_allocation_data_history
    console.log(`\n[STEP 2 OF 3] Delete snapshot from rev_recognition_allocation_data_history: ${snapshot_version}`);

    const [result] = await connection.execute(delete_sql, [snapshot_version]);

    console.log('[SUCCESS] Snapshot deleted.');
    console.log(`Affected rows: ${result.affectedRows}`);

    // NOTE: [STEP 3 OF 3] Reload rev_recognition_allocation_data_history to BigQuery
    if (result.affectedRows > 0) {
      console.log('\n[STEP 3 OF 3] Reload rev_recognition_allocation_data_history to BigQuery');
      await execute_load_big_query_recognition_allocation_data_history();
      console.log('[SUCCESS] BigQuery reload complete.');
    } else {
      console.log('[INFO] No rows deleted. Skipping Step 3 BigQuery reload.');
    }

    console.log('\n[SUCCESS] Delete process complete.');
    return result.affectedRows;

  } catch (error) {
    console.error('[ERROR] Delete process failed:', error);
    throw error;
  } finally {
    await connection.end();
    stopTimer('timer');
  }
}

if (require.main === module) {
  (async () => {
    try {
      console.log('\nStarting delete job.');
      await main("revenue_month_2026_03");
    } catch (error) {
      console.error('Error during delete:', error);
      process.exit(1);
    }
  })();
}

module.exports = {
  execute_delete_recognition_allocation_data_history: main,
};