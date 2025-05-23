// const dotenv = require('dotenv');
// dotenv.config({ path: "../../.env" });

// const mysqlP                                  = require('mysql2/promise');   // only for dst.execute
// const { local_usat_sales_db_config }          = require('../../utilities/config');
// const { runTimer, stopTimer }                 = require('../../utilities/timer');

// // connection.js
// async function get_dst_connection() {
//   const cfg = await local_usat_sales_db_config();
//   return await mysqlP.createConnection(cfg);
// }

// async function query_revenue() {
//   return `
//     WITH monthly_agg AS (
//       SELECT 
//           month_actual,
//           is_year_to_date,
//           is_current_month,
//           0 AS is_ytd_row,
//           -- GOAL
//           SUM(sales_rev_2025_goal) AS sales_rev_2025_goal,
//           SUM(sales_units_2025_goal) AS sales_units_2025_goal,
//           NULLIF(SUM(sales_rev_2025_goal), 0) / NULLIF(SUM(sales_units_2025_goal), 0) AS sales_rpu_2025_goal,

//           -- 2025 ACTUAL
//           SUM(sales_rev_2025_actual) AS sales_rev_2025_actual,
//           SUM(sales_units_2025_actual) AS sales_units_2025_actual,
//           NULLIF(SUM(sales_rev_2025_actual), 0) / NULLIF(SUM(sales_units_2025_actual), 0) AS sales_rpu_2025_actual,

//           -- 2024 ACTUAL
//           SUM(sales_rev_2024_actual) AS sales_rev_2024_actual,
//           SUM(sales_units_2024_actual) AS sales_units_2024_actual,
//           NULLIF(SUM(sales_rev_2024_actual), 0) / NULLIF(SUM(sales_units_2024_actual), 0) AS sales_rpu_2024_actual
//       FROM sales_data_actual_v_goal
//       WHERE is_year_to_date
//       GROUP BY month_actual, is_year_to_date, is_current_month
//     ),

//       -- Then, the YTD totals row
//       ytd_agg AS (
//           SELECT 
//               NULL AS month_actual,
//               0 AS is_year_to_date,
//               0 AS is_current_month,
//               1 AS is_ytd_row,
//               -- GOAL
//               SUM(sales_rev_2025_goal) AS sales_rev_2025_goal,
//               SUM(sales_units_2025_goal) AS sales_units_2025_goal,
//               NULLIF(SUM(sales_rev_2025_goal), 0) / NULLIF(SUM(sales_units_2025_goal), 0) AS sales_rpu_2025_goal,

//               -- 2025 ACTUAL
//               SUM(sales_rev_2025_actual) AS sales_rev_2025_actual,
//               SUM(sales_units_2025_actual) AS sales_units_2025_actual,
//               NULLIF(SUM(sales_rev_2025_actual), 0) / NULLIF(SUM(sales_units_2025_actual), 0) AS sales_rpu_2025_actual,

//               -- 2024 ACTUAL
//               SUM(sales_rev_2024_actual) AS sales_rev_2024_actual,
//               SUM(sales_units_2024_actual) AS sales_units_2024_actual,
//               NULLIF(SUM(sales_rev_2024_actual), 0) / NULLIF(SUM(sales_units_2024_actual), 0) AS sales_rpu_2024_actual
//           FROM sales_data_actual_v_goal
//           WHERE is_current_month = 0 AND is_year_to_date = 1
//       )

//       -- Final unified query with diffs
//       SELECT 
//         *,
          
//           -- ABS DIFFS: GOAL VS 2025
//           sales_rev_2025_actual - sales_rev_2025_goal AS abs_diff_rev_goal_vs_2025_actual,
//           sales_units_2025_actual - sales_units_2025_goal AS abs_diff_units_goal_vs_2025_actual,
//           sales_rpu_2025_actual - sales_rpu_2025_goal AS abs_diff_rpu_goal_vs_2025_actual,

//           -- % DIFFS: GOAL VS 2025
//           (sales_rev_2025_actual - sales_rev_2025_goal) / NULLIF(sales_rev_2025_goal, 0) * 100 AS pct_diff_rev_goal_vs_2025_actual,
//           (sales_units_2025_actual - sales_units_2025_goal) / NULLIF(sales_units_2025_goal, 0) * 100 AS pct_diff_units_goal_vs_2025_actual,
//           (sales_rpu_2025_actual - sales_rpu_2025_goal) / NULLIF(sales_rpu_2025_goal, 0) * 100 AS pct_diff_rpu_goal_vs_2025_actual,

//           -- ABS DIFFS: 2025 VS 2024
//           sales_rev_2025_actual - sales_rev_2024_actual AS abs_diff_rev_2025_vs_2024_actual,
//           sales_units_2025_actual - sales_units_2024_actual AS abs_diff_units_2025_vs_2024_actual,
//           sales_rpu_2025_actual - sales_rpu_2024_actual AS abs_diff_rpu_2025_vs_2024_actual,

//           -- % DIFFS: 2025 VS 2024
//           (sales_rev_2025_actual - sales_rev_2024_actual) / NULLIF(sales_rev_2024_actual, 0) * 100 AS pct_diff_rev_2025_vs_2024_actual,
//           (sales_units_2025_actual - sales_units_2024_actual) / NULLIF(sales_units_2024_actual, 0) * 100 AS pct_diff_units_2025_vs_2024_actual,
//           (sales_rpu_2025_actual - sales_rpu_2024_actual) / NULLIF(sales_rpu_2024_actual, 0) * 100 AS pct_diff_rpu_2025_vs_2024_actual

//       FROM (
//           SELECT * FROM monthly_agg
//           UNION ALL
//           SELECT * FROM ytd_agg
//       ) AS combined_data
//       ORDER BY 
//           is_ytd_row ASC,
//           month_actual
//       ;
//     `
// }

// async function query_events() {
//   return `
//     SELECT "event-data" AS "table", r.* FROM sales_data_actual_v_goal AS r LIMIT 1;
//     ;
//   `
// }

// async function query_participation() {
//   return `
//     SELECT "participation-data" AS "table", r.* FROM sales_data_actual_v_goal AS r LIMIT 1;
//     ;
//   `
// }

// async function execute_step_1_get_slack_daily_stats() {
//   runTimer('timer');
  
//   let result = 'Transfer Failed';        // default if something blows up

//   const dst = await get_dst_connection();  // mysql2/promise connection

//   try {
//     const [revenue_rows] = await dst.query(await query_revenue());
//     // const [event_rows] = await dst.query(await query_events());
//     // const [participation_rows] = await dst.query(await query_participation());

//     const results = [
//       { name: 'Revenue', data: revenue_rows },
//       // { name: 'Events', data: event_rows },
//       // { name: 'Participation', data: participation_rows },
//     ];

//     // for (const { name, data } of results) {
//     //   if (!data.length) {
//     //     console.warn(`No data returned from ${name} query`);
//     //   } else {
//     //     const sample = data[0];
//     //     console.log(`${name} - Available keys:`, Object.keys(sample));
//     //     console.log(`${name} - Sample row:`, sample);
//     //   }
//     // }

//     result = 'Tranfer Successful';          // only set this if we got all the way through

//   } catch (err) {
//     console.error('Error during data queries:', err);
//     throw err;

//   } finally {
//     await dst.end();  // Properly close MySQL connection
//     stopTimer('timer');
//   }

// }

// // execute_step_1_get_slack_daily_stats().catch(err => {
// //     console.error('Stream failed:', err);
// //     process.exit(1);
// // });

// module.exports = {
//   execute_step_1_get_slack_daily_stats,
// };
