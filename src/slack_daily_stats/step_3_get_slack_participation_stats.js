const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP                                  = require('mysql2/promise');   // only for dst.execute
const { local_usat_sales_db_config }          = require('../../utilities/config');
const { runTimer, stopTimer }                 = require('../../utilities/timer');

// Connect to MySQL
async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function query_year_over_year_counts() {
    // C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_participation_061225.sql

    return `
        -- year over year data by month for participation # of events & participants
        WITH participant_events AS (
            SELECT
                "year_over_year_counts" AS label,
                MAX(created_at_mtn) AS created_at_mtn,
                start_date_month_races,

                YEAR(CURDATE()) - 1 AS last_year,
                YEAR(CURDATE()) AS this_year,

                COUNT(DISTINCT CASE WHEN start_date_year_races = YEAR(CURDATE()) - 1 THEN id_sanctioning_events END) AS participant_event_count_last_year,
                COUNT(DISTINCT CASE WHEN start_date_year_races = YEAR(CURDATE()) THEN id_sanctioning_events END) AS participant_event_count_this_year,

                SUM(CASE WHEN start_date_year_races = YEAR(CURDATE()) - 1 THEN count_all_participants END) AS participants_count_last_year,
                SUM(CASE WHEN start_date_year_races = YEAR(CURDATE()) THEN count_all_participants END) AS participants_count_this_year

            FROM participation_race_profiles
            WHERE start_date_year_races IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1)
            GROUP BY start_date_month_races
            HAVING participant_event_count_this_year > 0
        )
            SELECT
                label,
                created_at_mtn,
                start_date_month_races,
                last_year,
                this_year,
                participant_event_count_last_year,
                participant_event_count_this_year,
                participant_event_count_this_year - participant_event_count_last_year AS participant_event_difference_last_vs_this_year,
                participants_count_last_year,
                participants_count_this_year,
                participants_count_this_year - participants_count_last_year AS _participants_difference_last_vs_this_year
            FROM participant_events

            UNION ALL

            -- Totals row based on filtered data
            SELECT
                'TOTAL',
                'TOTAL',
                'TOTAL',
                MIN(last_year),
                MIN(this_year),
                SUM(participant_event_count_last_year),
                SUM(participant_event_count_this_year),
                SUM(participant_event_count_this_year) - SUM(participant_event_count_last_year),
                SUM(participants_count_last_year),
                SUM(participants_count_this_year),
                SUM(participants_count_this_year) - SUM(participants_count_last_year)
            FROM participant_events

            ORDER BY 
                label = 'TOTAL',
                start_date_month_races
        ;
      `
}

async function query_sanctioned_vs_participation_counts() {
    // C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_participation_061225.sql

    return `
        -- compare sanctioned events vs race reporting
        WITH participant_events AS (
            SELECT
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn,
                start_date_month_races AS month_label,
                COUNT(DISTINCT CASE WHEN start_date_year_races = YEAR(CURDATE()) - 1 THEN id_sanctioning_events END) AS participant_event_count_last_year,
                COUNT(DISTINCT CASE WHEN start_date_year_races = YEAR(CURDATE()) THEN id_sanctioning_events END) AS participant_event_count_this_year
            FROM participation_race_profiles
            WHERE start_date_year_races IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1)
                AND LOWER(name_event_type) IN ('adult event', 'youth event')
            GROUP BY 
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d'), start_date_month_races
        ),
            sanctioned_events AS (
                SELECT
                    DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn,
                    starts_month_events AS month_label,
                    COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) - 1 THEN id_sanctioning_events END) AS sanction_count_last_year,
                    COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) THEN id_sanctioning_events END) AS sanction_count_this_year
                FROM event_data_metrics
                WHERE starts_year_events IN (YEAR(CURDATE()) - 1, YEAR(CURDATE()))
                    AND status_events NOT IN ('cancelled', 'declined', 'deleted')
                    AND LOWER(name_event_type) IN ('adult race', 'youth race')
                GROUP BY 
                    DATE_FORMAT(created_at_mtn, '%Y-%m-%d'), starts_month_events
            ),

            combined AS (
                SELECT
                    "participation_v_sanction_events_query" AS label,
                    GREATEST(r.created_at_mtn, s.created_at_mtn) AS max_created_at,
                    r.month_label,
                    s.sanction_count_last_year,
                    r.participant_event_count_last_year,
                    r.participant_event_count_last_year - s.sanction_count_last_year AS diff_last_year,
                    s.sanction_count_this_year,
                    r.participant_event_count_this_year,
                    r.participant_event_count_this_year - s.sanction_count_this_year AS diff_this_year
                FROM participant_events r
                    LEFT JOIN sanctioned_events s ON r.month_label = s.month_label
                WHERE 
                    r.participant_event_count_this_year > 0

                UNION

                SELECT
                    "participation_v_sanction_events_query" AS label,
                    GREATEST(r.created_at_mtn, s.created_at_mtn) AS max_created_at,
                    s.month_label,
                    s.sanction_count_last_year,
                    r.participant_event_count_last_year,
                    r.participant_event_count_last_year - s.sanction_count_last_year,
                    s.sanction_count_this_year,
                    r.participant_event_count_this_year,
                    r.participant_event_count_this_year - s.sanction_count_this_year
                FROM sanctioned_events s
                    LEFT JOIN participant_events r ON r.month_label = s.month_label
                WHERE 
                    r.participant_event_count_this_year > 0
            )

            SELECT * FROM combined

            UNION ALL

            -- Total row
            SELECT
                'TOTAL',
                'TOTAL',
                'TOTAL' AS month_label,
                SUM(sanction_count_last_year),
                SUM(participant_event_count_last_year),
                SUM(diff_last_year),
                SUM(sanction_count_this_year),
                SUM(participant_event_count_this_year),
                SUM(diff_this_year)
            FROM combined

            ORDER BY
                CASE WHEN month_label = 'TOTAL' THEN 1 ELSE 0 END,  -- TOTAL last
                MONTH(STR_TO_DATE(month_label, '%M')) ASC
        ;
      `
}

async function execute_get_participation_stats() {
    runTimer('timer');
    const startTime = performance.now();
    
    const dst = await get_dst_connection();  // mysql2/promise connection

    let result_year_over_year = [];
    let result_sanctioned_vs_participation = [];

    try {
        // STEP 1: No need for month / input variable validation

        // STEP 2: Run query only if no invalid filters
        let [data_year_over_year] = await dst.query(await query_year_over_year_counts());

        // STEP 3: Run query only if no invalid filters
        let [data_sanctioned_vs_participation] = await dst.query(await query_sanctioned_vs_participation_counts());

        // if (data_year_over_year && data_sanctioned_vs_participation.length > 0) {
        //     console.log('length =', data_year_over_year.length);
        //     const sample = data_year_over_year[0];
        //     console.log(`Sample row:`, sample);
        // } else {
        //     console.log('data_year_over_year is undefined or empty:', data_year_over_year);
        // }

        // STEP #3: CREATE SLACK MESSAGE (pass along array if undefined)
        result_year_over_year = (data_year_over_year !== undefined && data_year_over_year !== null) ? data_year_over_year : [];
        result_sanctioned_vs_participation = (data_sanctioned_vs_participation!== undefined && data_sanctioned_vs_participation !== null) ? data_sanctioned_vs_participation : [];
        

    } catch (err) {
            
        stopTimer('timer');

        console.error('Error during data queries:', err);

        slack_message = `Error - No results: error`;

        throw err;
    
    } finally {
        await dst.end();  // Properly close MySQL connection
        stopTimer('timer');

        // LOG RESULTS
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

        console.log(`\nAll participation data queries executed successfully. Elapsed Time: ${elapsedTime ? elapsedTime : "Oops error getting time"} sec\n`);

        // return result;
        return { result_year_over_year, result_sanctioned_vs_participation };
    }
    
}

// async function test() {
//     const { create_slack_message } = require('./step_3a_create_slack_participation_message');

//     const { result_year_over_year, result_sanctioned_vs_participation } = await execute_get_participation_stats();
//     // console.log(result_year_over_year);
//     // console.log(result_sanctioned_vs_participation);

//     const { slack_message, slack_blocks } = await create_slack_message(result_year_over_year, result_sanctioned_vs_participation);
//     console.log('message =', slack_message);

//     process.exit(1);
// }

// test();

module.exports = {
    execute_get_participation_stats,
}