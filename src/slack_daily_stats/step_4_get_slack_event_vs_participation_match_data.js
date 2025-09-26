const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const path = require('path');
const mysqlP = require('mysql2/promise');   // promise client for regular queries
const mysql = require('mysql2');              // callback client for streaming

const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { create_directory } = require('../../utilities/createDirectory');
const { streamQueryToCsv } = require('../../utilities/stream_query_to_csv');

const { upload_single_file_to_thread } = require('../../utilities/slack_messaging/slack_message_api_attachment');

/**
 * Streaming pool (callback client). Keeps your existing promise client intact.
 */
async function get_stream_pool() {
    const cfg = await local_usat_sales_db_config();
    return mysql.createPool({
        ...cfg,
        multipleStatements: false,   // safer for streaming a single SELECT
        dateStrings: true            // CSV-friendly: no JS Date objects
    });
}

// Connect to MySQL (promise client)
async function get_dst_connection() {
    const cfg = await local_usat_sales_db_config();
    return await mysqlP.createConnection(cfg);
}

async function query_sanction_vs_participation_detail(month = "other", type = "all", is_reported = "all") {

    console.log('===================== month =', month);
    console.log('===================== type =', type);
    console.log('===================== is_reported =', is_reported);

    // validate the month field
    const m = Number(month); // coerce
    if (Number.isInteger(m) && m >= 1 && m <= 12) {
        month_parameter = "other"
    } else {
        month_parameter = "all"
    }

    const options_month = {
        all: "-- no month statement; returns all",
        other: `AND s_month_label = ${month}`
    };

    const options_type = {
        all: "-- no type statement; returns all",
        race: "AND REGEXP_LIKE(COALESCE(event_type_category, ''), 'race', 'i') -- true if the text contains “race”; 'i' makes it case-insensitive",
        clinic: "AND REGEXP_LIKE(COALESCE(event_type_category, ''), 'clinic', 'i') -- true if the text contains “clinic”; 'i' makes it case-insensitive",
    };

    const options_is_reported = {
        all: "-- no is_reported statement; returns all",
        true: 'AND reported_flag = "✅ Reported"',
        false: 'AND reported_flag = "❌ Not Reported"',
    };

    const query = `
        SELECT 
            * 
        FROM usat_sales_db.event_vs_participation_match_data 
        WHERE 1 = 1
            ${options_month[month_parameter]}
            ${options_type[type]}
            ${options_is_reported[is_reported]}
        LIMIT 2000
        ;
    `;

    return query;

    //   -- AND s_month_label = 6 
    // -- return all ""
    // -- AND NOT REGEXP_LIKE(COALESCE(s_id_sanctioning_events, ''), 'race|clinic', 'i') -- true if the text does not contain “race” or “clinic”; 'i' makes it case-insensitive
    // -- AND REGEXP_LIKE(COALESCE(s_id_sanctioning_events, ''), 'race|clinic', 'i') -- true if the text contains “race” or “clinic”; 'i' makes it case-insensitive
    // -- AND REGEXP_LIKE(COALESCE(s_id_sanctioning_events, ''), 'race', 'i') -- true if the text contains “race”; 'i' makes it case-insensitive
    // -- AND REGEXP_LIKE(COALESCE(s_id_sanctioning_events, ''), 'clinic', 'i') -- true if the text contains “clinic”; 'i' makes it case-insensitive
    // -- AND reported_flag = "✅ Reported"
    // -- AND reported_flag = "❌ Not Reported"
}

async function execute_get_event_vs_participation_detail(month = 7, type = 'race', is_reported = 'false') {
    runTimer('timer');
    const startTime = performance.now();

    let pool;                 // <-- declare in outer scope
    let file_directory;
    let file_path;
    let rows;

    try {
        // 1) Setup streaming pool & query (to get by month, type, is reported)
        pool = await get_stream_pool();
        // month = "3"; type = "all"; is_reported = "all";
        // month = "all"; type = "all"; is_reported = "all";
        const query = await query_sanction_vs_participation_detail(month, type, is_reported);
        // const { sql, params } = await query_sanction_vs_participation_detail(month, type, is_reported);

        // 2) Create output directory + path
        file_directory = await create_directory('usat_slack_event_vs_partcipation_match_data');
        file_path = path.join(file_directory, `sanction_vs_participation_${month}.csv`);

        // 3) Stream data to CSV
        const file_flag = 'w'; // 'w' overwrite, 'a' append, 'wx' fail if exists
        let { filePath, rows_count, sizeBytes, charCount } = await streamQueryToCsv(pool, query, file_path, file_flag);

        rows = rows_count;
        
        // await streamQueryToCsv(pool, sql, params, file_path, file_flag);
        console.log(`Wrote 2 ${rows} rows to ${filePath} (${sizeBytes.toLocaleString()} bytes) ${charCount.toLocaleString()} characters`);
   
    } catch (err) {
        stopTimer('timer');
        console.error('Error during data queries:', err);
        throw err;

    } finally {
        stopTimer('timer');

        // safely close pool if it exists
        if (typeof pool?.end === 'function') {
            try { pool.end(); } catch { }
        }
    
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        console.log(`\nAll participation data queries executed successfully. Elapsed Time: ${elapsedTime ? elapsedTime : "Oops error getting time"} sec\n`);
    }

    // exit only after all awaits complete
    return { file_directory, file_path, rows };
}

// async function test() {
//     await execute_get_event_vs_participation_detail(month = 3, type = 'race', is_reported = 'false');
// }

// test();

module.exports = {
    execute_get_event_vs_participation_detail,
};
