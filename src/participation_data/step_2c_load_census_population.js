// step_2c_load_census_population.js
// Builds census_state_population (state_code -> population) and batch-INSERTs it into MySQL.
//   PRIMARY source: the US Census Bureau API (ACS 1-year total population) — the most CURRENT data.
//                   Auto-detects the newest year the API serves (probes this-year-1 downward). Needs a
//                   free key in CENSUS_API_KEY (sign up: https://api.census.gov/data/key_signup.html).
//   FALLBACK:       BigQuery's public census dataset (bigquery-public-data.census_bureau_acs), which is
//                   frozen at 2021. Used automatically when CENSUS_API_KEY is missing or the API is down.
// Refreshes on every run. Mirrors step_2b_load_zip_reference structure (connection/helper/main/exports).
// Powers the per-capita / penetration metrics in the reporting app.

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { BigQuery } = require('@google-cloud/bigquery');

const { getCurrentDateTime } = require('../../utilities/getCurrentDate');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { local_usat_sales_db_config } = require('../../utilities/config');
const { create_local_db_connection } = require('../../utilities/connectionLocalDB');

const { query_drop_table } = require('../queries/create_drop_db_table/queries_drop_db_tables');
const { query_create_census_population_table } = require('../queries/create_drop_db_table/query_create_census_population_table');

// FIPS state code -> USPS abbreviation (50 states + DC + PR). Maps the Census API's numeric state code
// to the state_code the app / region_data use. (GU/VI/AS/MP are not in ACS, so they simply won't load.)
const FIPS_TO_ABBR = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR',
};

// Connect to MySQL (mirrors step_2b_load_zip_reference).
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

// PRIMARY: US Census Bureau API — ACS 1-year Sex-by-Age (table B01001). We pull the total plus the five
// under-20 male + five under-20 female brackets so we can split population at age 20 to match the app's
// adult (20+) / youth (under-20) athlete definitions:
//   B01001_001E = total; male under-20 = _003E.._007E (<5, 5-9, 10-14, 15-17, 18-19);
//   female under-20 = _027E.._031E. adult(20+) = total − under20; youth = under20.
// Auto-detects the newest vintage by probing from (this year - 1) downward. Returns
// [state, name, total, adult, youth, source] rows, or null to signal "use the BigQuery fallback".
async function get_population_from_census_api() {
    const key = process.env.CENSUS_API_KEY;
    if (!key) { console.log('No CENSUS_API_KEY set — skipping Census API, using BigQuery fallback.'); return null; }
    if (typeof fetch !== 'function') { console.log('global fetch unavailable (Node < 18) — using BigQuery fallback.'); return null; }

    const U20 = 'B01001_003E,B01001_004E,B01001_005E,B01001_006E,B01001_007E,B01001_027E,B01001_028E,B01001_029E,B01001_030E,B01001_031E';
    const thisYear = new Date().getFullYear();
    for (let y = thisYear - 1; y >= thisYear - 4; y--) {
        // https://api.census.gov/data/${y}/acs/acs1?get=NAME,B01001_001E,<under-20 brackets>&for=state:*&key=<key>
        const url = `https://api.census.gov/data/${y}/acs/acs1?get=NAME,B01001_001E,${U20}&for=state:*&key=${key}`;
        try {
            const res = await fetch(url);
            if (!res.ok) continue;                                   // year not published yet -> try older
            const data = await res.json();                           // [["NAME","B01001_001E",...,"state"], ...rows]
            if (!Array.isArray(data) || data.length < 2) continue;
            const source = `US Census ACS 1-yr ${y} B01001 (api.census.gov)`;
            const rows = data.slice(1).map((r) => {
                const name = r[0], total = Number(r[1]);
                let under20 = 0;
                for (let k = 2; k <= 11; k++) under20 += Number(r[k]) || 0;   // 10 under-20 brackets
                const fips = r[r.length - 1], st = FIPS_TO_ABBR[fips];
                const adult = total - under20;
                return st ? [st, name, total, adult, under20, source] : null;
            }).filter(Boolean);
            if (rows.length >= 50) { console.log(`Census API: ACS 1-year ${y} (B01001, age-split at 20) — ${rows.length} states`); return rows; }
        } catch (e) { /* network/parse issue for this year — try the previous year */ }
    }
    console.log('Census API returned no usable ACS 1-year vintage — using BigQuery fallback.');
    return null;
}

// FALLBACK: BigQuery public census (frozen at 2021). Auto-detects the newest state_*_1yr table available.
// The CAST join fixes the leading-zero FIPS codes (e.g. '06' California) that a plain string join drops.
async function get_population_rows_from_bigquery() {
    const bigqueryClient = new BigQuery({ credentials: JSON.parse(process.env.USAT_GOOGLE_SERVICE_ACCOUNT) });

    const [tbls] = await bigqueryClient.query({
        query: `
            SELECT table_name
            FROM \`bigquery-public-data.census_bureau_acs.INFORMATION_SCHEMA.TABLES\`
            WHERE REGEXP_CONTAINS(table_name, r'^state_[0-9]{4}_1yr$')
            ORDER BY table_name DESC
            LIMIT 1
        `,
        location: 'US',
    });
    const latest = (tbls[0] && tbls[0].table_name) || 'state_2021_1yr';
    const source = `US Census ACS 1-yr (bigquery-public-data.census_bureau_acs.${latest})`;
    console.log(`BigQuery fallback — latest ACS 1-year state table: ${latest}`);

    const sql = `
        SELECT
            f.state_postal_abbreviation AS state_code,
            f.state_name                AS state_name,
            p.total_pop                 AS population,
            '${source}'                 AS source
        FROM \`bigquery-public-data.census_bureau_acs.${latest}\` p
        JOIN \`bigquery-public-data.census_utility.fips_codes_states\` f
          ON CAST(p.geo_id AS INT64) = CAST(f.state_fips_code AS INT64)
        WHERE f.state_postal_abbreviation IS NOT NULL
        ORDER BY population DESC
    `;
    const [rows] = await bigqueryClient.query({ query: sql, location: 'US' });
    // Fallback carries total only; adult/youth are null (the app then uses total population as the denominator).
    return rows.map((r) => [r.state_code, r.state_name, r.population, null, null, r.source]);
}

// Main: drop + create census_state_population, pull population (Census API primary, BigQuery fallback),
// batch-INSERT directly.
async function execute_load_census_population() {
    let pool;
    const startTime = performance.now();

    try {
        // STEP #0: CREATE CONNECTION
        pool = await create_connection();
        const db_name = `usat_sales_db`;
        const table_name = `census_state_population`;

        // STEP #1: DROP + CREATE TABLE
        console.log(`STEP #1: DROP + CREATE ${table_name}`);
        await execute_mysql_working_query(pool, db_name, await query_drop_table(table_name));
        await execute_mysql_working_query(pool, db_name, await query_create_census_population_table(table_name));

        // STEP #2: GET STATE POPULATION — Census API primary (most current), BigQuery fallback
        console.log(`STEP #2: GET STATE POPULATION ${getCurrentDateTime()}`);
        runTimer('census_population');
        let rows = await get_population_from_census_api();
        if (!rows) rows = await get_population_rows_from_bigquery();
        stopTimer('census_population');
        console.log(`Fetched ${rows.length} state population rows`);

        // STEP #3: BATCH INSERT DIRECTLY (no CSV, no file path)
        const batch_size = 5000;
        let rows_added = 0;
        const insert_query = `INSERT INTO ${table_name} (state_code, state_name, population, population_adult, population_youth, source) VALUES ?`;

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

// execute_load_census_population();

if (require.main === module) {
  execute_load_census_population().catch((error) => {
    console.error("error loading census population:", error);
    process.exitCode = 1;
  });
}

module.exports = {
    execute_load_census_population,
};
