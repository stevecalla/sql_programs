/**
 * matcher.js — Pure fuzzy-matching scoring + reason helpers (no I/O).
 *
 * Depends on normalize.js for field cleaning and config.js for the fuzzy
 * threshold used in the human-readable match reason.
 */

'use strict';

const { FUZZY_THRESHOLD } = require('../config');
const { norm, clean_name, composite_zip } = require('./normalize');

function levenshtein_distance(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

function similarity_score(a, b) {
    const left = clean_name(a);
    const right = clean_name(b);

    if (!left || !right) return 0;
    if (left === right) return 100;

    const max_length = Math.max(left.length, right.length);
    const distance = levenshtein_distance(left, right);

    return Math.round((1 - distance / max_length) * 100);
}

function get_rule_flags(row_a, row_b) {
    const same_gender_flag =
        norm(row_a.cfg_Gender_Identity__pc) !== "" &&
        norm(row_a.cfg_Gender_Identity__pc) === norm(row_b.cfg_Gender_Identity__pc)
            ? 1
            : 0;

    const same_birthdate_flag =
        norm(row_a.PersonBirthdate) !== "" &&
        norm(row_a.PersonBirthdate) === norm(row_b.PersonBirthdate)
            ? 1
            : 0;

    const same_composite_zip_flag =
        norm(composite_zip(row_a)) !== "" &&
        norm(composite_zip(row_a)) === norm(composite_zip(row_b))
            ? 1
            : 0;

    const strict_rule_match_flag =
        same_gender_flag === 1 &&
        same_birthdate_flag === 1 &&
        same_composite_zip_flag === 1
            ? 1
            : 0;

    return {
        same_gender_flag,
        same_birthdate_flag,
        same_composite_zip_flag,
        strict_rule_match_flag,
        rule_match_count: same_gender_flag + same_birthdate_flag + same_composite_zip_flag,
    };
}

function get_name_difference_reason(row_a, row_b, first_name_score, last_name_score) {
    const first_a = clean_name(row_a.FirstName);
    const first_b = clean_name(row_b.FirstName);
    const last_a = clean_name(row_a.LastName);
    const last_b = clean_name(row_b.LastName);

    const reasons = [];

    let first_reason = "First names are exact after cleaning.";
    let last_reason = "Last names are exact after cleaning.";

    if (first_a !== first_b) {
        first_reason = `First names differ after cleaning: "${first_a}" vs "${first_b}" with score ${first_name_score}.`;
        reasons.push(first_reason);
    }

    if (last_a !== last_b) {
        last_reason = `Last names differ after cleaning: "${last_a}" vs "${last_b}" with score ${last_name_score}.`;
        reasons.push(last_reason);
    }

    if (reasons.length === 0) {
        reasons.push("Names are exact after cleaning; this pair should normally be skipped by fuzzy logic.");
    }

    return {
        first_name_difference_reason: first_reason,
        last_name_difference_reason: last_reason,
        name_difference_reason: reasons.join(" "),
    };
}

function get_rule_match_reason(row_a, rule_flags) {
    const gender = norm(row_a.cfg_Gender_Identity__pc);
    const birthdate = norm(row_a.PersonBirthdate);
    const zip = norm(composite_zip(row_a));

    if (rule_flags.strict_rule_match_flag === 1) {
        return `Strict rule match: same gender "${gender}", same birthdate "${birthdate}", and same composite ZIP "${zip}".`;
    }

    return [
        "Rule check failed or partial match.",
        `same_gender_flag=${rule_flags.same_gender_flag}`,
        `same_birthdate_flag=${rule_flags.same_birthdate_flag}`,
        `same_composite_zip_flag=${rule_flags.same_composite_zip_flag}`,
    ].join(" ");
}

function get_fuzzy_match_reason({
    row_a,
    row_b,
    first_name_score,
    last_name_score,
    combined_name_score,
    rule_flags,
}) {
    const name_reasons = get_name_difference_reason(row_a, row_b, first_name_score, last_name_score);
    const rule_match_reason = get_rule_match_reason(row_a, rule_flags);

    const fuzzy_match_reason = [
        `Fuzzy match because the combined name score ${combined_name_score} is >= threshold ${FUZZY_THRESHOLD}.`,
        name_reasons.name_difference_reason,
        rule_match_reason,
        "This pair was not included in the exact duplicate file because the cleaned first and/or last name was not an exact match.",
    ].join(" ");

    return {
        fuzzy_match_reason,
        rule_match_reason,
        ...name_reasons,
    };
}

module.exports = {
    levenshtein_distance,
    similarity_score,
    get_rule_flags,
    get_name_difference_reason,
    get_rule_match_reason,
    get_fuzzy_match_reason,
};
