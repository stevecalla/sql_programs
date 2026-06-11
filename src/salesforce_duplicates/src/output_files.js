/**
 * output_files.js — CSV writing + output/archive folder rotation + run summary.
 *
 * Files land in the cross-platform /data path resolved by
 * utilities/determineOSPath.js (via createDirectory), not the code folder.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('fast-csv');

const { create_directory } = require('../../../utilities/createDirectory');
const {
    OUTPUT_DIR_NAME,
    ARCHIVE_DIR_NAME,
    META_DIR_NAME,
    RUN_SUMMARY_FILE,
    ZIP_TRIM_MAPPING_FILE,
    NICKNAME_FIRE_MAPPING_FILE,
} = require('../config');

// Append a date/time stamp to the end of a file name, before its extension.
// e.g. ("account_duplicates_sf_import.csv", "2026-06-04_14-30-05")
//   -> "account_duplicates_sf_import_2026-06-04_14-30-05.csv"
function add_timestamp_to_filename(file_name, timestamp) {
    const ext = path.extname(file_name);
    const base = path.basename(file_name, ext);
    return `${base}_${timestamp}${ext}`;
}

async function write_csv(output_dir, file_name, rows) {
    const full_path = path.join(output_dir, file_name);

    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(full_path);

        ws.on("error", reject);
        ws.on("finish", resolve);

        csv
            .write(rows, { headers: true })
            .on("error", reject)
            .pipe(ws);
    });

    return full_path;
}

// Archive prior run output before writing new files.
// Mirrors the usat_sales_data convention (see src/sales_data/step_1_get_sales_data.js):
// 1. delete existing csvs in the archive folder
// 2. move existing csvs from the output folder into the archive folder
// Returns the output directory path for the current run's files.
async function archive_previous_output_files(output_dir_name = OUTPUT_DIR_NAME, archive_dir_name = ARCHIVE_DIR_NAME) {
    const output_dir = await create_directory(output_dir_name);
    const archive_dir = await create_directory(archive_dir_name);

    // 1. DELETE EXISTING FILES IN ARCHIVE
    for (const file of fs.readdirSync(archive_dir)) {
        if (file.endsWith(".csv")) {
            fs.rmSync(path.join(archive_dir, file));
        }
    }

    // 2. MOVE CURRENT OUTPUT FILES TO ARCHIVE
    for (const file of fs.readdirSync(output_dir)) {
        if (file.endsWith(".csv")) {
            fs.renameSync(path.join(output_dir, file), path.join(archive_dir, file));
        }
    }

    return output_dir;
}

// Write the per-run summary JSON (total records scanned, counts, timestamps)
// into the meta folder — a sibling of the output folder, so it is never swept
// into the Slack file uploads. Overwritten each run (reflects the latest run).
async function write_run_summary(summary, meta_dir_name = META_DIR_NAME, file_name = RUN_SUMMARY_FILE) {
    const meta_dir = await create_directory(meta_dir_name);
    const full_path = path.join(meta_dir, file_name);
    fs.writeFileSync(full_path, JSON.stringify(summary, null, 2));
    return full_path;
}

// Write the ZIP trim mapping (raw -> trimmed -> count) into the meta folder, so
// a reviewer can confirm how composite ZIPs were normalized to 5 digits. Like
// the run summary, it lives in the meta folder (NOT the output folder) so it is
// never swept into the Slack uploads. Overwritten each run. Returns the path.
async function write_zip_trim_mapping(rows, meta_dir_name = META_DIR_NAME, file_name = ZIP_TRIM_MAPPING_FILE) {
    const meta_dir = await create_directory(meta_dir_name);
    return write_csv(meta_dir, file_name, rows);
}

// Write the reviewable nickname-fire mapping (first-name A <-> B -> count) into
// the meta folder, alongside the ZIP-trim mapping. Lets a reviewer confirm which
// nickname relationships actually fired. Overwritten each run. Returns the path.
async function write_nickname_fire_mapping(rows, meta_dir_name = META_DIR_NAME, file_name = NICKNAME_FIRE_MAPPING_FILE) {
    const meta_dir = await create_directory(meta_dir_name);
    return write_csv(meta_dir, file_name, rows);
}

module.exports = {
    add_timestamp_to_filename,
    write_csv,
    archive_previous_output_files,
    write_run_summary,
    write_zip_trim_mapping,
    write_nickname_fire_mapping,
};
