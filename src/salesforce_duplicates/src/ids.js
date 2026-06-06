/**
 * ids.js — Run-id, hashing, and external-id helpers (pure).
 *
 * make_run_id stamps each run; make_external_id builds the stable upsert key
 * used by the Salesforce import rows.
 */

'use strict';

const crypto = require('crypto');

function make_run_id(date = new Date()) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mi = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");

    return `duplicate_run_${yyyy}_${mm}_${dd}_${hh}${mi}${ss}`;
}

function make_hash(value) {
    return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function make_external_id(run_id, match_type, unique_value) {
    return `${run_id}|${match_type}|${make_hash(unique_value)}`;
}

module.exports = {
    make_run_id,
    make_hash,
    make_external_id,
};
