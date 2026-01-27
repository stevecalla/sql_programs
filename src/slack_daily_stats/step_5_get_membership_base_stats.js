const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP                                  = require('mysql2/promise');   // only for dst.execute
const { local_usat_sales_db_config }          = require('../../utilities/config');
const { runTimer, stopTimer }                 = require('../../utilities/timer');

const { create_slack_message } = require('./step_5a_create_membership_base_message');

// Connect to MySQL
async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function query_membership_base() {
    // C:\Users\calla\development\usat\sql_code\19_membership_base\discovery_base_membership_012226_slack_queries.sql

    return `
        WITH yearly AS (
            SELECT 
                year, 
                SUM(unique_profiles) AS unique_profiles,
                SUM(unique_profiles_sales_through_day_of_year) AS unique_profiles_sales_through_day_of_year,
                SUM(unique_profiles_sales_ytd) AS unique_profiles_sales_ytd
            FROM membership_base_data
            GROUP BY year
            )

            SELECT
            year,

            -- totals (formatted)
            FORMAT(unique_profiles, 0) AS unique_profiles,
            FORMAT(unique_profiles_sales_through_day_of_year, 0) AS unique_profiles_sales_through_day_of_year,
            FORMAT(unique_profiles_sales_ytd, 0) AS unique_profiles_sales_ytd,

            -- YoY absolute change (formatted)
            FORMAT(
                unique_profiles
                - LAG(unique_profiles) OVER (ORDER BY year),
                0
            ) AS yoy_unique_profiles_change,

            FORMAT(
                unique_profiles_sales_through_day_of_year
                - LAG(unique_profiles_sales_through_day_of_year) OVER (ORDER BY year),
                0
            ) AS yoy_sales_through_doy_change,

            FORMAT(
                unique_profiles_sales_ytd
                - LAG(unique_profiles_sales_ytd) OVER (ORDER BY year),
                0
            ) AS yoy_sales_ytd_change,

            -- YoY % change (1 decimal, percent)
            CONCAT(
                FORMAT(
                100 * (
                    unique_profiles
                    - LAG(unique_profiles) OVER (ORDER BY year)
                ) / NULLIF(LAG(unique_profiles) OVER (ORDER BY year), 0),
                1
                ),
                '%'
            ) AS yoy_unique_profiles_pct,

            CONCAT(
                FORMAT(
                100 * (
                    unique_profiles_sales_through_day_of_year
                    - LAG(unique_profiles_sales_through_day_of_year) OVER (ORDER BY year)
                ) / NULLIF(LAG(unique_profiles_sales_through_day_of_year) OVER (ORDER BY year), 0),
                1
                ),
                '%'
            ) AS yoy_sales_through_doy_pct,

            CONCAT(
                FORMAT(
                100 * (
                    unique_profiles_sales_ytd
                    - LAG(unique_profiles_sales_ytd) OVER (ORDER BY year)
                ) / NULLIF(LAG(unique_profiles_sales_ytd) OVER (ORDER BY year), 0),
                1
                ),
                '%'
            ) AS yoy_sales_ytd_pct

            FROM yearly
            ORDER BY year
        ;
      `
}

async function main(type, category, month) {
    runTimer('timer');
    const startTime = performance.now();
    
    const dst = await get_dst_connection();  // mysql2/promise connection

    try {
        // STEP 1: Run query
        const [data] = await dst.query(await query_membership_base());

        if (data && data.length > 0) {
            console.log('length =', data.length);
            const sample = data[11];
            console.log(`Sample row:`, sample);
        } else {
            console.log('data is undefined or empty:', data);
        }

        // STEP #3: CREATE SLACK MESSAGE (pass along array if undefined)
        result_by_year = (data !== undefined && data !== null) ? data : [];

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

        // FOR TESTING
        // await create_slack_message(result_by_year);

        return { result_by_year };
    }  
}

// if (require.main === module) {
//   main().catch(err => {
//     console.error(err);
//     process.exit(1);
//   });
// }

module.exports = {
    execute_get_membership_base_stats: main,
}