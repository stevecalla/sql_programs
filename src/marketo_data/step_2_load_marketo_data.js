const fsp = require('fs').promises; // promses necessary for "fs.readdir"
// const mysql = require('mysql2');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });
const path = require('path');

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');
const { getCurrentDateTime } = require('../../utilities/getCurrentDate');
const { create_directory } = require('../../utilities/createDirectory');

const { query_create_database } = require('../queries/create_drop_db_table/queries_create_db');
const { query_drop_database, query_drop_table } = require('../queries/create_drop_db_table/queries_drop_db_tables');

const { query_load_marketo_data } = require('../queries/load_data/query_load_marketo_data');
const { query_update_or_insert_into_main } = require('../queries/load_data/query_load_and_insert_marketo_data');

const { initializeTables, query_create_marketo_table } = require('../queries/create_drop_db_table/query_create_marketo_table');

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

// EXECUTE MYSQL TO CREATE DB QUERY
async function execute_mysql_create_db_query(pool, query, step_info) {

    return new Promise((resolve, reject) => {

        const startTime = performance.now();

        pool.query(query, (queryError, results) => {
            const endTime = performance.now();
            const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

            if (queryError) {
                console.error('Error executing create query:', queryError);
                reject(queryError);
            } else {
                console.log(`\n${step_info}`);
                console.table(results);
                console.log(`Query results: ${results.info}, Elapsed Time: ${elapsedTime} sec\n`);
                resolve();
            }
        });
    });
}

// EXECUTE MYSQL TO CREATE TABLES & WORK WITH TABLES QUERY
async function execute_mysql_working_query(pool, db_name, query, filePath) {
    const startTime = performance.now();
    const fs = require('fs');

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, (queryError, results) => {
            // pool.query(query, (queryError, results) => {
            pool.query({
                sql: query,
                infileStreamFactory: function () { return fs.createReadStream(filePath) }
            },
                (queryError, results) => {

                    const endTime = performance.now();
                    const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

                    if (queryError) {
                        console.error('Error executing select query:', queryError);

                        reject(queryError);
                    } else {
                        console.table(results);
                        console.log(`Query results: ${results.info}, Elapsed Time: ${elapsedTime} sec\n`);

                        // stopTimer(i);
                        rows_added = parseInt(results.affectedRows);
                        resolve(rows_added);
                    }
                });
        });
    });
}

async function main() {
    let pool;
    const startTime = performance.now();

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_marketo_db`;
        console.log(db_name);

        // STEP #1: CREATE DATABASE - ONLY NEED TO CREATE DB INITIALLY
        const drop_db = false; // normally don't drop db
        drop_db && await execute_mysql_working_query(pool, db_name, query_drop_database(db_name), `STEP #1.0: DROP DB`);

        await execute_mysql_create_db_query(pool, query_create_database(db_name), `STEP #1.1: CREATE DATABASE`);

        // STEP #2: CREATE TABLES = all files loaded into single table
        let table_library = await initializeTables();

        for (const table of table_library) {
            const { table_name, create_query, step, step_info } = table;

            const drop_query = await query_drop_table(table_name);
            const drop_info = `${step} DROP ${step_info.toUpperCase()} TABLE`;
            await execute_mysql_working_query(pool, db_name, drop_query, drop_info);

            const create_info = `${step} CREATE ${step_info.toUpperCase()} TABLE`;
            await execute_mysql_working_query(pool, db_name, create_query, create_info);
        }

        // STEP #3 - GET FILES IN DIRECTORY / LOAD INTO MARKETO EMAIL DATA
        console.log(`STEP #3 - GET FILES IN DIRECTORY / LOAD INTO "usat marketo_email_data" TABLE`);
        console.log(getCurrentDateTime());

        const directory = await create_directory('usat_marketo_data');
        console.log(directory);

        // List all files in the directory
        const files = await fsp.readdir(directory);
        console.log(files);
        let number_of_fles = 0;

        // Iterate through each file
        for (let i = 0; i < files.length; i++) {

            runTimer(`${i}_get_data`);

            let currentFile = files[i];

            if (currentFile.endsWith('.csv')) {
                number_of_fles++;

                // Construct the full file path
                let filePath = path.join(directory, currentFile);
                filePath = filePath.replace(/\\/g, '/');

                console.log('file path to insert data = ', filePath);

                const email_table_name = 'marketo_email_data';
                const temp_table_name = 'marketo_temp_table';

                // STEP #1: DROP TEMP TABLE
                const drop_query = await query_drop_table(temp_table_name);
                await execute_mysql_working_query(pool, db_name, drop_query, filePath);

                // STEP #2: CREATE TEMP TABLE
                const create_query = await query_create_marketo_table(temp_table_name);
                await execute_mysql_working_query(pool, db_name, create_query, filePath);

                // STEP #3: LOAD DATA INTO TEMP TABLE
                const load_query = await query_load_marketo_data(filePath, temp_table_name);
                await execute_mysql_working_query(pool, db_name, load_query, filePath);

                // STEP #3a: ALTER SEGMENTS
                const alter_query = `
                    UPDATE marketo_temp_table
                    SET segment = REPLACE(segment, ' - Control', '')
                    WHERE segment LIKE '% - Control' AND id > 0;
                `;
                await execute_mysql_working_query(pool, db_name, alter_query, filePath);

                // STEP #4: UPDATE OR INSERT DATA INTO MARKETO MAIN DATA TABLE
                console.log(`\nexecute upate or insert from ${email_table_name} to ${temp_table_name}\n`.toUpperCase())
                const update_query = await query_update_or_insert_into_main(email_table_name, temp_table_name);
                await execute_mysql_working_query(pool, db_name, update_query, filePath, rows_added);

                // // STEP #5: DROP TEMP TABLE IF NECESSARY
                const drop_table = false;
                drop_table && await execute_mysql_working_query(pool, db_name, drop_query, filePath);

                // track number of rows added
                console.log(`File ${i} of ${files.length}`);
                console.log(`Rows added = ${rows_added}\n`);

                stopTimer(`${i}_get_data`);
            }
        }

        // STEP #5a: Log results
        console.log('STEP #5A: All queries executed successfully.');

    } catch (error) {
        console.log('STEP #5B: All queries NOT executed successfully.');
        console.error('Error:', error);

    } finally {
        // STEP #5c: Log results
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec
        console.log(`\nSTEP #5C = TIME LOG. Elapsed Time: ${elapsedTime ? elapsedTime : "Opps error getting time"} sec\n`);
        // return elapsedTime;

        // STEP #6: CLOSE CONNECTION/POOL
        await pool.end(err => {
            if (err) {
                console.error('Error closing connection pool:', err.message);
            } else {
                console.log('Connection pool closed successfully.');
                process.exit();
            }
        });
    }
}

main();
