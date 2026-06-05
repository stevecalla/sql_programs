/**
 * salesforce.js — jsforce connect + Account query. The only module that
 * touches the network and Salesforce credentials.
 *
 * Credentials come from process.env (loaded by the entry script's dotenv):
 * SF_DEV_* in test mode, SF_PROD_* in production.
 *
 * Fetch strategy:
 *   --test (dev sandbox, small capped pull) -> REST autoFetch (fast for a few
 *       thousand records; Bulk's job-startup overhead would make it slower).
 *   --prod (full ~700k pull)                -> Bulk API query (far fewer, larger
 *       transfers than REST paging 2,000 at a time).
 * Both paths return the same { result: { records, totalSize }, ... } shape.
 */

'use strict';

const jsforce = require('jsforce');

const { log_info, log_success } = require('./log');
const { format_duration, format_timestamp_utc } = require('./fmt');

// Base query — no ORDER BY. The duplicate detection never needs the rows in
// any particular order: exact grouping uses a hash Map, fuzzy uses rule-block
// buckets, and the output files are sorted in code afterward. Leaving the sort
// off lets Salesforce stream records as it finds them instead of sorting the
// whole result set first — a big win on the full ~700k production extract.
const ACCOUNT_SOQL_BASE = `
    SELECT Id,
        LastName,
        FirstName,
        cfg_Member_Number__pc,
        cfg_Gender_Identity__pc,
        usat_Foundation_Constituent__c,
        PersonBirthdate,
        BillingPostalCode,
        PersonMailingPostalCode
    FROM Account
    WHERE FirstName != null
    AND LastName != null
`;

// Ordered variant — used ONLY by the capped --test REST pull so the dev-sandbox
// run returns a stable, deterministic subset (same 5,000 rows every time). The
// sort cost is negligible at that size.
const ACCOUNT_SOQL_ORDERED = `${ACCOUNT_SOQL_BASE.trimEnd()}
    ORDER BY LastName, FirstName, Id
`;

// Back-compat alias (anything importing the old name gets the ordered query).
const ACCOUNT_SOQL = ACCOUNT_SOQL_ORDERED;

// Bulk jobs run asynchronously server-side; jsforce's default poll timeout is
// only 30s, which a full ~700k extract will exceed. Give it generous headroom.
const BULK_POLL_INTERVAL_MS = 5_000;        // check the job every 5s
const BULK_POLL_TIMEOUT_MS = 20 * 60 * 1000; // allow up to 20 minutes

// REST autoFetch — pages of 2,000, capped at max_fetch. Used for --test.
// Uses the ORDERED query so the capped subset is deterministic.
async function rest_query(conn, max_fetch) {
    const result = await conn.query(ACCOUNT_SOQL_ORDERED).execute({
        autoFetch: true,
        maxFetch: max_fetch,
    });
    return { records: result.records, total_size: result.totalSize };
}

// Bulk API query — one async job, results streamed back in large chunks.
// Used for production (the whole result set; no maxFetch cap). Uses the
// UNORDERED query so Salesforce doesn't sort ~700k rows before streaming.
async function bulk_query(conn) {
    const records = [];
    const record_stream = await conn.bulk2.query(ACCOUNT_SOQL_BASE, {
        pollInterval: BULK_POLL_INTERVAL_MS,
        pollTimeout: BULK_POLL_TIMEOUT_MS,
    });

    await new Promise((resolve, reject) => {
        record_stream.on('record', (rec) => records.push(rec));
        record_stream.on('error', reject);
        record_stream.on('end', resolve);
    });

    return { records, total_size: records.length };
}

// Log into Salesforce (dev sandbox when is_test, else production) and run the
// Account query. Returns the raw result plus query timing for the run summary.
async function fetch_salesforce_accounts({ is_test, max_fetch, script_start_ms }) {
    const conn = new jsforce.Connection({
        loginUrl: is_test ? process.env.SF_DEV_LOGIN_URL : process.env.SF_PROD_LOGIN_URL,
    });

    log_info("Logging into Salesforce...", script_start_ms);

    await conn.login(
        is_test ? process.env.SF_DEV_USERNAME : process.env.SF_PROD_USERNAME,
        is_test ?
            process.env.SF_DEV_PASSWORD + process.env.SF_DEV_SECURITY_TOKEN :
            process.env.SF_PROD_PASSWORD + process.env.SF_PROD_SECURITY_TOKEN
    );

    log_success("Login successful.", script_start_ms);

    const query_start_date = new Date();
    const query_start_ms = Date.now();

    const method = is_test ? 'REST autoFetch' : 'Bulk API';
    log_info(`Running Salesforce query via ${method}...`, script_start_ms);

    const { records, total_size } = is_test
        ? await rest_query(conn, max_fetch)
        : await bulk_query(conn);

    const query_end_date = new Date();
    const query_duration_ms = Date.now() - query_start_ms;

    log_success("Salesforce query complete.", query_start_ms);

    console.log(`Query method: ${method}`);
    console.log(`Query start time: ${format_timestamp_utc(query_start_date)}`);
    console.log(`Query end time: ${format_timestamp_utc(query_end_date)}`);
    console.log(`Query duration: ${format_duration(query_duration_ms)}`);
    console.log(`Salesforce total matching records: ${total_size}`);
    console.log(`Records actually fetched: ${records.length}`);

    // Same shape the rest of the pipeline already expects.
    const result = { records, totalSize: total_size };
    return { result, query_start_date, query_end_date, query_duration_ms };
}

module.exports = {
    ACCOUNT_SOQL, // back-compat alias = ACCOUNT_SOQL_ORDERED
    ACCOUNT_SOQL_BASE,
    ACCOUNT_SOQL_ORDERED,
    fetch_salesforce_accounts,
    rest_query,
    bulk_query,
};
