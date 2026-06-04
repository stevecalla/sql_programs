/**
 * salesforce.js — jsforce connect + Account query. The only module that
 * touches the network and Salesforce credentials.
 *
 * Credentials come from process.env (loaded by the entry script's dotenv):
 * SF_DEV_* in test mode, SF_PROD_* in production.
 */

'use strict';

const jsforce = require('jsforce');

const { log_info, log_success } = require('./log');
const { format_duration, format_timestamp_utc } = require('./fmt');

const ACCOUNT_SOQL = `
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
    ORDER BY LastName, FirstName, Id
`;

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

    log_info("Running Salesforce query...", script_start_ms);

    const result = await conn.query(ACCOUNT_SOQL).execute({
        autoFetch: true,
        maxFetch: max_fetch,
    });

    const query_end_date = new Date();
    const query_duration_ms = Date.now() - query_start_ms;

    log_success("Salesforce query complete.", query_start_ms);

    console.log(`Query start time: ${format_timestamp_utc(query_start_date)}`);
    console.log(`Query end time: ${format_timestamp_utc(query_end_date)}`);
    console.log(`Query duration: ${format_duration(query_duration_ms)}`);
    console.log(`Salesforce total matching records: ${result.totalSize}`);
    console.log(`Records actually fetched: ${result.records.length}`);

    return { result, query_start_date, query_end_date, query_duration_ms };
}

module.exports = {
    ACCOUNT_SOQL,
    fetch_salesforce_accounts,
};
