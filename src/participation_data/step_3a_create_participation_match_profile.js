const fsp = require('fs').promises; // promses necessary for "fs.readdir"
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { query_drop_table } = require("../queries/create_drop_db_table/queries_drop_db_tables");

const { 
    query_create_participation_profiles,
    query_append_index_fields
} = require("../queries/participation_data/step_3a_create_participation_match_profile_table");

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
                    console.log("\nQuery results - Elapsed Time:", elapsedTime, "sec");

                    resolve(results);
                }
            });
        });
    });
}

async function execute_create_participation_profile_table() {   
    let pool;
    const startTime = performance.now();
    let test = false; // true will run less data for insert

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_sales_db`;
        const table_name = `participation_profiles`;
        console.log(db_name);
        
        // STEP #1: DROP TABLE
        console.log('\nDROP & CREATE TABLE ****************');
        runTimer(`query_to_drop_and_create_table`);
        
        const query_to_drop_table = await query_drop_table(table_name);
        await execute_mysql_working_query(pool, db_name, query_to_drop_table);

        // STEP #2: CREATE TABLE
        const query_to_create_table = await query_create_participation_profiles(table_name);
        await execute_mysql_working_query(pool, db_name, query_to_create_table);

        stopTimer(`query_to_drop_and_create_table`);
 
        // STEP #3: APPEND INDEXES
        // console.log('\nCREATED INDEXES ****************');
        // runTimer(`query_to_create_indexes`);

        // const query_to_create_indexes = await query_append_index_fields(table_name);
        // await execute_mysql_working_query(pool, db_name, query_to_create_indexes);

        // stopTimer(`query_to_create_indexes`);

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

// execute_create_participation_profile_table();

module.exports = {
    execute_create_participation_profile_table,
}