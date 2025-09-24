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

async function query_sanction_vs_participation_detail(month) {
    // C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_participation_event_details_062425.sql
    return `
        -- SET @match_month = 4;

        WITH participant_events AS (
            SELECT
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn,
                id_sanctioning_events,
                GROUP_CONCAT(DISTINCT(start_date_month_races)) AS month_label,
                GROUP_CONCAT(DISTINCT(start_date_races)) AS start_date_races
            FROM participation_race_profiles
            WHERE 1 = 1
                AND start_date_year_races = YEAR(CURDATE())
                --  start_date_month_races <= MONTH(CURDATE())
                AND LOWER(name_event_type) IN ('adult race', 'youth race')
            GROUP BY 
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d'), id_sanctioning_events
        )
        -- SELECT * FROM participant_events;
        -- SELECT id_sanctioning_events, FORMAT(COUNT(*), 0) FROM participant_events GROUP BY 1;
        -- SELECT month_label, FORMAT(COUNT(DISTINCT(id_sanctioning_events)), 0) FROM participant_events GROUP BY 1 ORDER BY 1;

        , sanctioned_events AS (
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
            )
        -- SELECT * FROM sanctioned_events ORDER BY month_label ASC;
        -- SELECT month_label, FORMAT(COUNT(DISTINCT(id_sanctioning_events)), 0) FROM sanctioned_events GROUP BY 1 ORDER BY 1;

        , sanctioned_events_with_reported_flag AS ( 
            SELECT   
                ROW_NUMBER() OVER (ORDER BY s.id_sanctioning_short ASC) AS row_num,  -- row numbering

                s.id_sanctioning_short                      AS s_id_sanctioning_short,
                GROUP_CONCAT(s.id_sanctioning_events ORDER BY s.id_sanctioning_events ASC) AS s_id_sanctioning_events,
                -- s.id_sanctioning_events          	    AS s_id_sanctioning_events,
                -- GROUP_CONCAT(s.id_sanctioning_events) AS s_id_sanctioning_events,

                TRIM(BOTH '"' FROM TRIM(BOTH '''' FROM name_events)) AS s_name_events,
                
                s.starts_events                AS s_starts_events,
                s.month_label                  AS s_month_label,
                s.state_code_events            AS s_state_code_events,

                p.id_sanctioning_events        AS p_id_sanctioning_events,
                p.month_label             	   AS p_month_label,
                p.start_date_races             AS p_start_date_races,
                
                CASE
                    WHEN p.id_sanctioning_events IS NOT NULL THEN '✅ Reported'
                    ELSE '❌ Not Reported'
                END AS reported_flag,
                
                s.created_at_mtn               AS s_created_at_mtn,
                COUNT(*) OVER () AS row_count   -- ✅ adds row count at the first column 
                -- COUNT(DISTINCT(s.id_sanctioning_events)) AS total_sanctioned

            FROM sanctioned_events AS s
                LEFT JOIN participant_events AS p ON p.id_sanctioning_events = s.id_sanctioning_short
            WHERE 1 = 1
                -- AND s.month_label = @match_month
                AND s.month_label = ${month}
            GROUP BY 2, 4, 5, 6, 7, 8, 9, 10, 11, 12
            HAVING 1 = 1 
                AND reported_flag = '❌ Not Reported'
            ORDER BY 1 ASC
            ) 
            SELECT * FROM sanctioned_events_with_reported_flag AS s ORDER BY s.s_month_label, s.s_id_sanctioning_events

            -- all below is commented out to ensure only one array of results is returned
            -- ;

            -- COUNTS ARE OFF SLIGHTY FROM THE discovery_partication_061225 b/c
            -- participation event id is counted once / distinct in the participation events query but
            -- can be applied to multiple id_sanctioning_events in the sanctioning events query
            -- i think i can align the queries by group concat in the participation query
            -- 310734 id sanctioning events is an issue b/c it has race start date in 2/25 & 3/25 (asked Sam to fix)

            -- COUNTS ARE OFF SLIGHTY FROM THE discovery_partication_061225 b/c
            -- participation event id is counted once / distinct in the participation events query but
            -- can be applied to multiple id_sanctioning_events in the sanctioning events query
            -- i think i can align the queries by group concat in the participation query
            -- 310734 id sanctioning events is an issue b/c it has race start date in 2/25 & 3/25 (asked Sam to fix)

            -- SELECT s_id_sanctioning_short, GROUP_CONCAT(reported_flag), FORMAT(COUNT(*), 0) FROM sanctioned_events_with_reported_flag AS s GROUP BY 1;

            -- SELECT
            --     s.s_month_label,
            --     COUNT(DISTINCT s.p_id_sanctioning_events) AS total_reported,
            --     COUNT(DISTINCT s.s_id_sanctioning_events) - COUNT(DISTINCT s.p_id_sanctioning_events) AS count_not_reported,
            --     COUNT(DISTINCT(s.s_id_sanctioning_events)) AS total_sanctioned
            -- FROM sanctioned_events_with_reported_flag s
            -- GROUP BY s.s_month_label
            -- HAVING total_reported > 0
            -- ORDER BY s.s_month_label
        -- ;
      `
}

async function execute_get_sanction_vs_participation_detail() {
    runTimer('timer');
    const startTime = performance.now();
    
    const dst = await get_dst_connection();  // mysql2/promise connection

    let result_sanction_vs_participation_detail = [];

    try {
        // STEP 1: No need for month / input variable validation

        // STEP 2: Run query only if no invalid filters
        let month = 4;
        let [ result ] = await dst.query(await query_sanction_vs_participation_detail(month));
        console.log(result);

        // if (data_year_over_year && data_sanctioned_vs_participation.length > 0) {
        //     console.log('length =', data_year_over_year.length);
        //     const sample = data_year_over_year[0];
        //     console.log(`Sample row:`, sample);
        // } else {
        //     console.log('data_year_over_year is undefined or empty:', data_year_over_year);
        // }

        // STEP #3: CREATE SLACK MESSAGE (pass along array if undefined)
        // result_year_over_year = (data_year_over_year !== undefined && data_year_over_year !== null) ? data_year_over_year : [];
        // result_sanctioned_vs_participation = (data_sanctioned_vs_participation!== undefined && data_sanctioned_vs_participation !== null) ? data_sanctioned_vs_participation : [];
        
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
        return { result_sanction_vs_participation_detail };
    }
    
}

async function test() {
    // GET SANCTION VS PARTICIPATION DETAIL BY EVENT
    const { result_sanction_vs_participation_detail } = await execute_get_sanction_vs_participation_detail();
    console.log( result_sanction_vs_participation_detail );
    
    
    // SEND SLACK MESSAGE WITH RESULTS
    // const { create_slack_message } = require('./step_3a_create_slack_participation_message');
    // const { slack_message, slack_blocks } = await create_slack_message(result_year_over_year, result_sanctioned_vs_participation);
    // console.log('message =', slack_message);

    // CREATE SERVER
    // SCHEDULED REPORT
    // AD HOC REPORT: Month, Event types, All

    process.exit(1);
}

test();

module.exports = {
    execute_get_sanction_vs_participation_detail,
}