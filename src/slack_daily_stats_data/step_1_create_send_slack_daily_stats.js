const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP                                  = require('mysql2/promise');   // only for dst.execute
const { local_usat_sales_db_config }          = require('../../utilities/config');
const { runTimer, stopTimer }                 = require('../../utilities/timer');

const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');
// const { send_slack_followup_message } = require('../../utilities/slack_messaging/send_followup_message');
const { create_slack_sales_message } = require('./step_2_slack_sales_message');

// Connect to MySQL
async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function query_revenue() {
    return `
      WITH monthly_agg AS (
        SELECT 
            month_actual,
            is_year_to_date,
            is_current_month,
            0 AS is_ytd_row,
            -- GOAL
            SUM(sales_rev_2025_goal) AS sales_rev_2025_goal,
            SUM(sales_units_2025_goal) AS sales_units_2025_goal,
            NULLIF(SUM(sales_rev_2025_goal), 0) / NULLIF(SUM(sales_units_2025_goal), 0) AS sales_rpu_2025_goal,
  
            -- 2025 ACTUAL
            SUM(sales_rev_2025_actual) AS sales_rev_2025_actual,
            SUM(sales_units_2025_actual) AS sales_units_2025_actual,
            NULLIF(SUM(sales_rev_2025_actual), 0) / NULLIF(SUM(sales_units_2025_actual), 0) AS sales_rpu_2025_actual,
  
            -- 2024 ACTUAL
            SUM(sales_rev_2024_actual) AS sales_rev_2024_actual,
            SUM(sales_units_2024_actual) AS sales_units_2024_actual,
            NULLIF(SUM(sales_rev_2024_actual), 0) / NULLIF(SUM(sales_units_2024_actual), 0) AS sales_rpu_2024_actual
        FROM sales_data_actual_v_goal
        WHERE is_year_to_date
        GROUP BY month_actual, is_year_to_date, is_current_month
      ),
  
        -- Then, the YTD totals row
        ytd_agg AS (
            SELECT 
                NULL AS month_actual,
                0 AS is_year_to_date,
                0 AS is_current_month,
                1 AS is_ytd_row,
                -- GOAL
                SUM(sales_rev_2025_goal) AS sales_rev_2025_goal,
                SUM(sales_units_2025_goal) AS sales_units_2025_goal,
                NULLIF(SUM(sales_rev_2025_goal), 0) / NULLIF(SUM(sales_units_2025_goal), 0) AS sales_rpu_2025_goal,
  
                -- 2025 ACTUAL
                SUM(sales_rev_2025_actual) AS sales_rev_2025_actual,
                SUM(sales_units_2025_actual) AS sales_units_2025_actual,
                NULLIF(SUM(sales_rev_2025_actual), 0) / NULLIF(SUM(sales_units_2025_actual), 0) AS sales_rpu_2025_actual,
  
                -- 2024 ACTUAL
                SUM(sales_rev_2024_actual) AS sales_rev_2024_actual,
                SUM(sales_units_2024_actual) AS sales_units_2024_actual,
                NULLIF(SUM(sales_rev_2024_actual), 0) / NULLIF(SUM(sales_units_2024_actual), 0) AS sales_rpu_2024_actual
            FROM sales_data_actual_v_goal
            WHERE is_current_month = 0 AND is_year_to_date = 1
        )
  
        -- Final unified query with diffs
        SELECT 
          *,
            
            -- ABS DIFFS: GOAL VS 2025
            sales_rev_2025_actual - sales_rev_2025_goal AS abs_diff_rev_goal_vs_2025_actual,
            sales_units_2025_actual - sales_units_2025_goal AS abs_diff_units_goal_vs_2025_actual,
            sales_rpu_2025_actual - sales_rpu_2025_goal AS abs_diff_rpu_goal_vs_2025_actual,
  
            -- % DIFFS: GOAL VS 2025
            (sales_rev_2025_actual - sales_rev_2025_goal) / NULLIF(sales_rev_2025_goal, 0) * 100 AS pct_diff_rev_goal_vs_2025_actual,
            (sales_units_2025_actual - sales_units_2025_goal) / NULLIF(sales_units_2025_goal, 0) * 100 AS pct_diff_units_goal_vs_2025_actual,
            (sales_rpu_2025_actual - sales_rpu_2025_goal) / NULLIF(sales_rpu_2025_goal, 0) * 100 AS pct_diff_rpu_goal_vs_2025_actual,
  
            -- ABS DIFFS: 2025 VS 2024
            sales_rev_2025_actual - sales_rev_2024_actual AS abs_diff_rev_2025_vs_2024_actual,
            sales_units_2025_actual - sales_units_2024_actual AS abs_diff_units_2025_vs_2024_actual,
            sales_rpu_2025_actual - sales_rpu_2024_actual AS abs_diff_rpu_2025_vs_2024_actual,
  
            -- % DIFFS: 2025 VS 2024
            (sales_rev_2025_actual - sales_rev_2024_actual) / NULLIF(sales_rev_2024_actual, 0) * 100 AS pct_diff_rev_2025_vs_2024_actual,
            (sales_units_2025_actual - sales_units_2024_actual) / NULLIF(sales_units_2024_actual, 0) * 100 AS pct_diff_units_2025_vs_2024_actual,
            (sales_rpu_2025_actual - sales_rpu_2024_actual) / NULLIF(sales_rpu_2024_actual, 0) * 100 AS pct_diff_rpu_2025_vs_2024_actual
  
        FROM (
            SELECT * FROM monthly_agg
            UNION ALL
            SELECT * FROM ytd_agg
        ) AS combined_data
        ORDER BY 
            is_ytd_row ASC,
            month_actual
        ;
      `
  }
  
async function query_events() {
return `
    SELECT "event-data" AS "table", r.* FROM sales_data_actual_v_goal AS r LIMIT 1;
    ;
`
}

async function query_participation() {
return `
    SELECT "participation-data" AS "table", r.* FROM sales_data_actual_v_goal AS r LIMIT 1;
    ;
`
}

async function execute_step_1_create_send_daily_stats(is_cron_job = true, channel_id, channel_name, user_id) {
    runTimer('timer');
    const startTime = performance.now();
    
    let result = 'Transfer Failed';        // default if something blows up

    const dst = await get_dst_connection();  // mysql2/promise connection
    
    try {
        // STEP #1: GET DATA
        const [revenue_rows] = await dst.query(await query_revenue());
        // const [event_rows] = await dst.query(await query_events());
        // const [participation_rows] = await dst.query(await query_participation());

        const results = [
            { name: 'Revenue', data: revenue_rows },
            // { name: 'Events', data: event_rows },
            // { name: 'Participation', data: participation_rows },
          ];

        // for (const { name, data } of results) {
        //   if (!data.length) {
        //     console.warn(`No data returned from ${name} query`);
        //   } else {
        //     const sample = data[0];
        //     console.log(`${name} - Available keys:`, Object.keys(sample));
        //     console.log(`${name} - Sample row:`, sample);
        //   }
        // }
      
        // STEP #2: CREATE SLACK MESSAGE
        if (results) {
            // const slack_message = await create_slack_sales_message(results);
            // console.log('step_3_get_slack... =', slack_message);

            // STEP #4: SEND CRON SCHEDULED MESSAGE TO SLACK
            // ONLY EXECUTE IF is_cron_job is true

            // TESTING VARIABLE
            // const send_slack_to_calla = false;
            // console.log('send slack to calla =', send_slack_to_calla);
            // console.log('is cron = ', is_cron_job);

            // if (send_slack_to_calla && is_cron_job) {
            //     console.log('1 =', send_slack_to_calla, is_cron_job, send_slack_to_calla && is_cron_job);
            //     await slack_message_api(slack_message, "steve_calla_slack_channel");
            // } else if(is_cron_job) {
            //     console.log('2 =', send_slack_to_calla, is_cron_job, send_slack_to_calla && is_cron_job);
            //     await slack_message_api(slack_message, "daily_sales_bot_slack_channel");
            // } else {
            //     // Send a follow-up message to Slack
            //     await send_slack_followup_message(channel_id, channel_name, user_id, slack_message);
            // }
        } else {
            const slack_message = "Error - No results";
            // await slack_message_api(slack_message, "steve_calla_slack_channel");
        }

        result = 'Tranfer Successful';          // only set this if we got all the way through

        } catch (err) {
            console.error('Error during data queries:', err);

            const slack_message = `Error - No results: error`;
            // await slack_message_api(slack_message, "steve_calla_slack_channel");

            throw err;
    
        } finally {
            await dst.end();  // Properly close MySQL connection
            stopTimer('timer');

            // LOG RESULTS
            const endTime = performance.now();
            const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec

            console.log(`\nAll lead data queries executed successfully. Elapsed Time: ${elapsedTime ? elapsedTime : "Oops error getting time"} sec\n`);
    }
    
  return result;
}

// Run the main function
// execute_step_1_create_send_daily_stats().catch(err => {
//     console.error('Stream failed:', err);
//     process.exit(1);
// });

module.exports = {
    execute_step_1_create_send_daily_stats,
}