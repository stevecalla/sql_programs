const { execute_run_recognition_data_history_jobs } = require('../../src/revenue_recognition_history/step_0_run_recognition_history_jobs_050325');
const { send_slack_followup_message } = require('../../utilities/slack_messaging/send_message_api_v2_followup');

function get_prior_month_year_month() {
    const now = new Date();
    const prior_month_date = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    return {
        history_year: prior_month_date.getFullYear(),
        history_month: prior_month_date.getMonth() + 1,
    };
}

function parse_history_params(req) {
    const default_date = get_prior_month_year_month();

    let {
        year: history_year = default_date.history_year,
        month: history_month = default_date.history_month,
    } = req.query;

    if (req.body && Object.keys(req.body).length > 0 && req.body.text) {
        const args = req.body.text.trim().split(/\s+/);

        for (const arg of args) {
            const [key, value] = arg.split('=');

            if (!key || !value) continue;

            const normalized_key = key.toLowerCase();

            switch (normalized_key) {
                case 'year':
                    if (!req.query.year) history_year = value;
                    break;

                case 'month':
                    if (!req.query.month) history_month = value;
                    break;

                default:
                    console.warn(`Unknown parameter: ${key}`);
            }
        }
    }

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
    console.log('Received request for recognition history - /insert-recognition-history :', {
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

    let { history_year, history_month } = parse_history_params(req);

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
            text: 'Invalid input. Use `/rec_history_insert` or `/rec_history_insert year=2026 month=3`.',
        });
    }

    try {
        res.status(200).json({
            text: `Recognition history job started for year=${history_year} month=${history_month}. Will respond shortly.`,
        });

        await execute_run_recognition_data_history_jobs(history_year, history_month);

        const slack_message = `Recognition history job complete for year=${history_year} month=${history_month}.`;

        await send_slack_followup_message(
            channel_id,
            channel_name,
            user_id,
            response_url,
            slack_message
        );

    } catch (error) {
        console.error('Error inserting recognition history data.', error);

        const slack_message = `Recognition history job failed for year=${history_year} month=${history_month}. Error: ${error.message || 'Internal Server Error'}`;

        try {
            await send_slack_followup_message(
                channel_id,
                channel_name,
                user_id,
                response_url,
                slack_message
            );
        } catch (followup_error) {
            console.error('Error sending slack follow-up message.', followup_error);
        }
    }
}

module.exports = {
    insert_recognition_history_controller,
};