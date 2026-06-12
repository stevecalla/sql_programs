/**
 * verify_database_snapshot.js — MANUAL, STEP-BY-STEP smoke test of the Phase 0 loader.
 *
 * Loads a handful of SYNTHETIC Account records into the REAL local database
 * (usat_sales_db, table salesforce_account_duplicate_snapshot) and lets you inspect
 * them — so you can confirm, one step at a time, that the connection, the DROP/CREATE,
 * the batched INSERTs, the precomputed keys, and the SQL exact-duplicate rule all work.
 * It does NOT touch Salesforce. The table is disposable, so this is safe to run.
 *
 * Lives in src/ with the other modules; run it from the project folder:
 *   node src/verify_database_snapshot.js load    # drop+recreate, load 4 synthetic rows, show count
 *   node src/verify_database_snapshot.js show     # SELECT rows + run the exact-duplicate GROUP BY
 *   node src/verify_database_snapshot.js drop     # drop the verification table (cleanup)
 *   node src/verify_database_snapshot.js          # load + show (the whole thing at once)
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const { SNAPSHOT_TABLE_NAME } = require('../config');
const { load_snapshot, open_local_executor } = require('./database_snapshot');

function rec(id, first, last, extra = {}) {
    return {
        Id: id, FirstName: first, LastName: last,
        cfg_Gender_Identity__pc: 'Male', PersonBirthdate: '1990-01-01',
        BillingPostalCode: '80919-1234', PersonMailingPostalCode: '',
        cfg_Member_Number__pc: `m${id}`, usat_Salesforce_Merge_Id__pc: `mg${id}`,
        usat_Foundation_Constituent__c: '', ...extra,
    };
}

// 001 and 002 are an exact duplicate; 003 (Bob) is a nickname, NOT an exact dup;
// 004 is unrelated. So we expect exactly one exact-duplicate group of size 2.
function synthetic_records() {
    return [
        rec('001', 'Robert', 'Smith'),
        rec('002', 'Robert', 'Smith'),
        rec('003', 'Bob', 'Smith'),
        rec('004', 'Jane', 'Doe', { BillingPostalCode: '10001' }),
    ];
}

// Run `fn(executor)` against the real local DB, always closing the pool afterward.
async function with_executor(fn) {
    const { pool, executor } = await open_local_executor();
    try { return await fn(executor); }
    finally { try { pool.end(); } catch (_) { /* ignore */ } }
}

async function step_load(executor) {
    const records = synthetic_records();
    console.log(`STEP "load" — dropping + recreating ${SNAPSHOT_TABLE_NAME} and loading ${records.length} synthetic rows...`);
    const loaded = await load_snapshot(records, { executor });
    const countRows = await executor(`SELECT COUNT(*) AS n FROM \`${SNAPSHOT_TABLE_NAME}\``, []);
    console.log(`  Loaded ${loaded} rows. Row count in table: ${countRows[0].n} (expected ${records.length}).`);
    console.log('  Next: run the "show" step to see the rows and the exact-duplicate groups.');
}

async function step_show(executor) {
    console.log(`STEP "show" — reading ${SNAPSHOT_TABLE_NAME} and running the exact-duplicate GROUP BY...\n`);
    let rows;
    try {
        rows = await executor(
            `SELECT salesforce_account_id, first_name, last_name, exact_duplicate_key, composite_zip_five_digit
             FROM \`${SNAPSHOT_TABLE_NAME}\` ORDER BY salesforce_account_id`, []);
    } catch (e) {
        if (/doesn't exist|Unknown table/i.test(e.message)) {
            console.log(`  Table ${SNAPSHOT_TABLE_NAME} not found. Run the "load" step first.`);
            return;
        }
        throw e;
    }

    console.log('  Rows (id | name | exact_duplicate_key | composite_zip_five_digit):');
    for (const r of rows) {
        console.log(`    ${r.salesforce_account_id} | ${r.first_name} ${r.last_name} | ${r.exact_duplicate_key} | zip=${r.composite_zip_five_digit}`);
    }

    console.log('\n  Exact-duplicate groups  —  SELECT exact_duplicate_key, COUNT(*), GROUP_CONCAT(id) ... HAVING COUNT(*) > 1:');
    const groups = await executor(
        `SELECT exact_duplicate_key, COUNT(*) AS duplicate_count, GROUP_CONCAT(salesforce_account_id ORDER BY salesforce_account_id) AS ids
         FROM \`${SNAPSHOT_TABLE_NAME}\` GROUP BY exact_duplicate_key HAVING COUNT(*) > 1`, []);
    if (groups.length === 0) console.log('    (none)');
    for (const g of groups) console.log(`    ${g.duplicate_count}x  [${g.exact_duplicate_key}]  ids=${g.ids}`);
    console.log('\n  Expected: one group of 2 for Robert Smith (ids 001,002). Bob (003) is a nickname, not an exact dup.');
}

async function step_drop(executor) {
    console.log(`STEP "drop" — removing ${SNAPSHOT_TABLE_NAME}...`);
    await executor(`DROP TABLE IF EXISTS \`${SNAPSHOT_TABLE_NAME}\``, []);
    console.log(`  Dropped ${SNAPSHOT_TABLE_NAME}.`);
}

async function main() {
    const sub = (process.argv[2] || 'all').toLowerCase();
    switch (sub) {
        case 'load': await with_executor(step_load); break;
        case 'show': await with_executor(step_show); break;
        case 'drop': await with_executor(step_drop); break;
        case 'all':
            await with_executor(async (executor) => { await step_load(executor); console.log(''); await step_show(executor); });
            break;
        default:
            console.log('Usage: node src/verify_database_snapshot.js [load|show|drop]   (no arg = load + show)');
    }
}

if (require.main === module) {
    main().catch((e) => { console.error('Verification FAILED:', e.message); process.exit(1); });
}

module.exports = { main, synthetic_records, step_load, step_show, step_drop };
