const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');
const { triggerGarbageCollection } = require('../../utilities/garbage_collection/trigger_garbage_collection');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_drop_table } = require("../queries/create_drop_db_table/queries_drop_db_tables");

const {
    query_create_cohort_table,
    query_create_activity_table,
    query_append_cohort_indexes,
    query_append_activity_indexes,
} = require("../queries/participation_data/step_3g_create_ironman_timeseries_table");

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

async function execute_mysql_working_query(pool, db_name, query) {
    const startTime = performance.now();
    runTimer(db_name);

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, () => {
            pool.query({ sql: query }, (queryError, results) => {
                const elapsedTime = ((performance.now() - startTime) / 1_000).toFixed(2);
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

async function with_connection(callback) {
    const pool = await create_connection();
    try {
        await callback(pool);
    } catch (error) {
        throw error;
    } finally {
        await pool.end(err => {
            if (err) console.error('Error closing connection pool:', err.message);
            else console.log('Connection pool closed successfully.');
        });
    }
}

async function execute_create_ironman_timeseries_tables() {
    let start_time = performance.now();
    let db_name = 'usat_sales_db';

    let cohort_table = 'im_participation_4_timeseries_cohort';
    let activity_table = 'im_participation_5_timeseries_activity';

    let steps_to_run = { // todo:
        create_cohort_rollup:   true, // #4 im_participation_4_timeseries_cohort
        create_activity_rollup: true, // #5 im_participation_5_timeseries_activity
        append_indexes:         true,
    };

    try {
        await with_connection(async (pool) => {
            console.log(`Using database: ${db_name}`);

            if (steps_to_run.create_cohort_rollup) {
                console.log('Creating cohort retention rollup (#4)');
                await drop_and_create(pool, db_name, cohort_table, await query_create_cohort_table(cohort_table));
            }
            if (steps_to_run.create_activity_rollup) {
                console.log('Creating activity-by-year rollup (#5)');
                await drop_and_create(pool, db_name, activity_table, await query_create_activity_table(activity_table));
            }
            if (steps_to_run.append_indexes) {
                console.log('Appending indexes to rollups');
                if (steps_to_run.create_cohort_rollup) {
                    await execute_mysql_working_query(pool, db_name, await query_append_cohort_indexes(cohort_table));
                }
                if (steps_to_run.create_activity_rollup) {
                    await execute_mysql_working_query(pool, db_name, await query_append_activity_indexes(activity_table));
                }
            }

            console.log('All time-series queries executed successfully.');
        });
    } catch (error) {
        console.error('Error executing queries:', error);
    } finally {
        let elapsed_time = ((performance.now() - start_time) / 1000).toFixed(2);
        console.log(`Elapsed Time: ${elapsed_time} sec`);

        cohort_table = null;
        activity_table = null;
        steps_to_run = null;
        db_name = null;

        await triggerGarbageCollection();
        return elapsed_time;
    }
}

// execute_create_ironman_timeseries_tables();

module.exports = {
    execute_create_ironman_timeseries_tables,
};
