// step_2b_load_zip_reference.js
// Builds zip_lat_lng_reference (ZIP -> lat/lng/city/state/county) directly from BigQuery's public
// dataset, then batch-INSERTs it straight into MySQL (no CSV, no file path). Refreshes on every run, so
// new ZIPs appear automatically. Mirrors step_2a_load_region_table structure (connection/helper/main/exports)
// but swaps the CSV LOAD for a BigQuery pull + direct multi-row INSERT.

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { BigQuery } = require('@google-cloud/bigquery');

const { getCurrentDateTime } = require('../../utilities/getCurrentDate');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { query_drop_table } = require('../queries/create_drop_db_table/queries_drop_db_tables');
const { query_create_zip_reference_table } = require('../queries/create_drop_db_table/query_create_zip_reference_table');

// Connect to MySQL (mirrors step_2a_load_region_table).
async function create_connection() {
    console.log('create connection');
    try {
        const config_details = await local_usat_sales_db_config();
        const pool = create_local_db_connection(config_details);
        return (pool);
    } catch (error) {
        console.log(`Error connecting: ${error}`);
    }
}

// EXECUTE MYSQL WORKING QUERY (USE db; then query). `values` supports the bulk INSERT (VALUES ?).
async function execute_mysql_working_query(pool, db_name, query, values) {
    const startTime = performance.now();

    return new Promise((resolve, reject) => {
        pool.query(`USE ${db_name};`, () => {
            pool.query({ sql: query, values: values }, (queryError, results) => {
                const elapsedTime = ((performance.now() - startTime) / 1_000).toFixed(2);
                if (queryError) {
                    console.error('Error executing query:', queryError);
                    reject(queryError);
                } else {
                    resolve(results);
                }
            });
        });
    });
}

// Pull US ZIP centroids from BigQuery's public dataset (same client/creds as the google_cloud steps).
async function get_zip_rows_from_bigquery() {
    const bigqueryClient = new BigQuery({ credentials: JSON.parse(process.env.USAT_GOOGLE_SERVICE_ACCOUNT) });
    const sql = `
        SELECT
            zip_code,
            ROUND(internal_point_lat, 6) AS lat,
            ROUND(internal_point_lon, 6) AS lng,
            city,
            state_code,
            county
        FROM \`bigquery-public-data.geo_us_boundaries.zip_codes\`
        WHERE zip_code IS NOT NULL
        ORDER BY zip_code
    `;
    const [rows] = await bigqueryClient.query({ query: sql, location: 'US' });
    // Shape into ordered value arrays for the bulk INSERT.
    return rows.map((r) => [r.zip_code, r.lat, r.lng, r.city, r.state_code, r.county]);
}

// Main: drop + create zip_lat_lng_reference, pull from BigQuery, batch-INSERT directly.
async function execute_load_zip_reference() {
    let pool;
    const startTime = performance.now();

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();
        const db_name = `usat_sales_db`;
        const table_name = `zip_lat_lng_reference`;

        // STEP #1: DROP + CREATE TABLE
        console.log(`STEP #1: DROP + CREATE ${table_name}`);
        await execute_mysql_working_query(pool, db_name, await query_drop_table(table_name));
        await execute_mysql_working_query(pool, db_name, await query_create_zip_reference_table(table_name));

        // STEP #2: PULL ZIP CENTROIDS FROM BIGQUERY
        console.log(`STEP #2: GET ZIP CENTROIDS FROM BIGQUERY ${getCurrentDateTime()}`);
        runTimer('bigquery_zip');
        const rows = await get_zip_rows_from_bigquery();
        stopTimer('bigquery_zip');
        console.log(`Fetched ${rows.length} zip rows from BigQuery`);

        // STEP #3: BATCH INSERT DIRECTLY (no CSV, no file path)
        const batch_size = 5000;
        let rows_added = 0;
        const insert_query = `INSERT INTO ${table_name} (zip5, lat, lng, city, state_code, county) VALUES ?`;

        for (let i = 0; i < rows.length; i += batch_size) {
            const batch = rows.slice(i, i + batch_size);
            const results = await execute_mysql_working_query(pool, db_name, insert_query, [batch]);
            rows_added += parseInt(results.affectedRows || batch.length);
            console.log(`Inserted ${rows_added} of ${rows.length}`);
        }

        // STEP #4: Log results
        console.log('STEP #4: All queries executed successfully. Rows added =', rows_added);

    } catch (error) {
        console.log('STEP: All queries NOT executed successfully.');
        console.error('Error:', error);

    } finally {
        // STEP #5: CLOSE CONNECTION/POOL
        await pool.end(err => {
            if (err) console.error('Error closing connection pool:', err.message);
            else console.log('Connection pool closed successfully.');
        });

        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        console.log(`\nTIME LOG. Elapsed Time: ${elapsedTime ? elapsedTime : "Opps error getting time"} sec\n`);

        return elapsedTime;
    }
}

// execute_load_zip_reference();

if (require.main === module) {
  execute_load_zip_reference().catch((error) => {
    console.error("error creating participation summary:", error);
    process.exitCode = 1;
  });
}

module.exports = {
    execute_load_zip_reference,
};