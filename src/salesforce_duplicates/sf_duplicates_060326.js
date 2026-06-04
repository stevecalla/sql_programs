const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });

const jsforce = require("jsforce");
const fs = require("fs");
const csv = require("fast-csv");

const MAX_FETCH = 1000000;
const FUZZY_THRESHOLD = 90;
const PROGRESS_LOG_EVERY_RECORDS = 1000;
const PROGRESS_LOG_EVERY_PAIRS = 250000;

const EXACT_OUTPUT_FILE = "account_duplicates.csv";
const FUZZY_PAIR_OUTPUT_FILE = "account_fuzzy_name_matches.csv";
const FUZZY_GROUP_OUTPUT_FILE = "account_fuzzy_name_groups.csv";

/*
    OUTPUTS

    1. account_duplicates.csv
       Exact duplicate groups:
       exact FirstName + exact LastName + exact Gender + exact Birthdate + exact Composite ZIP

    2. account_fuzzy_name_matches.csv
       Pair-by-pair fuzzy matches:
       fuzzy FirstName/LastName
       AND same Gender
       AND same Birthdate
       AND same Composite ZIP
       AND not already in exact duplicate output
       AND not exact same cleaned first/last name

    3. account_fuzzy_name_groups.csv
       Grouped fuzzy clusters:
       combines connected fuzzy pairs into grouped duplicate candidates
*/

const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
};

function colorize(color, value) {
    return `${colors[color] || ""}${value}${colors.reset}`;
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];

    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);

    parts.push(`${seconds}s`);

    return parts.join(" ");
}

function formatTimestamp(date = new Date()) {
    return date.toISOString().replace("T", " ").replace("Z", " UTC");
}

function logInfo(message, startMs = null) {
    const elapsed = startMs
        ? colorize("gray", ` | elapsed: ${formatDuration(Date.now() - startMs)}`)
        : "";

    console.log(
        `${colorize("cyan", "[INFO]")} ${colorize("gray", formatTimestamp())} ${message}${elapsed}`
    );
}

function logSuccess(message, startMs = null) {
    const elapsed = startMs
        ? colorize("gray", ` | elapsed: ${formatDuration(Date.now() - startMs)}`)
        : "";

    console.log(
        `${colorize("green", "[OK]")} ${colorize("gray", formatTimestamp())} ${message}${elapsed}`
    );
}

function logWarn(message) {
    console.warn(
        `${colorize("yellow", "[WARN]")} ${colorize("gray", formatTimestamp())} ${message}`
    );
}

function logError(message) {
    console.error(
        `${colorize("red", "[ERROR]")} ${colorize("gray", formatTimestamp())} ${message}`
    );
}

function norm(value) {
    return (value || "").trim().toUpperCase();
}

function cleanName(value) {
    return norm(value)
        .replace(/[^A-Z0-9]/g, "")
        .trim();
}

function compositeZip(row) {
    const billing = (row.BillingPostalCode || "").trim();
    const mailing = (row.PersonMailingPostalCode || "").trim();

    return billing !== "" ? billing : mailing;
}

function makeFullName(row) {
    return `${row.FirstName || ""} ${row.LastName || ""}`.trim();
}

function makeCleanFullName(row) {
    return `${cleanName(row.FirstName)} ${cleanName(row.LastName)}`.trim();
}

function makeExactDuplicateKey(row) {
    return [
        norm(row.LastName),
        norm(row.FirstName),
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        norm(compositeZip(row)),
    ].join("|");
}

function makeRuleKey(row) {
    return [
        norm(row.cfg_Gender_Identity__pc),
        norm(row.PersonBirthdate),
        norm(compositeZip(row)),
    ].join("|");
}

function hasRequiredRuleFields(row) {
    return (
        norm(row.cfg_Gender_Identity__pc) !== "" &&
        norm(row.PersonBirthdate) !== "" &&
        norm(compositeZip(row)) !== ""
    );
}

function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

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

function similarityScore(a, b) {
    const left = cleanName(a);
    const right = cleanName(b);

    if (!left || !right) return 0;
    if (left === right) return 100;

    const maxLength = Math.max(left.length, right.length);
    const distance = levenshteinDistance(left, right);

    return Math.round((1 - distance / maxLength) * 100);
}

function getRuleFlags(rowA, rowB) {
    const sameGenderFlag =
        norm(rowA.cfg_Gender_Identity__pc) !== "" &&
        norm(rowA.cfg_Gender_Identity__pc) === norm(rowB.cfg_Gender_Identity__pc)
            ? 1
            : 0;

    const sameBirthdateFlag =
        norm(rowA.PersonBirthdate) !== "" &&
        norm(rowA.PersonBirthdate) === norm(rowB.PersonBirthdate)
            ? 1
            : 0;

    const sameCompositeZipFlag =
        norm(compositeZip(rowA)) !== "" &&
        norm(compositeZip(rowA)) === norm(compositeZip(rowB))
            ? 1
            : 0;

    const strictRuleMatchFlag =
        sameGenderFlag === 1 &&
        sameBirthdateFlag === 1 &&
        sameCompositeZipFlag === 1
            ? 1
            : 0;

    return {
        same_gender_flag: sameGenderFlag,
        same_birthdate_flag: sameBirthdateFlag,
        same_composite_zip_flag: sameCompositeZipFlag,
        strict_rule_match_flag: strictRuleMatchFlag,
        rule_match_count: sameGenderFlag + sameBirthdateFlag + sameCompositeZipFlag,
    };
}

function getNameDifferenceReason(rowA, rowB, firstNameScore, lastNameScore) {
    const firstA = cleanName(rowA.FirstName);
    const firstB = cleanName(rowB.FirstName);
    const lastA = cleanName(rowA.LastName);
    const lastB = cleanName(rowB.LastName);

    const reasons = [];

    let firstReason = "First names are exact after cleaning.";
    let lastReason = "Last names are exact after cleaning.";

    if (firstA !== firstB) {
        firstReason = `First names differ after cleaning: "${firstA}" vs "${firstB}" with score ${firstNameScore}.`;
        reasons.push(firstReason);
    }

    if (lastA !== lastB) {
        lastReason = `Last names differ after cleaning: "${lastA}" vs "${lastB}" with score ${lastNameScore}.`;
        reasons.push(lastReason);
    }

    if (reasons.length === 0) {
        reasons.push("Names are exact after cleaning; this pair should normally be skipped by fuzzy logic.");
    }

    return {
        first_name_difference_reason: firstReason,
        last_name_difference_reason: lastReason,
        name_difference_reason: reasons.join(" "),
    };
}

function getRuleMatchReason(rowA, ruleFlags) {
    const gender = norm(rowA.cfg_Gender_Identity__pc);
    const birthdate = norm(rowA.PersonBirthdate);
    const zip = norm(compositeZip(rowA));

    if (ruleFlags.strict_rule_match_flag === 1) {
        return `Strict rule match: same gender "${gender}", same birthdate "${birthdate}", and same composite ZIP "${zip}".`;
    }

    return [
        "Rule check failed or partial match.",
        `same_gender_flag=${ruleFlags.same_gender_flag}`,
        `same_birthdate_flag=${ruleFlags.same_birthdate_flag}`,
        `same_composite_zip_flag=${ruleFlags.same_composite_zip_flag}`,
    ].join(" ");
}

function getFuzzyMatchReason({
    rowA,
    rowB,
    firstNameScore,
    lastNameScore,
    combinedNameScore,
    ruleFlags,
}) {
    const nameReasons = getNameDifferenceReason(rowA, rowB, firstNameScore, lastNameScore);
    const ruleMatchReason = getRuleMatchReason(rowA, ruleFlags);

    const fuzzyMatchReason = [
        `Fuzzy match because the combined name score ${combinedNameScore} is >= threshold ${FUZZY_THRESHOLD}.`,
        nameReasons.name_difference_reason,
        ruleMatchReason,
        "This pair was not included in the exact duplicate file because the cleaned first and/or last name was not an exact match.",
    ].join(" ");

    return {
        fuzzy_match_reason: fuzzyMatchReason,
        rule_match_reason: ruleMatchReason,
        ...nameReasons,
    };
}

async function writeCsv(outputFile, rows) {
    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(outputFile);

        csv
            .write(rows, { headers: true })
            .on("error", reject)
            .on("finish", resolve)
            .pipe(ws);
    });
}

class UnionFind {
    constructor() {
        this.parent = new Map();
    }

    add(x) {
        if (!this.parent.has(x)) {
            this.parent.set(x, x);
        }
    }

    find(x) {
        this.add(x);

        const parent = this.parent.get(x);

        if (parent !== x) {
            const root = this.find(parent);
            this.parent.set(x, root);
            return root;
        }

        return parent;
    }

    union(a, b) {
        const rootA = this.find(a);
        const rootB = this.find(b);

        if (rootA !== rootB) {
            this.parent.set(rootB, rootA);
        }
    }

    groups() {
        const out = new Map();

        for (const item of this.parent.keys()) {
            const root = this.find(item);

            if (!out.has(root)) {
                out.set(root, []);
            }

            out.get(root).push(item);
        }

        return out;
    }
}

function logExactDuplicateExclusionSummary(exactDuplicateGroups, exactDuplicateRecordIds) {
    const duplicateGroupSizeSummary = exactDuplicateGroups.reduce((acc, group) => {
        const size = group.record_ids.length;
        acc[size] = (acc[size] || 0) + 1;
        return acc;
    }, {});

    logInfo("Exact duplicate exclusion summary:");

    console.table({
        exact_duplicate_groups: exactDuplicateGroups.length,
        exact_duplicate_record_ids_excluded_from_fuzzy: exactDuplicateRecordIds.size,
    });

    console.table(
        Object.entries(duplicateGroupSizeSummary).map(([duplicate_count, group_count]) => ({
            duplicate_count: Number(duplicate_count),
            group_count,
            total_records: Number(duplicate_count) * group_count,
        }))
    );
}

function logFuzzyCandidateFilterSummary({
    baseRecordsFetched,
    exactDuplicateRecordIdsExcluded,
    recordsAfterExactExclusion,
    recordsExcludedMissingRuleFields,
    finalFuzzyCandidateRecords,
}) {
    logInfo("Fuzzy candidate filter summary:");

    console.table({
        base_records_fetched: baseRecordsFetched,
        exact_duplicate_record_ids_excluded: exactDuplicateRecordIdsExcluded,
        records_after_exact_exclusion: recordsAfterExactExclusion,
        records_excluded_missing_gender_birthdate_or_zip: recordsExcludedMissingRuleFields,
        final_fuzzy_candidate_records: finalFuzzyCandidateRecords,
    });
}

function logRuleBlockSummary(ruleBlocks) {
    const summary = [...ruleBlocks.entries()]
        .map(([rule_key, rows]) => ({
            rule_key,
            record_count: rows.length,
            estimated_pair_comparisons: (rows.length * (rows.length - 1)) / 2,
        }))
        .sort((a, b) => b.estimated_pair_comparisons - a.estimated_pair_comparisons)
        .slice(0, 20);

    logInfo("Top fuzzy rule blocks by estimated pair comparisons:");
    console.table(summary);
}

function buildFuzzyGroups(fuzzyMatches, recordLookup) {
    const uf = new UnionFind();

    for (const match of fuzzyMatches) {
        uf.union(match.record_id_1, match.record_id_2);
    }

    const rawGroups = [...uf.groups().values()].filter((ids) => ids.length > 1);

    const pairStatsByGroupKey = new Map();

    for (const ids of rawGroups) {
        const sortedIds = [...ids].sort();
        const groupKey = sortedIds.join("|");

        pairStatsByGroupKey.set(groupKey, {
            best_pair_score: 0,
            lowest_pair_score: 100,
            pair_count: 0,
            pair_reasons: [],
        });
    }

    for (const match of fuzzyMatches) {
        const rootIds = rawGroups.find(
            (ids) => ids.includes(match.record_id_1) && ids.includes(match.record_id_2)
        );

        if (!rootIds) continue;

        const groupKey = [...rootIds].sort().join("|");
        const stats = pairStatsByGroupKey.get(groupKey);

        stats.best_pair_score = Math.max(stats.best_pair_score, match.match_score_combined_name);
        stats.lowest_pair_score = Math.min(stats.lowest_pair_score, match.match_score_combined_name);
        stats.pair_count += 1;

        stats.pair_reasons.push(
            `${match.full_name_1} <-> ${match.full_name_2}: score ${match.match_score_combined_name}`
        );
    }

    return rawGroups
        .map((ids) => {
            const sortedIds = [...ids].sort();
            const groupKey = sortedIds.join("|");
            const stats = pairStatsByGroupKey.get(groupKey);

            const rows = sortedIds
                .map((id) => recordLookup.get(id))
                .filter(Boolean);

            const firstRow = rows[0] || {};

            return {
                fuzzy_group_key: groupKey,
                group_record_count: rows.length,
                shared_gender: firstRow.cfg_Gender_Identity__pc || "",
                shared_birthdate: firstRow.PersonBirthdate || "",
                shared_composite_zip: compositeZip(firstRow),
                names_in_group: rows.map(makeFullName).join(";"),
                clean_names_in_group: rows.map(makeCleanFullName).join(";"),
                record_ids: rows.map((r) => r.Id).join(";"),
                member_numbers: rows
                    .map((r) => r.cfg_Member_Number__pc)
                    .filter(Boolean)
                    .join(";"),
                best_pair_score: stats?.best_pair_score || "",
                lowest_pair_score: stats?.lowest_pair_score || "",
                fuzzy_pair_count_in_group: stats?.pair_count || 0,
                fuzzy_pair_summary: stats?.pair_reasons.join(" | ") || "",
                fuzzy_group_logic:
                    "connected group built from fuzzy pair matches sharing same gender, birthdate, and composite ZIP",
            };
        })
        .sort((a, b) => {
            if (b.group_record_count !== a.group_record_count) {
                return b.group_record_count - a.group_record_count;
            }

            if (b.best_pair_score !== a.best_pair_score) {
                return b.best_pair_score - a.best_pair_score;
            }

            return String(a.names_in_group || "").localeCompare(String(b.names_in_group || ""));
        });
}

async function main() {
    const scriptStartDate = new Date();
    const scriptStartMs = Date.now();

    logInfo("Script started.");
    logInfo(`Hardcoded MAX_FETCH: ${MAX_FETCH}`);
    logInfo(`Hardcoded FUZZY_THRESHOLD: ${FUZZY_THRESHOLD}`);

    const conn = new jsforce.Connection({
        loginUrl: process.env.SF_LOGIN_URL || "https://test.salesforce.com",
    });

    logInfo("Logging into Salesforce...", scriptStartMs);

    await conn.login(
        process.env.SF_USERNAME,
        process.env.SF_PASSWORD + process.env.SF_SECURITY_TOKEN
    );

    logSuccess("Login successful.", scriptStartMs);

    const soql = `
        SELECT Id,
            LastName,
            FirstName,
            cfg_Member_Number__pc,
            cfg_Gender_Identity__pc,
            PersonBirthdate,
            BillingPostalCode,
            PersonMailingPostalCode
        FROM Account
        WHERE FirstName != null
        AND LastName != null
        ORDER BY LastName, FirstName, Id
    `;

    const queryStartDate = new Date();
    const queryStartMs = Date.now();

    logInfo("Running Salesforce query...", scriptStartMs);

    const result = await conn.query(soql).execute({
        autoFetch: true,
        maxFetch: MAX_FETCH,
    });

    const queryEndDate = new Date();
    const queryDurationMs = Date.now() - queryStartMs;

    logSuccess("Salesforce query complete.", queryStartMs);

    console.log(`Query start time: ${formatTimestamp(queryStartDate)}`);
    console.log(`Query end time: ${formatTimestamp(queryEndDate)}`);
    console.log(`Query duration: ${formatDuration(queryDurationMs)}`);
    console.log(`Salesforce total matching records: ${result.totalSize}`);
    console.log(`Records actually fetched: ${result.records.length}`);

    if (result.records.length === 0) {
        logWarn("No records returned. Ending script.");
        return;
    }

    if (result.records.length >= MAX_FETCH) {
        logWarn(
            `Test run stopped at MAX_FETCH=${MAX_FETCH}. Increase MAX_FETCH for a full run.`
        );
    }

    const recordLookup = new Map();

    for (const row of result.records) {
        recordLookup.set(row.Id, row);
    }

    const exactStartMs = Date.now();
    const exactGroups = new Map();

    logInfo("Grouping records for exact duplicate detection...", scriptStartMs);

    for (let i = 0; i < result.records.length; i++) {
        const row = result.records[i];
        const key = makeExactDuplicateKey(row);

        if (!exactGroups.has(key)) {
            exactGroups.set(key, {
                duplicate_key: key,
                LastName: row.LastName,
                FirstName: row.FirstName,
                cfg_Gender_Identity__pc: row.cfg_Gender_Identity__pc,
                PersonBirthdate: row.PersonBirthdate,
                CompositeZip: compositeZip(row),
                duplicate_count: 0,
                record_ids: [],
                member_numbers: [],
            });
        }

        const group = exactGroups.get(key);

        group.duplicate_count += 1;
        group.record_ids.push(row.Id);

        if (row.cfg_Member_Number__pc) {
            group.member_numbers.push(row.cfg_Member_Number__pc);
        }

        if ((i + 1) % PROGRESS_LOG_EVERY_RECORDS === 0) {
            const pct = (((i + 1) / result.records.length) * 100).toFixed(1);

            logInfo(
                `Exact grouping progress: ${i + 1}/${result.records.length} records (${pct}%)`,
                exactStartMs
            );
        }
    }

    logSuccess("Exact duplicate grouping complete.", exactStartMs);

    const exactDuplicateGroups = [...exactGroups.values()]
        .filter((g) => g.duplicate_count > 1)
        .sort((a, b) => {
            if (b.duplicate_count !== a.duplicate_count) {
                return b.duplicate_count - a.duplicate_count;
            }

            const lastNameCompare = String(a.LastName || "").localeCompare(
                String(b.LastName || "")
            );

            if (lastNameCompare !== 0) return lastNameCompare;

            return String(a.FirstName || "").localeCompare(String(b.FirstName || ""));
        });

    const exactDuplicateRecordIds = new Set();

    for (const group of exactDuplicateGroups) {
        for (const recordId of group.record_ids) {
            exactDuplicateRecordIds.add(recordId);
        }
    }

    logExactDuplicateExclusionSummary(exactDuplicateGroups, exactDuplicateRecordIds);

    const exactDuplicates = exactDuplicateGroups.map((g, index) => ({
        row_number: index + 1,
        run_start_time: formatTimestamp(scriptStartDate),
        query_start_time: formatTimestamp(queryStartDate),
        query_end_time: formatTimestamp(queryEndDate),
        query_duration: formatDuration(queryDurationMs),
        duplicate_logic:
            "exact FirstName + exact LastName + exact Gender + exact Birthdate + exact Composite ZIP",
        LastName: g.LastName,
        FirstName: g.FirstName,
        cfg_Gender_Identity__pc: g.cfg_Gender_Identity__pc,
        PersonBirthdate: g.PersonBirthdate,
        CompositeZip: g.CompositeZip,
        duplicate_count: g.duplicate_count,
        record_ids: g.record_ids.join(";"),
        member_numbers: g.member_numbers.join(";"),
    }));

    logInfo(`Writing exact duplicates to ${EXACT_OUTPUT_FILE}...`, scriptStartMs);

    await writeCsv(EXACT_OUTPUT_FILE, exactDuplicates);

    logSuccess(`Exact duplicate file written: ${EXACT_OUTPUT_FILE}`, scriptStartMs);

    const fuzzyStartDate = new Date();
    const fuzzyStartMs = Date.now();

    logInfo("Building fuzzy + strict rule-based match file...", scriptStartMs);

    const recordsAfterExactExclusion = result.records.filter(
        (row) => !exactDuplicateRecordIds.has(row.Id)
    );

    const fuzzyCandidateRecords = recordsAfterExactExclusion.filter((row) => {
        return hasRequiredRuleFields(row);
    });

    const recordsExcludedMissingRuleFields =
        recordsAfterExactExclusion.length - fuzzyCandidateRecords.length;

    logFuzzyCandidateFilterSummary({
        baseRecordsFetched: result.records.length,
        exactDuplicateRecordIdsExcluded: exactDuplicateRecordIds.size,
        recordsAfterExactExclusion: recordsAfterExactExclusion.length,
        recordsExcludedMissingRuleFields,
        finalFuzzyCandidateRecords: fuzzyCandidateRecords.length,
    });

    const ruleBlocks = new Map();

    for (let i = 0; i < fuzzyCandidateRecords.length; i++) {
        const row = fuzzyCandidateRecords[i];
        const ruleKey = makeRuleKey(row);

        if (!ruleBlocks.has(ruleKey)) {
            ruleBlocks.set(ruleKey, []);
        }

        ruleBlocks.get(ruleKey).push(row);

        if ((i + 1) % PROGRESS_LOG_EVERY_RECORDS === 0) {
            const pct = (((i + 1) / fuzzyCandidateRecords.length) * 100).toFixed(1);

            logInfo(
                `Fuzzy rule block build progress: ${i + 1}/${fuzzyCandidateRecords.length} records (${pct}%)`,
                fuzzyStartMs
            );
        }
    }

    logSuccess(`Fuzzy rule block build complete. Blocks created: ${ruleBlocks.size}`, fuzzyStartMs);
    logRuleBlockSummary(ruleBlocks);

    const fuzzyMatches = [];
    const seenFuzzyPairs = new Set();

    let pairsCompared = 0;
    let pairsSkippedExactCleanName = 0;
    let pairsSkippedBelowThreshold = 0;
    let pairsSkippedNotStrictRule = 0;
    let blocksProcessed = 0;

    logInfo("Starting fuzzy comparisons...", fuzzyStartMs);

    for (const [ruleKey, blockRows] of ruleBlocks.entries()) {
        blocksProcessed += 1;

        if (blockRows.length < 2) continue;

        for (let i = 0; i < blockRows.length; i++) {
            for (let j = i + 1; j < blockRows.length; j++) {
                pairsCompared += 1;

                const rowA = blockRows[i];
                const rowB = blockRows[j];

                const pairKey = [rowA.Id, rowB.Id].sort().join("|");

                if (seenFuzzyPairs.has(pairKey)) continue;

                seenFuzzyPairs.add(pairKey);

                const firstNameScore = similarityScore(rowA.FirstName, rowB.FirstName);
                const lastNameScore = similarityScore(rowA.LastName, rowB.LastName);

                const exactCleanFirstNameMatch = firstNameScore === 100;
                const exactCleanLastNameMatch = lastNameScore === 100;

                if (exactCleanFirstNameMatch && exactCleanLastNameMatch) {
                    pairsSkippedExactCleanName += 1;
                    continue;
                }

                const combinedNameScore = Math.round(
                    firstNameScore * 0.45 + lastNameScore * 0.55
                );

                if (combinedNameScore < FUZZY_THRESHOLD) {
                    pairsSkippedBelowThreshold += 1;
                    continue;
                }

                const ruleFlags = getRuleFlags(rowA, rowB);

                if (ruleFlags.strict_rule_match_flag !== 1) {
                    pairsSkippedNotStrictRule += 1;
                    continue;
                }

                const fuzzyReasons = getFuzzyMatchReason({
                    rowA,
                    rowB,
                    firstNameScore,
                    lastNameScore,
                    combinedNameScore,
                    ruleFlags,
                });

                fuzzyMatches.push({
                    rule_key: ruleKey,
                    fuzzy_threshold: FUZZY_THRESHOLD,

                    fuzzy_match_reason: fuzzyReasons.fuzzy_match_reason,
                    name_difference_reason: fuzzyReasons.name_difference_reason,
                    first_name_difference_reason: fuzzyReasons.first_name_difference_reason,
                    last_name_difference_reason: fuzzyReasons.last_name_difference_reason,
                    rule_match_reason: fuzzyReasons.rule_match_reason,

                    match_score_combined_name: combinedNameScore,
                    match_score_first_name: firstNameScore,
                    match_score_last_name: lastNameScore,
                    exact_clean_first_name_match_flag: exactCleanFirstNameMatch ? 1 : 0,
                    exact_clean_last_name_match_flag: exactCleanLastNameMatch ? 1 : 0,
                    ...ruleFlags,

                    record_id_1: rowA.Id,
                    member_number_1: rowA.cfg_Member_Number__pc,
                    first_name_1: rowA.FirstName,
                    last_name_1: rowA.LastName,
                    full_name_1: makeFullName(rowA),
                    clean_full_name_1: makeCleanFullName(rowA),
                    gender_1: rowA.cfg_Gender_Identity__pc,
                    birthdate_1: rowA.PersonBirthdate,
                    composite_zip_1: compositeZip(rowA),
                    billing_zip_1: rowA.BillingPostalCode,
                    mailing_zip_1: rowA.PersonMailingPostalCode,

                    record_id_2: rowB.Id,
                    member_number_2: rowB.cfg_Member_Number__pc,
                    first_name_2: rowB.FirstName,
                    last_name_2: rowB.LastName,
                    full_name_2: makeFullName(rowB),
                    clean_full_name_2: makeCleanFullName(rowB),
                    gender_2: rowB.cfg_Gender_Identity__pc,
                    birthdate_2: rowB.PersonBirthdate,
                    composite_zip_2: compositeZip(rowB),
                    billing_zip_2: rowB.BillingPostalCode,
                    mailing_zip_2: rowB.PersonMailingPostalCode,

                    not_in_exact_duplicate_file_flag: 1,
                    fuzzy_match_logic:
                        "fuzzy first/last name score >= threshold AND same gender AND same birthdate AND same composite zip AND not exact same cleaned name",
                });

                if (fuzzyMatches.length % 100 === 0) {
                    logInfo(
                        `Fuzzy matches found so far: ${fuzzyMatches.length.toLocaleString()}`,
                        fuzzyStartMs
                    );
                }

                if (pairsCompared % PROGRESS_LOG_EVERY_PAIRS === 0) {
                    logInfo(
                        `Fuzzy compare progress: ${pairsCompared.toLocaleString()} pairs compared, ${fuzzyMatches.length.toLocaleString()} matches found, ${blocksProcessed}/${ruleBlocks.size} blocks processed`,
                        fuzzyStartMs
                    );
                }
            }
        }
    }

    logSuccess(`Fuzzy comparison complete. Pair matches found: ${fuzzyMatches.length.toLocaleString()}`, fuzzyStartMs);

    const fuzzyEndDate = new Date();
    const fuzzyDurationMs = Date.now() - fuzzyStartMs;

    const fuzzyMatchesFinal = fuzzyMatches
        .sort((a, b) => {
            if (b.match_score_combined_name !== a.match_score_combined_name) {
                return b.match_score_combined_name - a.match_score_combined_name;
            }

            if (b.match_score_last_name !== a.match_score_last_name) {
                return b.match_score_last_name - a.match_score_last_name;
            }

            return String(a.full_name_1 || "").localeCompare(String(b.full_name_1 || ""));
        })
        .map((row, index) => ({
            row_number: index + 1,
            run_start_time: formatTimestamp(scriptStartDate),
            query_start_time: formatTimestamp(queryStartDate),
            query_end_time: formatTimestamp(queryEndDate),
            query_duration: formatDuration(queryDurationMs),
            fuzzy_start_time: formatTimestamp(fuzzyStartDate),
            fuzzy_end_time: formatTimestamp(fuzzyEndDate),
            fuzzy_duration: formatDuration(fuzzyDurationMs),
            ...row,
        }));

    logInfo(`Writing fuzzy pair matches to ${FUZZY_PAIR_OUTPUT_FILE}...`, scriptStartMs);

    await writeCsv(FUZZY_PAIR_OUTPUT_FILE, fuzzyMatchesFinal);

    logSuccess(`Fuzzy pair match file written: ${FUZZY_PAIR_OUTPUT_FILE}`, scriptStartMs);

    logInfo("Building fuzzy grouped duplicate file...", scriptStartMs);

    const fuzzyGroupsRaw = buildFuzzyGroups(fuzzyMatchesFinal, recordLookup);

    const fuzzyGroupsFinal = fuzzyGroupsRaw.map((group, index) => ({
        row_number: index + 1,
        run_start_time: formatTimestamp(scriptStartDate),
        query_start_time: formatTimestamp(queryStartDate),
        query_end_time: formatTimestamp(queryEndDate),
        query_duration: formatDuration(queryDurationMs),
        fuzzy_start_time: formatTimestamp(fuzzyStartDate),
        fuzzy_end_time: formatTimestamp(fuzzyEndDate),
        fuzzy_duration: formatDuration(fuzzyDurationMs),
        ...group,
    }));

    logSuccess(`Fuzzy groups built. Groups found: ${fuzzyGroupsFinal.length.toLocaleString()}`, scriptStartMs);
    logInfo(`Writing fuzzy groups to ${FUZZY_GROUP_OUTPUT_FILE}...`, scriptStartMs);

    await writeCsv(FUZZY_GROUP_OUTPUT_FILE, fuzzyGroupsFinal);

    logSuccess(`Fuzzy group file written: ${FUZZY_GROUP_OUTPUT_FILE}`, scriptStartMs);

    const scriptEndDate = new Date();
    const scriptDurationMs = Date.now() - scriptStartMs;

    console.log("");
    console.log(colorize("bright", "Summary"));
    console.log(colorize("bright", "-------"));
    console.log(`Script start time: ${formatTimestamp(scriptStartDate)}`);
    console.log(`Script end time: ${formatTimestamp(scriptEndDate)}`);
    console.log(`Script duration: ${formatDuration(scriptDurationMs)}`);
    console.log(`Query start time: ${formatTimestamp(queryStartDate)}`);
    console.log(`Query end time: ${formatTimestamp(queryEndDate)}`);
    console.log(`Query duration: ${formatDuration(queryDurationMs)}`);
    console.log(`Fuzzy start time: ${formatTimestamp(fuzzyStartDate)}`);
    console.log(`Fuzzy end time: ${formatTimestamp(fuzzyEndDate)}`);
    console.log(`Fuzzy duration: ${formatDuration(fuzzyDurationMs)}`);
    console.log(`Total records scanned: ${result.records.length}`);
    console.log(`Salesforce total matching records: ${result.totalSize}`);
    console.log(`Hardcoded MAX_FETCH: ${MAX_FETCH}`);
    console.log(`Hardcoded FUZZY_THRESHOLD: ${FUZZY_THRESHOLD}`);
    console.log(`Unique exact duplicate-check groups: ${exactGroups.size}`);
    console.log(`Exact duplicate groups found: ${exactDuplicates.length}`);
    console.log(`Exact duplicate record IDs excluded from fuzzy files: ${exactDuplicateRecordIds.size}`);
    console.log(`Records after exact duplicate exclusion: ${recordsAfterExactExclusion.length}`);
    console.log(`Records excluded from fuzzy because missing gender/birthdate/zip: ${recordsExcludedMissingRuleFields}`);
    console.log(`Fuzzy candidate records scanned after exact exclusion and required-rule filters: ${fuzzyCandidateRecords.length}`);
    console.log(`Fuzzy rule blocks created: ${ruleBlocks.size}`);
    console.log(`Fuzzy pairs compared: ${pairsCompared.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - exact cleaned first/last name: ${pairsSkippedExactCleanName.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - below threshold: ${pairsSkippedBelowThreshold.toLocaleString()}`);
    console.log(`Fuzzy pairs skipped - not strict gender/birthdate/zip rule: ${pairsSkippedNotStrictRule.toLocaleString()}`);
    console.log(colorize("green", `Fuzzy pair matches found: ${fuzzyMatchesFinal.length.toLocaleString()}`));
    console.log(colorize("green", `Fuzzy groups found: ${fuzzyGroupsFinal.length.toLocaleString()}`));
    console.log(`Exact duplicate output written to: ${EXACT_OUTPUT_FILE}`);
    console.log(`Fuzzy pair output written to: ${FUZZY_PAIR_OUTPUT_FILE}`);
    console.log(`Fuzzy group output written to: ${FUZZY_GROUP_OUTPUT_FILE}`);
}

if (require.main === module) {
    console.log(colorize("bright", "\nStarting data load."));

    main()
        .then(() => {
            logSuccess("Done.");
        })
        .catch((error) => {
            logError("Error during data load:");
            console.error(error);
            process.exit(1);
        });
}

module.exports = {
    execute_get_salesforce_duplicates_data: main,
};