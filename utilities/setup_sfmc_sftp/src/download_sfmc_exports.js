/*
===============================================================
SFMC SFTP EXPORT DOWNLOADER
===============================================================

Purpose
-------
Connects to SFMC's hosted SFTP server, checks the /Export folder,
downloads new files into the local SFTP upload folder, and lets the
existing watcher process them.

Flow:
SFMC /Export
  ↓
download_sfmc_exports.js
  ↓
/sftp/sfmc_export/upload
  ↓
watch_uploads.js
  ↓
processed/
  ↓
Slack notification

Notes
-----
- Uses a local manifest file to avoid downloading the same remote file twice.
- Does not delete remote SFMC files unless DELETE_REMOTE_AFTER_DOWNLOAD=true.
- Slack failures should not stop the downloader.
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
const SFMC_REMOTE_DIR = process.env.SFMC_REMOTE_DIR || "/Export";
const DELETE_REMOTE_AFTER_DOWNLOAD =
    String(process.env.DELETE_REMOTE_AFTER_DOWNLOAD || "false").toLowerCase() === "true";

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

function load_manifest(manifest_path) {
    if (!fs.existsSync(manifest_path)) {
        return { downloaded_files: {} };
    }

    try {
        return JSON.parse(fs.readFileSync(manifest_path, "utf8"));
    } catch {
        return { downloaded_files: {} };
    }
}

function save_manifest(manifest_path, manifest) {
    fs.mkdirSync(path.dirname(manifest_path), { recursive: true });

    const tmp_path = `${manifest_path}.tmp`;

    fs.writeFileSync(
        tmp_path,
        JSON.stringify(manifest, null, 2) + "\n",
        "utf8"
    );

    fs.renameSync(tmp_path, manifest_path);
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

    const manifest_path = path.join(
        config.logs_dir,
        "sfmc_download_manifest.json"
    );

    const manifest = load_manifest(manifest_path);

    const sftp = new Client();

    const started_at = format_timestamp_mtn();

    console.log("");
    console.log("================================================");
    console.log("SFMC SFTP EXPORT DOWNLOAD STARTED");
    console.log("================================================");
    console.log(`Host: ${SFMC_HOST}`);
    console.log(`Remote dir: ${SFMC_REMOTE_DIR}`);
    console.log(`Local upload dir: ${config.upload_dir}`);
    console.log(`Started at: ${started_at} MT`);
    console.log("================================================");

    let downloaded_count = 0;
    let skipped_count = 0;
    let failed_count = 0;

    try {
        await sftp.connect({
            host: SFMC_HOST,
            port: SFMC_PORT,
            username: SFMC_USERNAME,
            password: SFMC_PASSWORD,
            readyTimeout: 30000,

            /*
            SFMC currently offers ssh-rsa host keys.
            This allows this script to connect to that older host key type.
            */
            algorithms: {
                serverHostKey: ["ssh-rsa"],
            },
        });

        const remote_files = await sftp.list(SFMC_REMOTE_DIR);

        const files_only = remote_files.filter((item) => item.type === "-");

        if (files_only.length === 0) {
            console.log("[INFO] No files found in SFMC export directory.");

            await send_slack_notification(
                [
                    `ℹ️ INFO · SFMC SFTP download completed`,
                    `Result: No files found`,
                    `Remote dir: ${SFMC_REMOTE_DIR}`,
                    `Checked at: ${format_timestamp_mtn()} MT`,
                ].join("\n")
            );

            return;
        }

        for (const file of files_only) {
            const remote_file_path = `${SFMC_REMOTE_DIR}/${file.name}`;
            const manifest_key = `${remote_file_path}::${file.size}::${file.modifyTime}`;

            if (manifest.downloaded_files[manifest_key]) {
                skipped_count++;
                console.log(`[SKIP] Already downloaded: ${file.name}`);
                continue;
            }

            const local_tmp_path = path.join(
                config.upload_dir,
                `${file.name}.download`
            );

            const local_final_path = path.join(
                config.upload_dir,
                file.name
            );

            try {
                console.log(`[DOWNLOAD] ${remote_file_path}`);
                console.log(`[LOCAL] ${local_final_path}`);

                await sftp.fastGet(remote_file_path, local_tmp_path);

                fs.renameSync(local_tmp_path, local_final_path);

                manifest.downloaded_files[manifest_key] = {
                    remote_file_path,
                    local_file_path: local_final_path,
                    size_bytes: file.size,
                    downloaded_at_mtn: format_timestamp_mtn(),
                    downloaded_at_utc: new Date().toISOString(),
                };

                save_manifest(manifest_path, manifest);

                downloaded_count++;

                console.log(`[SUCCESS] Downloaded: ${file.name}`);

                if (DELETE_REMOTE_AFTER_DOWNLOAD) {
                    await sftp.delete(remote_file_path);
                    console.log(`[REMOTE DELETE] ${remote_file_path}`);
                }

            } catch (error) {
                failed_count++;

                console.error(`[FAILURE] ${file.name}`);
                console.error(error.message);

                try {
                    if (fs.existsSync(local_tmp_path)) {
                        fs.unlinkSync(local_tmp_path);
                    }
                } catch {
                    // cleanup failure should not stop the script
                }

                await send_slack_notification(
                    [
                        `❌ FAILURE · SFMC SFTP file download failed`,
                        `File: ${file.name}`,
                        `Remote: ${remote_file_path}`,
                        `Failed at: ${format_timestamp_mtn()} MT`,
                        `Error: ${error.message}`,
                    ].join("\n")
                );
            }
        }

        await send_slack_notification(
            [
                `✅ SUCCESS · SFMC SFTP download completed`,
                `Remote dir: ${SFMC_REMOTE_DIR}`,
                `Downloaded: ${downloaded_count}`,
                `Skipped: ${skipped_count}`,
                `Failed: ${failed_count}`,
                `Completed at: ${format_timestamp_mtn()} MT`,
                `Local upload dir: ${config.upload_dir}`,
            ].join("\n")
        );

        console.log("");
        console.log("================================================");
        console.log("SFMC SFTP EXPORT DOWNLOAD COMPLETE");
        console.log("================================================");
        console.log(`Downloaded: ${downloaded_count}`);
        console.log(`Skipped: ${skipped_count}`);
        console.log(`Failed: ${failed_count}`);
        console.log("================================================");

    } catch (error) {
        console.error("[FATAL]", error.message);

        await send_slack_notification(
            [
                `❌ FAILURE · SFMC SFTP download job failed`,
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