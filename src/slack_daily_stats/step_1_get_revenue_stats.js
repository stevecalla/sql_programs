const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP                                  = require('mysql2/promise');   // only for dst.execute
const { local_usat_sales_db_config }          = require('../../utilities/config');
const { runTimer, stopTimer }                 = require('../../utilities/timer');

const { type_map, category_map} = require('./utilities/product_mapping');

// Connect to MySQL
async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function query_revenue(type_list, category_list) {
    // source: C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_revenue_052225.sql
    
    console.log('type =', type_list, 'category =', category_list);

    // BUILD WHERE CLAUSE(S)
    const type_where_clause = type_list ? `AND type_actual = "${type_list}"` : "";
    console.log('type where clause =', type_where_clause);
    
    // Safely quote each category
    const category_list_formatted = category_list?.map ? category_list?.map(c => `'${c}'`).join(", ") : `'${category_list}'`;
    const category_where_clause = category_list?.length ? `AND category_actual IN (${category_list_formatted})` : "";
    console.log('category where clause =', category_where_clause);

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
    
    const dst = await get_dst_connection();  // mysql2/promise connection

    let result = [];

    // If month is undefined/null, default to current month number (1-12) 
    if (month === null || month === undefined) {
        const now = new Date();
        month = now.getMonth() + 1; // getMonth() returns 0-11, so add 1
    }
    console.log('type =', type, 'category =', category, 'month =', month);

    try {
        // STEP 1: Resolve type and category filters
        const type_list = type_map[type];
        const category_list = category_map[category];

        // STEP 2: Determine if values were passed but invalid
        const type_invalid = type !== undefined && type_list === undefined;
        const category_invalid = category !== undefined && category_list === undefined;

        // STEP 3: Run query only if no invalid filters
        let data;
        if (!type_invalid && !category_invalid) {
            [data] = await dst.query(await query_revenue(type_list, category_list));
        } else {
            data = undefined;
        }

        // if (data && data.length > 0) {
        //     console.log('length =', data.length);
        //     const sample = data[0];
        //     console.log(`Sample row:`, sample);
        // } else {
        //     console.log('data is undefined or empty:', data);
        // }

        // STEP #3: CREATE SLACK MESSAGE (pass along array if undefined)
        result = (data !== undefined && data !== null) ? data : [];

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

// async function test() {
//     const { create_slack_message } = require('./step_1a_create_revenue_message');
    
//     const type = "adult"; const category = undefined; let month; // result full table
//     // const type = undefined; const category = undefined; const month = 3; // result full table
//     // const type = undefined; const category = undefined; let month; // result full table
//     // const type = "adult"; const category = undefined; const month = "ytd"; // result full table

//     // const type = "invalid input"; const category = undefined; const month = 3; // result = error message
//     // const type = "invalid input"; const category = undefined; const month = "ytd"; // result = empty table
//     // const type = undefined; const category = "invalid input"; const month = "ytd"; // result = empty table

//     const result = await execute_get_revenue_stats(type, category, month);
//     const { slack_message, slack_blocks } = await create_slack_message(result, type, category, month);

//     console.log('message =', slack_message);

//     process.exit(1);
// }

// test();

module.exports = {
    execute_get_revenue_stats,
}