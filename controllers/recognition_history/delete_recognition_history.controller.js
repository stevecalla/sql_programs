const { execute_delete_recognition_allocation_data_history } = require('../../src/revenue_recognition_history/step_3_delete_recognition_allocation_data_history');
const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');
const { format_duration_ms } = require('../../utilities/slack_messaging/send_delayed_still_working_message');
const { start_private_job_thread } = require('../../utilities/slack_messaging/start_private_job_thread');

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

    console.log(`⚙️ [DELETE] Starting job for snapshot=${history_snapshot}`);

    const { send_thread_message, finish_timer } = await start_private_job_thread({
        req,
        res,
        ack_text: `🗑️ Delete job started for snapshot=${history_snapshot}. Progress updates will be sent to you in a private bot thread.`,
        parent_message: `🗑️ Recognition history delete started for snapshot=${history_snapshot}.`,
        job_label: `Recognition history delete for snapshot=${history_snapshot}`,
        start_time_ms,
    });

    try {
        const rows_deleted = await execute_delete_recognition_allocation_data_history(history_snapshot);

        finish_timer();

        const formatted_rows = Number(rows_deleted || 0).toLocaleString();
        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.log(`✅ [DELETE] Completed snapshot=${history_snapshot} | rows_deleted=${formatted_rows} | duration=${duration}`);

        await send_thread_message(
            `🗑️ Delete complete for snapshot=${history_snapshot}. ✅\n` +
            `📌 Rows deleted: ${formatted_rows}\n` +
            `⏱️ Duration: ${duration}`
        );

    } catch (error) {
        finish_timer();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.error(`❌ [DELETE] Failed snapshot=${history_snapshot}`, error);

        try {
            await send_thread_message(
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