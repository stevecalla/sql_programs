const fs = require('fs');
const path = require('path');
const { streamQueryToCsvAndTrackLastId } = require('./your_stream_module'); // update path if needed

async function execute_retrieve_data(options, datasetId, bucketName, schema, directoryName) {
    const startTime = performance.now();

    const pool = await create_local_db_connection(await local_usat_sales_db_config());

    const directory_name = directoryName ?? `usat_google_bigquery_data`;
    const directory_name_archive = `${directory_name}_archive`;

    const retrieval_batch_size = 100000;
    const id_field = 'id_profiles'; // adjust if using a different unique key

    console.log(options, directory_name, directory_name_archive);

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

            const after = performance.now();
            console.log(`⏱️ Elapsed Time: ${((after - before) / 1000).toFixed(2)} sec`);

            if (newLastSeenId !== null) {
                rowsReturned = retrieval_batch_size; // assume full batch unless otherwise tracked
                lastSeenId = newLastSeenId;
            } else {
                rowsReturned = 0;
            }

            batchCounter++;
            await triggerGarbageCollection();

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
