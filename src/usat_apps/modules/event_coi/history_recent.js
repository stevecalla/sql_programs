#!/usr/bin/env node
'use strict';
/**
 * history_recent.js — print the most recent COI submission runs from event_coi_submission_history, a
 * counts-by-status breakdown (with grand total), and the SQL for both (copy-paste ready for MySQL
 * Workbench). Non-PII: shows counts/timing/who/event/status only — never holder data.
 *
 *   node src/usat_apps/modules/event_coi/history_recent.js          # last 10
 *   node src/usat_apps/modules/event_coi/history_recent.js 25       # last 25
 *
 * Reads DB creds from repo-root .env; does NOT need the :8023 server running.
 */
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '..', '.env') }); } catch (e) { /* optional */ }
const history = require('./store/submission_history');
const db = require('./store/../../../store/db');

const N = Math.min(Math.max(parseInt(process.argv[2], 10) || 10, 1), 200);
const DB = process.env.LOCAL_USAT_SALES_DB || 'usat_sales_db';
const T = '`' + DB + '`.`event_coi_submission_history`';

const RECENT_SQL =
  'SELECT id, started_at_mtn, event_name, event_sanction_id, ran_by, certificates_requested,\n' +
  '       certificates_submitted, certificates_failed, certificates_skipped, status, status_description\n' +
  'FROM ' + T + '\n' +
  'ORDER BY started_at_mtn DESC, id DESC\n' +
  'LIMIT ' + N + ';';
const COUNT_SQL =
  'SELECT status, COUNT(*) AS runs\n' +
  'FROM ' + T + '\n' +
  'GROUP BY status WITH ROLLUP;';

function fmtDate(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 16);
  try { const d = new Date(v); const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  catch (e) { return String(v); }
}
const pad = (v, w) => String(v == null ? '' : v).padEnd(w).slice(0, w);
const padL = (v, w) => String(v == null ? '' : v).padStart(w);

async function main() {
  let rows, counts;
  try { rows = await history.recent(N); counts = await history.counts_by_status(); }
  catch (e) { console.error('  Could not read history — is MySQL reachable? (' + ((e && e.message) || e) + ')'); process.exit(1); }

  console.log('\n  Recent-runs query (copy into MySQL Workbench):\n');
  console.log(RECENT_SQL.split('\n').map((l) => '    ' + l).join('\n'));

  console.log('\n  ' + pad('#', 4) + pad('started (mtn)', 17) + pad('event', 24) + pad('by', 10) +
    padL('req', 4) + padL('sub', 5) + padL('fail', 5) + padL('skip', 5) + '  status');
  console.log('  ' + '-'.repeat(78));
  if (!rows.length) console.log('  (no runs recorded yet)');
  rows.forEach((r, i) => {
    const flag = (r.status === 'in_progress' || r.status === 'queued') ? '  ←' : '';
    console.log('  ' + pad(i + 1, 4) + pad(fmtDate(r.started_at_mtn), 17) + pad(r.event_name, 24) + pad(r.ran_by, 10) +
      padL(r.certificates_requested, 4) + padL(r.certificates_submitted, 5) + padL(r.certificates_failed, 5) +
      padL(r.certificates_skipped, 5) + '  ' + pad(r.status, 12) + flag);
  });

  console.log('\n  Counts-by-status query (copy into MySQL Workbench):\n');
  console.log(COUNT_SQL.split('\n').map((l) => '    ' + l).join('\n'));
  console.log('\n  counts by status');
  counts.forEach((c) => console.log('    ' + pad(c.status, 16) + padL(c.runs, 6) + '   ' + (c.status === 'TOTAL' ? '' : history.desc(c.status))));

  console.log('');
  try { await db.end(); } catch (e) { /* ignore */ }
  process.exit(0);
}
main().catch((e) => { console.error('  history error:', (e && e.message) || e); process.exit(1); });
