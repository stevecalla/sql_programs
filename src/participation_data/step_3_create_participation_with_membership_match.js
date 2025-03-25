const fsp = require('fs').promises; // promses necessary for "fs.readdir"
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { query_drop_table } = require("../queries/create_drop_db_table/queries_drop_db_tables");
const { 
    query_create_table,
    query_append_region_fields,
    query_append_membership_period_fields,
    query_append_index_fields,
    step_4_create_participation_with_membership_match,
} = require("../queries/participation_data/step_3_create_participation_with_membership_match");

const { generate_date_periods } = require('../../utilities/data_query_criteria/generate_date_periods');
const { runTimer, stopTimer } = require('../../utilities/timer');

// Connect to MySQL
async function create_connection() {

    console.log('create connection');

    try {
        // Create a connection to MySQL
        const config_details = await local_usat_sales_db_config();

        const pool = create_local_db_connection(config_details);

        return (pool);

    } catch (error) {
        console.log(`Error connecting: ${error}`)
    }
}

// EXECUTE MYSQL TO CREATE TABLES & WORK WITH TABLES QUERY
async function execute_mysql_working_query(pool, db_name, query) {
    const startTime = performance.now();
    // const fs = require('fs');

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, (queryError, results) => {
            pool.query({sql: query,}, (queryError, results) => {

                const endTime = performance.now();
                const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

                if (queryError) {
                    console.error('Error executing select query:', queryError);

                    reject(queryError);
                } else {
                    // console.log("Query results:", results, "Elapsed Time:", elapsedTime, "sec");
                    console.log("Query results - Elapsed Time:", elapsedTime, "sec");


                    resolve(results.affectedRows);
                }
            });
        });
    });
}

async function create_table(pool, db_name, table_name) {
    runTimer(`query_to_create_table`);

    // DROP TABLE
    const query_to_drop_table = await query_drop_table(table_name);
    await execute_mysql_working_query(pool, db_name, query_to_drop_table);

    // CREATE TABLE, ADD PARTICIPATION FIELDS
    const query_to_create_table = await query_create_table(table_name);
    await execute_mysql_working_query(pool, db_name, query_to_create_table);

    // APPEND REGION FIELDS
    const query_to_append_region_fields = await query_append_region_fields(table_name);
    await execute_mysql_working_query(pool, db_name, query_to_append_region_fields);

    // APPEND SALES, ROW NUMBER & IS ACTIVE FIELDS
    const query_to_append_membership_period_fields = await query_append_membership_period_fields(table_name);
    await execute_mysql_working_query(pool, db_name, query_to_append_membership_period_fields);

    stopTimer(`query_to_create_table`);
    return;
}

async function insert_data(pool, db_name, table_name, test = false) {
    const start_year = 2010; // Default = 2010
    const membershipPeriodEnds = '2008-01-01';
    const period_interval = 2; // options include 1, 3, 6 months

    let date_periods = await generate_date_periods(start_year, membershipPeriodEnds, period_interval);

    let loop_iteration = 0;
    test ? loop_iteration = 1 : loop_iteration = date_periods.length;

    for (let i = 0; i < loop_iteration; i++) {
    
        runTimer(`${i}_query_to_insert_data`);
        
        const date_period = date_periods[i];
        let start_date_time = "";
        let end_date_time = "";
        
        if (test) {
            start_date_time = '2025-03-01 00:00:00';
            end_date_time = '2025-03-01 23:59:00';
        } else {
            start_date_time = date_period.start_date_time;
            end_date_time = date_period.end_date_time;
        }

        const query_to_insert_data = await step_4_create_participation_with_membership_match(table_name, start_date_time, end_date_time);

        console.log(`\nQuery of ${i + 1} of ${date_periods.length}: ****** Start Date: ${start_date_time}; End Date: ${end_date_time}.`)

        await execute_mysql_working_query(pool, db_name, query_to_insert_data);

        stopTimer(`${i}_query_to_insert_data`);
    }

    return;
}

async function append_indexes(pool, db_name, table_name) {
    console.log("Create indexes");

    runTimer(`query_to_append_indexes`);

    const query_to_create_indexes = await query_append_index_fields(table_name);
    await execute_mysql_working_query(pool, db_name, query_to_create_indexes);

    stopTimer(`query_to_append_indexes`);
    return;
}

async function execute_create_participation_with_membership_match() {
    let pool;
    const startTime = performance.now();
    let test = false; // true will run less data for insert

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_sales_db`;
        const table_name = `all_participation_data_with_membership_match`;
        console.log(db_name);

        // STEP #1: CREATE TABLE
        await create_table(pool, db_name, table_name);

        // STEP #2: INSERT DATA
        await insert_data(pool, db_name, table_name, test);
 
        // STEP #3: APPEND INDEXES
        console.log('CREATED INDEXES ****************')
        // await append_indexes(pool, db_name, table_name)

        // STEP #5a: Log results
        console.log('STEP #1: All queries executed successfully.');

    } catch (error) {
        console.log('STEP #1: All queries NOT executed successfully.');
        console.error('Error:', error);

    } finally {
        // STEP #6: CLOSE CONNECTION/POOL
        await pool.end(err => {
            if (err) {
                console.error('Error closing connection pool:', err.message);
            } else {
                console.log('Connection pool closed successfully.');
            }
        });

        // LOG RESULTS
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

        console.log(`\nSTEP #1 = TIME LOG. Elapsed Time: ${elapsedTime ? elapsedTime : "Opps error getting time"} sec\n`);
        
        return elapsedTime;
    }
}

// execute_create_participation_with_membership_match();

module.exports = {
    execute_create_participation_with_membership_match,
}