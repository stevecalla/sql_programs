const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { triggerGarbageCollection } = require('../../utilities/garbage_collection/trigger_garbage_collection');

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');
const { streamQueryToCsvAndTrackLastId } = require('../../utilities/streamQueryToCsvAndTrackLastId');

const { determineOSPath } = require('../../utilities/determineOSPath');
const { create_directory } = require('../../utilities/createDirectory');

const { getCurrentDateTimeForFileNaming } = require('../../utilities/getCurrentDate');

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

// QUERIES & STREAMS DATA DIRECTLY TO CSV VS HOLDING IN MEMORY
// async function execute_retrieve_data(options) {
async function execute_retrieve_data(options, datasetId, bucketName, schema, directoryName) {

    const startTime = performance.now();

    const pool = await create_local_db_connection(await local_usat_sales_db_config());
    
    const directory_name = directoryName ?? `usat_google_bigquery_data`;
    const directory_name_archive = `${directory_name}_archive`;

    const retrieval_batch_size = 100000;

    console.log(options, directory_name, directory_name_archive);

    const id_field = 'id_profiles'; // adjust if using a different unique key
    let lastSeenId = 0;
    let batchCounter = 0;
    let rowsReturned = 0;

    try {
        await deleteArchivedFiles(directory_name_archive);
        await moveFilesToArchive(directory_name, directory_name_archive);

        const { fileName, query } = options[0];

        do {
            const sql = typeof query === 'function'
                ? await query(retrieval_batch_size, lastSeenId)
                : query;

            // console.log(sql);

            // Create export directory if needed
            const dirPath = await create_directory(directory_name);
            const timestamp = getCurrentDateTimeForFileNaming();
            const filePath = path.join(
                dirPath,
                `results_${timestamp}_${fileName}_after_${lastSeenId}_batch_${batchCounter + 1}.csv`
            );
            
            console.log(`🚀 Exporting: ${filePath}`);
            const before = performance.now();

            // ✅ STREAM and track lastSeenId
            const { lastSeenId: newLastSeenId } = await streamQueryToCsvAndTrackLastId(
                pool,
                sql,
                filePath,
                id_field
            );
            console.log('last seen id', lastSeenId);

            const after = performance.now();
            console.log(`⏱️  Elapsed Time: ${((after - before) / 1000).toFixed(2)} sec`);

            // SET rowsReturned to terminate do loop
            if (newLastSeenId !== null) {
                rowsReturned = retrieval_batch_size; // assume full batch unless otherwise tracked
                lastSeenId = newLastSeenId;
            } else {
                rowsReturned = 0;
            }

            batchCounter++;

            await triggerGarbageCollection();

        // } while (batchCounter < 3);  //testing
        } while (rowsReturned > 0);

    } catch (err) {
        console.error('🔥 Error in data retrieval:', err);
    } finally {
        await pool.end();
        const endTime = performance.now();
        console.log(`✅ Total Elapsed Time: ${((endTime - startTime) / 1000).toFixed(2)} sec`);

        await triggerGarbageCollection();
    }
}

// Run the main function
// execute_retrieve_data();

module.exports = {
    execute_retrieve_data,
}