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
    job_label = 'Job',
    send_message_fn,
    start_time_ms = Date.now(),
}) {
    const final_delay = delay_ms ?? 5000; // 👈 handles null AND undefined; 5000 = 5 sec; 30000 = 30 sec

    let is_finished = false;

    const timer = setTimeout(async () => {
        if (is_finished) return;

        try {
            const duration = format_duration_ms(Date.now() - start_time_ms);

            await send_message_fn(`⏳ ${job_label} is still working...\n⏱️ Elapsed: ${duration}`);
        } catch (error) {
            console.error(`❌ [${job_label}] Error sending delayed still-working message.`, error);
        }
    }, final_delay);

    return {
        finish() {
            is_finished = true;
            clearTimeout(timer);
        },
    };
}

module.exports = {
    start_delayed_still_working_timer,
    format_duration_ms,
};