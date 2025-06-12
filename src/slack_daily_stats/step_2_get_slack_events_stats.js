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

async function query_year_over_year_counts(month) {
    // C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_sanction_061025.sql
    
    console.log('month =', month);

    // BUILD WHERE CLAUSE(S)
    const month_where_clause = month ? `AND starts_month_events IN (${month})` : "";
    console.log('month where clause =', month_where_clause ? month_where_clause : "no where");

    return `
        -- year over year data for full year or by month by event type
        -- Main rows grouped by event_type and created_at_mtn
        SELECT
            "year_over_year_counts" AS label,
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,

            CASE 
                WHEN name_event_type LIKE "%missing%" THEN "missing" 
                ELSE name_event_type 
            END AS event_type,

            YEAR(CURDATE()) - 1 AS last_year,
            YEAR(CURDATE()) AS this_year,
            YEAR(CURDATE()) + 1 AS next_year,

            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) - 1 THEN id_sanctioning_events END) AS sanction_count_last_year,
            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) THEN id_sanctioning_events END) AS sanction_count_this_year,
            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) + 1 THEN id_sanctioning_events END) AS sanction_count_next_year,

            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) THEN id_sanctioning_events END) -
            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) - 1 THEN id_sanctioning_events END) AS difference_last_vs_this_year

        FROM event_data_metrics
        WHERE 1 = 1
            AND starts_year_events IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1, YEAR(CURDATE()) + 1)
            -- AND starts_month_events IN (5)
            ${month_where_clause}
            AND status_events NOT IN ('cancelled', 'declined', 'deleted')
        GROUP BY created_at_mtn, event_type

        UNION ALL

        -- Total rollup row (no grouping fields)
        SELECT
            "year_over_year_counts" AS label,
            NULL AS created_at_mtn,
            'TOTAL' AS event_type,

            YEAR(CURDATE()) - 1 AS last_year,
            YEAR(CURDATE()) AS this_year,
            YEAR(CURDATE()) + 1 AS next_year,

            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) - 1 THEN id_sanctioning_events END),
            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) THEN id_sanctioning_events END),
            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) + 1 THEN id_sanctioning_events END),

            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) THEN id_sanctioning_events END) -
            COUNT(DISTINCT CASE WHEN starts_year_events = YEAR(CURDATE()) - 1 THEN id_sanctioning_events END)

        FROM event_data_metrics
        WHERE 1 = 1
            AND starts_year_events IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1, YEAR(CURDATE()) + 1)
            -- AND starts_month_events IN (5)
            ${month_where_clause}
            AND status_events NOT IN ('cancelled', 'declined', 'deleted')

        ORDER BY created_at_mtn IS NULL,  -- places the TOTAL row at the bottom
        event_type
        ;
      `
}

async function query_last_7_days() {
    // C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_sanction_061025.sql

    return `
        -- last 7 days by event type
        -- Create a 7-day range using a derived table of numbers (0 to 6)

        WITH RECURSIVE date_range AS (
            SELECT CURDATE() - INTERVAL 7 DAY AS generated_date

            UNION ALL

            SELECT generated_date + INTERVAL 1 DAY
            FROM date_range
            WHERE generated_date + INTERVAL 1 DAY <= CURDATE()
        )

        SELECT
            "last_7_days" AS label,
            DATE_FORMAT(d.generated_date, '%Y-%m-%d') AS created_at_mtn,
            DATE_FORMAT(d.generated_date, '%a') AS created_weekday_abbr,  -- 3-letter weekday
            COALESCE(
                CASE 
                WHEN e.name_event_type LIKE "%missing%" THEN "missing" 
                WHEN e.name_event_type IS NOT NULL THEN e.name_event_type
                ELSE ""
                END, 'no_event'
            ) AS event_type,
            COUNT(e.id_sanctioning_events) AS count_total,
            COUNT(DISTINCT e.id_sanctioning_events) AS count_distinct_id_sanctioning_events

        FROM date_range d
            LEFT JOIN event_data_metrics e ON DATE(e.created_at_events) = d.generated_date
            AND e.status_events NOT IN ('cancelled', 'declined', 'deleted')
        GROUP BY d.generated_date, event_type
        ORDER BY d.generated_date DESC, event_type
        LIMIT 100
        ;
      `
}

async function query_last_10_created_events() {
    // C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_sanction_061025.sql

    return `
        -- last 10 created events by created date with event name, region, event start date

        SELECT
            "last_10_created_events",
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn,
            DATE_FORMAT(NOW(), '%Y-%m-%d') AS now_date_mtn,
            DATE_FORMAT(created_at_events, '%Y-%m-%d %H:%i:%s') AS created_at_events,
            -- id_sanctioning_events,
            SUBSTRING_INDEX(id_sanctioning_events, '-', 1) AS id_sanctioning_events, -- removed the event type used to get unique count
            TRIM(BOTH '"' FROM name_events) AS name_events,
            status_events,
            CASE WHEN name_event_type LIKE "%missing%" THEN "missing" ELSE name_event_type END name_event_type,
            name_distance_types,
            name_race_type,
            DATE_FORMAT(starts_events, '%Y-%m-%d') AS starts_events,
            state_code_events
        FROM event_data_metrics
        -- WHERE created_at_events >= NOW() - INTERVAL 3 DAY
        ORDER BY created_at_events DESC
        LIMIT 10
        ;
      `
}

async function execute_get_slack_events_stats(month) {
    runTimer('timer');
    const startTime = performance.now();
    
    const dst = await get_dst_connection();  // mysql2/promise connection

    let result_year_over_year = [];
    let result_last_7_days = [];
    let result_last_10_created_events = [];

    // If month is undefined/null, default to current month number (1-12) 
    // if (month === null || month === undefined) {
    //     const now = new Date();
    //     month = now.getMonth() + 1; // getMonth() returns 0-11, so add 1
    // }
    console.log('month =', month ? month : "no month given");

    try {
        // STEP 1: Determine if month passed is invalid; if month is not provided default to full year
        const month_invalid = (
            month !== undefined &&
            month !== null &&
            month !== '' &&
            (
                isNaN(Number(month)) ||
                Number(month) < 1 ||
                Number(month) > 12
            )
        );

        // STEP 2: Run query only if no invalid filters
        let data_year_over_year;
        if (!month_invalid) {
            [data_year_over_year] = await dst.query(await query_year_over_year_counts(month));
        } else {
            data_year_over_year = undefined;
        }

        // STEP 3: Run query only if no invalid filters
        let data_last_7_days;
        if (!month_invalid) {
            [data_last_7_days] = await dst.query(await query_last_7_days());
        } else {
            data_last_7_days = undefined;
        }

        // STEP 4: Run query only if no invalid filters
        let data_last_10_created_events;
        if (!month_invalid) {
            [data_last_10_created_events] = await dst.query(await query_last_10_created_events());
        } else {
            data_last_10_created_events = undefined;
        }

        // if (data_year_over_year && data_year_over_year.length > 0) {
        //     console.log('length =', data_year_over_year.length);
        //     const sample = data_year_over_year[0];
        //     console.log(`Sample row:`, sample);
        // } else {
        //     console.log('data_year_over_year is undefined or empty:', data_year_over_year);
        // }

        // STEP #3: CREATE SLACK MESSAGE (pass along array if undefined)
        result_year_over_year = (data_year_over_year !== undefined && data_year_over_year !== null) ? data_year_over_year : [];
        result_last_7_days = (data_last_7_days!== undefined && data_last_7_days !== null) ? data_last_7_days : [];
        result_last_10_created_events = (data_last_10_created_events !== undefined && data_last_10_created_events !== null) ? data_last_10_created_events : [];

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

        console.log(`\nAll sanction data queries executed successfully. Elapsed Time: ${elapsedTime ? elapsedTime : "Oops error getting time"} sec\n`);

        // return result;
        return { result_year_over_year, result_last_7_days, result_last_10_created_events };
    }
    
}

// async function test() {
    // const { create_slack_message } = require('./step_2a_create_slack_events_message');
    
//     month = "";    
//     // month = "7";
//     // month = "ten";

    // const { result_year_over_year, result_last_7_days, result_last_10_created_events } = await execute_get_slack_events_stats(month);
//     // console.log(result_year_over_year);
//     // console.log(result_last_7_days);
//     // console.log(result_last_10_created_events);

//     // let test = format_markdown_table_last_10_created_events(result_last_10_created_events);
//     // console.log(test);

//     const { slack_message, slack_blocks } = await create_slack_message(result_year_over_year, month, result_last_7_days, result_last_10_created_events);
//     console.log('message =', slack_message);

//     process.exit(1);
// }

// test();

module.exports = {
    execute_get_slack_events_stats,
}