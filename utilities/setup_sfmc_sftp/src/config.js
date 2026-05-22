/*
SFMC SFTP configuration and runtime directory management.

This utility centralizes path creation/configuration for the
SFMC export ingestion pipeline, including upload, processed,
archive, and log directories.
*/

const path = require("path");
const { create_directory } = require("../../createDirectory");

const PROJECT_FOLDER = "sfmc_exports";

async function getConfig() {
    const base_dir = await create_directory(PROJECT_FOLDER);

    // const upload_dir = await create_directory(path.join(PROJECT_FOLDER, "upload"));
    const upload_dir = process.env.SFMC_SFTP_UPLOAD_DIR || "/sftp/sfmc_export/upload";
    const processed_dir = await create_directory(path.join(PROJECT_FOLDER, "processed"));
    const archive_dir = await create_directory(path.join(PROJECT_FOLDER, "archive"));
    const logs_dir = await create_directory(path.join(PROJECT_FOLDER, "logs"));
    const import_dir = await create_directory(path.join(PROJECT_FOLDER, "import"));
    const import_uploaded_dir = await create_directory(path.join(PROJECT_FOLDER, "archive", "import_uploaded"));

    return {
        base_dir,
        upload_dir,
        processed_dir,
        archive_dir,
        logs_dir,import_dir,
        import_uploaded_dir,
        
        retention_days: {
            upload: Number(process.env.RETENTION_UPLOAD_DAYS || 10),
            processed: Number(process.env.RETENTION_PROCESSED_DAYS || 10),
            archive: Number(process.env.RETENTION_ARCHIVE_DAYS || 10),
            logs: Number(process.env.RETENTION_LOGS_DAYS || 10),
        },

        sftp_user: process.env.SFTP_USER || "sfmc_export",
        sftp_port: Number(process.env.SFTP_PORT || 2222),
    };
}

module.exports = { getConfig };