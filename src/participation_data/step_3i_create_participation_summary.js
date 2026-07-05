const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');
const { triggerGarbageCollection } = require('../../utilities/garbage_collection/trigger_garbage_collection');

const { query_drop_table } = require("../queries/create_drop_db_table/queries_drop_db_tables");

const {
    create_participation_summary_table,
    create_participation_flows_table,
    query_append_index_fields_summary,
    query_append_index_fields_flows,
} = require("../queries/participation_data/step_3i_create_participation_summary_table");

const { runTimer, stopTimer } = require('../../utilities/timer');

// Connect to MySQL (mirrors step_3a_create_participation_match_profile).
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

// EXECUTE MYSQL TO CREATE TABLES & WORK WITH TABLES QUERY (mirrors step_3a).
async function execute_mysql_working_query(pool, db_name, query) {
    const startTime = performance.now();
    runTimer(db_name);

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, (useError) => {
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

// DROP then CREATE a table from a builder(table_name, base_table) (mirrors execute_process_step).
async function create_table_from_builder(pool, db_name, builder, table_name, base_table) {
    try {
        runTimer(table_name);
        console.log(`\nSTEP 0: CREATE ${table_name} ****************`);
        await execute_mysql_working_query(pool, db_name, await query_drop_table(table_name));
        await execute_mysql_working_query(pool, db_name, await builder(table_name, base_table));
        console.log(`\n****************\n`);
    } catch (error) {
        console.log('create_table_from_builder: query NOT executed successfully.');
        console.error('Error:', error);
        throw error;
    } finally {
        stopTimer(table_name);
    }
}

// Helper to manage the database connection lifecycle (mirrors step_3a).
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

// Main: build the reporting summary + flows tables from the parent participation table, then index them.
async function execute_create_participation_summary() {
    let start_time = performance.now();
    let db_name = 'usat_sales_db';
    let base_table = 'all_participation_data_with_membership_match';
    let summary_table = 'all_participation_data_with_membership_match_summary';
    let flows_table = 'all_participation_data_with_membership_match_flows';

    let steps_to_run = {
        create_summary: true,
        index_summary: true,
        create_flows: true,
        index_flows: true,
    };

    try {
        await with_connection(async (pool) => {
            console.log(`Using database: ${db_name}`);

            if (steps_to_run.create_summary) {
                await create_table_from_builder(pool, db_name, create_participation_summary_table, summary_table, base_table);
            }
            if (steps_to_run.index_summary) {
                console.log('Appending indexes to summary table');
                await execute_mysql_working_query(pool, db_name, await query_append_index_fields_summary(summary_table));
            }
            if (steps_to_run.create_flows) {
                await create_table_from_builder(pool, db_name, create_participation_flows_table, flows_table, base_table);
            }
            if (steps_to_run.index_flows) {
                console.log('Appending indexes to flows table');
                await execute_mysql_working_query(pool, db_name, await query_append_index_fields_flows(flows_table));
            }

            console.log('All queries executed successfully.');
        });
    } catch (error) {
        console.error('Error executing queries:', error);
    } finally {
        let elapsed_time = ((performance.now() - start_time) / 1000).toFixed(2);
        console.log(`Elapsed Time: ${elapsed_time} sec`);

        db_name = null;
        base_table = null;
        summary_table = null;
        flows_table = null;
        steps_to_run = null;

        await triggerGarbageCollection();

        return elapsed_time;
    }
}

// execute_create_participation_summary();

module.exports = {
    execute_create_participation_summary,
};
