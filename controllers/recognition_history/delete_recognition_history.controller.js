const { execute_delete_recognition_allocation_data_history } = require('../../src/revenue_recognition_history/step_3_delete_recognition_allocation_data_history');
const { send_slack_followup_message } = require('../../utilities/slack_messaging/send_message_api_v2_followup');

function parse_snapshot(req) {
    let { snapshot: history_snapshot } = req.query;

    if (req.body && Object.keys(req.body).length > 0 && req.body.text) {
        const args = req.body.text.trim().split(/\s+/);

        for (const arg of args) {
            const [key, value] = arg.split('=');

            if (key?.toLowerCase() === 'snapshot' && value && !req.query.snapshot) {
                history_snapshot = value;
            }
        }
    }

    return history_snapshot;
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

    const history_snapshot = parse_snapshot(req);

    if (!history_snapshot) {
        console.warn('⚠️ [DELETE] Invalid input - missing snapshot');

        return res.status(200).json({
            text: '⚠️ Invalid input. Use `/rec_history_delete snapshot=revenue_month_2026_03`.',
        });
    }

    try {
        console.log(`⚙️ [DELETE] Starting job for snapshot=${history_snapshot}`);

        res.status(200).json({
            text: `🚀 Delete job started for snapshot=${history_snapshot}.`,
        });

        const rows_deleted = await execute_delete_recognition_allocation_data_history(history_snapshot);
        const formatted_rows = Number(rows_deleted || 0).toLocaleString();

        console.log(`✅ [DELETE] Completed snapshot=${history_snapshot} | rows_deleted=${formatted_rows}`);

        const slack_message = `🗑️ Delete complete for snapshot=${history_snapshot}. Rows deleted: ${formatted_rows}. ✅`;

        console.log('📣 [DELETE] Sending Slack follow-up message');

        await send_slack_followup_message(
            channel_id,
            channel_name,
            user_id,
            response_url,
            slack_message
        );

    } catch (error) {
        console.error(`❌ [DELETE] Failed snapshot=${history_snapshot}`, error);

        const slack_message = `🗑️ Delete failed for snapshot=${history_snapshot}. ❌ Error: ${error.message || 'Internal Server Error'}`;

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

// we can add a pre-delete count preview (like “this will delete 1.2M rows — confirm?”) which is very useful for production safety.