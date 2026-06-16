const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');
const { triggerGarbageCollection } = require('../../utilities/garbage_collection/trigger_garbage_collection');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { execute_save_single_csv } = require('../../utilities/save_single_csv_with_archive');

const { query_drop_table } = require("../queries/create_drop_db_table/queries_drop_db_tables");
const { query_ironman_profile } = require('../google_cloud/queries/query_ironman_profile');

const {
    step_a_create_ironman_profile_table,
    step_b_create_distinct_profile_id_table,
    step_d_create_history_table,
    query_append_history_indexes,
    step_d_create_history_batch_table,
    step_c_insert_ironman_profiles,
    query_append_index_fields,
} = require("../queries/participation_data/step_3e_create_ironman_profile_table");

// Connect to MySQL
async function create_connection() {
    console.log('create connection');
    try {
        const config_details = await local_usat_sales_db_config();
        const pool = create_local_db_connection(config_details);
        return (pool);
    } catch (error) {
        console.log(`Error connecting: ${error}`);
    }
}

// EXECUTE MYSQL TO CREATE TABLES & WORK WITH TABLES QUERY
async function execute_mysql_working_query(pool, db_name, query) {
    const startTime = performance.now();
    runTimer(db_name);

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, (useError) => {
            pool.query({ sql: query }, (queryError, results) => {
                const endTime = performance.now();
                const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);

                if (queryError) {
                    console.error('Error executing query:', queryError);
                    stopTimer(db_name);
                    reject(queryError);
                } else {
                    console.log("\nQuery results - Elapsed Time:", elapsedTime, "sec");
                    stopTimer(db_name);
                    resolve(results);
                }
            });
        });
    });
}

// Helper: drop then create a table from a query builder
async function drop_and_create(pool, db_name, table_name, create_query) {
    console.log(`\nDROP + CREATE ${table_name} ****************`);
    runTimer(table_name);
    try {
        await execute_mysql_working_query(pool, db_name, await query_drop_table(table_name));
        await execute_mysql_working_query(pool, db_name, create_query);
    } catch (error) {
        console.error(`Error building ${table_name}:`, error);
        throw error;
    } finally {
        stopTimer(table_name);
        console.log(`****************\n`);
    }
}

// Helper to manage the database connection lifecycle.
async function with_connection(callback) {
    const pool = await create_connection();
    try {
        await callback(pool);
    } catch (error) {
        throw error;
    } finally {
        await pool.end(err => {
            if (err) {
                console.error('Error closing connection pool:', err.message);
            } else {
                console.log('Connection pool closed successfully.');
            }
        });
    }
}

// STEP A: Create the (empty) final profile table.
async function create_profile_table(pool, db_name, final_table) {
    console.log('STEP A: Creating Ironman Profile Table (#3)');
    await drop_and_create(pool, db_name, final_table, await step_a_create_ironman_profile_table(final_table));
}

// STEP B: Create the distinct Ironman participant id table (#1).
async function create_distinct_id_table(pool, db_name, profile_id_table) {
    console.log('STEP B: Creating Distinct Ironman Profile ID Table (#1)');
    await drop_and_create(pool, db_name, profile_id_table, await step_b_create_distinct_profile_id_table(profile_id_table));
}

// STEP D: Create the Ironman-participant history table (#2).
// CREATE and INDEX are run + timed SEPARATELY so we can see which dominates the build.
async function create_history_table(pool, db_name, history_table, profile_id_table) {
    console.log('STEP D: Creating Ironman History Table (#2)');

    // Drop any prior copy.
    await execute_mysql_working_query(pool, db_name, await query_drop_table(history_table));

    // Part 1: CREATE TABLE ... AS SELECT (the JOIN + derived flags).
    console.log('STEP D.1: CREATE TABLE AS SELECT (join + derive)');
    runTimer('history_create_table');
    await execute_mysql_working_query(pool, db_name, await step_d_create_history_table(history_table, profile_id_table));
    stopTimer('history_create_table');

    // Part 2: ADD INDEXES.
    console.log('STEP D.2: ADD INDEXES');
    runTimer('history_create_indexes');
    await execute_mysql_working_query(pool, db_name, await query_append_history_indexes(history_table));
    stopTimer('history_create_indexes');
}

// STEP C: Batch through profile IDs, insert into final profile table.
// Performance design:
//   (#2) Keyset RANGE paging on id_profile_rr instead of a 50k-value IN() list — index-friendly.
//   (#1) Each batch is materialized into a small, indexed slice table (im_participation_2_history_batch);
//        the behavior CTEs scan that tiny table, so re-evaluation is cheap (no repeated full-history scans).
async function process_batches(pool, db_name, profile_id_table, history_table, final_table) {
    console.log('STEP C: Processing batches (keyset range + materialized slice)');
    let page_size = 50000;
    let counter = 0;
    const batch_table = 'im_participation_2_history_batch';

    const count_query = `SELECT COUNT(*) AS count_profile_ids FROM ${profile_id_table};`;
    const count_result = await execute_mysql_working_query(pool, db_name, count_query);
    const { count_profile_ids } = count_result[0];
    console.log(`Total Ironman profile IDs: ${count_profile_ids}`);

    // Keyset cursor: empty string sorts before all ids (id_profile_rr is excluded when NULL/'' in #1).
    let prev_cursor = '';
    let batch;
    do {
        // (#2) Pull the next page of ids by keyset (no OFFSET, no IN-list).
        const query_profile_ids = `
            SELECT id_profile_rr
            FROM ${profile_id_table}
            WHERE id_profile_rr > '${prev_cursor}'
            ORDER BY id_profile_rr
            LIMIT ${page_size}
        `;
        batch = await execute_mysql_working_query(pool, db_name, query_profile_ids);
        if (batch.length === 0) break;

        const cur_cursor = batch[batch.length - 1].id_profile_rr;
        console.log(`\nBatch ${counter + 1} of ~${Math.ceil(count_profile_ids / page_size)}: ${batch.length} profiles, range ('${prev_cursor}', '${cur_cursor}']`);

        // (#1) Materialize this batch's history slice via the same RANGE, then index it.
        const where_range = `AND id_profile_rr > '${prev_cursor}' AND id_profile_rr <= '${cur_cursor}'`;
        await execute_mysql_working_query(pool, db_name, await query_drop_table(batch_table));
        await execute_mysql_working_query(pool, db_name, await step_d_create_history_batch_table(batch_table, history_table, where_range));

        // Run the behavior insert against the small, indexed slice (where = '' — slice is already filtered).
        const insert_query = await step_c_insert_ironman_profiles(final_table, batch_table, '');
        await execute_mysql_working_query(pool, db_name, insert_query);

        prev_cursor = cur_cursor;
        counter++;
        await triggerGarbageCollection();
    } while (batch.length === page_size);

    // Clean up the transient slice table.
    await execute_mysql_working_query(pool, db_name, await query_drop_table(batch_table));

    page_size = null;
    counter = null;
    await triggerGarbageCollection();
}

// STEP III: Append indexes to the final table.
async function append_indexes(pool, db_name, final_table) {
    console.log('STEP III: Appending Indexes to final table');
    runTimer('query_to_create_indexes');
    await execute_mysql_working_query(pool, db_name, await query_append_index_fields(final_table));
    stopTimer('query_to_create_indexes');
}

// STEP IV: Export the final profile table to a SINGLE, archived CSV at the /data path.
// Archives the prior run (clears archive folder, moves old main-folder csvs into it),
// then streams one query row-by-row to one file (memory-safe).
async function export_to_csv() {
    console.log('STEP IV: Exporting Ironman profile table to a single archived CSV (/data path)');
    runTimer('export_csv');

    await execute_save_single_csv({
        directory_name:         'usat_csv_ironman_profile',
        directory_name_archive: 'usat_csv_ironman_profile_archive',
        fileName:               'ironman_profile_data',
        query: (retrieval_batch_size, offset) => query_ironman_profile(retrieval_batch_size, offset),
    });

    stopTimer('export_csv');
}

// Main function to execute the overall process.
async function execute_create_ironman_profile_tables() {
    let start_time = performance.now();
    let db_name = 'usat_sales_db';

    // Table names
    let final_table = 'im_participation_3_profile';
    let profile_id_table = 'im_participation_1_profile_ids';
    let history_table = 'im_participation_2_history';

    // Configuration for which steps to run.
    let steps_to_run = { 
        create_distinct_ids:    true, // Step A   — im_participation_1_profile_ids              #1
        create_history_table:   true, // Step B   — im_participation_2_history                  #2
        create_profile_table:   true, // Step C   — CREATE im_participation_3_profile (empty)   #3
        process_batches:        true, // Step D   — loop 50k profiles, Appendix-A INSERT -> #3
        append_indexes:         true, // Step III
        export_csv:             true, // Step IV  — stream #3 to CSV at /data path
    };

    try {
        await with_connection(async (pool) => {
            console.log(`Using database: ${db_name}`);

            if (steps_to_run.create_profile_table) {
                await create_profile_table(pool, db_name, final_table);
            }
            if (steps_to_run.create_distinct_ids) {
                await create_distinct_id_table(pool, db_name, profile_id_table);
            }
            if (steps_to_run.create_history_table) {
                await create_history_table(pool, db_name, history_table, profile_id_table);
            }
            if (steps_to_run.process_batches) {
                await process_batches(pool, db_name, profile_id_table, history_table, final_table);
            }
            if (steps_to_run.append_indexes) {
                await append_indexes(pool, db_name, final_table);
            }

            console.log('All MySQL queries executed successfully.');
        });

        // STEP IV runs on its own pool (execute_save_data_to_csv manages its own connection).
        if (steps_to_run.export_csv) {
            await export_to_csv();
        }

    } catch (error) {
        console.error('Error executing queries:', error);
    } finally {
        let elapsed_time = ((performance.now() - start_time) / 1000).toFixed(2);
        console.log(`Elapsed Time: ${elapsed_time} sec`);

        final_table = null;
        profile_id_table = null;
        history_table = null;
        steps_to_run = null;
        db_name = null;

        await triggerGarbageCollection();
        return elapsed_time;
    }
}

// execute_create_ironman_profile_tables();

module.exports = {
    execute_create_ironman_profile_tables,
};
