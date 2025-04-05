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

// STEP III: Append indexes to the final table.
async function append_indexes(pool, db_name, final_table) {
    console.log('STEP III: Appending Indexes to final table');
    runTimer('query_to_create_indexes');

    const index_query = await query_append_index_fields(final_table);
    await execute_mysql_working_query(pool, db_name, index_query);

    stopTimer('query_to_create_indexes');
}

// EXECUTE MYSQL TO CREATE TABLES & WORK WITH TABLES QUERY
async function execute_mysql_working_query(pool, db_name, query) {
    const startTime = performance.now();
    
    runTimer(db_name);

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, (queryError, results) => {
            pool.query({sql: query,}, (queryError, results) => {

                const endTime = performance.now();
                const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

                if (queryError) {
                    console.error('Error executing select query:', queryError);

                    stopTimer(db_name);
                    reject(queryError);
                } else {
                    console.log("\nQuery results - Elapsed Time:", elapsedTime, "sec");
                    
                    stopTimer(db_name);

                    resolve(results);
                }
            });
        });
    });
}

async function execute_process_step(pool, db_name, step, table_name, where, limit, base_table) {
    try {
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
        
    } catch (error) {
        console.log('STEP execute_process_step: All queries NOT executed successfully.');
        console.error('Error:', error);
        
    } finally {
        stopTimer(table_name);
    }
}

// Helper to manage the database connection lifecycle.
async function with_connection(callback) {
    const pool = await create_connection();
    try {
        await callback(pool);
    } catch (error) {
        throw error;
    } finally {
        await pool.end(err => {
        if (err) {
            console.error('Error closing connection pool:', err.message);
        } else {
            console.log('Connection pool closed successfully.');
        }
        });
    }
}
  
// STEP A: Create the participation profiles table.
async function create_participation_profiles_table(pool, db_name, final_table) {
    console.log('STEP A: Creating Participation Profiles Table');
    await execute_process_step(pool, db_name, step_a_create_participation_profiles_table, final_table);
}
  
// STEP B: Create the distinct profile IDs table.
async function create_distinct_profile_id_table(pool, db_name, profile_id_table) {
    console.log('STEP B: Creating Distinct Profile ID Table');
    await execute_process_step(pool, db_name, step_b_create_distinct_profile_id_table, profile_id_table);
}
  
// STEP C: Process batches of profile IDs and run processing steps (D–I).
async function process_batches(pool, db_name, profile_id_table, base_table, final_table) {
    console.log('STEP C: Processing batches for profile IDs');
    const page_size = 1000; // todo:
    let offset = 0;
    let counter = 0;
  
    // Configuration for processing steps inside batch processing.
    const processing_steps = {
      step_d: true, // Create base data.
      step_e: true, // Create least recent membership data.
      step_f: true, // Create most recent membership data.
      step_g: true, // Create most recent race data.
      step_h: true, // Create participation metrics.
      step_i: true  // Insert participant profiles into final table.
    };
  
    // Retrieve total number of profile IDs.
    const count_query = `SELECT COUNT(*) AS count_profile_ids FROM ${profile_id_table};`;
    const count_result = await execute_mysql_working_query(pool, db_name, count_query);
    const { count_profile_ids } = count_result[0];
    console.log(`Total profile IDs: ${count_profile_ids}`);
  
    let batch;
    do {
      const query_profile_ids = `
        SELECT profile_id
        FROM ${profile_id_table}
        ORDER BY profile_id
        LIMIT ${page_size} OFFSET ${offset}
      `;
      batch = await execute_mysql_working_query(pool, db_name, query_profile_ids);
      console.log(`Batch ${counter + 1}: Processing ${batch.length} profiles, offset: ${offset}`);

      console.log(`\nQuery: ${counter} of ${count_profile_ids / page_size} Batch = ${offset}; Count of Profiles = ${count_profile_ids}`);
  
      if (batch.length > 0) {
        // Create a comma-separated list of profile IDs.
        const profile_ids_str = batch.map(row => row.profile_id).join(',');
        const options = {
          where: `AND id_profile_rr IN (${profile_ids_str})`,
          limit: '' // Modify if you need to limit rows.
        };
  
        // Define the steps as an array of objects.
        const steps = [
          {
            step: 'D',
            enabled: processing_steps.step_d,
            log: 'STEP D: Creating Base Data',
            fn: async () => {
              await execute_process_step(pool, db_name, step_d_participation_base_data, base_table, options.where, options.limit);
            }
          },
          {
            step: 'E',
            enabled: processing_steps.step_e,
            log: 'STEP E: Creating Least Recent Membership Data',
            fn: async () => {
              await execute_process_step(pool, db_name, step_e_participation_least_recent_member_data, 'step_e_participation_least_recent_member_data', '', '', base_table);
            }
          },
          {
            step: 'F',
            enabled: processing_steps.step_f,
            log: 'STEP F: Creating Most Recent Membership Data',
            fn: async () => {
              await execute_process_step(pool, db_name, step_f_participation_most_recent_member_data, 'step_f_participation_most_recent_member_data', '', '', base_table);
            }
          },
          {
            step: 'G',
            enabled: processing_steps.step_g,
            log: 'STEP G: Creating Most Recent Race Data',
            fn: async () => {
              await execute_process_step(pool, db_name, step_g_participation_most_recent_race_data, 'step_g_participation_most_recent_race_data', '', '', base_table);
            }
          },
          {
            step: 'H',
            enabled: processing_steps.step_h,
            log: 'STEP H: Creating Participation Metrics',
            fn: async () => {
              await execute_process_step(pool, db_name, step_h_participation_aggregated_metrics, 'step_h_participation_aggregated_metrics', '', '', base_table);
            }
          },
          {
            step: 'I',
            enabled: processing_steps.step_i,
            log: `STEP I: Inserting Participant Profiles into final table ${final_table}`,
            fn: async () => {
              const insert_query = await step_i_insert_participation_profiles(final_table);
              await execute_mysql_working_query(pool, db_name, insert_query);
            }
          }
        ];
  
        // Loop over each processing step and execute if enabled.
        for (const current_step of steps) {
          if (current_step.enabled) {
            console.log(current_step.log);
            await current_step.fn();
          }
        }
      }
  
      offset += batch.length;
      counter++;
      // For testing, this loop stops after one batch; adjust the condition as needed.
    } while (batch.length === page_size && counter < 1);
    // } while (batch.length === page_size); // todo:
}

// Main function to execute the overall process.
async function execute_create_participation_profile_table() {
    const start_time = performance.now();
    const db_name = 'usat_sales_db';

    // Table names configuration.
    const final_table = 'step_a_participation_profiles';
    const base_table = 'step_d_participation_base_data';
    const profile_id_table = 'step_b_distinct_profile_id';

    // Configuration for which steps to run.
    const steps_to_run = {
        create_profile_table: true,
        create_distinct_ids: true,
        process_batches: true,
        append_indexes: true
    };

    try {
        await with_connection(async (pool) => {
        console.log(`Using database: ${db_name}`);

        if (steps_to_run.create_profile_table) {
            await create_participation_profiles_table(pool, db_name, final_table);
        }
        
        if (steps_to_run.create_distinct_ids) {
            await create_distinct_profile_id_table(pool, db_name, profile_id_table);
        }
        
        if (steps_to_run.process_batches) {
            await process_batches(pool, db_name, profile_id_table, base_table, final_table);
        }
        
        if (steps_to_run.append_indexes) {
            await append_indexes(pool, db_name, final_table);
        }
        
        console.log('All queries executed successfully.');
        });
    } catch (error) {
        console.error('Error executing queries:', error);
    } finally {
        const elapsed_time = ((performance.now() - start_time) / 1000).toFixed(2);
        console.log(`Elapsed Time: ${elapsed_time} sec`);
        return elapsed_time;
    }
}
  
// execute_create_participation_profile_table();

module.exports = {
    execute_create_participation_profile_table,
}

