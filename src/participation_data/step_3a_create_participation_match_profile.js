const fsp = require('fs').promises; // promses necessary for "fs.readdir"
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { query_drop_table } = require("../queries/create_drop_db_table/queries_drop_db_tables");

const { 
    step_a_create_participation_profiles_table,
    step_b_create_distinct_profile_id_table,
    step_d_participation_base_data,
    step_e_participation_least_recent_member_data,
    step_f_participation_most_recent_member_data,
    step_g_participation_most_recent_race_data,
    step_h_participation_aggregated_metrics,

    step_i_insert_participation_profiles,

    query_append_index_fields
} = require("../queries/participation_data/step_3a_create_participation_match_profile_table");

const { generate_date_periods } = require('../../utilities/data_query_criteria/generate_date_periods');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { table } = require('console');

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

async function execute_process_step(pool, db_name, step, table_name, where, limit, base_table) {
    runTimer(table_name);

    console.log(`\nSTEP 0: CREATE ${table_name} ****************`);
    console.log(`\n****************`);

    // DROP TABLE
    await execute_mysql_working_query(pool, db_name, await query_drop_table(table_name));

    // CREATE TABLE
    const query_to_create_table = await step(table_name, where, limit, base_table);
    // console.log(query_to_create_table);

    await execute_mysql_working_query(pool, db_name, query_to_create_table);
    
    stopTimer(table_name);
    console.log(`\n****************\n`);
}

async function execute_create_participation_profile_table() {   
    let pool;
    const startTime = performance.now();
    let test = false; // true will run less data for insert

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();

        const db_name = `usat_sales_db`;
        console.log(db_name);

        const table_name_final_table = `step_a_participation_profiles`;
        const participation_base_table = 'step_d_participation_base_data';
        const profile_id_table = 'step_b_distinct_profile_id';

        // *************************************** 
        const run_step_a = true; // create participation profile table run_step_0
        const run_step_b = false; // get unique profile ids; 3 mins

        const run_step_c = true; // execute loop to process data
        const run_step_d = true; // create base profile data; 5 mins
        const run_step_e = true; // create least recent membership fields
        const run_step_f = true; // create most recent membership fields
        const run_step_g = true; // create most recent race fields
        const run_step_h = true; // create participation metrics
  
        const run_step_i  = true; // insert participant profile into final table

        // *****************************************

        // STEP #a - CREATE PARTICIPATION PROFILE TABLE
        run_step_a && await execute_process_step(pool, db_name, step_a_create_participation_profiles_table, table_name_final_table );  

        // STEP #b = GET PROFILE IDS & CREATE TABLE
        run_step_b && await execute_process_step(pool, db_name, step_b_create_distinct_profile_id_table, profile_id_table); 

        // *************************
        
        if (run_step_c) {
            // 2. Retrieve distinct profile IDs from your source table.
            const page_size = 30000;
            let offset = 0;
            let batch;
            let counter = 0;

            const query_count_of_profile_id = `SELECT COUNT(*) AS count_profile_ids FROM ${profile_id_table};`;
            
            // console.log(query_count_of_profile_id);

            query_profile_id_count = await execute_mysql_working_query(pool, db_name, query_count_of_profile_id);
            const { count_profile_ids } = query_profile_id_count[0];

            // console.log(count_profile_ids);

            console.log(`STEP C: INSERT DATA INTO ${table_name_final_table}`);
            do {
                runTimer(`query_to_drop_and_create_table`);

                const query_profile_ids = `
                    SELECT 
                        profile_id
                    FROM ${profile_id_table}
                    WHERE 1 = 1
                        -- AND profile_id IS NOT NULL
                        -- AND profile_id <> ''
                    ORDER BY profile_id
                    LIMIT ${page_size} OFFSET ${offset}
                `;
                
                batch = await execute_mysql_working_query(pool, db_name, query_profile_ids);
                
                console.log(`Query: ${counter} of ${count_profile_ids / page_size} Batch = ${offset}; Count of Profiles = ${count_profile_ids}`);
                
                if (batch.length > 0) {
                    // Process the current batch. For instance, insert the IDs into another table.
                    // Build a values string like: "(123), (456), (789)"
                    const profile_ids = batch.map(row => `${row.profile_id}`).join(',');
                    // console.log(profile_ids);
       
                    // STEP #d = CREATE BASE DATA
                    const options = {
                        where: `AND id_profile_rr IN (${profile_ids})`, // AND id_profile_rr = 489329
                        limit: '' // '', LIMIT 5000
                    };
                    // console.log(options.where);
                    run_step_d && await execute_process_step(pool, db_name, step_d_participation_base_data, participation_base_table, options.where, options.limit);
                    
                    // STEP #e = CREATE LEAST RECENT MEMBERSHIP DATA
                    run_step_e && await execute_process_step(pool, db_name, step_e_participation_least_recent_member_data, 'step_e_participation_least_recent_member_data', '', '', participation_base_table); 
                    
                    // STEP #f = CREATE LEAST RECENT MEMBERSHIP DATA
                    run_step_f && await execute_process_step(pool, db_name, step_f_participation_most_recent_member_data, 'step_f_participation_most_recent_member_data', '', '', participation_base_table); 
                    
                    // STEP #g = CREATE MOST RECENT RACE DATA
                    run_step_g && await execute_process_step(pool, db_name, step_g_participation_most_recent_race_data, 'step_g_participation_most_recent_race_data', '', '', participation_base_table);  
                    
                    // STEP #h = CREATE MOST RECENT RACE DATA
                    run_step_h && await execute_process_step(pool, db_name, step_h_participation_aggregated_metrics, 'step_h_participation_aggregated_metrics', '', '', participation_base_table); 

                    // STEP #i = INSERT PARTICIPANT PROFILE INTO FINAL TABLE
                    console.log(`\nSTEP i: CREATE ${table_name_final_table} ****************`);
                    console.log(`\n****************`);
                    run_step_i && await execute_mysql_working_query(pool, db_name, await step_i_insert_participation_profiles(table_name_final_table));
                }

                offset += batch.length;
                counter++; // Increment the counter
                // stopTimer(`query_to_drop_and_create_table`);

                // Break after first iteration for testing purposes.
                // break;
            } while (batch.length === page_size); // todo:
            // } while (batch.length === page_size && counter < 3); // todo:

        }

        // *************************
        // // STEP #3: APPEND INDEXES
        // console.log('\nCREATED INDEXES ****************');
        // runTimer(`query_to_create_indexes`);

        // const query_to_create_indexes = await query_append_index_fields(table_name_final_table);
        // await execute_mysql_working_query(pool, db_name, query_to_create_indexes);

        // stopTimer(`query_to_create_indexes`);

        // STEP #5a: Log results
        console.log('***************** All queries executed successfully.');

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