const { execute_backup_recognition_allocation_data_history } = require('../../src/revenue_recognition_history/step_4_backup_recognition_allocation_data_history');
const { validate_command_password } = require('../../utilities/slack_messaging/parse_slack_command');
const { format_duration_ms } = require('../../utilities/slack_messaging/send_delayed_still_working_message');
const { start_private_job_thread } = require('../../utilities/slack_messaging/start_private_job_thread');

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

    console.log(`⚙️ [BACKUP] Starting recognized revenue backup job (${backup_type.backup_type})`);

    const { send_thread_message, finish_timer } = await start_private_job_thread({
        req,
        res,
        ack_text: `💾 Rev recognition backup job started (${backup_type.backup_type}). Progress updates will be sent to you in a private bot thread.`,
        parent_message: `💾 Rev recognition backup job started (${backup_type.backup_type}).`,
        job_label: `Recognition history backup (${backup_type.backup_type})`,
        start_time_ms,
    });

    try {
        const backup_results = await execute_backup_recognition_allocation_data_history(backup_type);

        finish_timer();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        const backup_table = backup_results?.backup_table || 'n/a';
        const inserted_rows = Number(backup_results?.inserted_rows || 0).toLocaleString();
        const removed_backups = Number(backup_results?.removed_backups || 0).toLocaleString();
        const final_backup_count = Number(backup_results?.final_backup_count || 0).toLocaleString();

        console.log(`✅ [BACKUP] Completed (${backup_type.backup_type})`, backup_results);

        await send_thread_message(
            `💾 Rev recognition backup job complete (${backup_type.backup_type}). ✅\n` +
            `📁 Backup table: ${backup_table}\n` +
            `📌 Rows copied: ${inserted_rows}\n` +
            `🧹 Old backups removed: ${removed_backups}\n` +
            `📚 Final backup count kept: ${final_backup_count}\n` +
            `⏱️ Duration: ${duration}`
        );

    } catch (error) {
        finish_timer();

        const duration = format_duration_ms(Date.now() - start_time_ms);

        console.error(`❌ [BACKUP] Failed recognized revenue (${backup_type.backup_type})`, error);

        try {
            await send_thread_message(
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