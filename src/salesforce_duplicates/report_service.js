/**
 * report_service.js — slash-command argument parsing + report resolution for
 * the Slack server (server_salesforce_duplicates_8017.js).
 *
 * Pulled out of the server so this glue (which has been the source of runtime
 * bugs) is unit-testable. resolve_report's dependencies are injectable so it
 * can be tested without Salesforce.
 */

'use strict';

const { FRESH_OUTPUT_WINDOW_MINUTES } = require('./config');
const { execute_get_duplicate_report } = require('./step_2_get_duplicate_report');
const { execute_get_salesforce_duplicates_data } = require('./step_1_find_duplicates');

// Parse the slash-command "text" (space-separated key=value pairs) into
// { mode, file, force }. Values also accepted as ?query params (direct curl).
// Mirrors the arg-parsing pattern in server_slack_events.js.
function parse_report_args(req) {
    let mode = req.query?.mode ?? null;     // 'latest' | 'run'
    let file = req.query?.file ?? null;     // 'all' | 'exact' | 'fuzzy_pair' | 'fuzzy_group'
    let force = req.query?.force ?? null;   // 'true' bypasses the freshness window

    if (req.body && Object.keys(req.body).length > 0 && req.body.text) {
        const args = req.body.text.trim().split(/\s+/);
        for (const arg of args) {
            const [key, value] = arg.split('=');
            if (key && value) {
                const normalizedKey = key.toLowerCase();
                switch (normalizedKey) {
                    case 'mode':
                        if (!mode) mode = value;
                        break;
                    case 'file':
                        if (!file) file = value;
                        break;
                    case 'force':
                        if (!force) force = value;
                        break;
                    default:
                        console.warn(`Unknown parameter: ${key}`);
                }
            }
        }
    }

    // Defaults: latest (no Salesforce pull), all files, no force.
    mode = (mode ?? '').trim() || 'latest';
    file = (file ?? '').trim() || 'all';
    const force_bool = String(force ?? '').trim().toLowerCase() === 'true';
    return { mode, file, force: force_bool };
}

// Resolve the report. mode=run regenerates against production when the latest
// output is older than the freshness window — OR whenever force=true is set
// (which bypasses the window). Otherwise it returns the latest files as-is.
//
// deps is injectable for testing:
//   get_report(file)   -> the latest report (defaults to step_2)
//   regenerate(is_test) -> run the finder (defaults to step_1; called with false = production)
//   window_minutes     -> freshness window (defaults to config)
async function resolve_report({ mode, file, force = false }, deps = {}) {
    const {
        get_report = execute_get_duplicate_report,
        regenerate = execute_get_salesforce_duplicates_data,
        window_minutes = FRESH_OUTPUT_WINDOW_MINUTES,
    } = deps;

    let report = await get_report(file);
    let regenerated = false;

    const stale = report.age_minutes == null || report.age_minutes > window_minutes;

    if (mode === 'run' && (force || stale)) {
        const why = force ? 'force=true (bypassing freshness window)' : `output stale (age=${report.age_minutes})`;
        console.log(`mode=run — regenerating (production); ${why}...`);
        await regenerate(false); // server always regenerates against production
        report = await get_report(file);
        regenerated = true;
    }

    return { ...report, mode, regenerated };
}

module.exports = { parse_report_args, resolve_report };
