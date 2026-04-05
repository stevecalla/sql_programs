const { execute_delete_recognition_allocation_data_history } = require('../../src/revenue_recognition_history/step_3_delete_recognition_allocation_data_history');
const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');
const { start_delayed_still_working_timer, format_duration_ms } = require('../../utilities/slack_messaging/send_delayed_still_working_message');
const { slack_message_api_v2_thread } = require('../../utilities/slack_messaging/slack_message_api_v2_thread');

function parse_snapshot(parsed) {
    return parsed.snapshot;
}

async function delete_recognition_history_controller(req, res) {
    console.log('🚀 [DELETE] Request received', {
        body: req.body,
        query: req.query,
        text: req?.body?.text,
        response_url: req?.body?.response_url,
    });

    const { channel_id, channel_name, user_id } = req.body || {};
    const DM_ONLY_CHANNEL_ID = ''; // intentionally blank to force private DM via user_id

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

    console.log(`⚙️ [DELETE] Starting job for snapshot=${history_snapshot}`, {
        channel_id,
        channel_name,
        user_id,
    });

    // Immediate slash-command acknowledgement (only visible to requesting user)
    res.status(200).json({
        text: `🗑️ Delete job started for snapshot=${history_snapshot}. Progress updates will be sent to you in a private bot thread.`,
    });

    let parent_thread_ts = null;

    try {
        console.log('🧵 [DELETE] Creating private Slack parent thread message for requesting user');

        parent_thread_ts = await slack_message_api_v2_thread(
            DM_ONLY_CHANNEL_ID,
            user_id || '',
            `🗑️ Recognition history delete started for snapshot=${history_snapshot}.`,
            undefined,
            ''
        );

        console.log(`🧵 [DELETE] Parent thread ts=${parent_thread_ts || 'not returned'}`);
    } catch (thread_init_error) {
        console.error('❌ [DELETE] Failed to create private Slack parent thread message.', thread_init_error);
    }

    const send_delete_thread_message = async (slack_message) => {
        if (!parent_thread_ts) {
            console.log('ℹ️ [DELETE] No parent thread ts available. Skipping private thread message.');
            return;
        }

        console.log('📣 [DELETE] Sending private Slack thread message');

        await slack_message_api_v2_thread(
            DM_ONLY_CHANNEL_ID,
            user_id || '',
            slack_message,
            undefined,
            parent_thread_ts
        );
    };

    const still_working_timer = start_delayed_still_working_timer({
        delay_ms: undefined,
        interval_ms: undefined,
        job_label: `Recognition history delete for snapshot=${history_snapshot}`,
        send_message_fn: send_delete_thread_message,
        start_time_ms,
    });

    try {
        const rows_deleted = await execute_delete_recognition_allocation_data_history(history_snapshot);

        still_working_timer.finish();

        const formatted_rows = Number(rows_deleted || 0).toLocaleString();
        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.log(`✅ [DELETE] Completed snapshot=${history_snapshot} | rows_deleted=${formatted_rows} | duration=${duration}`);

        await send_delete_thread_message(
            `🗑️ Delete complete for snapshot=${history_snapshot}. ✅\n` +
            `📌 Rows deleted: ${formatted_rows}\n` +
            `⏱️ Duration: ${duration}`
        );

    } catch (error) {
        still_working_timer.finish();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.error(`❌ [DELETE] Failed snapshot=${history_snapshot}`, error);

        try {
            await send_delete_thread_message(
                `🗑️ Delete failed for snapshot=${history_snapshot}. ❌ ` +
                `Error: ${error.message || 'Internal Server Error'}\n` +
                `⏱️ Duration: ${duration}`
            );
        } catch (thread_error) {
            console.error('❌ [DELETE] Error sending private Slack thread failure message.', thread_error);
        }
    }
}

module.exports = {
    delete_recognition_history_controller,
};