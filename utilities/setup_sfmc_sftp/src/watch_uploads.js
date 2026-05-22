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
const path = require("path");
require("dotenv").config({
    path: "/home/usat-server/development/usat/sql_programs/.env"
});

const chokidar = require("chokidar");
const fs = require("fs");

const { getConfig } = require("./config");
const { slack_message_api } = require("../../slack_messaging/slack_message_api");

/*
Format timestamp for logs and Slack messages.
Uses America/Denver because this server/process supports USAT ops.
*/
function format_timestamp_mtn(date = new Date()) {
    return date.toLocaleString("en-US", {
        timeZone: "America/Denver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
}

/*
Simple sleep helper used while waiting for
large files to finish uploading.
*/
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
Send Slack notification without allowing Slack failures
to stop the file watcher.
*/
async function send_slack_notification(message) {
    try {
        await slack_message_api(
            message,
            "steve_calla_slack_channel"
        );
    } catch (error) {
        console.warn(`[SLACK WARNING] ${error.message}`);
    }
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
Delete old processed files based on retention policy.
*/
async function cleanup_old_files(config) {
    const folders = [
        {
            label: "upload",
            dir: config.upload_dir,
            retention_days: config.retention_days.upload,
        },
        {
            label: "processed",
            dir: config.processed_dir,
            retention_days: config.retention_days.processed,
        },
        {
            label: "archive",
            dir: config.archive_dir,
            retention_days: config.retention_days.archive,
        },
        {
            label: "logs",
            dir: config.logs_dir,
            retention_days: config.retention_days.logs,
        },
    ];

    const now = Date.now();

    console.log("");
    console.log("================================================");
    console.log("RUNNING FILE RETENTION CLEANUP");
    console.log("================================================");

    for (const folder of folders) {
        const retention_ms =
            folder.retention_days * 24 * 60 * 60 * 1000;

        let deleted_count = 0;

        if (!fs.existsSync(folder.dir)) {
            console.log(`[SKIP] ${folder.label}: folder does not exist`);
            continue;
        }

        const files = fs.readdirSync(folder.dir);

        for (const file of files) {
            const file_path = path.join(folder.dir, file);
            const stats = fs.statSync(file_path);

            if (!stats.isFile()) {
                continue;
            }

            const age_ms = now - stats.mtimeMs;

            if (age_ms > retention_ms) {
                fs.unlinkSync(file_path);
                deleted_count++;
                console.log(`[DELETED] ${folder.label}: ${file}`);
            }
        }

        console.log(
            `[RETENTION] ${folder.label}: ${folder.retention_days} days, deleted ${deleted_count} file(s)`
        );
    }

    console.log("================================================");
}

/*
Handle newly uploaded file.
*/
/*
Handle newly uploaded file.

Sends Slack SUCCESS when a file is processed.
Sends Slack FAILURE if processing fails.
*/
/*
Handle newly uploaded file.

Sends Slack SUCCESS when a file is processed.
Sends Slack FAILURE if processing fails.
*/
/*
Handle newly uploaded file.

Sends Slack SUCCESS when a file is processed.
Sends Slack FAILURE if processing fails.

Test-only failure trigger:
- Any filename containing "__force_failure__" intentionally throws an error.
*/
async function handle_file(file_path, config) {

    const filename = path.basename(file_path);

    try {
        console.log("");
        console.log("================================================");
        console.log(`[FOUND] ${filename}`);

        /*
        Test-only failure trigger.

        Example test file:
        __force_failure__test.csv
        */
        if (filename.includes("__force_failure__")) {
            throw new Error("Intentional failure test");
        }

        // ensure upload completed
        const ready = await wait_for_file_ready(file_path);

        if (!ready) {
            console.log(`[FAILURE] File not ready: ${filename}`);

            const failed_at_mtn = format_timestamp_mtn();

            await send_slack_notification(
                [
                    `❌ FAILURE · SFMC SFTP file was not ready`,
                    `File: ${filename}`,
                    `Failed at: ${failed_at_mtn} MT`,
                ].join("\n")
            );

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

        const processed_at_mtn = format_timestamp_mtn();

        console.log(`[MOVED] ${filename}`);
        console.log(`[DEST] ${destination}`);
        console.log(`[SIZE] ${size_mb} MB`);

        await send_slack_notification(
            [
                `✅ SUCCESS · SFMC SFTP file processed`,
                `File: ${filename}`,
                `Processed file: ${path.basename(destination)}`,
                `Size: ${size_mb} MB`,
                `Processed at: ${processed_at_mtn} MT`,
                `Destination: ${destination}`,
            ].join("\n")
        );

        console.log("================================================");

    } catch (error) {

        console.error(`[FAILURE] ${filename}`);
        console.error(error.message);

        const failed_at_mtn = format_timestamp_mtn();

        await send_slack_notification(
            [
                `❌ FAILURE · SFMC SFTP file processing failed`,
                `File: ${filename}`,
                `Failed at: ${failed_at_mtn} MT`,
                `Error: ${error.message}`,
            ].join("\n")
        );

        console.log("================================================");
    }
}

/*
Main watcher startup.
*/
async function main() {

    const config = await getConfig();

    /*
    Run retention cleanup on startup.
    */
    await cleanup_old_files(config);

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