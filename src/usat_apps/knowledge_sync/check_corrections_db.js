'use strict';
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
// Live MySQL smoke for operator corrections: ensures the table, inserts a test row, reads it back.
//   node src/usat_apps/knowledge_sync/check_corrections_db.js
const corrections = require('../services/corrections');
const mysql_store = require('../services/corrections/mysql_store');
(async () => {
  try {
    const store = await mysql_store.create_store();
    const rec = await corrections.add({ note: 'SMOKE TEST correction (safe to delete)', scope: 'global', author: 'smoke' }, store);
    console.log('OK inserted correction id', rec && rec.id);
    const all = await corrections.list(store);
    console.log('OK list -', all.length, 'active correction(s) in knowledge_corrections');
    const lines = await corrections.grounding_lines(store, 5, {});
    console.log('OK grounding lines:', lines.length);
    try { await require('../store/db').end(); } catch (e) { /* ignore */ }
    process.exit(0);
  } catch (e) { console.error('FAIL corrections DB smoke:', (e && e.message) || e); process.exit(1); }
})();
