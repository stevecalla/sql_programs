const { execute_run_recognition_data_history_jobs } = require('../../src/revenue_recognition_history/step_0_run_recognition_history_jobs_050325');
const { send_slack_followup_message } = require('../../utilities/slack_messaging/send_message_api_v2_followup');

const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');

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
            text: '⚠️ Invalid input. Use `/rec_history_insert password=xxx` or `/rec_history_insert password=xxx year=2026 month=3`.',
        });
    }

    try {
        console.log(`⚙️ [INSERT] Starting job year=${history_year} month=${history_month}`);

        res.status(200).json({
            text: `🚀 Recognition history job started for year=${history_year} month=${history_month}. Will respond shortly.`,
        });

        await execute_run_recognition_data_history_jobs(history_year, history_month);

        console.log(`✅ [INSERT] Completed year=${history_year} month=${history_month}`);

        const slack_message = `📊 Recognition history job complete for year=${history_year} month=${history_month}. ✅`;

        console.log('📣 [INSERT] Sending Slack follow-up message');

        await send_slack_followup_message(
            channel_id,
            channel_name,
            user_id,
            response_url,
            slack_message
        );

    } catch (error) {
        console.error(`❌ [INSERT] Failed year=${history_year} month=${history_month}`, error);

        const slack_message = `📊 Recognition history job failed for year=${history_year} month=${history_month}. ❌ Error: ${error.message || 'Internal Server Error'}`;

        try {
            console.log('📣 [INSERT] Sending Slack failure message');

            await send_slack_followup_message(
                channel_id,
                channel_name,
                user_id,
                response_url,
                slack_message
            );
        } catch (followup_error) {
            console.error('❌ [INSERT] Error sending slack follow-up message.', followup_error);
        }
    }
}

module.exports = {
    insert_recognition_history_controller,
};