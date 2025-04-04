const fsp = require('fs').promises; // promses necessary for "fs.readdir"
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { query_drop_table } = require("../queries/create_drop_db_table/queries_drop_db_tables");

const { 
    query_create_participation_profiles,
    query_create_table,
    query_append_index_fields
} = require("../queries/participation_data/step_3a_create_participation_match_profile_table_v2");

const { generate_date_periods } = require('../../utilities/data_query_criteria/generate_date_periods');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { count } = require('console');

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
                    // console.log(results);

                    resolve(results);
                }
            });
        });
    });
}

async function execute_create_participation_profile_table() {   
    let pool;
    let profile_id_table;
    const db_name = `usat_sales_db`;
    const startTime = performance.now();
    let test = false; // true will run less data for insert

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const table_name = `test_participation_profiles`;
        console.log(db_name);
        
        // STEP #1: DROP TABLE
        console.log('\nDROP & CREATE TABLE ****************');
        runTimer(`query_to_drop_and_create_table`);
        
        const query_to_drop_table = await query_drop_table(table_name);
        await execute_mysql_working_query(pool, db_name, query_to_drop_table);

        // STEP #1: CREATE TABLE
        // const query_to_create_table = await query_create_participation_profiles(table_name);
        console.log(`STEP 1: CREATE TABLE ${table_name}`);
        const query_to_create_table = await query_create_table(table_name);
        await execute_mysql_working_query(pool, db_name, query_to_create_table);

        // console.log(`STEP 2: CREATE TABLE ${profile_id_table}`);
        profile_id_table = 'tmp_distinct_participant_profile_ids';
        const query_to_create_distinct_profile_id_table = `
            CREATE TABLE ${profile_id_table} AS
                SELECT 
                    DISTINCT id_profile_rr AS profile_id
                FROM all_participation_data_with_membership_match
                WHERE 1 = 1
                    AND id_profile_rr IS NOT NULL
                    AND id_profile_rr <> ''
                ORDER BY id_profile_rr
            `
        ;
        // await execute_mysql_working_query(pool, db_name, query_to_create_distinct_profile_id_table); // todo:

        console.log(`STEP 3: CREATE INDEX FOR ${profile_id_table}`);
        const query_to_add_index = `
            ALTER TABLE ${profile_id_table}
                ADD INDEX idx_profile_id (profile_id);
            `
        ;
        // await execute_mysql_working_query(pool, db_name, query_to_add_index); // todo:

        // 2. Retrieve distinct profile IDs from your source table.
        const page_size = 10000; // todo:
        let offset = 0;
        let batch;
        let counter = 0;

        const query_count_of_profile_id = `
            SELECT COUNT(*) AS count_profile_ids FROM tmp_distinct_participant_profile_ids;
        `;

        query_profile_id_count = await execute_mysql_working_query(pool, db_name, query_count_of_profile_id);
        const { count_profile_ids } = query_profile_id_count[0];
        // console.log(count_profile_ids);
        
        console.log(`STEP 4: INSERT DATA INTO ${table_name}`);
        do {
            runTimer(`query_to_drop_and_create_table`);

            const query_profile_ids = `
                SELECT 
                    profile_id
                FROM ${profile_id_table}
                WHERE 1 = 1
                    AND profile_id IS NOT NULL
                    AND profile_id <> ''
                ORDER BY profile_id
                LIMIT ${page_size} OFFSET ${offset}
            `;
            
            batch = await execute_mysql_working_query(pool, db_name, query_profile_ids);
            
            console.log(`Query: ${counter} of ${count_profile_ids / page_size} Batch = ${offset}; Count of Profiles = ${count_profile_ids}`);
            
            if (batch.length > 0) {
                // Process the current batch. For instance, insert the IDs into another table.
                // Build a values string like: "(123), (456), (789)"
                const profile_ids = batch.map(row => `${row.profile_id}`).join(',');
                
                // STEP #2: CREATE & INSERT
                const query_to_create_table = await query_create_participation_profiles(table_name, profile_ids);
                await execute_mysql_working_query(pool, db_name, query_to_create_table); 
            }

            offset += batch.length;
            counter++; // Increment the counter
            stopTimer(`query_to_drop_and_create_table`);

            // Break after first iteration for testing purposes.
            // break;
        } while (batch.length === page_size); // todo:
        // } while (batch.length === page_size && counter < 1); // todo:
            
        stopTimer(`query_to_drop_and_create_table`);
 
        // STEP #3: APPEND INDEXES
        console.log('\nCREATED INDEXES ****************');
        runTimer(`query_to_create_indexes`);

        // const query_to_create_indexes = await query_append_index_fields(table_name);
        await execute_mysql_working_query(pool, db_name, query_to_create_indexes);

        stopTimer(`query_to_create_indexes`);

        // STEP #5a: Log results
        console.log('STEP #1: All queries executed successfully.');

    } catch (error) {
        console.log('STEP #1: All queries NOT executed successfully.');
        console.error('Error:', error);

    } finally {
            
        stopTimer(`query_to_drop_and_create_table`);
        
        // console.log(`DROP ${profile_id_table}`);
        // const query_to_drop_table = await query_drop_table(profile_id_table);
        // await execute_mysql_working_query(pool, db_name, query_to_drop_table);

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

execute_create_participation_profile_table();

module.exports = {
    execute_create_participation_profile_table,
}