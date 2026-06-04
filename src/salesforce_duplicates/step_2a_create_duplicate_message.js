/**
 * step_2a_create_duplicate_message.js — Build the Slack summary text for the
 * duplicate report (used as the message that accompanies the uploaded files,
 * and as the /stats response).
 */

'use strict';

// counts:   { exact, fuzzy_pair, fuzzy_group }
// options:  { file_selector, age_minutes, mode, regenerated, has_output,
//             total_records_scanned, fresh_window_minutes }
function create_duplicate_message(counts = {}, options = {}) {
    const {
        file_selector = 'all',
        age_minutes = null,
        mode = 'latest',
        regenerated = false,
        has_output = true,
        total_records_scanned = null,
        fresh_window_minutes = null,
    } = options;

    if (!has_output) {
        return {
            main_message_text:
                '⚠️ No Salesforce duplicate output found yet. Run the finder first ' +
                '(`node step_1_find_duplicates.js --prod`) or use `mode=run`.',
        };
    }

    const lines = [];
    lines.push('🔁 *Salesforce duplicate report*');
    if (total_records_scanned != null) {
        lines.push(`• Total records scanned: ${Number(total_records_scanned).toLocaleString()}`);
    }
    lines.push(`• Exact duplicate groups: ${counts.exact ?? 0}`);
    lines.push(`• Fuzzy name pair matches: ${counts.fuzzy_pair ?? 0}`);
    lines.push(`• Fuzzy name groups: ${counts.fuzzy_group ?? 0}`);

    if (file_selector && file_selector !== 'all') {
        lines.push(`• File: ${file_selector}`);
    }

    if (regenerated) {
        lines.push('• Freshly regenerated for this request.');
    } else if (age_minutes != null) {
        const mins = Math.round(age_minutes);
        const when = mins <= 0 ? 'just now' : `${mins} min ago`;
        lines.push(`• Generated ${when}.`);
        // mode=run but we returned the latest because the output is still inside
        // the freshness window — tell the user why, and how to force a re-run.
        if (mode === 'run') {
            const win = fresh_window_minutes != null ? `${fresh_window_minutes} minutes` : 'the freshness window';
            lines.push(
                `• Returned the latest files instead of re-running — the output is newer than ${win}, ` +
                'so Salesforce was not re-queried. Add `force=true` to regenerate anyway ' +
                '(e.g. `mode=run force=true`).'
            );
        }
    }

    return { main_message_text: lines.join('\n') };
}

module.exports = { create_duplicate_message };
