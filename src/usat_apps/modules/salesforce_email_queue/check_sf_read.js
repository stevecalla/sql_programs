'use strict';
// Live Salesforce READ smoke for the email-queue module. Connects (read role) and lists queues.
//   node src/usat_apps/modules/salesforce_email_queue/check_sf_read.js [--sandbox]
const sf = require('./sf');
(async () => {
  const is_test = process.argv.includes('--sandbox');
  try {
    const r = await sf.connect({ is_test: is_test, role: 'read' });
    console.log('OK connected:', r.label || (is_test ? 'sandbox' : 'production'), '- org', r.org_id || '(unknown)', '- as', r.username || '');
    const queues = await sf.list_queues(r.conn, { with_open_counts: true });
    console.log('OK list_queues -', queues.length, 'queues');
    queues.slice(0, 8).forEach(function (q) { console.log('   -', q.name, '(open:', q.open_count, ')'); });
    process.exit(0);
  } catch (e) { console.error('FAIL SF read smoke:', (e && e.message) || e); process.exit(1); }
})();
