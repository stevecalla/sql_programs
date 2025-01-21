const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2');
const fastcsv = require('fast-csv');

const {} = require('../../../utilities/garbage_collection/trigger_garbage_collection');

const { Client } = require('ssh2');
const sshClient = new Client();
const { forwardConfig , dbConfig, sshConfig } = require('../../../utilities/config');
const { determineOSPath } = require('../../../utilities/determineOSPath');
const { create_directory } = require('../../../utilities/createDirectory');

const { local_usat_sales_db_config } = require('../../../utilities/config');
const { create_local_db_connection } = require('../../../utilities/connectionLocalDB');

const { query_create_all_membership_sales_table } = require('../../queries/create_drop_db_table/query_create_sales_table');

const { query_get_sales_data } = require('../../queries/sales_data/0_get_sales_data_master_logic');

const { query_one_day_sales_units_logic } = require('../../queries/sales_data/5b_one_day_sales_units_logic');
const { query_annual_sales_units_logic } = require('../../queries/sales_data/5c_annual_sales_units_logic');
const { query_coaches_sales_units_logic } = require('../../queries/sales_data/5d_coaches_sales_units_logic');

const { getCurrentDateTimeForFileNaming } = require('../../../utilities/getCurrentDate');
const { runTimer, stopTimer } = require('../../../utilities/timer');

// Function to create a Promise for managing the SSH connection and MySQL queries
async function createSSHConnection() {

    const getSshConfig = await sshConfig();

    return new Promise((resolve, reject) => {
        sshClient.on('ready', () => {
            console.log(`\nSSH tunnel established.\n`);

            const { srcHost, srcPort, dstHost, dstPort } = forwardConfig;
            sshClient.forwardOut(
                srcHost,
                srcPort,
                dstHost,
                dstPort,
                (err, stream) => {
                    if (err) reject(err);

                    const updatedDbServer = {
                        ...dbConfig,
                        stream,
                        ssl: {
                            rejectUnauthorized: false,
                        },
                    };

                    const pool = mysql.createPool(updatedDbServer);

                    resolve(pool);
                }
            );
        }).connect(getSshConfig);
    });
}

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

// STEP #1 - DELETE ARCHIVED FILES
async function deleteArchivedFiles() {
    console.log('Deleting files from archive');

    // Create the "archive" directory if it doesn't exist
    const directoryName  = `usat_sales_data_archive`;
    const directoryPath = await create_directory(directoryName);

    // List all files in the directory
    const files = fs.readdirSync(directoryPath);
    console.log(files);

    const logPath = await determineOSPath();

    // Iterate through each file
    files?.forEach((file) => {
        if (file.endsWith('.csv')) {
            // Construct the full file path
            const filePath = `${directoryPath}/${file}`;
            console.log(filePath);

            try {
                // Delete the file
                fs.unlinkSync(filePath);
                console.log(`File ${filePath} deleted successfully.`);
            } catch (deleteErr) {
                console.error(`Error deleting file ${filePath}:`, deleteErr);
            }
        }
    });
}

// STEP #2 - MOVE FILES TO ARCHIVE
async function moveFilesToArchive() {
    console.log('Moving files to archive');

    const os_path = await determineOSPath();

    try {
        // List all files in the directory
        const sourcePath = `${os_path}usat_sales_data`;
        const files = fs.readdirSync(sourcePath);
        console.log(files);

        // Create the "archive" directory if it doesn't exist
        const directoryName  = `usat_sales_data_archive`;
        const destinationPath = await create_directory(directoryName);
        console.log(destinationPath);

        // Iterate through each file
        for (const file of files) {
            if (file.endsWith('.csv')) {
                // Construct the full file paths
                const sourceFilePath = `${sourcePath}/${file}`;
                const destinationFilePath = `${destinationPath}/${file}`;

                try {
                    // Move the file to the "archive" directory
                    fs.renameSync(sourceFilePath, destinationFilePath);
                    console.log(`Archived ${file}`);
                } catch (archiveErr) {
                    console.error(`Error moving file ${file} to archive:`, archiveErr);
                }
            }
        }

    } catch (readErr) {
        console.error('Error reading files:', readErr);
    }
}

// STEP #3: GET / QUERY USER DATA & RETURN RESULTS
async function execute_query_get_usat_sales_data(pool, membership_category_logic, i, year, start_date, end_date, membership_period_ends) {
    const startTime = performance.now(); // Start timing
    const logPath = await determineOSPath();

    try {
        // Wrap pool.query in a promise
        const results = await new Promise((resolve, reject) => {
            // const query = query_one_day_sales;
            const query = query_get_sales_data(membership_category_logic, year, start_date, end_date, membership_period_ends);
            // console.log('query =', query);

            pool.query(query, (queryError, results) => {
                if (queryError) {
                    reject(queryError);
                } else {
                    resolve(results);
                }
            });
        });

        // Calculate elapsed time
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); // Convert ms to sec

        // Log results and elapsed time
        // console.log(`\n\nQuery results: `);
        // console.table(results);
        console.log(`\nQuery results length: ${results.length}, Elapsed Time: ${elapsedTime} sec`);

        return results; // Return results if needed

    } catch (error) {
        // Handle errors
        console.error('Error executing select query:', error);
        throw error; // Rethrow error if needed
    } finally {
    }
}

// ************
async function execute_query(pool, query, params) {
    const startTime = performance.now();

    try {
        // Wrap pool.query in a promise
        const results = await new Promise((resolve, reject) => {

            pool.query(query, params, (queryError, results) => {
                if (queryError) {
                    reject(queryError);
                } else {
                    resolve(results);
                }
            });
        });

        // Calculate elapsed time
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); // Convert ms to sec

        // Log results and elapsed time
        // console.log(`\n\nQuery results: `);
        // console.table(results);
        console.log(`\nQuery results length: ${results.length}, Elapsed Time: ${elapsedTime} sec`);

        return results; // Return results if needed

    } catch (error) {
        // Handle errors
        console.error('Error executing select query:', error);
        throw error; // Rethrow error if needed
    } finally {
    }
}
// ************

// Main function to handle SSH connection and execute queries
// CREATE TEMP TABLE THEN OFFSET / BATCH TO REDUCE MEMORY USAGE
async function execute_get_sales_data_batch() {
    let pool;
    const startTime = performance.now();

    const membership_category_logic = [
        {
            query: query_annual_sales_units_logic,
            file_name: 'annual_sales_units',
        },
    ];

    const date_periods = [
        {
            year: 2010,
            membership_period_ends: '2008-01-01',
            start_date: '2010-01-01 00:00:00',
            end_date: '2010-06-30 23:59:59',
        },
    ];

    try {
        pool = await createSSHConnection();

        for (let i = 0; i < date_periods.length; i++) {
            for (let j = 0; j < membership_category_logic.length; j++) {

                const { query, file_name } = membership_category_logic[j];
                const year = date_periods[i].year;
                const start_date = date_periods[i].start_date;
                const end_date = date_periods[i].end_date;
                const membership_period_ends = date_periods[i].membership_period_ends;

                // Create temporary table
                await execute_query(
                    pool,
                    query_get_sales_data_create_temp(query, year, start_date, end_date, membership_period_ends),
                    []
                );

                // Fetch and process results in chunks
                let offset = 0;
                const batch_size = 1000;
                let results;

                do {
                    results = await execute_query_get_usat_sales_data(
                        pool,
                        query_get_sales_data_paginated(offset, batch_size)
                    );

                    offset += batch_size;

                    const dateOnly = start_date.split(' ')[0];
                    const file_name_date = `${file_name}_${dateOnly}`;

                    await processResultsInBatches(results, 1000, async (batch) => {
                        await export_generator_results_to_csv_fast_csv(batch, file_name_date, j);
                    });

                    await triggerGarbageCollection();
                    
                } while (results.length > 0);

                // Drop temporary table
                await execute_query(pool, `DROP TEMPORARY TABLE temp_append_all_fields;`, []);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (pool) await pool.end();
        const endTime = performance.now();
        console.log(`Elapsed time: ${((endTime - startTime) / 1000).toFixed(2)} sec`);
    }
}

// START FIX *********************************************
async function execute_get_sales_data() {
    let sourcePool, destinationPool;
    const startTime = performance.now();

    const membership_category_logic = [
        {
            query: query_annual_sales_units_logic,
            file_name: 'annual_sales_units',
        },
    ];

    const date_periods = [
        {
            year: 2010,
            membership_period_ends: '2008-01-01',
            start_date: '2010-02-01 00:00:00',
            end_date: '2010-03-01 23:59:59',
        },
    ];

    try {
        // Create source and destination pool connections
        sourcePool = await await createSSHConnection();
        destinationPool = await create_connection();

        console.log('source pool =', sourcePool && true);
        console.log('destination pool =', destinationPool && true);

        for (let i = 0; i < date_periods.length; i++) {
            for (let j = 0; j < membership_category_logic.length; j++) {
                const { query, file_name } = membership_category_logic[j];
                const year = date_periods[i].year;
                const start_date = date_periods[i].start_date;
                const end_date = date_periods[i].end_date;
                const membership_period_ends = date_periods[i].membership_period_ends;

                // Create temporary table in the destination
                // runTimer(`create_temp_table`);
                console.log(`\nCREATE TEMP TABLE`);   

                await execute_query(
                    destinationPool,
                    query_get_sales_data_create_temp(),
                    []
                );
                // stopTimer(`create_temp_table`);  

                // // Fetch and process results in chunks from source and write to destination
                let offset = 0;
                const batch_size = 1000;
                let results;

                do {
                    // runTimer(`insert_data_into_temp_table`);
                    console.log(`\nFETCH DATA FROM SOURCE DATABASE`);

                    // Fetch data from the source database
                    results = await execute_query(
                        sourcePool,
                        query_get_sales_data(query, year, start_date, end_date, membership_period_ends, offset, batch_size),
                        []
                    );

                    // console.table(results[1]);
                    console.log(results.length);

                    if (results.length > 0) {
                        // Insert the results into the destination temporary table
                        const insertQuery = `
                            -- Insert data into the temporary table
                            INSERT INTO temp_append_all_fields (member_number_members_sa, id_membership_periods_sa, real_membership_types_sa, 
                                                                new_member_category_6_sa, actual_membership_fee_6_sa, actual_membership_fee_6_rule_sa, 
                                                                source_2_sa, is_koz_acception_sa, id_events, event_type_id_events, name_events, 
                                                                created_at_events, created_at_month_events, created_at_quarter_events, 
                                                                created_at_year_events, starts_events, starts_month_events, starts_quarter_events, 
                                                                starts_year_events, ends_events, ends_month_events, ends_quarter_events, ends_year_events, 
                                                                status_events, race_director_id_events, last_season_event_id, city_events, state_events, 
                                                                country_name_events, country_events, address_ma, application_type_ma, approval_status_ma, 
                                                                city_ma, confirmation_code_ma, country_ma, created_at_ma, date_of_birth_ma, deleted_at_ma, 
                                                                distance_type_id_ma, email_ma, event_id_ma, extension_type_ma, first_name_ma, gender_ma, 
                                                                id_ma, last_name_ma, membership_type_id_ma, middle_name_ma, origin_flag_ma, outside_payment_ma, 
                                                                paper_waivers_signed_ma, payment_id_ma, payment_type_ma, phone_ma, plan_id_ma, profile_id_ma, 
                                                                race_id_ma, race_type_id_ma, referral_code_ma, state_ma, status_ma, updated_at_ma, uuid_ma, 
                                                                zip_ma, club_affiliations_ma, denial_reason_ma, payment_explanation_ma, upgrade_code_ma, 
                                                                created_at_mp, deleted_at_mp, ends_mp, member_id_mp, membership_type_id_mp, origin_flag_mp, 
                                                                origin_status_mp, origin_mp, period_status_mp, progress_status_mp, purchased_on_mp, 
                                                                purchased_on_date_mp, purchased_on_year_mp, purchased_on_quarter_mp, purchased_on_month_mp, 
                                                                purchased_on_adjusted_mp, purchased_on_date_adjusted_mp, purchased_on_year_adjusted_mp, 
                                                                purchased_on_quarter_adjusted_mp, purchased_on_month_adjusted_mp, remote_id_mp, 
                                                                renewed_membership_period_id, starts_mp, state_mp, status_mp, terminated_on_mp, updated_at_mp, 
                                                                upgraded_from_id_mp, upgraded_to_id_mp, waiver_status_mp, active_members, created_at_members, 
                                                                deleted_at_members, id_members, longevity_status_members, member_number_members, 
                                                                memberable_id_members, memberable_type_members, period_status_members, referrer_code_members, 
                                                                updated_at_members, created_at_mt, deleted_at_mt, extension_type_mt, id_mt, 
                                                                membership_card_template_id_mt, membership_licenses_type_id_mt, name_mt, priority_mt, 
                                                                published_mt, require_admin_approval_mt, tag_id_mt, updated_at_mt, short_description_mt, 
                                                                id_profiles, created_at_profiles, date_of_birth_profiles, date_of_birth_registration_audit, 
                                                                created_at_users, order_id_op, cart_label_op, amount_per_op, discount_op, amount_refunded_op)
                            VALUES ?   
                            ON DUPLICATE KEY UPDATE;
                        `;
                            
                        const values = results.map(row => [
                            row.member_number_members_sa,
                            row.id_membership_periods_sa,
                            row.real_membership_types_sa,
                            row.new_member_category_6_sa,
                            row.actual_membership_fee_6_sa,
                            row.actual_membership_fee_6_rule_sa,
                            row.source_2_sa,
                            row.is_koz_acception_sa,
                            row.id_events,
                            row.event_type_id_events,
                            row.name_events,
                            row.created_at_events,
                            row.created_at_month_events,
                            row.created_at_quarter_events,
                            row.created_at_year_events,
                            row.starts_events,
                            row.starts_month_events,
                            row.starts_quarter_events,
                            row.starts_year_events,
                            row.ends_events,
                            row.ends_month_events,
                            row.ends_quarter_events,
                            row.ends_year_events,
                            row.status_events,
                            row.race_director_id_events,
                            row.last_season_event_id,
                            row.city_events,
                            row.state_events,
                            row.country_name_events,
                            row.country_events,
                            row.address_ma,
                            row.application_type_ma,
                            row.approval_status_ma,
                            row.city_ma,
                            row.confirmation_code_ma,
                            row.country_ma,
                            row.created_at_ma,
                            row.date_of_birth_ma,
                            row.deleted_at_ma,
                            row.distance_type_id_ma,
                            row.email_ma,
                            row.event_id_ma,
                            row.extension_type_ma,
                            row.first_name_ma,
                            row.gender_ma,
                            row.id_ma,
                            row.last_name_ma,
                            row.membership_type_id_ma,
                            row.middle_name_ma,
                            row.origin_flag_ma,
                            row.outside_payment_ma,
                            row.paper_waivers_signed_ma,
                            row.payment_id_ma,
                            row.payment_type_ma,
                            row.phone_ma,
                            row.plan_id_ma,
                            row.profile_id_ma,
                            row.race_id_ma,
                            row.race_type_id_ma,
                            row.referral_code_ma,
                            row.state_ma,
                            row.status_ma,
                            row.updated_at_ma,
                            row.uuid_ma,
                            row.zip_ma,
                            row.club_affiliations_ma,
                            row.denial_reason_ma,
                            row.payment_explanation_ma,
                            row.upgrade_code_ma,
                            row.created_at_mp,
                            row.deleted_at_mp,
                            row.ends_mp,
                            row.member_id_mp,
                            row.membership_type_id_mp,
                            row.origin_flag_mp,
                            row.origin_status_mp,
                            row.origin_mp,
                            row.period_status_mp,
                            row.progress_status_mp,
                            row.purchased_on_mp,
                            row.purchased_on_date_mp,
                            row.purchased_on_year_mp,
                            row.purchased_on_quarter_mp,
                            row.purchased_on_month_mp,
                            row.purchased_on_adjusted_mp,
                            row.purchased_on_date_adjusted_mp,
                            row.purchased_on_year_adjusted_mp,
                            row.purchased_on_quarter_adjusted_mp,
                            row.purchased_on_month_adjusted_mp,
                            row.remote_id_mp,
                            row.renewed_membership_period_id,
                            row.starts_mp,
                            row.state_mp,
                            row.status_mp,
                            row.terminated_on_mp,
                            row.updated_at_mp,
                            row.upgraded_from_id_mp,
                            row.upgraded_to_id_mp,
                            row.waiver_status_mp,
                            row.active_members,
                            row.created_at_members,
                            row.deleted_at_members,
                            row.id_members,
                            row.longevity_status_members,
                            row.member_number_members,
                            row.memberable_id_members,
                            row.memberable_type_members,
                            row.period_status_members,
                            row.referrer_code_members,
                            row.updated_at_members,
                            row.created_at_mt,
                            row.deleted_at_mt,
                            row.extension_type_mt,
                            row.id_mt,
                            row.membership_card_template_id_mt,
                            row.membership_licenses_type_id_mt,
                            row.name_mt,
                            row.priority_mt,
                            row.published_mt,
                            row.require_admin_approval_mt,
                            row.tag_id_mt,
                            row.updated_at_mt,
                            row.short_description_mt,
                            row.id_profiles,
                            row.created_at_profiles,
                            row.date_of_birth_profiles,
                            row.date_of_birth_registration_audit,
                            row.created_at_users,
                            row.order_id_op,
                            row.cart_label_op,
                            row.amount_per_op,
                            row.discount_op,
                            row.amount_refunded_op,
                        ]);

                        await execute_query(destinationPool, insertQuery, [values]);

                        // Increment offset for the next batch
                        offset += batch_size;
                    }
                    // stopTimer(`insert_data_into_temp_table\n`);e
                } while (results.length > 0);

                const dateOnly = start_date.split(' ')[0];
                const file_name_date = `${file_name}_${dateOnly}`;

                // Export temporary table data to a CSV
                const exportQuery = `
                    SELECT *
                    FROM temp_append_all_fields;
                `;

                console.table('export query = ', exportQuery[1]);

                const exportResults = await execute_query(destinationPool, exportQuery, []);

                await processResultsInBatches(exportResults, 1000, async (batch) => {
                    await export_generator_results_to_csv_fast_csv(batch, file_name_date, j);
                });

                // Drop temporary table
                await execute_query(destinationPool, `DROP TEMPORARY TABLE temp_append_all_fields;`);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        // Close both pool connections
        if (sourcePool) await sourcePool.end();
        if (destinationPool) await destinationPool.end();
        const endTime = performance.now();
        console.log(`Elapsed time: ${((endTime - startTime) / 1000).toFixed(2)} sec`);
    }
}

// Helper for creating the temporary table in the destination
function query_get_sales_data_create_temp() {
    return `
        CREATE TEMPORARY TABLE temp_append_all_fields (
            ${query_create_all_membership_sales_table}
        );    

        SHOW COLUMNS FROM temp_append_all_fields;
        SELECT * FROM temp_append_all_fields;
    `;
}

// STEP #4 EXPORT RESULTS TO CSV FILE
async function export_generator_results_to_csv_fast_csv(results, file_name, i) {
    console.log('STEP #4 EXPORT RESULTS TO CSV FILE', `${i}_export file_name`);
    const startTime = performance.now();

    // runTimer(`export results_to_csv`);
    console.log(`\nEXPORT RESULTS TO CSV`);
    
    if (!results || results.length === 0) {
        console.log('No results to export.');
        return;
    }

    // DEFINE DIRECTORY PATH
    const directoryName = `usat_sales_data`;
    const directoryPath = await create_directory(directoryName);

    try {
        const header = Object.keys(results[0]);

        // Create file path with timestamp
        const created_at_formatted = getCurrentDateTimeForFileNaming();
        const filePath = path.join(directoryPath, `results_${created_at_formatted}_${file_name}.csv`);

        // Create a writable stream to the file
        const writeStream = fs.createWriteStream(filePath);

        // Create a fast-csv stream
        const csvStream = fastcsv.format({ headers: true });

        // Pipe the csv stream to the writable stream
        csvStream.pipe(writeStream);

        // Use a generator function to yield rows one at a time
        function* rowGenerator(rows) {
            for (const row of rows) {
                yield header.reduce((acc, key) => ({
                    ...acc,
                    [key]: row[key] !== null ? row[key] : 'NULL'
                }), {});
            }
        }

        for (const row of rowGenerator(results)) {
            csvStream.write(row);
        }

        // End the CSV stream
        csvStream.end();

        // Await stream finish
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        // Calculate elapsed time
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); // Convert ms to sec

        console.log(`STEP #4 EXPORT RESULTS TO CSV FILE: Elapsed Time: ${elapsedTime} sec`);

        console.log(`Results exported to ${filePath}`);

        // stopTimer(`export results_to_csv`);
        return;

    } catch (error) {
        console.error(`Error exporting results to csv:`, error);
    }
}

async function processResultsInBatches(results, batchSize, processFunction) {
    for (let start = 0; start < results.length; start += batchSize) {
        const batch = results.slice(start, start + batchSize);
        await processFunction(batch);
    }

    // CLEAR MEMORY
    results = null;
    batchSize = null;
    processFunction = null;
}

// Helper for paginated query
function query_get_sales_data_paginated(offset, batch_size) {
    return `
        SELECT *
        FROM temp_append_all_fields
        ORDER BY id_membership_periods_sa
        LIMIT ${batch_size} OFFSET ${offset};
    `;
}

// Run the main function
// execute_get_sales_data();

module.exports = {
    execute_get_sales_data,
}