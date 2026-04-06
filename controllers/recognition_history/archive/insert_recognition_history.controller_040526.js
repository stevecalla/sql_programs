const { execute_run_recognition_data_history_jobs } = require('../../src/revenue_recognition_history/step_0_run_recognition_history_jobs_040326');
const { send_slack_followup_message } = require('../../utilities/slack_messaging/send_message_api_v2_followup');
const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');
const { start_delayed_still_working_timer, format_duration_ms } = require('../../utilities/slack_messaging/send_delayed_still_working_message');

function get_prior_month_year_month() {
    const now = new Date();
    const prior_month_date = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    return {
        history_year: prior_month_date.getFullYear(),
        history_month: prior_month_date.getMonth() + 1,
    };
}

function parse_history_params(parsed) {
    const default_date = get_prior_month_year_month();

    const history_year = parsed.year ?? default_date.history_year;
    const history_month = parsed.month ?? default_date.history_month;

    return {
        history_year: Number(history_year),
        history_month: Number(history_month),
    };
}

function get_response_url(req) {
    if (req.body && Object.keys(req.body).length === 0) {
        return process.env.SLACK_WEBHOOK_STEVE_CALLA_USAT_URL;
    }

    return req?.body?.response_url;
}

async function insert_recognition_history_controller(req, res) {
    console.log('🚀 [INSERT] Request received - /insert-recognition-history', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req?.body?.text,
        response_url: req?.body?.response_url,
    });

    const {
        channel_id,
        channel_name,
        user_id,
    } = req.body || {};

    const response_url = get_response_url(req);

    // 🔐 PASSWORD VALIDATION
    const auth = validate_command_password(req);

    if (!auth.is_valid) {
        console.warn('⛔ [INSERT] Authorization failed:', auth.error);

        return res.status(auth.status).json({
            text: auth.error,
        });
    }

    const parsed = auth.parsed;
    const { history_year, history_month } = parse_history_params(parsed);

    const is_valid_year =
        Number.isInteger(history_year) &&
        history_year >= 2000 &&
        history_year <= 2100;

    const is_valid_month =
        Number.isInteger(history_month) &&
        history_month >= 1 &&
        history_month <= 12;

    if (!is_valid_year || !is_valid_month) {
        return res.status(200).json({
            text: '⚠️ Invalid input. Use `/rec_history_insert password=` or `/rec_history_insert password= year=2026 month=3`.',
        });
    }

    const start_time_ms = Date.now();

    console.log(`⚙️ [INSERT] Starting job year=${history_year} month=${history_month}`);

    res.status(200).json({
        text: `🚀 Recognition history job started for year=${history_year} month=${history_month}. Will respond shortly.`,
    });

    const send_insert_followup_message = async (slack_message) => {
        console.log('📣 [INSERT] Sending Slack follow-up message');

        await send_slack_followup_message(
            channel_id,
            channel_name,
            user_id,
            response_url,
            slack_message
        );
    };

    const still_working_timer = start_delayed_still_working_timer({
        delay_ms: undefined,
        interval_ms: undefined,
        job_label: `Recognition history insert for year=${history_year} month=${history_month}`,
        send_message_fn: send_insert_followup_message,
        start_time_ms,
    });

    try {
        await execute_run_recognition_data_history_jobs(history_year, history_month);

        still_working_timer.finish();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.log(`✅ [INSERT] Completed year=${history_year} month=${history_month} duration=${duration}`);

        const slack_message = `📊 Recognition history job complete for year=${history_year} month=${history_month}. ✅\n⏱️ Duration: ${duration}`;

        // await send_insert_followup_message(slack_message);
        console.log('ℹ️ [INSERT] Final completion message handled by webhook-based pipeline messaging.');

    } catch (error) {
        still_working_timer.finish();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.error(`❌ [INSERT] Failed year=${history_year} month=${history_month} duration=${duration}`, error);

        const slack_message = `📊 Recognition history job failed for year=${history_year} month=${history_month}. ❌ Error: ${error.message || 'Internal Server Error'}\n⏱️ Duration: ${duration}`;

        try {
            await send_insert_followup_message(slack_message);
        } catch (followup_error) {
            console.error('❌ [INSERT] Error sending slack follow-up message.', followup_error);
        }
    }
}

module.exports = {
    insert_recognition_history_controller,
};