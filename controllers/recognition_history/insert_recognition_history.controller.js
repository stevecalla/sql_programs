const { execute_run_recognition_data_history_jobs } = require('../../src/revenue_recognition_history/step_0_run_recognition_history_jobs_040326');
const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');
const { format_duration_ms } = require('../../utilities/slack_messaging/send_delayed_still_working_message');
const { start_private_job_thread } = require('../../utilities/slack_messaging/start_private_job_thread');

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

async function insert_recognition_history_controller(req, res) {
    console.log('🚀 [INSERT] Request received - /insert-recognition-history', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req?.body?.text,
        response_url: req?.body?.response_url,
    });

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

    const { send_thread_message, finish_timer } = await start_private_job_thread({
        req,
        res,
        ack_text: `🚀 Recognition history job started for year=${history_year} month=${history_month}. Progress updates will be sent to you in a private bot thread.`,
        parent_message: `🚀 Recognition history job started for year=${history_year} month=${history_month}.`,
        job_label: `Recognition history insert for year=${history_year} month=${history_month}`,
        start_time_ms,
    });

    try {
        await execute_run_recognition_data_history_jobs(history_year, history_month);

        finish_timer();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.log(`✅ [INSERT] Completed year=${history_year} month=${history_month} duration=${duration}`);

        await send_thread_message(
            `📊 Recognition history job complete for year=${history_year} month=${history_month}. ✅\n⏱️ Duration: ${duration}`
        );

    } catch (error) {
        finish_timer();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.error(`❌ [INSERT] Failed year=${history_year} month=${history_month} duration=${duration}`, error);

        try {
            await send_thread_message(
                `📊 Recognition history job failed for year=${history_year} month=${history_month}. ❌ Error: ${error.message || 'Internal Server Error'}\n⏱️ Duration: ${duration}`
            );
        } catch (thread_error) {
            console.error('❌ [INSERT] Error sending private Slack thread failure message.', thread_error);
        }
    }
}

module.exports = {
    insert_recognition_history_controller,
};