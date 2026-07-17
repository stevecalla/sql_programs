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
 *
 * Optional merge field: `usat_Salesforce_Merge_Id__pc` may not exist in every org
 * (e.g. it was added to the sandbox before production). At fetch time we DESCRIBE
 * Account and include the field in the SELECT only if it exists. If it's missing,
 * the field is omitted (the merge columns simply come out blank) and the run does
 * NOT fail. The moment an admin adds the field, the next run picks it up
 * automatically — no code change needed.
 */

'use strict';

const { connect_salesforce } = require('../../../utilities/salesforce/salesforce_connect');

const { log_info, log_success, log_warn } = require('./log');
const { format_duration, format_timestamp_utc } = require('./fmt');
const { resolve_fetch_plan, BULK_FETCH_PROGRESS_EVERY } = require('../config');

// Optional, org-dependent field (Person-Account `__pc` view of the Contact field).
const MERGE_ID_FIELD = 'usat_Salesforce_Merge_Id__pc';

// The always-present base fields (identity, contact info, demographics, flags,
// audit dates). All are flat Account fields — no relationship traversal — so they
// come back the same shape from both the REST (--test) and Bulk (--prod) paths.
// The optional merge field is inserted (when it exists) next to the foundation
// field by build_account_soql().
const ACCOUNT_BASE_FIELDS = [
    'Id',
    'Name',
    'FirstName',
    'LastName',
    'cfg_Member_Number__pc',
    'PersonEmail',
    'Phone',
    'PersonMailingStreet',
    'PersonMailingCity',
    'PersonMailingState',
    'PersonMailingPostalCode',
    'BillingPostalCode',
    'cfg_Gender_Identity__pc',
    'PersonBirthdate',
    'usat_Foundation_Constituent__c',
    'CreatedDate',
    'CreatedById',
    'LastModifiedDate',
    'LastModifiedById',
];

// Build the Account SOQL. `include_merge_id` adds the optional merge field;
// `ordered` adds ORDER BY (deterministic — used only for the capped --test sample).
// No ORDER BY otherwise: detection never needs sorted input (exact uses a hash Map,
// fuzzy uses rule-block buckets, outputs are sorted in code), so dropping the sort
// lets Salesforce stream the full ~700k extract without sorting it first.
function build_account_soql({ include_merge_id = true, ordered = false } = {}) {
    const fields = [...ACCOUNT_BASE_FIELDS];
    if (include_merge_id) {
        const after = fields.indexOf('usat_Foundation_Constituent__c');
        fields.splice(after + 1, 0, MERGE_ID_FIELD); // group it next to the foundation field
    }
    const select = `SELECT ${fields.join(', ')} FROM Account WHERE FirstName != null AND LastName != null`;
    return ordered ? `${select} ORDER BY LastName, FirstName, Id` : select;
}

// Back-compat constants (full query, merge field included) — kept for anything
// importing them and for the documented SOQL.
const ACCOUNT_SOQL_BASE = build_account_soql({ include_merge_id: true, ordered: false });
const ACCOUNT_SOQL_ORDERED = build_account_soql({ include_merge_id: true, ordered: true });
const ACCOUNT_SOQL = ACCOUNT_SOQL_ORDERED;

// Describe Account and report whether a field exists. If the describe itself fails
// (e.g. permissions), return false so the optional field is safely omitted.
async function account_field_exists(conn, field) {
    try {
        const meta = await conn.sobject('Account').describe();
        return meta.fields.some((f) => f.name === field);
    } catch (_) {
        return false;
    }
}

// Bulk jobs run asynchronously server-side; jsforce's default poll timeout is
// only 30s, which a full ~700k extract will exceed. Give it generous headroom.
const BULK_POLL_INTERVAL_MS = 5_000;        // check the job every 5s
const BULK_POLL_TIMEOUT_MS = 20 * 60 * 1000; // allow up to 20 minutes

// REST autoFetch — pages of 2,000, capped at max_fetch. Used for --test / --partial.
async function rest_query(conn, soql, max_fetch) {
    const result = await conn.query(soql).execute({
        autoFetch: true,
        maxFetch: max_fetch,
    });
    return { records: result.records, total_size: result.totalSize };
}

// The Bulk API 2.0 returns CSV; jsforce can leak the CSV HEADER row into the record
// stream as a fake record where every field equals its own column name (Id === 'Id',
// LastName === 'LastName', ...) — once per result chunk on large extracts. These are
// not real Accounts, so we drop them at the source. (REST autoFetch does not do this.)
function is_bulk_header_row(rec) {
    return !!rec && rec.Id === 'Id';
}

// Bulk API query — one async job, results streamed back in large chunks. Used for
// production / any --full run. Stops at max_fetch (the --test --full guardrail).
async function bulk_query(conn, soql, max_fetch = Infinity, { script_start_ms } = {}) {
    const records = [];
    let header_rows_skipped = 0;
    const record_stream = await conn.bulk2.query(soql, {
        pollInterval: BULK_POLL_INTERVAL_MS,
        pollTimeout: BULK_POLL_TIMEOUT_MS,
    });

    await new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        record_stream.on('record', (rec) => {
            if (is_bulk_header_row(rec)) { header_rows_skipped += 1; return; }
            records.push(rec);
            if (records.length % BULK_FETCH_PROGRESS_EVERY === 0) {
                log_info(`Fetched ${records.length.toLocaleString()} records from Salesforce...`, script_start_ms);
            }
            if (records.length >= max_fetch) {
                try { record_stream.destroy(); } catch (_) { /* ignore */ }
                finish();
            }
        });
        record_stream.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
        record_stream.on('end', finish);
    });

    if (header_rows_skipped > 0) {
        console.log(`Bulk API: dropped ${header_rows_skipped} CSV header row(s) leaked into the record stream.`);
    }

    return { records, total_size: records.length };
}

// Resolve user Ids (CreatedById / LastModifiedById) to readable names via one small
// query, returned as an Id -> Name Map. Best-effort: if the integration user can't read
// User, return an empty map so names just come out blank and the run still succeeds.
async function fetch_user_name_map(conn, script_start_ms) {
    try {
        const res = await conn.query('SELECT Id, Name FROM User').execute({ autoFetch: true, maxFetch: 100000 });
        const map = new Map();
        for (const u of res.records || []) map.set(u.Id, u.Name || '');
        log_info(`Resolved ${map.size.toLocaleString()} user names for created-by / last-modified-by.`, script_start_ms);
        return map;
    } catch (e) {
        log_warn(`Could not query User names (${e.message || e}); created-by / last-modified-by names will be blank.`);
        return new Map();
    }
}

// Log into Salesforce (dev sandbox when is_test, else production) and run the
// Account query. Returns the raw result plus query timing for the run summary.
async function fetch_salesforce_accounts({ is_test, is_full = false, is_partial = false, max_fetch, script_start_ms }) {
    log_info("Connecting to Salesforce...", script_start_ms);
    const { conn, org_id } = await connect_salesforce({ is_test });
    log_success("Connected.", script_start_ms);

    // Source provenance for the snapshot: which environment + which org these records
    // came from. environment is the run mode; org id/host come from the authenticated
    // connection. Stamped on every snapshot row so the table is self-describing (it is
    // dropped and recreated each run, so one snapshot = one environment + one org).
    const environment = is_test ? 'test' : 'prod';
    let org_host = '';
    try { org_host = conn.instanceUrl ? new URL(conn.instanceUrl).host : ''; } catch (_) { org_host = ''; }
    log_info(`Connected org: environment=${environment} org_id=${org_id || '(unknown)'} host=${org_host || '(unknown)'}`, script_start_ms);

    // Only request the optional merge field if this org actually has it.
    const include_merge_id = await account_field_exists(conn, MERGE_ID_FIELD);
    log_info(
        `Optional field ${MERGE_ID_FIELD}: ${include_merge_id ? 'present — included in query' : 'NOT present in this org — skipped (merge columns will be blank)'}`,
        script_start_ms
    );

    const query_start_date = new Date();
    const query_start_ms = Date.now();

    // Fetch path:
    //   --partial      -> quick capped REST sample (no Bulk job, no full sort)
    //   plain --test   -> capped REST ordered sample (deterministic 5k)
    //   prod / --full  -> Bulk API (full)
    const { use_rest, ordered } = resolve_fetch_plan(is_test, is_full, is_partial);
    const soql = build_account_soql({ include_merge_id, ordered });
    const method = use_rest
        ? `REST autoFetch (${is_partial ? 'partial sample' : 'capped'})`
        : (is_test ? 'Bulk API (dev sandbox, FULL)' : 'Bulk API');
    log_info(`Running Salesforce query via ${method}...`, script_start_ms);

    const { records, total_size } = use_rest
        ? await rest_query(conn, soql, max_fetch)
        : await bulk_query(conn, soql, max_fetch, { script_start_ms });

    const query_end_date = new Date();
    const query_duration_ms = Date.now() - query_start_ms;

    log_success("Salesforce query complete.", query_start_ms);

    console.log(`Query method: ${method}`);
    console.log(`Query start time: ${format_timestamp_utc(query_start_date)}`);
    console.log(`Query end time: ${format_timestamp_utc(query_end_date)}`);
    console.log(`Query duration: ${format_duration(query_duration_ms)}`);
    console.log(`Salesforce total matching records: ${total_size}`);
    console.log(`Records actually fetched: ${records.length}`);

    // Resolve created-by / last-modified-by names (one small User query, joined in Node)
    // and attach them to each record so to_snapshot_row can read them like any field.
    const user_names = await fetch_user_name_map(conn, script_start_ms);
    for (const rec of records) {
        rec.CreatedByName = user_names.get(rec.CreatedById) || '';
        rec.LastModifiedByName = user_names.get(rec.LastModifiedById) || '';
    }

    // Same shape the rest of the pipeline already expects, plus the source
    // provenance (environment + org) for stamping the snapshot rows.
    const result = { records, totalSize: total_size };
    return { result, query_start_date, query_end_date, query_duration_ms, environment, org_id, org_host };
}

module.exports = {
    MERGE_ID_FIELD,
    ACCOUNT_BASE_FIELDS,
    build_account_soql,
    account_field_exists,
    ACCOUNT_SOQL, // back-compat alias = ACCOUNT_SOQL_ORDERED
    ACCOUNT_SOQL_BASE,
    ACCOUNT_SOQL_ORDERED,
    fetch_salesforce_accounts,
    rest_query,
    bulk_query,
    is_bulk_header_row,
};
