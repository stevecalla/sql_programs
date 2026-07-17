/**
 * discover_account_fields.js — One-off, READ-ONLY discovery helper.
 *
 * Confirms whether a Salesforce field exists on a given entity (Account or
 * Contact) and prints its exact API name. Does three independent checks so you
 * can cross-confirm:
 *   1. Object describe  — lists every field on the entity whose name/label matches.
 *   2. Tooling FieldDefinition SOQL — same, via metadata SOQL (incl. __pc fields).
 *   3. Direct SOQL existence test of the assumed name (catches INVALID_FIELD).
 *
 * It NEVER writes to Salesforce.
 *
 * Person Account note: a custom field made on Contact has a `__c` API name; the
 * same field surfaces on Account as `__pc` (person custom). Query the entity your
 * code actually uses — this pipeline queries Account, so the `__pc` name applies.
 *
 * Usage (from src/salesforce_duplicates):
 *   node discover_account_fields.js --prod                    # Account, "merge"
 *   node discover_account_fields.js --prod Account Merge
 *   node discover_account_fields.js --prod Contact Merge
 *   node discover_account_fields.js --test Account Merge
 */

'use strict';

const dotenv = require('dotenv');
dotenv.config({ path: '../../.env' });

const { connect_salesforce } = require('../../utilities/salesforce/salesforce_connect');
const { resolve_is_test } = require('./config');

// Positional args after the node script path, ignoring --flags.
const positionals = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ENTITY = positionals[0] || 'Account';
const SEARCH_TERM = (positionals[1] || 'Merge').toLowerCase();

// Sensible assumed name to existence-test, per entity (Person Account convention).
const ASSUMED_FIELD = /^account$/i.test(ENTITY)
    ? 'usat_Salesforce_Merge_Id__pc'
    : 'usat_Salesforce_Merge_Id__c';

async function main() {
    const is_test = resolve_is_test();

    console.log(`Connecting to Salesforce (${is_test ? 'DEV sandbox' : 'PRODUCTION'})...`);
    const { conn } = await connect_salesforce({ is_test });
    console.log(`Connected. Entity="${ENTITY}", term="${SEARCH_TERM}".\n`);

    // 1) DESCRIBE entity, filter fields matching the search term.
    console.log(`1) ${ENTITY}.describe() fields matching "${SEARCH_TERM}":`);
    try {
        const meta = await conn.sobject(ENTITY).describe();
        const hits = meta.fields.filter(
            (f) => f.name.toLowerCase().includes(SEARCH_TERM) || String(f.label || '').toLowerCase().includes(SEARCH_TERM)
        );
        if (hits.length === 0) console.log('   (no matching fields)');
        else for (const f of hits) console.log(`   ${f.name}   | label: "${f.label}" | type: ${f.type}`);
    } catch (e) {
        console.log(`   (describe failed: ${e.message})`);
    }
    console.log('');

    // 2) Tooling API FieldDefinition SOQL (enumerates by metadata, incl. __pc).
    console.log(`2) Tooling FieldDefinition for ${ENTITY} LIKE %${SEARCH_TERM}%:`);
    try {
        const tooling = await conn.tooling.query(
            `SELECT QualifiedApiName, Label, DataType FROM FieldDefinition ` +
            `WHERE EntityDefinition.QualifiedApiName = '${ENTITY}' ` +
            `AND QualifiedApiName LIKE '%${SEARCH_TERM}%'`
        );
        if (!tooling.records.length) console.log('   (no matching fields)');
        else for (const r of tooling.records) console.log(`   ${r.QualifiedApiName}   | label: "${r.Label}" | type: ${r.DataType}`);
    } catch (e) {
        console.log(`   (tooling query failed: ${e.message})`);
    }
    console.log('');

    // 3) Direct SOQL existence test of the assumed name.
    console.log(`3) Direct SOQL existence test of "${ASSUMED_FIELD}" on ${ENTITY}:`);
    try {
        await conn.query(`SELECT Id, ${ASSUMED_FIELD} FROM ${ENTITY} LIMIT 1`);
        console.log(`   EXISTS and is readable: ${ASSUMED_FIELD}`);
    } catch (e) {
        console.log(`   NOT usable as-is: ${e.errorCode || ''} ${e.message}`);
        console.log('   -> use the exact name from step 1 or 2 above.');
    }
}

main()
    .then(() => console.log('\nDone (read-only; nothing was written to Salesforce).'))
    .catch((err) => {
        console.error('Discovery failed:', err.message);
        process.exit(1);
    });
