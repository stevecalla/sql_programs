const fsp = require('fs').promises; // promses necessary for "fs.readdir"
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');
const { triggerGarbageCollection } = require('../../utilities/garbage_collection/trigger_garbage_collection');

const { query_drop_table } = require("../queries/create_drop_db_table/queries_drop_db_tables");
const { 
    query_create_table,
    query_insert_participation_race_profiles,
    query_append_index_fields,
} = require("../queries/participation_data/step_3c_create_participation_match_race_profile_table");

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


                    resolve(results);
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

    stopTimer(`query_to_create_table`);
    return;
}

async function insert_data(pool, db_name, table_name, test = false) {
    const start_year = 2010; // Default = 2010
    const membershipPeriodEnds = '2008-01-01';
    const period_interval = 12; // options include 1, 3, 6 months

    let start_date_time = "2010-01-01 00:00:00";
    let end_date_time = "2010-12-31 23:59:00";
    let min_start_date = start_date_time;
    let max_end_date = "2010-12-31 23:59:00";

    // GET DATE PERIODS
    let date_periods = await generate_date_periods(start_year, membershipPeriodEnds, period_interval);
    // console.log(date_periods);

    // SET LOOP ITERATION; IF TEST SET LOOP TO ONE TIME ONLY
    let loop_iteration = 0;
    test ? loop_iteration = 1 : loop_iteration = date_periods.length;

    for (let i = 0; i < loop_iteration; i++) {
    
        runTimer(`${i}_query_to_insert_data`);
        
        const date_period = date_periods[i];

        if (!test) {
            start_date_time = date_period.start_date_time;
            end_date_time = date_period.end_date_time;
        }

        console.log(`\nQuery of ${i + 1} of ${date_periods.length}: ****** Start Date: ${start_date_time}; End Date: ${end_date_time}.`);

        // QUERY TO INSERT THE DATA
        console.log('\nStep 2: get insert query running');
        const query_to_insert_data = await query_insert_participation_race_profiles(table_name, start_date_time, end_date_time, min_start_date, max_end_date);
        // console.log(query_to_insert_data);

        console.log('\nStep 3: insert query running');
        await execute_mysql_working_query(pool, db_name, query_to_insert_data);

        // Clear memory
        await triggerGarbageCollection();

        stopTimer(`${i}_query_to_insert_data`);
    }
    
    // Clear memory
    await triggerGarbageCollection();

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

async function execute_create_participation_race_profile_tables() {   
    let pool;
    const startTime = performance.now();
    let test = false; // true will run less data for insert

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_sales_db`;
        const table_name = `participation_race_profiles`;
        console.log(db_name);

        // STEP #1: CREATE TABLE
        await create_table(pool, db_name, table_name);

        // STEP #2: INSERT DATA
        await insert_data(pool, db_name, table_name, test);
 
        // STEP #3: APPEND INDEXES
        console.log('CREATED INDEXES ****************')
        await append_indexes(pool, db_name, table_name)

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
        
        // Clear memory
        startTime = null;
        test = null;
        pool = null;
        db_name = null;
        table_name = null;

        await triggerGarbageCollection();
        
        return elapsedTime;
    }
}

// execute_create_participation_race_profile_tables();

module.exports = {
    execute_create_participation_race_profile_tables,
}