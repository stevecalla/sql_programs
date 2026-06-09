/**
 * zip_trim.js — Build a human-reviewable record of how composite ZIPs were
 * trimmed to their first five digits (see src/normalize.js -> trim_zip5).
 *
 * Pure (no I/O): takes the fetched Salesforce rows and returns the distinct
 * raw -> trimmed ZIP mappings (only where the trim actually changed the value)
 * plus summary counts. The orchestrator writes the mapping to the meta folder
 * and logs the summary so a reviewer can confirm the ZIP normalization did what
 * they expect (and catch any surprises, e.g. an international code that happened
 * to start with five digits).
 */

'use strict';

const { composite_zip_raw, trim_zip5 } = require('./normalize');

// Build the raw -> trimmed mapping across all records.
// Returns:
//   {
//     total_records,            // records examined
//     records_with_zip,         // records that had a (raw) composite ZIP
//     records_trimmed,          // records whose ZIP changed after the trim
//     mapping: [                // distinct changed mappings, sorted by count desc
//       { raw_composite_zip, trimmed_composite_zip, record_count }, ...
//     ],
//   }
function build_zip_trim_mapping(records) {
    const counts = new Map(); // raw -> { raw, trimmed, record_count }

    let records_with_zip = 0;
    let records_trimmed = 0;

    for (const row of records) {
        const raw = composite_zip_raw(row);
        if (raw === "") continue;
        records_with_zip += 1;

        const trimmed = trim_zip5(raw);
        if (trimmed === raw) continue; // unchanged — not interesting to review
        records_trimmed += 1;

        const existing = counts.get(raw);
        if (existing) {
            existing.record_count += 1;
        } else {
            counts.set(raw, { raw_composite_zip: raw, trimmed_composite_zip: trimmed, record_count: 1 });
        }
    }

    const mapping = [...counts.values()].sort((a, b) => {
        if (b.record_count !== a.record_count) return b.record_count - a.record_count;
        return a.raw_composite_zip.localeCompare(b.raw_composite_zip);
    });

    return {
        total_records: records.length,
        records_with_zip,
        records_trimmed,
        mapping,
    };
}

module.exports = { build_zip_trim_mapping };
