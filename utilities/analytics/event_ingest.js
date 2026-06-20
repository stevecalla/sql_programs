'use strict';
// Generic analytics core — build an express handler that whitelists an incoming
// event to `columns`, stamps the two canonical timestamps (created_at_utc +
// created_at_mtn), and inserts one row.
//
//   make_event_ingest({ pool, table, columns, reporting_tz }) -> async (req,res)=>void
//
// Timestamps are computed in NODE (full ICU timezone data) and bound as values, so
// this works on any MySQL — it does NOT depend on the server's CONVERT_TZ timezone
// tables being loaded (a local DB often has them empty, which yields NULL).
//
// Analytics must NEVER break the app: any failure is logged and the handler still
// returns 204 (fire-and-forget). Uses pool.query (not execute) so the variable
// per-event column set doesn't bloat the prepared-statement cache.
const DEFAULT_TZ = 'America/Denver';

// 'YYYY-MM-DD HH:mm:ss' for a given instant in a given IANA timezone.
function fmt_in_tz(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).reduce(function (o, p) { o[p.type] = p.value; return o; }, {});
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' +
         parts.hour + ':' + parts.minute + ':' + parts.second;
}

// Whitelist `body` to `allow`, stamp the two canonical timestamps, and INSERT one row.
// Shared by the HTTP ingest handler AND server-side loggers (e.g. AI-call events, where latency /
// verdict / success are only known on the server). Returns true if a row was written.
async function insert_event(pool, table, allow, reporting_tz, body) {
  body = body || {};
  const cols = [];
  const vals = [];
  Object.keys(body).forEach(function (k) {
    if (allow.has(k) && body[k] !== undefined) {
      cols.push(k);
      vals.push(body[k] === '' ? null : body[k]);
    }
  });
  if (!cols.length) return false;
  // stamp the two canonical timestamps (computed in Node — no CONVERT_TZ needed)
  const now = new Date();
  cols.push('created_at_utc'); vals.push(fmt_in_tz(now, 'UTC'));
  cols.push('created_at_mtn'); vals.push(fmt_in_tz(now, reporting_tz));
  const col_list = cols.map(function (c) { return '`' + c + '`'; }).join(', ');
  const placeholders = cols.map(function () { return '?'; }).join(', ');
  const sql = 'INSERT INTO `' + table + '` (' + col_list + ') VALUES (' + placeholders + ')';
  await pool.query(sql, vals);
  return true;
}

function make_event_ingest(opts) {
  const pool = opts.pool;
  const table = opts.table;
  const allow = new Set(opts.columns || []);
  const reporting_tz = opts.reporting_tz || DEFAULT_TZ;
  return async function event_ingest(req, res) {
    try {
      await insert_event(pool, table, allow, reporting_tz, (req && req.body) || {});
      res.status(204).end();
    } catch (e) {
      console.error('[analytics] ingest error:', e.message);
      try { res.status(204).end(); } catch (e2) { /* response already gone */ }
    }
  };
}
module.exports = { make_event_ingest, insert_event, fmt_in_tz };
