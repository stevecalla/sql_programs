const { execute_backup_recognition_allocation_data_history } = require('../../src/revenue_recognition_history/step_4_backup_recognition_allocation_data_history');
const { send_slack_followup_message } = require('../../utilities/slack_messaging/send_message_api_v2_followup');

const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');

function parse_backup_type(parsed) {
    let backup_type = parsed.backup_type;

    if (backup_type) backup_type = backup_type.toLowerCase();

    const allowed = ['user', 'system'];

    if (!allowed.includes(backup_type)) {
        backup_type = 'user';
    }

    return { backup_type };
}

function get_response_url(req) {
    if (req.body && Object.keys(req.body).length === 0) {
        return process.env.SLACK_WEBHOOK_STEVE_CALLA_USAT_URL;
    }
    return req?.body?.response_url;
}

async function backup_recognition_history_controller(req, res) {
    console.log('🚀 [BACKUP] Request received', {
        body: req.body,
        query: req.query,
        text: req?.body?.text,
    });

    const { channel_id, channel_name, user_id } = req.body || {};
    const response_url = get_response_url(req);

    // 🔐 PASSWORD VALIDATION
    const auth = validate_command_password(req);

    if (!auth.is_valid) {
        console.warn('⛔ [BACKUP] Authorization failed:', auth.error);

        return res.status(auth.status).json({
            text: auth.error,
        });
    }

    const parsed = auth.parsed;
    const backup_type = parse_backup_type(parsed);

    try {
        console.log(`⚙️ [BACKUP] Starting recognied revenue backup job (${backup_type.backup_type})`);

        res.status(200).json({
            text: `🚀 Rev recognition backup job started (${backup_type.backup_type}).`,
        });

        await execute_backup_recognition_allocation_data_history(backup_type);

        console.log(`✅ [BACKUP] Completed (${backup_type.backup_type})`);

        const slack_message = `💾 Rev recognition backup job complete (${backup_type.backup_type}). ✅`;

        console.log('📣 [BACKUP] Sending Slack follow-up message');

        await send_slack_followup_message(
            channel_id,
            channel_name,
            user_id,
            response_url,
            slack_message
        );

    } catch (error) {
        console.error(`❌ [BACKUP] Failed recognized revenue (${backup_type.backup_type})`, error);

        const slack_message = `💾 Backup recognized revenue job failed (${backup_type.backup_type}). ❌ Error: ${error.message || 'Internal Server Error'}`;

        try {
            console.log('📣 [BACKUP] Sending Slack recogized revenue job failure message');

            await send_slack_followup_message(
                channel_id,
                channel_name,
                user_id,
                response_url,
                slack_message
            );
        } catch (e) {
            console.error('❌ [BACKUP] Error sending Slack follow-up message.', e);
        }
    }
}

module.exports = {
    backup_recognition_history_controller,
};