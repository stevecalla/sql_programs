// ============================================================
// BACKUP HISTORY TABLE WITH RETENTION RULES
// ============================================================
// BEHAVIOR:
// - Creates a backup of rev_recognition_allocation_data_history
// - Preserves full table structure by using CREATE TABLE ... LIKE
// - Supports two backup types:
//     1) system
//        - Creates or replaces one _sys backup for the current date
//        - Keeps only the 7 most recent _sys backups in total
//     2) user
//        - Creates the next _usrN backup for the current date
//        - Keeps only the 3 most recent _usrN backups in total
//
// NAMING CONVENTION:
// - System backup:
//     rev_recognition_allocation_data_history_bck_YYYY_MM_DD_sys
// - User backup:
//     rev_recognition_allocation_data_history_bck_YYYY_MM_DD_usr1
//     rev_recognition_allocation_data_history_bck_YYYY_MM_DD_usr2
//     etc.
//
// RETENTION:
// - _sys backups: keep latest 7 total across all dates
// - _usrN backups: keep latest 3 total across all dates
//
// IMPORTANT:
// - User backup cleanup sorts by parsed date + parsed usr number in JavaScript
//   so usr10 is treated as newer than usr9
// - MySQL table name limit is 64 characters; this naming stays under the limit
// ============================================================

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');

function sort_system_backup_names_oldest_to_newest(table_names) {
  return [...table_names].sort((a, b) => {
    const a_match = a.match(/_(\d{4}_\d{2}_\d{2})_sys$/);
    const b_match = b.match(/_(\d{4}_\d{2}_\d{2})_sys$/);

    const a_date = a_match ? a_match[1] : '';
    const b_date = b_match ? b_match[1] : '';

    if (a_date < b_date) return -1;
    if (a_date > b_date) return 1;
    return 0;
  });
}

function sort_user_backup_names_oldest_to_newest(table_names) {
  return [...table_names].sort((a, b) => {
    const a_match = a.match(/_(\d{4}_\d{2}_\d{2})_usr(\d+)$/);
    const b_match = b.match(/_(\d{4}_\d{2}_\d{2})_usr(\d+)$/);

    const a_date = a_match ? a_match[1] : '';
    const b_date = b_match ? b_match[1] : '';

    const a_run = a_match ? Number(a_match[2]) : 0;
    const b_run = b_match ? Number(b_match[2]) : 0;

    if (a_date < b_date) return -1;
    if (a_date > b_date) return 1;

    return a_run - b_run;
  });
}

async function main(QUERY_OPTIONS = {}) {
  // QUERY_OPTIONS = {...QUERY_OPTIONS, backup_type: 'system'};

  const source_table = 'rev_recognition_allocation_data_history';
  const backup_table_prefix = 'rev_recognition_allocation_data_history_bck';

  const backup_type = QUERY_OPTIONS.backup_type || process.argv[2] || 'user';
  const keep_system_backups_total = 7;
  const keep_user_backups_total = 3;

  if (!['system', 'user'].includes(backup_type)) {
    throw new Error(
      `Invalid backup_type: ${backup_type}. Use 'system' or 'user'.`
    );
  }

  const connection_config = await local_usat_sales_db_config();
  const connection = await mysql.createConnection(connection_config);

  runTimer('timer');

  try {
    const backup_date = new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '_');

    const preview_source_sql = `
      SELECT
        COUNT(*) AS count_rows
      FROM \`${source_table}\`
    `;

    const list_matching_backup_tables_sql = `
      SELECT
        table_name AS backup_table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name LIKE ?
    `;

    const check_exact_table_sql = `
      SELECT
        COUNT(*) AS count_rows
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
    `;

    console.log(`[INFO] Previewing source table before backup: ${source_table}`);
    const [source_rows] = await connection.execute(preview_source_sql);
    console.table(source_rows);

    let backup_table = null;

    if (backup_type === 'system') {
      backup_table = `${backup_table_prefix}_${backup_date}_sys`;

      if (backup_table.length > 64) {
        throw new Error(
          `Backup table name is too long for MySQL (${backup_table.length} chars): ${backup_table}`
        );
      }

      const [existing_system_rows] = await connection.execute(
        check_exact_table_sql,
        [backup_table]
      );

      if (existing_system_rows[0]?.count_rows > 0) {
        console.log(`[INFO] System backup already exists and will be replaced: ${backup_table}`);

        const drop_existing_system_sql = `
          DROP TABLE IF EXISTS \`${backup_table}\`
        `;
        await connection.execute(drop_existing_system_sql);
      } else {
        console.log(`[INFO] No existing system backup for today. Creating: ${backup_table}`);
      }
    }

    if (backup_type === 'user') {
      const user_backup_pattern = `${backup_table_prefix}_%_usr%`;

      const [all_user_backup_rows] = await connection.execute(
        list_matching_backup_tables_sql,
        [user_backup_pattern]
      );

      console.log('[INFO] Existing user-generated backup tables:');
      console.table(all_user_backup_rows);

      const today_user_backup_prefix = `${backup_table_prefix}_${backup_date}_usr`;

      const existing_today_user_backup_names = all_user_backup_rows
        .map(row => row.backup_table_name)
        .filter(table_name => table_name.startsWith(today_user_backup_prefix));

      let max_user_run_number_for_today = 0;

      for (const table_name of existing_today_user_backup_names) {
        const match = table_name.match(/_usr(\d+)$/);
        if (match) {
          const run_number = Number(match[1]);
          if (run_number > max_user_run_number_for_today) {
            max_user_run_number_for_today = run_number;
          }
        }
      }

      const next_user_run_number = max_user_run_number_for_today + 1;
      backup_table = `${backup_table_prefix}_${backup_date}_usr${next_user_run_number}`;

      if (backup_table.length > 64) {
        throw new Error(
          `Backup table name is too long for MySQL (${backup_table.length} chars): ${backup_table}`
        );
      }

      console.log(`[INFO] Creating next user backup: ${backup_table}`);
    }

    const create_backup_structure_sql = `
      CREATE TABLE \`${backup_table}\`
      LIKE \`${source_table}\`
    `;

    const insert_backup_data_sql = `
      INSERT INTO \`${backup_table}\`
      SELECT *
      FROM \`${source_table}\`
    `;

    const validate_backup_sql = `
      SELECT
        COUNT(*) AS count_rows
      FROM \`${backup_table}\`
    `;

    console.log(`[INFO] Creating backup table structure: ${backup_table}`);
    await connection.execute(create_backup_structure_sql);

    console.log(`[INFO] Inserting backup data into: ${backup_table}`);
    const [insert_result] = await connection.execute(insert_backup_data_sql);

    const [validate_rows] = await connection.execute(validate_backup_sql);

    console.log('[SUCCESS] Backup table created.');
    console.log(`Inserted rows: ${insert_result.affectedRows}`);
    console.log('[INFO] Backup row count:');
    console.table(validate_rows);

    if (backup_type === 'system') {
      const system_backup_pattern = `${backup_table_prefix}_%_sys`;

      const [all_system_backup_rows] = await connection.execute(
        list_matching_backup_tables_sql,
        [system_backup_pattern]
      );

      console.log('[INFO] All system backup tables:');
      console.table(all_system_backup_rows);

      const all_system_backup_names = all_system_backup_rows.map(
        row => row.backup_table_name
      );

      const sorted_system_backup_names = sort_system_backup_names_oldest_to_newest(
        all_system_backup_names
      );

      const system_backups_to_drop =
        sorted_system_backup_names.length > keep_system_backups_total
          ? sorted_system_backup_names.slice(
              0,
              sorted_system_backup_names.length - keep_system_backups_total
            )
          : [];

      if (system_backups_to_drop.length === 0) {
        console.log(
          `[INFO] No old system backups need to be removed. Keeping up to ${keep_system_backups_total} total system backups.`
        );
      } else {
        console.log(
          `[INFO] Removing old system backups. Keeping most recent ${keep_system_backups_total} total system backups.`
        );

        for (const old_backup_table of system_backups_to_drop) {
          const drop_old_backup_sql = `
            DROP TABLE IF EXISTS \`${old_backup_table}\`
          `;

          console.log(`[INFO] Dropping old system backup table: ${old_backup_table}`);
          await connection.execute(drop_old_backup_sql);
        }

        console.log(
          `[SUCCESS] Removed ${system_backups_to_drop.length} old system backup table(s).`
        );
      }

      const [final_system_backup_rows] = await connection.execute(
        list_matching_backup_tables_sql,
        [system_backup_pattern]
      );

      console.log('[INFO] Final system backup tables:');
      console.table(final_system_backup_rows);
    }

    if (backup_type === 'user') {
      const user_backup_pattern = `${backup_table_prefix}_%_usr%`;

      const [all_user_backup_rows_after_insert] = await connection.execute(
        list_matching_backup_tables_sql,
        [user_backup_pattern]
      );

      console.log('[INFO] All user-generated backup tables:');
      console.table(all_user_backup_rows_after_insert);

      const all_user_backup_names = all_user_backup_rows_after_insert.map(
        row => row.backup_table_name
      );

      const sorted_user_backup_names = sort_user_backup_names_oldest_to_newest(
        all_user_backup_names
      );

      const user_backups_to_drop =
        sorted_user_backup_names.length > keep_user_backups_total
          ? sorted_user_backup_names.slice(
              0,
              sorted_user_backup_names.length - keep_user_backups_total
            )
          : [];

      if (user_backups_to_drop.length === 0) {
        console.log(
          `[INFO] No old user-generated backups need to be removed. Keeping up to ${keep_user_backups_total} total user backups.`
        );
      } else {
        console.log(
          `[INFO] Removing old user-generated backups. Keeping most recent ${keep_user_backups_total} total user backups.`
        );

        for (const old_backup_table of user_backups_to_drop) {
          const drop_old_backup_sql = `
            DROP TABLE IF EXISTS \`${old_backup_table}\`
          `;

          console.log(`[INFO] Dropping old user backup table: ${old_backup_table}`);
          await connection.execute(drop_old_backup_sql);
        }

        console.log(
          `[SUCCESS] Removed ${user_backups_to_drop.length} old user-generated backup table(s).`
        );
      }

      const [final_user_backup_rows] = await connection.execute(
        list_matching_backup_tables_sql,
        [user_backup_pattern]
      );

      console.log('[INFO] Final user-generated backup tables:');
      console.table(final_user_backup_rows);
    }

  } catch (error) {
    console.error('[ERROR] Backup failed:', error);
    throw error;
  } finally {
    await connection.end();
    stopTimer('timer');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error during backup:', error);
    process.exit(1);
  });
}

module.exports = {
  execute_backup_recognition_allocation_data_history: main,
};
