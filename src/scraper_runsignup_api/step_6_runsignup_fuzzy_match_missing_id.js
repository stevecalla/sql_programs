/**
 * QUERY: C:\Users\calla\development\usat\sql_code\29_runsignup_api\discovery_runsignup_usat_id_vs_fuzzy_match_usat_id_041226.sql
 * C:\Users\calla\development\usat\sql_programs\src\scraper_runsignup_api\step_4_runsignup_affliate_url.js
 *
 * Create a local MySQL table of RunSignup registration URL logic
 * using the USAT fuzzy-match-driven criteria.
 */

const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });

const mysqlP = require("mysql2/promise");
const { local_usat_sales_db_config } = require("../../utilities/config");
const { runTimer, stopTimer } = require("../../utilities/timer");

const affiliate_token = process.env.RUNSIGNUP_AFFILIATE_TOKEN;
const { create_runsignup_match_data, runsignup_add_indexes } = require("../queries/runsignup_api/create_runsignup_match_data");

async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function create_target_table(dst, TABLE_NAME, where_statement, affiliate_token) {
  await dst.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);

  const query = await create_runsignup_match_data(TABLE_NAME, where_statement, affiliate_token);
  await dst.execute(query);
}

async function main() {
  const TABLE_NAME = "all_runsignup_data_raw_missing_id";
  const where_statement = `
          -- USING USAT FUZZY MATCH AGAINST RUNSIGNUP TO MATCH RACES / EVENTS
          AND usat_sanction_id_internal IS NOT NULL
          AND rd.match_score_internal >= 74
  `;

  const dst = await get_dst_connection();
  dst.on("error", (err) => {
    console.error("⚠️ MySQL destination connection error:", err);
  });

  runTimer("timer");
  let result = "Step 6 Failed";

  try {
    await dst.beginTransaction();

    console.log(`Creating table: ${TABLE_NAME}`);
    await create_target_table(dst, TABLE_NAME, where_statement, affiliate_token);

    console.log(`Adding indexes: ${TABLE_NAME}`);
    await runsignup_add_indexes(dst, TABLE_NAME);

    const [[summary]] = await dst.execute(`
      SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT race_id) AS total_distinct_race_ids
      FROM \`${TABLE_NAME}\`
    `);

    await dst.commit();

    console.log(`Step 6 complete: ${TABLE_NAME}`);
    console.log(`Rows: ${summary.total_rows}`);
    console.log(`Distinct race_ids: ${summary.total_distinct_race_ids}`);

    result = "Step 6 Successful";
  } catch (err) {
    await dst.rollback();
    console.error("Step 6 failed, rolled back transaction:", err);
    throw err;
  } finally {
    try {
      await dst.end();
      console.log("✅ Destination DB connection closed.");
    } catch (closeErr) {
      console.warn("Error during cleanup:", closeErr);
    }

    stopTimer("timer");
  }

  return result;
}

if (require.main === module) {
  console.log("\nStarting step 6 load.");
  main().catch((error) => {
    console.error("Error during step 6 load:", error);
    process.exit(1);
  });
}

module.exports = {
  execute_step_6_runsignup_fuzzy_match_missing_id: main,
};