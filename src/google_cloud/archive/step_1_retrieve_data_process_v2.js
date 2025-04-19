const fs = require('fs');
const path = require('path');
const fastcsv = require('fast-csv');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql = require('mysql2');

const { triggerGarbageCollection } = require('../../utilities/garbage_collection/trigger_garbage_collection');

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { Client } = require('ssh2');
const sshClient = new Client();
const { forwardConfig, dbConfig, sshConfig } = require('../../utilities/config');
const { determineOSPath } = require('../../utilities/determineOSPath');
const { create_directory } = require('../../utilities/createDirectory');

const { query_step_0_participant_data_master_logic } = require('../queries/participation_data/step_0_get_participation_data_master_logic');

const { generate_date_periods } = require('../../utilities/data_query_criteria/generate_date_periods');

const { getCurrentDateTimeForFileNaming } = require('../../utilities/getCurrentDate');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { off } = require('process');

// Function to create a Promise for managing the SSH connection and MySQL queries
async function createSSHConnection() {

    const getSshConfig = await sshConfig();

    return new Promise((resolve, reject) => {
        sshClient.on('ready', () => {
            console.log('\nSSH tunnel established.\n');

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

// STEP #1 - DELETE ARCHIVED FILES
async function deleteArchivedFiles(directory_name_archive) {
    console.log('Deleting files from archive');

    // Create the "archive" directory if it doesn't exist
    const directoryPath = await create_directory(directory_name_archive);

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
async function moveFilesToArchive(directory_name, directory_name_archive) {
    console.log('Moving files to archive');

    const os_path = await determineOSPath();

    try {
        // List all files in the directory
        await create_directory(directory_name);
        const sourcePath = `${os_path}${directory_name}`;
        const files = fs.readdirSync(sourcePath);
        console.log(files);

        // Create the "archive" directory if it doesn't exist
        const destinationPath = await create_directory(directory_name_archive);
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
async function execute_query_get_usat_participation_data_batch(pool, sql, offset, batch_size) {
    const startTime = performance.now();

    try {
        const query = sql;
        // console.log('query =', query);

        // Wrap pool.query in a promise
        const results = await new Promise((resolve, reject) => {
            pool.query(query, (queryError, results) => {

                if (queryError) {
                    console.log('*************** ERROR **************')
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

// STEP #4 EXPORT RESULTS TO CSV FILE
async function export_generator_results_to_csv_fast_csv(results, file_name, batchCounter, directory_name) {
    console.log('STEP #4 EXPORT RESULTS TO CSV FILE', `${batchCounter}_export file_name`);
    const startTime = performance.now(); // Start timing

    if (!results || results.length === 0) {
        console.log('No results to export.');
        return;
    }

    // DEFINE DIRECTORY PATH
    const directoryPath = await create_directory(directory_name);

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

        console.log(`STEP #4 Elapsed Time: ${elapsedTime} sec`);

        console.log(`Results exported to ${filePath}`);

        return;

    } catch (error) {
        console.error(`Error exporting results to csv:`, error);
    }
}

async function processResultsInBatches(results, batchSize, processFunction) {
    for (let start = 0; start < results.length; start += batchSize) {

        let batch = results.slice(start, start + batchSize);

        console.log('start =', start + '; batchSize =', batchSize + '; batch =', batch.length + '; start + batchSize = ', start + batchSize);

        await processFunction(batch);

        // CLEAR MEMORY
        batch = null;
        await triggerGarbageCollection();
    }

    // CLEAR MEMORY
    results = null;
    batchSize = null;
    processFunction = null;

    await triggerGarbageCollection();
}

async function execute_retrieve_data(options) {
    let pool;
    pool = await create_local_db_connection(await local_usat_sales_db_config());

    const startTime = performance.now();

    let directory_name = `usat_google_bigquery_data`;
    let directory_name_archive  = `usat_google_bigquery_data_archive`;
    let results;
    let offset = 0;
    const retrieval_batch_size = 400000; // Retrieve 100,000 records at a time
    const write_batch_size = 400000; // Write 10,000 records at a time

    try {
        // STEP #1: DELETE PRIOR FILES
        await deleteArchivedFiles(directory_name_archive);

        // STEP #2 - MOVE FILES TO ARCHIVE
        await moveFilesToArchive(directory_name, directory_name_archive);

            offset = 0;
            
            do {
                // runTimer(`get_data`);
                const { fileName, query } = options[0];

                console.log('file name: ', fileName);
                console.log('query: ', query);

                const sql = typeof query === 'function' ? await query(retrieval_batch_size, offset) : query;

                console.log(retrieval_batch_size, offset);
                console.log(sql);
                
                // Retrieve data in batches of `${retrieval_batch_size}` records
                results = await execute_query_get_usat_participation_data_batch(
                    pool,
                    sql,
                    offset,
                    retrieval_batch_size
                );

                // console.table(results);
                console.log('GET DATA: Results length = ', results.length + '; offset = ', offset);

                // stopTimer(`get_data`);

                let batchCounter = 0; // Initialize a batch counter

                await processResultsInBatches(results, write_batch_size, async (batch) => {
                    // Increment the batch counter for each batch
                    batchCounter++;

                    // Generate a unique file name for this batch
                    let file_name_date = `${fileName}_${offset}_batch_${batchCounter}`;

                    console.log(`Exporting batch ${batchCounter} to file: ${file_name_date}`);

                    await export_generator_results_to_csv_fast_csv(batch, file_name_date, batchCounter, directory_name);
                });

                offset += retrieval_batch_size;

                // Clear memory if needed
                await triggerGarbageCollection();

            } while (results.length > 0);
        // }

    } catch (error) {
        console.error('Error #1: ', error);
    } finally {
        if (pool) await pool.end();
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec
        console.log(`Elapsed time: ${((endTime - startTime) / 1000).toFixed(2)} sec`);

        // Clear memory
        results = null;
        offset = null;

        await triggerGarbageCollection();

        return elapsedTime;
    }
}

// Run the main function
// execute_retrieve_data();

module.exports = {
    execute_retrieve_data,
}