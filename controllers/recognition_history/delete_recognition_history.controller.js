const { execute_delete_recognition_allocation_data_history } = require('../../src/revenue_recognition_history/step_3_delete_recognition_allocation_data_history');
const { send_slack_followup_message } = require('../../utilities/slack_messaging/send_message_api_v2_followup');

const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');
const { start_delayed_still_working_timer, format_duration_ms } = require('../../utilities/slack_messaging/send_delayed_still_working_message');

function parse_snapshot(parsed) {
    return parsed.snapshot;
}

function get_response_url(req) {
    if (req.body && Object.keys(req.body).length === 0) {
        return process.env.SLACK_WEBHOOK_STEVE_CALLA_USAT_URL;
    }
    return req?.body?.response_url;
}

async function delete_recognition_history_controller(req, res) {
    console.log('🚀 [DELETE] Request received', {
        body: req.body,
        query: req.query,
        text: req?.body?.text,
    });

    const { channel_id, channel_name, user_id } = req.body || {};
    const response_url = get_response_url(req);

    // 🔐 PASSWORD VALIDATION
    const auth = validate_command_password(req);

    if (!auth.is_valid) {
        console.warn('⛔ [DELETE] Authorization failed:', auth.error);

        return res.status(auth.status).json({
            text: auth.error,
        });
    }

    const parsed = auth.parsed;
    const history_snapshot = parse_snapshot(parsed);

    if (!history_snapshot) {
        console.warn('⚠️ [DELETE] Invalid input - missing snapshot');

        return res.status(200).json({
            text: '⚠️ Invalid input. Use `/rec_history_delete password=xxx snapshot=revenue_month_2026_03`.',
        });
    }

    const start_time_ms = Date.now();
    let still_working_timer;

    try {
        console.log(`⚙️ [DELETE] Starting job for snapshot=${history_snapshot}`);

        res.status(200).json({
            text: `🚀 Delete job started for snapshot=${history_snapshot}.`,
        });

        const send_delete_followup_message = async (slack_message) => {
            console.log('📣 [DELETE] Sending Slack follow-up message');

            await send_slack_followup_message(
                channel_id,
                channel_name,
                user_id,
                response_url,
                slack_message
            );
        };

        still_working_timer = start_delayed_still_working_timer({ 
            delay_ms: undefined,
            interval_ms: undefined,
            job_label: `Recognition history delete for snapshot=${history_snapshot}`,
            send_message_fn: send_delete_followup_message,
            start_time_ms,
        });

        const rows_deleted = await execute_delete_recognition_allocation_data_history(history_snapshot);
        still_working_timer.finish();

        const formatted_rows = Number(rows_deleted || 0).toLocaleString();
        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.log(`✅ [DELETE] Completed snapshot=${history_snapshot} | rows_deleted=${formatted_rows}`);

        const slack_message = `🗑️ Delete complete for snapshot=${history_snapshot}. Rows deleted: ${formatted_rows}. ✅\n⏱️ Duration: ${duration}`;

        console.log('📣 [DELETE] Sending Slack follow-up message');

        await send_delete_followup_message(slack_message);

    } catch (error) {
        if (still_working_timer) still_working_timer.finish();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.error(`❌ [DELETE] Failed snapshot=${history_snapshot}`, error);

        const slack_message = `🗑️ Delete failed for snapshot=${history_snapshot}. ❌ Error: ${error.message || 'Internal Server Error'}\n⏱️ Duration: ${duration}`;

        try {
            console.log('📣 [DELETE] Sending Slack failure message');

            await send_slack_followup_message(
                channel_id,
                channel_name,
                user_id,
                response_url,
                slack_message
            );
        } catch (e) {
            console.error('❌ [DELETE] Error sending Slack follow-up message.', e);
        }
    }
}

module.exports = {
    delete_recognition_history_controller,
};