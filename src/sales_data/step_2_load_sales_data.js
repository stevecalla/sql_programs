const fs = require('fs').promises; // promses necessary for "fs.readdir"
const mysql = require('mysql2');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');
const { getCurrentDateTime } = require('../../utilities/getCurrentDate');
const { csv_export_path } = require('../../utilities/config');
const { generateLogFile } = require('../../utilities/generateLogFile');

const { query_create_database } = require('../queries/create_drop_db_table/queries_create_db');
const { query_drop_database, query_drop_table } = require('../queries/create_drop_db_table/queries_drop_db_tables');
const { query_load_sales_data } = require('../queries/load_data/query_load_data');
const { tables_library } = require('../queries/create_drop_db_table/queries_create_tables');

const { runTimer, stopTimer } = require('../../utilities/timer');

// Connect to MySQL
async function create_connection() {

    console.log('create connection');

    try {
        // Create a connection to MySQL
        const config_details = local_usat_sales_db_config;
        // console.log(config_details);

        const pool = create_local_db_connection(config_details);
        // console.log(pool);

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
                console.error('Error executing select query:', queryError);
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
async function execute_mysql_working_query(pool, db_name, query, step_info, rows_added) {
    const startTime = performance.now();

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, (queryError, results) => {
            pool.query(query, (queryError, results) => {
                const endTime = performance.now();
                const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

                if (queryError) {
                    console.error('Error executing select query:', queryError);
                    reject(queryError);
                } else {
                    console.log(`\n${step_info}`);
                    console.table(results);
                    console.log(`Query results: ${results.info}, Elapsed Time: ${elapsedTime} sec\n`);

                    // stopTimer(i);nod
                    rows_added = parseInt(results.affectedRows);
                    resolve(rows_added);
                }
            });
        });
    });
}

// INSERT "CREATED AT" DATE, INSERT "UPDATED AT" DATA
async function execute_insert_createdAt_query(pool, db_name, table, step) {
    return new Promise((resolve, reject) => {

        const startTime = performance.now();

        const addCreateAtDate = `
            ALTER TABLE ${table} 
                ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;`;

        pool.query(`USE ${db_name};`, (queryError, results) => {
            pool.query(addCreateAtDate, (queryError, results) => {
                const endTime = performance.now();
                const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

                if (queryError) {
                    console.error(`Error executing ${step}:`, queryError);
                    reject(queryError);
                } else {
                    console.log(`\n${step}`);
                    console.table(results);
                    console.log(`Query results: ${results.info}, Elapsed Time: ${elapsedTime} sec\n`);

                    // resolve();
                }
            });
        });

        // Update the created_at and updated_at columns to UTC timestamps
        pool.query(`USE ${db_name};`, (queryError, results) => {
            pool.query(`
                UPDATE ${table}
                SET created_at = UTC_TIMESTAMP()
                    -- updated_at = UTC_TIMESTAMP()
                WHERE your_condition;
            `);

            resolve();
        });
    });
}

async function main() {
    let pool; // Declare the pool variable outside the try block to close connection in finally block
    const startTime = performance.now();

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_sales_db`;
        console.log(db_name);

        // STEP #1: CREATE DATABASE
        // await execute_mysql_working_query(pool, db_name, query_drop_database(db_name), `STEP #1.0: DROP DB`);
        // await execute_mysql_create_db_query(pool, query_create_database(db_name), `STEP #1.1: CREATE DATABASE`);

        // STEP #2: CREATE TABLES = all files loaded into single table
        for (const table of tables_library) {
            const { table_name, create_query, step, step_info } = table;

            const drop_query = query_drop_table(table_name.toUpperCase());

            const drop_info = `${step} DROP ${step_info.toUpperCase()} TABLE`;
            const create_info = `${step} CREATE ${step_info.toUpperCase()} TABLE`;

            await execute_mysql_working_query(pool, db_name, drop_query, drop_info);
            await execute_mysql_working_query(pool, db_name, create_query, create_info);
        }

        // STEP #3 - GET FILES IN DIRECTORY / LOAD INTO "USER DATA" TABLE
        console.log(`STEP #3 - GET FILES IN DIRECTORY / LOAD INTO "usat all_membership_sales_data" TABLE`);
        console.log(getCurrentDateTime());

        let rows_added = 0;

        const directory = `${csv_export_path}usat_sales_data`; // Directory containing CSV files
        console.log(directory);

        // List all files in the directory
        const files = await fs.readdir(directory);
        console.log(files);
        let numer_of_files = 0;

        // Iterate through each file
        for (let i = 0; i < files.length; i++) {
            let currentFile = files[i];

            if (currentFile.endsWith('.csv')) {
                numer_of_files++;

                // Construct the full file path
                const filePath = `${directory}/${currentFile}`;
                console.log('file path to insert data = ', filePath);

                // let table_name = tables_library[i].table_name;
                let table_name = tables_library[0].table_name;
                
                const query_load_data = query_load_sales_data(filePath, table_name);

                // Insert file into "" table
                let query = await execute_mysql_working_query(pool, db_name, query_load_data, filePath, table_name, rows_added, i);

                // track number of rows added
                rows_added += parseInt(query);
                console.log(`File ${i} of ${files.length}`);
                console.log(`Rows added = ${rows_added}\n`);
            }
        }

        generateLogFile('loading_usat_sales_data', `Total files added = ${numer_of_files} Total rows added = ${rows_added.toLocaleString()}`, csv_export_path);
        console.log('Files processed =', numer_of_files);

        // STEP #5 - INSERT "CREATED AT" DATE
        // console.log(`STEP #5 - INSERT "CREATED AT" DATE`);
        // await execute_insert_createdAt_query(pool, `${table}`);

        // STEP #4: UPDATE TABLES TO INCLUDE A CREATED AT AND UPDATED AT FIELD/DATE
        // for (const table of tables_library) {
        //     const { table_name } = table;

        //     await execute_insert_createdAt_query(pool, db_name, table_name, `STEP #5: INSERT CREATED/UPDATED AT DATE IN ${table_name.toUpperCase()} TABLE`);
        // }

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
