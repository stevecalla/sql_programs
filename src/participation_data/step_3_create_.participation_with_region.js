const fsp = require('fs').promises; // promses necessary for "fs.readdir"
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

// const { query_step_0_sales_key_metrics_master_logic } = require('../queries/sales_data_key_metrics/step_0_get_sales_key_metrics_data_master_logic_010425');

const { step_3_create_participation_with_regions } = require("../queries/participation_data/step_3_create_participation_with_regions");

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
                    // console.table(results[1]);
                    // console.log(results[1]);
                    console.log(`Query results: ${results[1].affectedRows}, Elapsed Time: ${elapsedTime} sec\n`);

                    resolve(results[1].affectedRows);
                }
            });
        });
    });
}

async function execute_create_participation_with_regions() {
    let pool;
    const startTime = performance.now();

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_sales_db`;
        console.log(db_name);

        // STEP #1: ITERATE THRU EACH QUERY & EXECUTE
        // QUERY CONTAINS A TABLE DROP, TABLE CREATE, & INDEXES (IF APPLICABLE)
        const query = await step_3_create_participation_with_regions();

        runTimer(`${i}_query_to_create_table`);

        const results = await execute_mysql_working_query(pool, db_name, query);
        
        console.log(`Rows affected/added ${results}\n`);

        stopTimer(`${i}_query_to_create_table`);

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

// execute_create_participation_with_regions();

module.exports = {
    execute_create_participation_with_regions,
}