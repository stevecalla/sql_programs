/**
 * normalize.js — Pure field-normalization + key-building helpers (no I/O).
 *
 * These operate on Salesforce account rows and produce the cleaned values,
 * composite keys, and rule keys used by the exact + fuzzy matching logic.
 */

'use strict';

function norm(value) {
    return (value || "").trim().toUpperCase();
}

function clean_name(value) {
    return norm(value).replace(/[^A-Z0-9]/g, "").trim();
}

function unique_join(values) {
    return [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== ""))]
        .join(";");
}

// Trim a US ZIP to its first five digits. If the value begins with exactly five
// digits (optionally followed by a ZIP+4 suffix like "-1234" or "1234"), keep
// just those five — so "80919-1234" and "809191234" both become "80919".
// Anything that does NOT start with five digits (e.g. a Canadian/international
// postal code such as "K1A 0B1", or a blank) is returned unchanged (trimmed).
// This is the single place ZIP normalization happens; every consumer goes
// through composite_zip() below, so the trim propagates everywhere.
function trim_zip5(value) {
    const trimmed = (value || "").trim();
    const match = trimmed.match(/^(\d{5})/);
    return match ? match[1] : trimmed;
}

// The raw composite ZIP: billing preferred, else mailing, with NO trimming.
// Used only to build the human-reviewable raw->trimmed mapping; the matching
// logic should always use composite_zip() (the trimmed value).
function composite_zip_raw(row) {
    const billing_zip = (row.BillingPostalCode || "").trim();
    const mailing_zip = (row.PersonMailingPostalCode || "").trim();

    return billing_zip !== "" ? billing_zip : mailing_zip;
}

// The composite ZIP used by ALL matching: billing-or-mailing, trimmed to 5 digits,
// then uppercased/trimmed (norm) so case never splits a match — "M4p1e8" and
// "M4P1E8" are the same postal code. This is the ONE place ZIP is normalized, so
// the exact key, the rule-block key, both eligibility gates, and the snapshot's
// composite_zip_five_digit column all see the identical value.
function composite_zip(row) {
    return norm(trim_zip5(composite_zip_raw(row)));
}

function make_full_name(row) {
    return `${row.FirstName || ""} ${row.LastName || ""}`.trim();
}

function make_clean_full_name(row) {
    return `${clean_name(row.FirstName)} ${clean_name(row.LastName)}`.trim();
}

// Exact-duplicate eligibility — the single, explicit gate. A record can only be
// an exact duplicate if all five identity fields are present (cleaned first +
// cleaned last, gender, birthdate, 5-digit ZIP). Every consumer (in-memory
// exact.js, the SQL path, the snapshot's precomputed key column) goes through
// this one definition.
function has_required_exact_fields(row) {
    return (
        clean_name(row.LastName) !== "" &&
        clean_name(row.FirstName) !== "" &&
        norm(row.cfg_Gender_Identity__pc) !== "" &&
        norm(row.PersonBirthdate) !== "" &&
        composite_zip(row) !== ""
    );
}

// The exact-duplicate key: CLEANED first + CLEANED last (punctuation/spacing
// insensitive, so "O'Brien" == "OBrien" and "Anne Marie" == "AnneMarie") +
// gender + birthdate + 5-digit composite ZIP. Returns "" for any record that
// fails has_required_exact_fields, so ineligible records never form an exact
// group — the blank key is the single signal the SQL path filters on
// (WHERE exact_duplicate_key <> ''). This function is the one source of truth
// for "what makes two records exact duplicates."
function make_exact_duplicate_key(row) {
    if (!has_required_exact_fields(row)) return "";
    return [
        clean_name(row.LastName),
        clean_name(row.FirstName),
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        composite_zip(row),
    ].join("|");
}

// The rule-block key: gender + birthdate + 5-digit composite ZIP — the blocking
// key for fuzzy/nickname (records sharing it are candidates for name comparison).
// Mirrors make_exact_duplicate_key: returns "" unless has_required_rule_fields
// (all three present), so an ineligible record never forms a rule block, and the
// blank key is the single signal a SQL fuzzy-blocking path filters on
// (WHERE rule_block_key <> ''). Aligned with the exact key so both keys gate on
// their required fields the same way.
function make_rule_key(row) {
    if (!has_required_rule_fields(row)) return "";
    return [
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        composite_zip(row),
    ].join("|");
}

function has_required_rule_fields(row) {
    return (
        norm(row.cfg_Gender_Identity__pc) !== "" &&
        norm(row.PersonBirthdate) !== "" &&
        composite_zip(row) !== ""
    );
}

module.exports = {
    norm,
    clean_name,
    unique_join,
    trim_zip5,
    composite_zip_raw,
    composite_zip,
    make_full_name,
    make_clean_full_name,
    make_exact_duplicate_key,
    has_required_exact_fields,
    make_rule_key,
    has_required_rule_fields,
};
