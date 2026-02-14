// at top
const dotenv  = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP  = require('mysql2/promise');   // <-- only for dst.prepare
const { create_usat_membership_connection } = require('../../utilities/connectionUSATMembershipDB');
const { local_usat_sales_db_config } = require('../../utilities/config');

const { runTimer, stopTimer } = require('../../utilities/timer');

// connection.js
async function get_src_connection() {
    return await create_usat_membership_connection();
}

async function get_dst_connection() {
    const cfg = await local_usat_sales_db_config();
    return await mysqlP.createConnection(cfg);
}
  
// schema.js
async function recreate_target_table(dst, { name, columnsDDL }) {
    await dst.execute(`DROP TABLE IF EXISTS \`${name}\``);
    await dst.execute(`
        CREATE TABLE \`${name}\` (
        ${columnsDDL}
        )
    `);
}

// streamer.js
async function stream_rows(src, sql, onRow) {
    const stream = src.query(sql).stream();
    for await (const row of stream) {
        await onRow(row);
    }
}

// inserter.js
async function make_inserter(dst, tableName, sampleRow) {
    const cols = Object.keys(sampleRow);
    const colList = cols.map(c => `\`${c}\``).join(',');
    const placeholders = cols.map(_ => '?').join(',');
    const stmt = await dst.prepare(
        `INSERT INTO \`${tableName}\` (${colList}) VALUES (${placeholders})`
    );
    return {
        insert: async row => stmt.execute(cols.map(c => row[c])),
        close:  ()  => stmt.close()
    };
}

async function execute_transfer_usat_to_local() {
    const TABLE       = 'events_copy';
    const DDL_COLUMNS = `
        id_event INT NOT NULL,
        sanctioning_event_id VARCHAR(100)
    `;

    const src = await get_src_connection();
    const dst = await get_dst_connection();
    
    runTimer('timer');

    await recreate_target_table(dst, { name: TABLE, columnsDDL: DDL_COLUMNS });

    let inserter;
    await stream_rows(src,
        `SELECT id AS id_event, sanctioning_event_id FROM events LIMIT 100000;`,
        async row => {
        if (!inserter) inserter = await make_inserter(dst, TABLE, row);
        await inserter.insert(row);
        }
    );

    if (inserter) await inserter.close();
    src.end();
    await dst.end();
    stopTimer('timer');
}

// execute_transfer_usat_to_local().catch(err => {
//     console.error('Stream failed:', err);
//     process.exit(1);
// });

module.exports = {
    execute_transfer_usat_to_local,
};