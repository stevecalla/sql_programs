const { execute_backup_recognition_allocation_data_history } = require('../../src/revenue_recognition_history/step_4_backup_recognition_allocation_data_history');
const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');
const { start_delayed_still_working_timer, format_duration_ms } = require('../../utilities/slack_messaging/send_delayed_still_working_message');
const { slack_message_api_v2_thread } = require('../../utilities/slack_messaging/slack_message_api_v2_thread');

function parse_backup_type(parsed) {
    let backup_type = parsed.backup_type;

    if (backup_type) backup_type = backup_type.toLowerCase();

    const allowed = ['user', 'system'];

    if (!allowed.includes(backup_type)) {
        backup_type = 'user';
    }

    return { backup_type };
}

async function backup_recognition_history_controller(req, res) {
    console.log('🚀 [BACKUP] Request received', {
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
        console.warn('⛔ [BACKUP] Authorization failed:', auth.error);

        return res.status(auth.status).json({
            text: auth.error,
        });
    }

    const parsed = auth.parsed;
    const backup_type = parse_backup_type(parsed);

    const start_time_ms = Date.now();

    console.log(`⚙️ [BACKUP] Starting recognized revenue backup job (${backup_type.backup_type})`, {
        channel_id,
        channel_name,
        user_id,
    });

    // Immediate slash-command acknowledgement (only visible to requesting user)
    res.status(200).json({
        text: `💾 Rev recognition backup job started (${backup_type.backup_type}). Progress updates will be sent to you in a private bot thread.`,
    });

    let parent_thread_ts = null;

    try {
        console.log('🧵 [BACKUP] Creating private Slack parent thread message for requesting user');

        parent_thread_ts = await slack_message_api_v2_thread(
            DM_ONLY_CHANNEL_ID,
            user_id || '',
            `💾 Rev recognition backup job started (${backup_type.backup_type}).`,
            undefined,
            ''
        );

        console.log(`🧵 [BACKUP] Parent thread ts=${parent_thread_ts || 'not returned'}`);
    } catch (thread_init_error) {
        console.error('❌ [BACKUP] Failed to create private Slack parent thread message.', thread_init_error);
    }

    const send_backup_thread_message = async (slack_message) => {
        if (!parent_thread_ts) {
            console.log('ℹ️ [BACKUP] No parent thread ts available. Skipping private thread message.');
            return;
        }

        console.log('📣 [BACKUP] Sending private Slack thread message');

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
        job_label: `Recognition history backup (${backup_type.backup_type})`,
        send_message_fn: send_backup_thread_message,
        start_time_ms,
    });

    try {
        const backup_results = await execute_backup_recognition_allocation_data_history(backup_type);

        still_working_timer.finish();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        const backup_table = backup_results?.backup_table || 'n/a';
        const inserted_rows = Number(backup_results?.inserted_rows || 0).toLocaleString();
        const removed_backups = Number(backup_results?.removed_backups || 0).toLocaleString();
        const final_backup_count = Number(backup_results?.final_backup_count || 0).toLocaleString();

        console.log(`✅ [BACKUP] Completed (${backup_type.backup_type})`, backup_results);

        await send_backup_thread_message(
            `💾 Rev recognition backup job complete (${backup_type.backup_type}). ✅\n` +
            `📁 Backup table: ${backup_table}\n` +
            `📌 Rows copied: ${inserted_rows}\n` +
            `🧹 Old backups removed: ${removed_backups}\n` +
            `📚 Final backup count kept: ${final_backup_count}\n` +
            `⏱️ Duration: ${duration}`
        );

    } catch (error) {
        still_working_timer.finish();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.error(`❌ [BACKUP] Failed recognized revenue (${backup_type.backup_type})`, error);

        try {
            await send_backup_thread_message(
                `💾 Backup recognized revenue job failed (${backup_type.backup_type}). ❌ ` +
                `Error: ${error.message || 'Internal Server Error'}\n` +
                `⏱️ Duration: ${duration}`
            );
        } catch (thread_error) {
            console.error('❌ [BACKUP] Error sending private Slack thread failure message.', thread_error);
        }
    }
}

module.exports = {
    backup_recognition_history_controller,
};