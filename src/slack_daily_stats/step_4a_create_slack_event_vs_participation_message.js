const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { runTimer, stopTimer } = require('../../utilities/timer');

async function create_slack_events_reporting_message(rows_count, month = "all", type = 'race', is_reported = 'false') {
    runTimer('timer');
    const startTime = performance.now();

    let main_message_text;

    try {
        // 1) Create message
        main_message_text = `📊 Here are the sanctioned events reporting: rows = ${rows_count.toLocaleString()}, month = ${month}, type = ${type}, is_reported = ${is_reported}:`;

    } catch (err) {
        stopTimer('timer');
        console.error('Error during data queries:', err);
        throw err;

    } finally {
        stopTimer('timer');
    
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);

        console.log(`\nEvent reporting message created successfully. Elapsed Time: ${elapsedTime ? elapsedTime : "Oops error getting time"} sec\n`);
    }

    // exit only after all awaits complete
    return { main_message_text };
}

// async function test() {
//     await execute_get_event_vs_participation_detail(month = 3, type = 'race', is_reported = 'false');
// }

// test();

module.exports = {
    create_slack_events_reporting_message,
};
