const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP                                  = require('mysql2/promise');   // only for dst.execute
const { local_usat_sales_db_config }          = require('../../utilities/config');
const { runTimer, stopTimer }                 = require('../../utilities/timer');

const { type_map, category_map} = require('./utilities/product_mapping');
const { create_slack_message } = require('./step_1a_create_revenue_message');

// Connect to MySQL
async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function query_revenue(type, category) {
    
    console.log('type =', type, 'category =', category);

    // BUILD WHERE CLAUSE(S)
    const type_where_clause = type ? `AND type_actual = "${type}"` : "";
    
    // Safely quote each category
    const category_list = category?.map ? category?.map(c => `'${c}'`).join(", ") : `'${category}'`;
    const category_where_clause = category?.length ? `AND category_actual IN (${category_list})` : "";

    return `
        WITH monthly_agg AS (
            SELECT 
                month_actual,
                is_year_to_date,
                is_current_month,
                0 AS is_ytd_row,
                created_at_mtn,

                -- 2025 GOAL
                SUM(sales_rev_2025_goal) AS sales_rev_2025_goal,
                SUM(sales_units_2025_goal) AS sales_units_2025_goal,
                NULLIF(SUM(sales_rev_2025_goal), 0) / NULLIF(SUM(sales_units_2025_goal), 0) AS sales_rpu_2025_goal,

                -- 2024 GOAL
                SUM(sales_rev_2024_goal) AS sales_rev_2024_goal,
                SUM(sales_units_2024_goal) AS sales_units_2024_goal,
                NULLIF(SUM(sales_rev_2024_goal), 0) / NULLIF(SUM(sales_units_2024_goal), 0) AS sales_rpu_2024_goal,

                -- 2025 ACTUAL
                SUM(sales_rev_2025_actual) AS sales_rev_2025_actual,
                SUM(sales_units_2025_actual) AS sales_units_2025_actual,
                NULLIF(SUM(sales_rev_2025_actual), 0) / NULLIF(SUM(sales_units_2025_actual), 0) AS sales_rpu_2025_actual,

                -- 2024 ACTUAL
                SUM(sales_rev_2024_actual) AS sales_rev_2024_actual,
                SUM(sales_units_2024_actual) AS sales_units_2024_actual,
                NULLIF(SUM(sales_rev_2024_actual), 0) / NULLIF(SUM(sales_units_2024_actual), 0) AS sales_rpu_2024_actual
            FROM sales_data_actual_v_goal
            WHERE 1 = 1
                AND is_year_to_date
                ${type_where_clause}
                ${category_where_clause}
            GROUP BY month_actual, is_year_to_date, is_current_month, created_at_mtn
        ),

        -- Then, the YTD totals row
        ytd_agg AS (
            SELECT 
                NULL AS month_actual,
                0 AS is_year_to_date,
                0 AS is_current_month,
                1 AS is_ytd_row,
                null AS created_at_mtn,

                -- 2025 GOAL
                SUM(sales_rev_2025_goal) AS sales_rev_2025_goal,
                SUM(sales_units_2025_goal) AS sales_units_2025_goal,
                NULLIF(SUM(sales_rev_2025_goal), 0) / NULLIF(SUM(sales_units_2025_goal), 0) AS sales_rpu_2025_goal,

                -- 2024 GOAL
                SUM(sales_rev_2024_goal) AS sales_rev_2024_goal,
                SUM(sales_units_2024_goal) AS sales_units_2024_goal,
                NULLIF(SUM(sales_rev_2024_goal), 0) / NULLIF(SUM(sales_units_2024_goal), 0) AS sales_rpu_2024_goal,

                -- 2025 ACTUAL
                SUM(sales_rev_2025_actual) AS sales_rev_2025_actual,
                SUM(sales_units_2025_actual) AS sales_units_2025_actual,
                NULLIF(SUM(sales_rev_2025_actual), 0) / NULLIF(SUM(sales_units_2025_actual), 0) AS sales_rpu_2025_actual,

                -- 2024 ACTUAL
                SUM(sales_rev_2024_actual) AS sales_rev_2024_actual,
                SUM(sales_units_2024_actual) AS sales_units_2024_actual,
                NULLIF(SUM(sales_rev_2024_actual), 0) / NULLIF(SUM(sales_units_2024_actual), 0) AS sales_rpu_2024_actual

            FROM sales_data_actual_v_goal
            WHERE 1 = 1
                AND is_current_month = 0 AND is_year_to_date = 1
                ${type_where_clause}
                ${category_where_clause}
        )

        -- Final unified query with diffs
        SELECT 
            *,
            
            -- ABS DIFFS: GOAL VS 2024 GOAL
            sales_rev_2025_goal - sales_rev_2024_goal AS abs_diff_rev_goal_vs_2024_goal,
            sales_units_2025_goal - sales_units_2024_goal AS abs_diff_units_goal_vs_2024_goal,
            sales_rpu_2025_goal - sales_rpu_2024_goal AS abs_diff_rpu_goal_vs_2024_goal,

            -- % DIFFS: GOAL VS 2024 GOAL
            (sales_rev_2025_goal - sales_rev_2024_goal) / NULLIF(sales_rev_2024_goal, 0) * 100 AS pct_diff_rev_goal_vs_2024_goal,
            (sales_units_2025_goal - sales_units_2024_goal) / NULLIF(sales_units_2024_goal, 0) * 100 AS pct_diff_units_goal_vs_2024_goal,
            (sales_rpu_2025_goal - sales_rpu_2024_goal) / NULLIF(sales_rpu_2024_goal, 0) * 100 AS pct_diff_rpu_goal_vs_2024_goal,
            
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

async function execute_get_revenue_stats(type, category, month) {
    runTimer('timer');
    const startTime = performance.now();

    let result = "Error - No results";

    const dst = await get_dst_connection();  // mysql2/promise connection
    
    try {
        // STEP #1: CONVERT TYPE & CATEGORY INPUT INTO LIST OF TYPES OR CATEGORIES
        const type_list = type_map[type] ? type_map[type] : type;
        const category_list = category_map[category] ? category_map[category] : category;

        // STEP #2: GET REVENUE DATA
        const [data] = await dst.query(await query_revenue(type_list, category_list));

        // for (const { name, data } of result) {
        //   if (!data.length) {
        //     console.warn(`No data returned from ${name} query`);
        //   } else {
        //     const sample = data[0];
        //     console.log(`${name} - Available keys:`, Object.keys(sample));
        //     console.log(`${name} - Sample row:`, sample);
        //   }
        // }
      
        // STEP #3: CREATE SLACK MESSAGE
        if (data) {
            result = data;
        } 

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

        console.log(`\nAll revenue data queries executed successfully. Elapsed Time: ${elapsedTime ? elapsedTime : "Oops error getting time"} sec\n`);

        return result;
    }
    
}

// Run the main function
// execute_step_1_create_send_revenue_stats().catch(err => {
//     console.error('Stream failed:', err);
//     process.exit(1);
// });

module.exports = {
    execute_get_revenue_stats,
}