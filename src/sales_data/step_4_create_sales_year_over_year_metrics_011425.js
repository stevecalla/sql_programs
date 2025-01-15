const fsp = require('fs').promises; // promses necessary for "fs.readdir"
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });
const path = require('path');

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { query_step_0_year_over_year_data_master_logic } = require('../queries/sales_data_year_over_year/step_0_get_sales_year_over_year_data_master_logic_011425');

const { runTimer, stopTimer } = require('../../utilities/timer');

// Connect to MySQL
async function create_connection() {

    console.log('create connection');

    try {
        // Create a connection to MySQL
        const config_details = local_usat_sales_db_config;

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

async function execute_create_year_over_year_key_metrics() {
    let pool;
    const startTime = performance.now();

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_sales_db`;
        console.log(db_name);

        // STEP #1: ITERATE THRU EACH QUERY & EXECUTE
            // EACH QUERY CONTAINS A TABLE DROP, TABLE CREATE, & INDEXES (IF APPLICABLE)
        const query_list = await query_step_0_year_over_year_data_master_logic();
        const number_of_queries = query_list.length;

        for (let i = 0; i < query_list.length; i++) {

            runTimer(`${i}_query_to_create_table`);

            let current_query = query_list[i]();
            const results = await execute_mysql_working_query(pool, db_name, current_query);
            
            console.log(`\nExecuted ${i} of ${number_of_queries} queries`);
            console.log(`Rows affected/added ${results}\n`);

            stopTimer(`${i}_query_to_create_table`);
        }

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

execute_create_year_over_year_key_metrics();

module.exports = {
    execute_create_year_over_year_key_metrics,
}
