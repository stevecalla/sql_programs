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

function composite_zip(row) {
    const billing_zip = (row.BillingPostalCode || "").trim();
    const mailing_zip = (row.PersonMailingPostalCode || "").trim();

    return billing_zip !== "" ? billing_zip : mailing_zip;
}

function make_full_name(row) {
    return `${row.FirstName || ""} ${row.LastName || ""}`.trim();
}

function make_clean_full_name(row) {
    return `${clean_name(row.FirstName)} ${clean_name(row.LastName)}`.trim();
}

function make_exact_duplicate_key(row) {
    return [
        norm(row.LastName),
        norm(row.FirstName),
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        norm(composite_zip(row)),
    ].join("|");
}

function make_rule_key(row) {
    return [
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        norm(composite_zip(row)),
    ].join("|");
}

function has_required_rule_fields(row) {
    return (
        norm(row.cfg_Gender_Identity__pc) !== "" &&
        norm(row.PersonBirthdate) !== "" &&
        norm(composite_zip(row)) !== ""
    );
}

module.exports = {
    norm,
    clean_name,
    unique_join,
    composite_zip,
    make_full_name,
    make_clean_full_name,
    make_exact_duplicate_key,
    make_rule_key,
    has_required_rule_fields,
};
