/*
SFMC SFTP IMPORT UPLOADER

Uploads local files from import/ to SFMC /Import.
After upload, moves local files to archive/import_uploaded/.
*/

const path = require("path");
const fs = require("fs");

require("dotenv").config({
    path: "/home/usat-server/development/usat/sql_programs/.env",
});

const Client = require("ssh2-sftp-client");

const { getConfig } = require("./config");
const { slack_message_api } = require("../../slack_messaging/slack_message_api");

const SFMC_HOST = process.env.SFMC_SFTP_HOST;
const SFMC_PORT = Number(process.env.SFMC_SFTP_PORT || 22);
const SFMC_USERNAME = process.env.SFMC_SFTP_USERNAME;
const SFMC_PASSWORD = process.env.SFMC_SFTP_PASSWORD;
const SFMC_REMOTE_IMPORT_DIR = process.env.SFMC_REMOTE_IMPORT_DIR || "/Import";

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

async function send_slack_notification(message) {
    try {
        await slack_message_api(message, "steve_calla_slack_channel");
    } catch (error) {
        console.warn(`[SLACK WARNING] ${error.message}`);
    }
}

function validate_env() {
    const missing = [];

    if (!SFMC_HOST) missing.push("SFMC_SFTP_HOST");
    if (!SFMC_USERNAME) missing.push("SFMC_SFTP_USERNAME");
    if (!SFMC_PASSWORD) missing.push("SFMC_SFTP_PASSWORD");

    if (missing.length > 0) {
        throw new Error(`Missing required env values: ${missing.join(", ")}`);
    }
}

async function main() {
    validate_env();

    const config = await getConfig();

    const local_files = fs
        .readdirSync(config.import_dir)
        .filter((file) => {
            const file_path = path.join(config.import_dir, file);
            return fs.statSync(file_path).isFile();
        });

    if (local_files.length === 0) {
        console.log("[INFO] No local import files found.");

        await send_slack_notification(
            [
                `ℹ️ INFO · SFMC import upload completed`,
                `Result: No files found`,
                `Local import dir: ${config.import_dir}`,
                `Checked at: ${format_timestamp_mtn()} MT`,
            ].join("\n")
        );

        return;
    }

    const sftp = new Client();

    let uploaded_count = 0;
    let failed_count = 0;

    try {
        await sftp.connect({
            host: SFMC_HOST,
            port: SFMC_PORT,
            username: SFMC_USERNAME,
            password: SFMC_PASSWORD,
            readyTimeout: 30000,
            algorithms: {
                serverHostKey: ["ssh-rsa"],
            },
        });

        for (const file of local_files) {
            const local_file_path = path.join(config.import_dir, file);
            const remote_file_path = `${SFMC_REMOTE_IMPORT_DIR}/${file}`;

            try {
                console.log(`[UPLOAD] ${local_file_path}`);
                console.log(`[REMOTE] ${remote_file_path}`);

                await sftp.fastPut(local_file_path, remote_file_path);

                const timestamp = new Date()
                    .toISOString()
                    .replace(/[:.]/g, "-");

                const archived_path = path.join(
                    config.import_uploaded_dir,
                    `${timestamp}__${file}`
                );

                fs.renameSync(local_file_path, archived_path);

                uploaded_count++;

                console.log(`[SUCCESS] Uploaded: ${file}`);

            } catch (error) {
                failed_count++;

                console.error(`[FAILURE] ${file}`);
                console.error(error.message);

                await send_slack_notification(
                    [
                        `❌ FAILURE · SFMC import upload failed`,
                        `File: ${file}`,
                        `Remote: ${remote_file_path}`,
                        `Failed at: ${format_timestamp_mtn()} MT`,
                        `Error: ${error.message}`,
                    ].join("\n")
                );
            }
        }

        await send_slack_notification(
            [
                `✅ SUCCESS · SFMC import upload completed`,
                `Remote dir: ${SFMC_REMOTE_IMPORT_DIR}`,
                `Uploaded: ${uploaded_count}`,
                `Failed: ${failed_count}`,
                `Completed at: ${format_timestamp_mtn()} MT`,
                `Local import dir: ${config.import_dir}`,
            ].join("\n")
        );

        console.log("");
        console.log("================================================");
        console.log("SFMC IMPORT UPLOAD COMPLETE");
        console.log("================================================");
        console.log(`Uploaded: ${uploaded_count}`);
        console.log(`Failed: ${failed_count}`);
        console.log("================================================");

    } catch (error) {
        console.error("[FATAL]", error.message);

        await send_slack_notification(
            [
                `❌ FAILURE · SFMC import upload job failed`,
                `Failed at: ${format_timestamp_mtn()} MT`,
                `Error: ${error.message}`,
            ].join("\n")
        );

        process.exitCode = 1;

    } finally {
        sftp.end().catch(() => {});
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };