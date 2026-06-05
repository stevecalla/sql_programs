/**
 * step_2a_create_duplicate_message.js — Build the Slack summary text for the
 * duplicate report (used as the message that accompanies the uploaded files,
 * and as the /stats response).
 *
 * Returns { main_message_text, warning } where `warning` is the freshness-guard
 * warning (or null) — the server also passes it as the file-attachment comment.
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
            warning: null,
        };
    }

    // Freshness-guard warning: user asked mode=run but we returned the existing
    // files because they're still inside the window. Make it loud + clear.
    let warning = null;
    if (!regenerated && mode === 'run' && age_minutes != null) {
        const mins = Math.round(age_minutes);
        const age = mins <= 0 ? 'under a minute' : `${mins} min`;
        const win = fresh_window_minutes != null ? `${fresh_window_minutes} min` : 'the freshness window';
        warning =
            `⚠️ *Heads up — these are the EXISTING files, not a fresh run.* ` +
            `You asked for \`mode=run\`, but the latest output is only ${age} old ` +
            `(within the ${win} window), so Salesforce was *not* re-queried. ` +
            `To force a brand-new run, use \`mode=run force=true\`.`;
    }

    const lines = [];
    lines.push('🔁 *Salesforce duplicate report*');
    if (warning) lines.push(warning);
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
        lines.push(`• Generated ${mins <= 0 ? 'just now' : `${mins} min ago`}.`);
    }

    return { main_message_text: lines.join('\n'), warning };
}

module.exports = { create_duplicate_message };
