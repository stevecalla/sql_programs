const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const mysql = require('mysql2');
const fastcsv = require('fast-csv');

const { Client } = require('ssh2');
const sshClient = new Client();
const { forwardConfig, dbConfig, sshConfig } = require('../../utilities/config');
const { determineOSPath } = require('../../utilities/determineOSPath');
const { create_directory } = require('../../utilities/createDirectory');

const { query_get_sales_data } = require('../queries/sales_data/0_get_sales_data_master_logic');

const { generate_monthly_date_periods } = require('../../utilities/data_query_criteria/generate_date_periods_by_month');
const { generate_membership_category_logic } = require('../../utilities/data_query_criteria/generate_membership_category_logic');

const { getCurrentDateTimeForFileNaming } = require('../../utilities/getCurrentDate');
const { runTimer, stopTimer } = require('../../utilities/timer');

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
async function execute_query_get_usat_sales_data_batch(pool, membership_category_logic, year, start_date, end_date, membership_period_ends, offset, batch_size) {
    const startTime = performance.now();

    try {
        // Wrap pool.query in a promise
        const results = await new Promise((resolve, reject) => {
            // const query = query_one_day_sales;
            const query = query_get_sales_data(membership_category_logic, year, start_date, end_date, membership_period_ends, offset, batch_size);
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

// STEP #4 EXPORT RESULTS TO CSV FILE
async function export_generator_results_to_csv_fast_csv(results, file_name, i) {
    console.log('STEP #4 EXPORT RESULTS TO CSV FILE', `${i}_export file_name`);
    const startTime = performance.now(); // Start timing

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

        console.log(`STEP #4 Elapsed Time: ${elapsedTime} sec`);

        console.log(`Results exported to ${filePath}`);

        return;

    } catch (error) {
        console.error(`Error exporting results to csv:`, error);
    }
}

async function processResultsInBatches(results, batchSize, processFunction) {
    for (let start = 0; start < results.length; start += batchSize) {

        const batch = results.slice(start, start + batchSize);

        console.log('start =', start + '; batchSize =', batchSize + '; batch =', batch.length + '; start + batchSize = ', start + batchSize);

        await processFunction(batch);
    }

    // CLEAR MEMORY
    results = null;
    batchSize = null;
    processFunction = null;
    
    if (global.gc) global.gc();
}

// Main function to handle SSH connection and execute queries
// OFFSET & BATCH = USES OFFSET / BATCH TO PROCESS SMALLER QUERY RESULTS & WRITE TO CSV
// async function execute_get_sales_data_works() {
//     let pool;
//     const startTime = performance.now();
//     console.log('Before GC FUNCTION START:', process.memoryUsage());

//     let results;
//     let offset = 0;
//     const retrieval_batch_size = 30000; // Retrieve 10,000 records at a time
//     const write_batch_size = 1000; // Write 1,000 records at a time
//     const start_year = 2010; // Default = 2010

//     let membership_category_logic = generate_membership_category_logic;
//     let date_periods = await generate_monthly_date_periods(start_year); // Starts in 2025

//     try {
//         // STEP #0: ENSURE FILE WAS UPDATED RECENTLY

//         // STEP #1: DELETE PRIOR FILES
//         await deleteArchivedFiles();

//         // STEP #2 - MOVE FILES TO ARCHIVE
//         await moveFilesToArchive();

//         pool = await createSSHConnection();

//         for (let i = 0; i < date_periods.length; i++) {
//             for (let j = 0; j < membership_category_logic.length; j++) {
//                 offset = 0; // Reset offset

//                 const { query, file_name } = membership_category_logic[j];
//                 const year = date_periods[i].year;
//                 const start_date = date_periods[i].start_date;
//                 const start_date_time = date_periods[i].start_date_time;
//                 const end_date_time = date_periods[i].end_date_time;
//                 const membership_period_ends = date_periods[i].membership_period_ends;

//                 console.log('start_date_time = ', start_date_time + '; end_date_time = ', end_date_time);
//                 console.log('membership file name = ', file_name);

//                 do {
//                     runTimer(`${i}_get_data`);
                
//                     // Retrieve data in batches of 10,000 records
//                     results = await execute_query_get_usat_sales_data_batch(
//                         pool,
//                         query,
//                         year,
//                         start_date_time,
//                         end_date_time,
//                         membership_period_ends,
//                         offset,
//                         retrieval_batch_size
//                     );

//                     console.log('GET DATA: Results length = ', results.length + '; offset = ', offset);

//                     offset += retrieval_batch_size;

//                     stopTimer(`${i}_get_data`);

//                     let batchCounter = 0; // Initialize a batch counter

//                     await processResultsInBatches(results, write_batch_size, async (batch) => {
//                         // Increment the batch counter for each batch
//                         batchCounter++;

//                         // Generate a unique file name for this batch
//                         let file_name_date = `${file_name}_${start_date}_batch_${batchCounter}`;

//                         console.log(`Exporting batch ${batchCounter} to file: ${file_name_date}`);

//                         await export_generator_results_to_csv_fast_csv(batch, file_name_date, j);
//                     });

//                     // Clear memory if needed
//                     if (global.gc) global.gc();

//                 } while (results.length > 0);
//             }
//         }
//     } catch (error) {
//         console.error('Error:', error);
//     } finally {
//         if (pool) await pool.end();
//         const endTime = performance.now();
//         console.log(`Elapsed time: ${((endTime - startTime) / 1000).toFixed(2)} sec`);

//         // Clear memory
//         results = null;
//         membership_category_logic = null;
//         date_periods = null;

//         if (global.gc) global.gc();
//     }
// }

const tempDir = path.join(__dirname, 'temp'); // Directory for temporary files
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

const dateIndexFilePath = path.join(tempDir, 'date_periods_indices.txt'); // File to track processed indices
const dateIndexLockFilePath = path.join(tempDir, 'date_periods_index_lock.txt'); // Lock file to ensure single initialization
const moveDeleteLockPath = path.join(tempDir, 'move_delete_lock.txt'); // Lock file to ensure single initialization

// Function to initialize the index file (Only once)
function initializeIndexFile() {
    if (!fs.existsSync(dateIndexLockFilePath)) {
        try {
            // Acquire a lock by creating the lock file
            fs.writeFileSync(dateIndexLockFilePath, 'lock', { flag: 'wx' });

            // Initialize the index file (create or clear it)
            if (!fs.existsSync(dateIndexFilePath)) {
                fs.writeFileSync(dateIndexFilePath, '', { flag: 'w' });
                console.log('Index file created and initialized.');
            } else {
                console.log('Index file already exists.');
            }
        } catch (err) {
            console.error('Error initializing index file:', err);
        } finally {
            // Release the lock
            // if (fs.existsSync(dateIndexLockFilePath)) {
            //     fs.unlinkSync(dateIndexLockFilePath);
            // }
        }
    } else {
        console.log('Another process is initializing the index file. Skipping...');
    }
}

// Function to check if an index is already processed (Sync)
function isIndexProcessedSync(dateIndexFilePath, index) {
    try {
        const data = fs.readFileSync(dateIndexFilePath, 'utf-8');
        const processedIndices = data.split('\n').filter((line) => line.trim() !== '').map(Number);
        return processedIndices.includes(index);
    } catch (err) {
        console.error('Error reading index file:', err);
        return false;
    }
}

// Function to mark an index as processed (Sync)
function markIndexAsProcessedSync(dateIndexFilePath, index) {
    try {
        fs.appendFileSync(dateIndexFilePath, `${index}\n`, { flag: 'a' }); // Append index to the file
        console.log(`Index ${index} marked as processed.`);
    } catch (err) {
        console.error(`Error marking index ${index} as processed:`, err);
    }
}

async function execute_get_sales_data() {
    let pool;
    const startTime = performance.now();
    // console.log('Befor   e GC FUNCTION START:', process.memoryUsage());

    let results;
    let offset = 0;
    const retrieval_batch_size = 30000; // Retrieve 30,000 records at a time
    const write_batch_size = 1000; // Write 1,000 records at a time
    const start_year = 2010; // Default = 2025

    let membership_category_logic = generate_membership_category_logic;
    let date_periods = await generate_monthly_date_periods(start_year); // Starts in 2025

    // Initialize the index file (only once, even in parallel processes)
    initializeIndexFile();

    try {
        // Ensure delete and move operations are only executed once
        if (!fs.existsSync(moveDeleteLockPath)) {
            console.log("Executing delete and move files operations...");

            // Create the lock file to indicate operations are in progress
            fs.writeFileSync(moveDeleteLockPath, 'lock', { flag: 'wx' });

            // Execute once-only functions
            await deleteArchivedFiles();
            await moveFilesToArchive();

            // Update the lock file to indicate operations are complete
            fs.writeFileSync(moveDeleteLockPath, 'done');
        } else {
            console.log("Delete and move operations already completed or in progress.");
        }

        pool = await createSSHConnection();

        for (let i = 0; i < date_periods.length; i++) {
            const isProcessed = isIndexProcessedSync(dateIndexFilePath, i);
            console.log('is processed ', isProcessed);

            if (isProcessed) {
                console.log(`Skipping already processed index ${i}`);
                continue; // Skip already processed indices
            }

            // Mark the current index as processed synchronously
            markIndexAsProcessedSync(dateIndexFilePath, i);
            console.log('mark index');

            const date_period = date_periods[i];

            console.log('date period =', date_period);

            for (let j = 0; j < membership_category_logic.length; j++) {
                offset = 0;

                const { query, file_name } = membership_category_logic[j];
                const year = date_period.year;
                const start_date = date_period.start_date;
                const start_date_time = date_period.start_date_time;
                const end_date_time = date_period.end_date_time;
                const membership_period_ends = date_period.membership_period_ends;

                console.log(`Processing date period index ${i}:`, start_date_time, '-', end_date_time);

                do {
                    runTimer(`${i}_get_data`);

                    // Retrieve data in batches of 10,000 records
                    results = await execute_query_get_usat_sales_data_batch(
                        pool,
                        query,
                        year,
                        start_date_time,
                        end_date_time,
                        membership_period_ends,
                        offset,
                        retrieval_batch_size
                    );

                    console.log('GET DATA: Results length = ', results.length + '; offset = ', offset);

                    offset += retrieval_batch_size;

                    stopTimer(`${i}_get_data`);

                    let batchCounter = 0; // Initialize a batch counter

                    await processResultsInBatches(results, write_batch_size, async (batch) => {
                        // Increment the batch counter for each batch
                        batchCounter++;

                        // Generate a unique file name for this batch
                        let file_name_date = `${file_name}_${start_date}_batch_${batchCounter}`;

                        console.log(`Exporting batch ${batchCounter} to file: ${file_name_date}`);

                        await export_generator_results_to_csv_fast_csv(batch, file_name_date, j);
                    });

                    // Clear memory if needed
                    if (global.gc) global.gc();
                    
                } while (results.length > 0);
            }
        }

    } catch (error) {
        console.error('Error #1: ', error);
    } finally {
        if (pool) await pool.end();
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec
        console.log(`Elapsed time: ${((endTime - startTime) / 1000).toFixed(2)} sec`);

        // Clear the lock file at the end
        if (fs.existsSync(dateIndexLockFilePath)) {
            fs.unlinkSync(dateIndexLockFilePath);
        }

        if (fs.existsSync(moveDeleteLockPath)) {
            fs.unlinkSync(moveDeleteLockPath);
        }

        if (fs.existsSync(dateIndexFilePath)) {
            fs.unlinkSync(dateIndexFilePath);
        }

        // Clear memory
        results = null;
        offset = null;
        membership_category_logic = null;
        date_periods = null;

        if (global.gc) global.gc();

        return elapsedTime;
    }
}

// Run the main function
// execute_get_sales_data();

module.exports = {
    execute_get_sales_data,
}