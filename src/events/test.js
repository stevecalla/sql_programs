// at top
const dotenv  = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP  = require('mysql2/promise');   // <-- only for dst.prepare
const { create_usat_membership_connection } = require('../../utilities/connectionUSATMembershipDB');
const { local_usat_sales_db_config } = require('../../utilities/config');

const { runTimer, stopTimer } = require('../../utilities/timer');

async function streamBetweenDbs() {
    runTimer('timer');

    // 1) Connect to both databases
    const config_details = await local_usat_sales_db_config();

    // const src = mysql.createConnection(config_details);     // non‑promise
    const src = await create_usat_membership_connection();     // non‑promise
    const dst = await mysqlP.createConnection(config_details); // promise

    // 2) Make sure events_copy exists with the same structure as events
    await dst.execute(`DROP TABLE IF EXISTS events_copy;`);
    await dst.execute(`
        CREATE TABLE IF NOT EXISTS events_copy (
            id_event INT NOT NULL,
            sanctioning_event_id INT
            );
    `);

    // 3) Stream fields from events on src   
    const query = src.query(`SELECT id AS id_event, sanctioning_event_id FROM events AS e LIMIT 1000;`);
    const rowsStream = query.stream();  

    let insertStmt;
    let columns;

    // 4) Pump each row from src → dst
    for await (const row of rowsStream) {
        // On the very first row, build & prepare a generic INSERT for all cols
        if (!insertStmt) {
        columns     = Object.keys(row);  // e.g. [ 'id', 'name', 'starts', … ]
        const colList      = columns.join(', ');
        const placeholders = columns.map(_ => '?').join(', ');
        const sql          =
            `INSERT INTO events_copy (${colList}) VALUES (${placeholders})`;
        insertStmt = await dst.prepare(sql);
        }

        // Now insert this row’s values in the same order
        const values = columns.map(col => row[col]);
        await insertStmt.execute(values);
    }

    // 5) Tidy up
    if (insertStmt) await insertStmt.close();
    src.end();
    await dst.end();

    stopTimer('timer');
}

streamBetweenDbs().catch(err => {
    console.error('Stream failed:', err);
    process.exit(1);
});
