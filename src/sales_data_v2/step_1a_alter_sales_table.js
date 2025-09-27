// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

// at top
const mysql   = require('mysql2');          // classic API
const mysqlP                                  = require('mysql2/promise');   // only for dst.execute
const { local_usat_sales_db_config }          = require('../../utilities/config');
const { runTimer, stopTimer }                 = require('../../utilities/timer');

const { query_alter_sales_table } = require('../queries/sales_data/7_1a_alter_sales_table');

async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function execute_alter_sales_table() {
  const dst = await get_dst_connection();  // promise API, for transaction + execute()

  runTimer('timer');
  
  let result = 'Alter Table Failed';        // default if something blows up

  try {
    // 1) Start a transaction so DDL + data load is atomic
    await dst.beginTransaction();

    // Alter table from $23 to $28 for select membership period ids
    const sql_alter_table = query_alter_sales_table;
    const [multi_result] = await dst.query(sql_alter_table);
    console.log(multi_result);

    // 5) Commit everything (DDL + data) in one go
    await dst.commit();

    result = 'Tranfer Successful';          // only set this if we got all the way through

  } catch (err) {
    // If anything goes wrong, undo the CREATE/DROP and any partial inserts
    await dst.rollback();
    console.error('Transfer failed, rolled back transaction:', err);
    throw err;

  } finally {
    // Always clean up connections and timer
    await dst.end();
    stopTimer('timer');
  }

  return result;  
}

// if (require.main === module) {
//   execute_alter_sales_table()
//   .catch(err => {
//       console.error('Query failed:', err);
//       process.exit(1);
//   });
// }

module.exports = {
  execute_alter_sales_table,
};
