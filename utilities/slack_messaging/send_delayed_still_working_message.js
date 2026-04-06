// C:\Users\calla\development\usat\sql_programs\utilities\slack_messaging\send_delayed_still_working_message.js

function format_duration_ms(ms) {
    const total_seconds = Math.floor(ms / 1000);
    const hours = Math.floor(total_seconds / 3600);
    const minutes = Math.floor((total_seconds % 3600) / 60);
    const seconds = total_seconds % 60;

    return [
        hours > 0 ? `${hours}h` : null,
        minutes > 0 ? `${minutes}m` : null,
        `${seconds}s`,
    ].filter(Boolean).join(' ');
}

function start_delayed_still_working_timer({
    delay_ms,
    interval_ms,
    job_label = 'Job',
    send_message_fn,
    start_time_ms = Date.now(),
}) {
    const first_delay_ms = delay_ms ?? 5000;     // first update at 30 sec; 5000 = 5 sec, 30000 = 30 sec
    const repeat_interval_ms = interval_ms ?? 30000; // then every 60 sec;  5000 = 5 sec, 30000 = 30 sec

    let is_finished = false;
    let repeat_timer = null;

    const send_still_working_message = async () => {
        if (is_finished) return;

        try {
            const duration = format_duration_ms(Date.now() - start_time_ms);

            await send_message_fn(`⏳ ${job_label} is still working...\n⏱️ Elapsed: ${duration}`);
        } catch (error) {
            console.error(`❌ [${job_label}] Error sending delayed still-working message.`, error);
        }
    };

    const initial_timer = setTimeout(async () => {
        if (is_finished) return;

        await send_still_working_message();

        repeat_timer = setInterval(async () => {
            await send_still_working_message();
        }, repeat_interval_ms);
    }, first_delay_ms);

    return {
        finish() {
            is_finished = true;
            clearTimeout(initial_timer);

            if (repeat_timer) {
                clearInterval(repeat_timer);
            }
        },
    };
}

module.exports = {
    start_delayed_still_working_timer,
    format_duration_ms,
};