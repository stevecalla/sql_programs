// show_build_scope.js
// Prints the reporting data scope recorded by step_3i (reporting_build_meta): whether the summary was
// built in TEST mode (2024 & 2025 only) or FULL (all data), the year range, and when it was built.
// Run from the menu (DATA PIPELINE) or: node show_build_scope.js
const dotenv = require('dotenv');
dotenv.config();

const { local_usat_sales_db_config } = require('./utilities/config');
const { create_local_db_connection } = require('./utilities/connectionLocalDB');

function run_query(pool, db_name, sql) {
  return new Promise((resolve, reject) => {
    pool.query(`USE ${db_name};`, () => {
      pool.query({ sql }, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  });
}

async function main() {
  const pool = await create_local_db_connection(await local_usat_sales_db_config());
  try {
    const rows = await run_query(pool, 'usat_sales_db',
      'SELECT build_mode, min_year, max_year, built_at FROM reporting_build_meta WHERE id = 1');
    const r = rows && rows[0];
    if (!r) {
      console.log('\n  No build scope recorded yet — run step 3i (full or test) first.\n');
    } else {
      const mode = (r.build_mode || 'full').toUpperCase();
      console.log(`\n  Reporting data scope: ${mode}`);
      console.log(`  Years:  ${r.min_year} - ${r.max_year}`);
      console.log(`  Built:  ${r.built_at}`);
      console.log(mode === 'TEST'
        ? '  !! TEST build (2024 & 2025 only) — re-run the FULL step 3i before sharing.\n'
        : '  OK FULL build — all data.\n');
    }
  } catch (e) {
    console.log('\n  Could not read reporting_build_meta:', e.message);
    console.log('  (The table is created by step 3i — run it once.)\n');
  } finally {
    await new Promise((res) => pool.end(() => res()));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
