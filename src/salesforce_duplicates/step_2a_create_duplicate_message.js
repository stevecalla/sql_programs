/**
 * step_2a_create_duplicate_message.js — Build the Slack summary text for the
 * duplicate report (used as the message that accompanies the uploaded files,
 * and as the /stats response).
 */

'use strict';

// counts:   { exact, fuzzy_pair, fuzzy_group }
// options:  { file_selector, age_minutes, mode, regenerated, has_output }
function create_duplicate_message(counts = {}, options = {}) {
    const {
        file_selector = 'all',
        age_minutes = null,
        mode = 'latest',
        regenerated = false,
        has_output = true,
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
        const note = mode === 'run' ? ' (within the freshness window — returning latest)' : '';
        lines.push(`• Generated ${when}${note}.`);
    }

    return { main_message_text: lines.join('\n') };
}

module.exports = { create_duplicate_message };
