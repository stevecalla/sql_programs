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
    query_append_created_at_dates,
    query_append_index_fields,
    query_get_min_and_max_races_dates,
    step_4_create_participation_with_membership_match,
    query_create_mtn_utc_timestamps,
    create_participation_min_start_date_races,
    create_participation_prev_race_date,
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

async function get_created_at_dates(pool, db_name, table_name) {
    const query = await query_create_mtn_utc_timestamps();

    const result = await execute_mysql_working_query(pool, db_name, query);

    const { created_at_mtn, created_at_utc } = result[2][0];

    return { created_at_mtn, created_at_utc };
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

async function create_support_tables(pool, db_name) {
    runTimer(`query_to_create_table`);

    console.log('CREATE SUPPORT TABLES');

    console.log('Create all_participation_min_start_date_races table');
    // STEP #1A: CREATE SUPPORT TABLES WITH MIN START DATE RACES & PREV RACE DATE FOR ID PROFILES
    await execute_mysql_working_query(pool, db_name, await create_participation_min_start_date_races());

    stopTimer(`query_to_create_table`);

    runTimer(`query_to_create_table`);

    console.log('Create all_participation_prev_race_date table');
    await execute_mysql_working_query(pool, db_name, await create_participation_prev_race_date());

    stopTimer(`query_to_create_table`);
    return;
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

    // APPEND CREATED AT FIELDS
    const query_to_append_created_at_fields = await query_append_created_at_dates(table_name);
    await execute_mysql_working_query(pool, db_name, query_to_append_created_at_fields);

    stopTimer(`query_to_create_table`);
    return;
}

async function insert_data(pool, db_name, table_name, created_at_mtn, created_at_utc, is_test = false) {
    const start_year = 2010; // Default = 2010
    const membershipPeriodEnds = '2008-01-01';
    const period_interval = 3; // options include 1, 3, 6 months

    let start_date_time = "2010-03-01 00:00:00";
    let end_date_time = "2010-03-01 23:59:00";

    // testing
    // start_date_time = "2025-01-01 00:00:00"; // Default = 2025
    // end_date_time = "2025-12-31 23:59:00";

    let min_start_date = start_date_time;
    let max_end_date = "2033-05-12 23:59:00";

    // GET DATE PERIODS
    let date_periods = await generate_date_periods(start_year, membershipPeriodEnds, period_interval);

    // SET LOOP ITERATION; IF TEST SET LOOP TO ONE TIME ONLY
    let loop_iteration = 0;
    is_test ? loop_iteration = 1 : loop_iteration = date_periods.length;

    for (let i = 0; i < loop_iteration; i++) {
    
        runTimer(`${i}_query_to_insert_data`);
        
        const date_period = date_periods[i];

        if (!is_test) {
            start_date_time = date_period.start_date_time;
            end_date_time = date_period.end_date_time;

            // GET MIN & MAX MP DATES TO LIMIT THE RACE RESULTS QUERY
            const query_min_max_dates = await query_get_min_and_max_races_dates(start_date_time, end_date_time);

            console.log('\nSTEP 1: min & max date query running')
            const date = await execute_mysql_working_query(pool, db_name, query_min_max_dates);
            const { min_date, max_date } = date[0];

            min_start_date = min_date || start_date_time;
            max_end_date = max_date || max_end_date;

            // console.log(query_min_max_dates);
            // console.log(date);
        }
        
        console.log(`\nQuery of ${i + 1} of ${date_periods.length}: ****** Start Date: ${start_date_time}; End Date: ${end_date_time}.`);

        console.log(`Query of ${i + 1} of ${date_periods.length}: ****** Min Race Date: ${min_start_date}; Max Race Date: ${max_end_date}.`);

        // QUERY TO INSERT THE DATA
        console.log('\nStep 2: get insert query running');
        const query_to_insert_data = await step_4_create_participation_with_membership_match(table_name, start_date_time, end_date_time, min_start_date, max_end_date, created_at_mtn, created_at_utc);
        // console.log(query_to_insert_data);

        console.log('\nStep 3: insert query running');
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
    let is_test = false; // true will run less data for insert

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_sales_db`;
        const table_name = `all_participation_data_with_membership_match`;
        console.log(db_name);

        // STEP #1: CREATE TABLES
        // await create_support_tables(pool, db_name); // WITH MIN START RACE DATES & PREV RACE DATES

        await create_table(pool, db_name, table_name); // CREATE all_participation_data_with_membership_match

        // STEP #1B: GET CREATED AT DATE
        const { created_at_mtn, created_at_utc } = await get_created_at_dates(pool, db_name, table_name);
        // console.log('CREATED AT DATES =', created_at_mtn, created_at_utc);

        // STEP #2: INSERT DATA
        await insert_data(pool, db_name, table_name, created_at_mtn, created_at_utc, is_test);

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