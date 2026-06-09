'use strict';
// Generic analytics core — table size + year-based purge. Keeps the current +
// (years-1) prior calendar years. The reporting-year boundary is computed in NODE
// (no CONVERT_TZ dependency), and the year column falls back to created_at_utc when
// created_at_mtn is NULL (e.g. legacy rows). `table` is always a code constant.
const YEAR_COL = 'YEAR(COALESCE(created_at_mtn, created_at_utc))';

function current_year_in_tz(tz) {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Denver', year: 'numeric' }).format(new Date()));
}

async function size(pool, table) {
  const [info] = await pool.query(
    'SELECT ROUND((data_length + index_length) / 1024 / 1024, 2) AS mb ' +
    'FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table]);
  const [range] = await pool.query(
    'SELECT COUNT(*) AS rows_total, MIN(created_at_utc) AS min_utc, MAX(created_at_utc) AS max_utc FROM `' + table + '`');
  const [by_year] = await pool.query(
    'SELECT ' + YEAR_COL + ' AS yr, COUNT(*) AS n FROM `' + table + '` GROUP BY yr ORDER BY yr');
  return {
    mb: info[0] ? info[0].mb : 0,
    rows: range[0] ? range[0].rows_total : 0,
    min_utc: range[0] ? range[0].min_utc : null,
    max_utc: range[0] ? range[0].max_utc : null,
    by_year: by_year || []
  };
}

// years = 2 keeps the current + prior calendar year; deletes older.
async function purge_keep_years(pool, table, years, reporting_tz) {
  years = years || 2;
  const cutoff = current_year_in_tz(reporting_tz) - (years - 1);
  const where = YEAR_COL + ' < ' + cutoff;
  const [c] = await pool.query('SELECT COUNT(*) AS n FROM `' + table + '` WHERE ' + where);
  const would = c[0] ? c[0].n : 0;
  const [r] = await pool.query('DELETE FROM `' + table + '` WHERE ' + where);
  return { would_delete: would, deleted: (r && r.affectedRows != null) ? r.affectedRows : would, cutoff_year: cutoff };
}
// Delete EVERY row (no date filter). For clearing test data; callers must confirm.
async function purge_all(pool, table) {
  const [c] = await pool.query('SELECT COUNT(*) AS n FROM `' + table + '`');
  const would = c[0] ? c[0].n : 0;
  const [r] = await pool.query('DELETE FROM `' + table + '`');
  return { would_delete: would, deleted: (r && r.affectedRows != null) ? r.affectedRows : would };
}
// Delete only deliberate test-run rows (is_test = 1) — leaves real + demo data untouched.
// Events from a browser opened with ?metrics_test=1 are stamped is_test=1 by the client.
async function purge_test(pool, table) {
  const where = 'is_test = 1';
  const [c] = await pool.query('SELECT COUNT(*) AS n FROM `' + table + '` WHERE ' + where);
  const would = c[0] ? c[0].n : 0;
  const [r] = await pool.query('DELETE FROM `' + table + '` WHERE ' + where);
  return { would_delete: would, deleted: (r && r.affectedRows != null) ? r.affectedRows : would };
}
module.exports = { size, purge_keep_years, purge_all, purge_test, current_year_in_tz, YEAR_COL };
