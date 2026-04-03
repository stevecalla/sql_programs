const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');

async function main(passed_snapshot_version) {
  const snapshot_version =
    passed_snapshot_version ||
    process.argv[2] ||
    'revenue_month_2026_03';

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

    console.log(`[INFO] Previewing snapshot before delete: ${snapshot_version}`);

    const [preview_rows] = await connection.execute(preview_sql, [snapshot_version]);

    if (preview_rows.length === 0) {
      console.log(`[INFO] No rows found for snapshot_version = ${snapshot_version}`);
      return;
    }

    console.log('[INFO] Preview results:');
    console.table(preview_rows);

    console.log(`[INFO] Deleting snapshot: ${snapshot_version}`);

    const [result] = await connection.execute(delete_sql, [snapshot_version]);

    console.log(`[SUCCESS] Snapshot deleted.`);
    console.log(`Affected rows: ${result.affectedRows}`);

  } catch (error) {
    console.error('[ERROR] Delete failed:', error);
    throw error;
  } finally {
    await connection.end();
    stopTimer('timer');
  }
}

if (require.main === module) {
  try {
    console.log('\nStarting data load.');
    main("revenue_month_2026_03");
  } catch (error) {
    console.error("Error during delete:", error);
    process.exit(1);
  }
}

module.exports = {
  execute_delete_recognition_allocation_data_history: main,
};


