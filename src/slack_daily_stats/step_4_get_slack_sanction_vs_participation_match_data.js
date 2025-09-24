const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP = require('mysql2/promise');   // promise client for regular queries
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { streamQueryToCsv } = require('../../utilities/stream_query_to_csv');

const { upload_single_file_to_thread } = require('../../utilities/slack_messaging/slack_message_api_attachment');

const fs = require('fs');
const path = require('path');
const fastcsv = require('fast-csv');
const mysql = require('mysql2');              // callback client for streaming

async function create_directory(file_path) {
    try {
        await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
    } catch (e) {
        return reject(e);
    }
}

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

/**
 * SQL (minimal change: parameterize month with `?` instead of interpolating)
 * Note: function still accepts `month` to keep your call sites unchanged, but the value is passed via params.
 */
async function query_sanction_vs_participation_detail(month) {
    return `
        WITH participant_events AS (
            SELECT
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn,
                id_sanctioning_events,
                GROUP_CONCAT(DISTINCT(start_date_month_races)) AS month_label,
                GROUP_CONCAT(DISTINCT(start_date_races)) AS start_date_races
            FROM participation_race_profiles
            WHERE 1 = 1
                AND start_date_year_races = YEAR(CURDATE())
                AND LOWER(name_event_type) IN ('adult race', 'youth race')
            GROUP BY 
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d'), id_sanctioning_events
        ),
        sanctioned_events AS (
            SELECT
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn,
                starts_month_events AS month_label,
                LEFT(id_sanctioning_events, 6) AS id_sanctioning_short,
                id_sanctioning_events,
                name_events,
                starts_events,
                starts_month_events,
                state_code_events
            FROM event_data_metrics
            WHERE 1 = 1
                AND starts_year_events IN (YEAR(CURDATE()))
                AND status_events NOT IN ('cancelled', 'declined', 'deleted')
                AND LOWER(name_event_type) IN ('adult race', 'youth race')
            GROUP BY 
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d'), starts_month_events, id_sanctioning_short, 
                id_sanctioning_events, name_events, starts_events, starts_month_events, 
                state_code_events
        ),
        sanctioned_events_with_reported_flag AS ( 
            SELECT   
                ROW_NUMBER() OVER (ORDER BY s.id_sanctioning_short ASC) AS row_num,  -- row numbering

                s.id_sanctioning_short                      AS s_id_sanctioning_short,
                GROUP_CONCAT(s.id_sanctioning_events ORDER BY s.id_sanctioning_events ASC) AS s_id_sanctioning_events,

                TRIM(BOTH '"' FROM TRIM(BOTH '''' FROM name_events)) AS s_name_events,
                
                s.starts_events                AS s_starts_events,
                s.month_label                  AS s_month_label,
                s.state_code_events            AS s_state_code_events,

                p.id_sanctioning_events        AS p_id_sanctioning_events,
                p.month_label                   AS p_month_label,
                p.start_date_races             AS p_start_date_races,
                
                CASE
                    WHEN p.id_sanctioning_events IS NOT NULL THEN '✅ Reported'
                    ELSE '❌ Not Reported'
                END AS reported_flag,
                
                s.created_at_mtn               AS s_created_at_mtn,
                COUNT(*) OVER () AS row_count   -- total rows in this final set

            FROM sanctioned_events AS s
                LEFT JOIN participant_events AS p ON p.id_sanctioning_events = s.id_sanctioning_short
            WHERE 1 = 1
                AND s.month_label = ?
            GROUP BY 2, 4, 5, 6, 7, 8, 9, 10, 11, 12
            HAVING 1 = 1 
                AND reported_flag = '❌ Not Reported'
            ORDER BY 1 ASC
        ) 
        SELECT * 
        FROM sanctioned_events_with_reported_flag AS s 
        ORDER BY s.s_month_label, s.s_id_sanctioning_events
  `;
}

async function execute_get_sanction_vs_participation_detail() {
    runTimer('timer');
    const startTime = performance.now();

    const dst = await get_dst_connection();  // mysql2/promise connection

    let result_sanction_vs_participation_detail = [];

    try {
        let month = 4;

        // single SELECT only (CTEs are fine) → clean result shape
        const sql = await query_sanction_vs_participation_detail(month);
        const [result] = await dst.query(sql, [month]);
        console.log(result);

    } catch (err) {
        stopTimer('timer');
        console.error('Error during data queries:', err);
        throw err;
    } finally {
        await dst.end();  // Properly close MySQL connection
        stopTimer('timer');

        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        console.log(`\nAll participation data queries executed successfully. Elapsed Time: ${elapsedTime ? elapsedTime : "Oops error getting time"} sec\n`);

        return { result_sanction_vs_participation_detail };
    }
}

async function test() {
    // 1) Stream the results to local DB
    // 2) Send the results to Google Cloud / DB

    // 3) Grab the results for slack email = grab the results for specific month
    // 4) Return the results via slack

    // 5) Schedule regular slack with X month
    // 6) Setup slack slash command with month, race type

    // 1) Run the query normally (optional)
    //   const { result_sanction_vs_participation_detail } = await execute_get_sanction_vs_participation_detail();
    //   console.log(result_sanction_vs_participation_detail);

    // 1) Stream the query results directly to CSV
    const month = 6;
    const query = await query_sanction_vs_participation_detail(month);

    const pool = await get_stream_pool();

    const file_directory = path.join(__dirname, 'out');
    console.log('file directory 1 =', file_directory);

    const file_path = path.join(file_directory, `sanction_vs_participation_${month}.csv`);
    console.log('file path 1 =', file_path);

    try {
        await create_directory(file_directory);

        const file_flag = "w"; // "w" = empty & overwrite; "a" = append; "wx" = fail if file exists
        await streamQueryToCsv(pool, query, file_path, [month], file_flag);

    } finally {
        pool.end();
    }

    // 2) Send the message to slack with the csv file
    let channelId;
    let mainMessageText;
    await upload_single_file_to_thread(file_directory, file_path, channelId, mainMessageText);


    // CREATE SERVER
    // SCHEDULED REPORT
    // AD HOC REPORT: Month, Event types, All

    process.exit(1);
}

test();

module.exports = {
    execute_get_sanction_vs_participation_detail,
};
