const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { local_usat_sales_db_config } = require('./config');
const { create_local_db_connection } = require('./connectionLocalDB');
const { streamQueryToCsv } = require('./stream_query_to_csv');
const { create_directory } = require('./createDirectory');
const { determineOSPath } = require('./determineOSPath');
const { getCurrentDateTimeForFileNaming } = require('./getCurrentDate');
const { triggerGarbageCollection } = require('./garbage_collection/trigger_garbage_collection');

// STEP #1 - DELETE ALL CSVs ALREADY IN THE ARCHIVE FOLDER
async function deleteArchivedFiles(directory_name_archive) {
    console.log('Deleting files from archive');
    const directoryPath = await create_directory(directory_name_archive);
    const files = fs.readdirSync(directoryPath);

    files?.forEach((file) => {
        if (file.endsWith('.csv')) {
            const filePath = path.join(directoryPath, file);
            try {
                fs.unlinkSync(filePath);
                console.log(`Deleted archived file: ${filePath}`);
            } catch (deleteErr) {
                console.error(`Error deleting file ${filePath}:`, deleteErr);
            }
        }
    });
}

// STEP #2 - MOVE EXISTING CSVs FROM THE MAIN FOLDER INTO THE ARCHIVE FOLDER
async function moveFilesToArchive(directory_name, directory_name_archive) {
    console.log('Moving files to archive');
    const sourcePath = await create_directory(directory_name);
    const destinationPath = await create_directory(directory_name_archive);

    const files = fs.readdirSync(sourcePath);
    for (const file of files) {
        if (file.endsWith('.csv')) {
            const sourceFilePath = path.join(sourcePath, file);
            const destinationFilePath = path.join(destinationPath, file);
            try {
                fs.renameSync(sourceFilePath, destinationFilePath);
                console.log(`Archived ${file}`);
            } catch (archiveErr) {
                console.error(`Error moving file ${file} to archive:`, archiveErr);
            }
        }
    }
}

// Archive prior runs, then stream ONE query to a SINGLE CSV in the main /data folder.
// options = { directory_name, directory_name_archive, fileName, query }
//   query: (batch_size, offset) => sql   OR   a plain sql string
async function execute_save_single_csv(options) {
    const startTime = performance.now();
    const { directory_name, directory_name_archive, fileName, query } = options;

    const pool = await create_local_db_connection(await local_usat_sales_db_config());

    try {
        // (1) clear the archive folder, (2) move current main-folder csvs into archive
        await deleteArchivedFiles(directory_name_archive);
        await moveFilesToArchive(directory_name, directory_name_archive);

        // (3) stream one query (all rows) to a single file in the main folder
        const dirPath = await create_directory(directory_name);
        const timestamp = getCurrentDateTimeForFileNaming();
        const filePath = path.join(dirPath, `results_${timestamp}_${fileName}.csv`);

        // huge LIMIT = no real cap; streamQueryToCsv streams row-by-row (memory-safe)
        const sql = typeof query === 'function' ? await query(1000000000, 0) : query;

        console.log(`🚀 Exporting (single file): ${filePath}`);
        const result = await streamQueryToCsv(pool, sql, filePath);
        console.log(`✅ Wrote ${result.rows_count} rows to ${filePath}`);

        return result;
    } catch (err) {
        console.error('🔥 Error in single-csv export:', err);
        throw err;
    } finally {
        await pool.end();
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Single-csv export elapsed: ${elapsed} sec`);
        await triggerGarbageCollection();
    }
}

module.exports = {
    execute_save_single_csv,
};
