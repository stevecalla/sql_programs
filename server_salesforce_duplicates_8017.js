const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8017;

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = true;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// SALESFORCE DUPLICATES PIPELINE + REPORT
const { execute_get_salesforce_duplicates_data } = require('./src/salesforce_duplicates/step_1_find_duplicates');
const { execute_get_duplicate_report } = require('./src/salesforce_duplicates/step_2_get_duplicate_report');
const { create_duplicate_message } = require('./src/salesforce_duplicates/step_2a_create_duplicate_message');
const { FRESH_OUTPUT_WINDOW_MINUTES } = require('./src/salesforce_duplicates/config');

// SLACK MESSAGING UTILITIES (shared with the other servers)
const { send_slack_followup_message } = require('./utilities/slack_messaging/send_message_api_v2_followup');
const { slack_message_api } = require('./utilities/slack_messaging/slack_message_api');
const {
    upload_single_file_to_thread_scheduled,
    upload_single_file_to_thread_user,
} = require('./utilities/slack_messaging/slack_message_api_attachment');

// Channel the scheduled job posts to (defaults to the test channel).
const SF_DUP_CHANNEL_ID = process.env.SF_DUP_CHANNEL_ID || 'C08TMBPTKEC';

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ─────────────────────────────────────────────────────────────────────────────
// SLASH COMMAND OPTIONS  (used by /salesforce-duplicates-stats and
// /salesforce-duplicates-reporting)
//
// Pass options in the slash command `text` as space-separated key=value pairs
// (they also work as ?query params when hitting the route directly with curl):
//
//   mode=latest | run
//       latest (DEFAULT) — return the most recent CSV(s) already on disk, no
//                          Salesforce pull. Fast.
//       run            — regenerate against PRODUCTION first, then return — BUT
//                          only if the newest output file is older than
//                          FRESH_OUTPUT_WINDOW_MINUTES (config, currently
//                          ${FRESH_OUTPUT_WINDOW_MINUTES} min). Inside that window it
//                          returns the latest instead, so rapid repeat calls
//                          don't hammer Salesforce.
//
//   force=true
//       Bypass the freshness window. `mode=run force=true` ALWAYS regenerates,
//       even if the latest output is brand new. (Ignored unless mode=run.)
//
//   file=all | exact | fuzzy_pair | fuzzy_group
//       Which file(s) to return (DEFAULT all). 'all' returns every CSV in the
//       output folder; a specific value returns just that one.
//
// Examples:
//   /duplicates                      -> latest, all files
//   /duplicates mode=run             -> regenerate if older than the window, else latest
//   /duplicates mode=run force=true  -> always regenerate
//   /duplicates file=exact           -> latest exact-duplicates file only
// ─────────────────────────────────────────────────────────────────────────────

// Parse the slash-command "text" (key=value pairs) into { mode, file, force }.
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
async function resolve_report({ mode, file, force = false }) {
    let report = await execute_get_duplicate_report(file);
    let regenerated = false;

    const stale = report.age_minutes == null || report.age_minutes > FRESH_OUTPUT_WINDOW_MINUTES;

    if (mode === 'run' && (force || stale)) {
        const why = force ? 'force=true (bypassing freshness window)' : `output stale (age=${report.age_minutes})`;
        console.log(`mode=run — regenerating (production); ${why}...`);
        await execute_get_salesforce_duplicates_data(false); // server always regenerates against production
        report = await execute_get_duplicate_report(file);
        regenerated = true;
    }

    return { ...report, mode, regenerated };
}

// ===========================
// GET /salesforce-duplicates-test  — health check
//   curl        curl http://localhost:8017/salesforce-duplicates-test
//   cloudflare  https://usat-salesforce-duplicates.kidderwise.org/salesforce-duplicates-test
// ===========================
app.get('/salesforce-duplicates-test', async (req, res) => {
    console.log('/salesforce-duplicates-test route req.rawHeaders = ', req.rawHeaders);

    try {
        res.status(200).json({
            message: 'Salesforce duplicates server is up and running. Stands Ready.',
        });
    } catch (error) {
        console.error('Error in salesforce duplicates test endpoint.', error);
        res.status(500).json({
            message: 'Error in salesforce duplicates test endpoint.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// ===========================
// POST /salesforce-duplicates-stats  — slash command; return latest run's counts (no files)
//   options: mode=latest|run  force=true  file=all|exact|fuzzy_pair|fuzzy_group  (see SLASH COMMAND OPTIONS above)
//   curl        curl -X POST http://localhost:8017/salesforce-duplicates-stats -d "text=mode=latest file=all"
//   cloudflare  https://usat-salesforce-duplicates.kidderwise.org/salesforce-duplicates-stats
// ===========================
app.post('/salesforce-duplicates-stats', async (req, res) => {
    console.log('Received request for salesforce duplicates - /salesforce-duplicates-stats :', {
        body: req.body,
        text: req.body.text,
        response_url: req.body.response_url,
    });

    const { channel_id, channel_name, user_id } = req.body;

    // mirrors server_slack_events.js: implicit-global response_url fallback
    if (req.body && Object.keys(req.body).length === 0)
        response_url = process.env.SLACK_WEBHOOK_STEVE_CALLA_USAT_URL;
    else
        response_url = req.body.response_url;

    const { mode, file, force } = parse_report_args(req);

    try {
        res.status(200).json({
            text: `Retrieving Salesforce duplicate stats. Will respond shortly.\nMode=${mode}, File=${file}${force ? ', Force=true' : ''}`,
        });

        // STEP 1: GET REPORT (optionally regenerate)
        const report = await resolve_report({ mode, file, force });

        // STEP 2: CREATE SLACK MESSAGE
        const { main_message_text } = create_duplicate_message(report.counts, {
            file_selector: file,
            age_minutes: report.age_minutes,
            mode,
            regenerated: report.regenerated,
            has_output: report.has_output,
            total_records_scanned: report.total_records_scanned,
            fresh_window_minutes: FRESH_OUTPUT_WINDOW_MINUTES,
        });

        // STEP 3: SEND SLACK MESSAGE (text only, no files)
        await send_slack_followup_message(channel_id, channel_name, user_id, response_url, main_message_text, []);
    } catch (error) {
        console.error('Error querying or sending salesforce duplicate stats.', error);
        res.status(500).json({
            message: 'Error querying or sending salesforce duplicate stats.',
            error: error.message || 'Internal Server Error',
        });
    }
});

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (a full prod run can be long)
let isRunning = false;
let lockTimeout;

// ===========================
// GET /scheduled-salesforce-duplicates  — cron; regenerate + post files to a channel
//   drive with ?is_test=true (dev sandbox) or ?is_test=false (production, default)
//   curl        curl "http://localhost:8017/scheduled-salesforce-duplicates?is_test=false"
//   cloudflare  https://usat-salesforce-duplicates.kidderwise.org/scheduled-salesforce-duplicates
// ===========================
app.get('/scheduled-salesforce-duplicates', async (req, res) => {
    const { v4: uuidv4 } = require('uuid');
    const jobId = uuidv4();
    console.log(`Started Salesforce duplicates job ${jobId}`);

    if (isRunning) {
        const is_running_message = '/scheduled-salesforce-duplicates = Salesforce duplicates job is already running. Please try again later.';

        const YELLOW = '\x1b[33m';
        const RESET = '\x1b[0m';

        console.warn(`${YELLOW}⚠️ ${is_running_message} ${RESET}`);
        console.log(`Finished Salesforce duplicates job ${jobId}`);

        return res.status(429).json({ message: is_running_message });
    }
    isRunning = true;

    lockTimeout = setTimeout(() => {
        console.warn('Salesforce duplicates job timed out.');
        console.log(`Finished Salesforce duplicates job ${jobId}`);
        isRunning = false;
    }, TIMEOUT_MS);

    try {
        // Drive the run with ?is_test=true|false (default false = production).
        const is_test = String(req.query?.is_test ?? '').toLowerCase() === 'true';
        console.log(`Scheduled run mode: ${is_test ? 'TEST (dev sandbox)' : 'PRODUCTION'}`);

        // STEP 1: REGENERATE THE DUPLICATE FILES
        await execute_get_salesforce_duplicates_data(is_test);

        // STEP 2: READ THE FRESH REPORT
        const report = await execute_get_duplicate_report('all');

        // STEP 3: CREATE SLACK MESSAGE
        const { main_message_text } = create_duplicate_message(report.counts, {
            file_selector: 'all',
            age_minutes: report.age_minutes,
            mode: 'run',
            regenerated: true,
            has_output: report.has_output,
            total_records_scanned: report.total_records_scanned,
            fresh_window_minutes: FRESH_OUTPUT_WINDOW_MINUTES,
        });

        // STEP 4: POST FILES TO CHANNEL
        // (pass null for month/type/is_reported — not relevant to duplicates)
        await upload_single_file_to_thread_scheduled(
            report.file_directory,
            report.file_path,
            SF_DUP_CHANNEL_ID,
            main_message_text,
            undefined,
            undefined,
            null,
            null,
            null,
        );

        res.status(200).json({
            message: 'Salesforce duplicates queried & sent successfully.',
        });
    } catch (error) {
        console.error('Error querying or sending salesforce duplicates data.', error);
        res.status(500).json({
            message: 'Error querying or sending salesforce duplicates data.',
            error: error.message || 'Internal Server Error',
        });
    } finally {
        console.log(`Finished Salesforce duplicates job ${jobId}`);
        clearTimeout(lockTimeout);
        isRunning = false;
    }
});

// ===========================
// POST /salesforce-duplicates-reporting  — slash /duplicates; DM the CSV file(s) + stats to the user
//   options: mode=latest|run  force=true  file=all|exact|fuzzy_pair|fuzzy_group  (see SLASH COMMAND OPTIONS above)
//   curl        curl -X POST http://localhost:8017/salesforce-duplicates-reporting -d "text=mode=run force=true file=all"
//   cloudflare  https://usat-salesforce-duplicates.kidderwise.org/salesforce-duplicates-reporting
// ===========================
app.post('/salesforce-duplicates-reporting', async (req, res) => {
    console.log('Received request for salesforce duplicates - /salesforce-duplicates-reporting :', {
        body: req.body,
        text: req.body.text,
        response_url: req.body.response_url,
    });

    const { channel_id, channel_name, user_id } = req.body;

    // mirrors server_slack_events.js: implicit-global response_url fallback
    if (req.body && Object.keys(req.body).length === 0)
        response_url = process.env.SLACK_WEBHOOK_STEVE_CALLA_USAT_URL;
    else
        response_url = req.body.response_url;

    const { mode, file, force } = parse_report_args(req);

    try {
        res.status(200).json({
            text: `Retrieving Salesforce duplicate report. Will respond shortly.\nMode=${mode}, File=${file}${force ? ', Force=true' : ''}`,
        });

        // STEP 1: GET REPORT (optionally regenerate when mode=run and stale, or force=true)
        const report = await resolve_report({ mode, file, force });

        // STEP 2: CREATE SLACK MESSAGE (stats summary travels with the files)
        const { main_message_text } = create_duplicate_message(report.counts, {
            file_selector: file,
            age_minutes: report.age_minutes,
            mode,
            regenerated: report.regenerated,
            has_output: report.has_output,
            total_records_scanned: report.total_records_scanned,
            fresh_window_minutes: FRESH_OUTPUT_WINDOW_MINUTES,
        });

        // STEP 3: SEND FILE(S) + STATS TO THE USER (DM)
        // (pass null for month/type/is_reported — not relevant to duplicates)
        await upload_single_file_to_thread_user(
            report.file_directory,
            report.file_path,
            channel_id,
            main_message_text,
            channel_name,
            user_id,
            null,
            null,
            null,
        );
    } catch (error) {
        console.error('Error querying or sending salesforce duplicate report.', error);
        res.status(500).json({
            message: 'Error querying or sending salesforce duplicate report.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Clean up on exit
async function cleanup() {
    console.log('\nGracefully shutting down...');
    process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start server
app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);

    // CLOUDFLARE TUNNEL
    console.log(`Tunnel using cloudflare https://usat-salesforce-duplicates.kidderwise.org/salesforce-duplicates-test`);

    // NGROK TUNNEL
    if (is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});
