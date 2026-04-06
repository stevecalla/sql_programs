const { start_delayed_still_working_timer } = require('./send_delayed_still_working_message');
const { slack_message_api_v2_thread } = require('./slack_message_api_v2_thread');

async function start_private_job_thread({
    req,
    res,
    ack_text,
    parent_message,
    job_label,
    start_time_ms,
    delay_ms = undefined,
    interval_ms = undefined,
}) {
    const { user_id, channel_id, channel_name } = req.body || {};
    const DM_ONLY_CHANNEL_ID = ''; // intentionally blank to force private DM via user_id

    console.log('🧵 [JOB THREAD] Initializing private job thread', {
        user_id,
        channel_id,
        channel_name,
        job_label,
    });

    // Immediate slash-command acknowledgement (only visible to requesting user)
    res.status(200).json({
        text: ack_text,
    });

    let parent_thread_ts = null;

    try {
        console.log('🧵 [JOB THREAD] Creating private Slack parent thread message');

        parent_thread_ts = await slack_message_api_v2_thread(
            DM_ONLY_CHANNEL_ID,
            user_id || '',
            parent_message,
            undefined,
            ''
        );

        console.log(`🧵 [JOB THREAD] Parent thread ts=${parent_thread_ts || 'not returned'}`);
    } catch (thread_init_error) {
        console.error('❌ [JOB THREAD] Failed to create private Slack parent thread message.', thread_init_error);
    }

    const send_thread_message = async (slack_message) => {
        if (!parent_thread_ts) {
            console.log('ℹ️ [JOB THREAD] No parent thread ts available. Skipping private thread message.');
            return;
        }

        console.log('📣 [JOB THREAD] Sending private Slack thread message');

        await slack_message_api_v2_thread(
            DM_ONLY_CHANNEL_ID,
            user_id || '',
            slack_message,
            undefined,
            parent_thread_ts
        );
    };

    const still_working_timer = start_delayed_still_working_timer({
        delay_ms,
        interval_ms,
        job_label,
        send_message_fn: send_thread_message,
        start_time_ms,
    });

    const finish_timer = () => {
        if (still_working_timer) {
            still_working_timer.finish();
        }
    };

    return {
        send_thread_message,
        finish_timer,
        parent_thread_ts,
    };
}

module.exports = {
    start_private_job_thread,
};