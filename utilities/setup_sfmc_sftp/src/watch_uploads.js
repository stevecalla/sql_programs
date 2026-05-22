/*
===============================================================
SFMC SFTP UPLOAD WATCHER
===============================================================

Purpose
-------
Monitors the SFMC upload directory for newly uploaded files.

When a new file is detected:
1. Wait for upload/write to complete
2. Move file into processed directory
3. Log file metadata

This utility provides the foundation for future automation:
- Slack notifications
- Box / Google Drive uploads
- ETL ingestion
- CSV validation
- Retention policies

===============================================================
*/

const chokidar = require("chokidar");
const fs = require("fs");
const path = require("path");

const { getConfig } = require("./config");

/*
Simple sleep helper used while waiting for
large files to finish uploading.
*/
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
Wait for file size to stabilize.

This helps prevent processing partially uploaded
files from SFMC/SFTP transfers.
*/
async function wait_for_file_ready(file_path) {
    let last_size = -1;

    for (let i = 0; i < 20; i++) {

        // file removed during upload
        if (!fs.existsSync(file_path)) {
            return false;
        }

        const { size } = fs.statSync(file_path);

        // size unchanged = likely finished uploading
        if (size === last_size) {
            return true;
        }

        last_size = size;

        // wait before checking again
        await sleep(3000);
    }

    return false;
}

/*
Handle newly uploaded file.
*/
async function handle_file(file_path, config) {

    const filename = path.basename(file_path);

    console.log("");
    console.log("================================================");
    console.log(`[FOUND] ${filename}`);

    // ensure upload completed
    const ready = await wait_for_file_ready(file_path);

    if (!ready) {
        console.log(`[SKIP] File not ready: ${filename}`);
        return;
    }

    /*
    Add timestamp to avoid accidental overwrites
    and improve traceability.
    */
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-");

    const destination = path.join(
        config.processed_dir,
        `${timestamp}__${filename}`
    );

    // move file into processed directory
    fs.renameSync(file_path, destination);

    // determine final file size
    const size_mb = (
        fs.statSync(destination).size / 1024 / 1024
    ).toFixed(2);

    console.log(`[MOVED] ${filename}`);
    console.log(`[DEST] ${destination}`);
    console.log(`[SIZE] ${size_mb} MB`);
    console.log("================================================");
}

/*
Main watcher startup.
*/
async function main() {

    const config = await getConfig();

    console.log("");
    console.log("================================================");
    console.log("SFMC SFTP WATCHER STARTED");
    console.log("================================================");
    console.log(`UPLOAD DIR:   ${config.upload_dir}`);
    console.log(`PROCESSED:    ${config.processed_dir}`);
    console.log("");

    chokidar
        .watch(config.upload_dir, {

            // do not process existing files on startup
            ignoreInitial: true,

            persistent: true,

            /*
            Additional protection for large uploads.
            */
            awaitWriteFinish: {
                stabilityThreshold: 10000,
                pollInterval: 1000,
            },
        })

        // file added event
        .on("add", (file_path) => {
            handle_file(file_path, config);
        });
}

main().catch((error) => {
    console.error("[ERROR]", error);
    process.exit(1);
});