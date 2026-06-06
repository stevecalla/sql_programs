// Full round-trip: drive the served app in a real browser, then assert the usage
// events actually landed in MySQL with the right columns. Isolates by this run's
// anonymous visitor_id and DELETEs its own rows afterward (never pollutes real data).
//
// DB is OPTIONAL: if the local analytics DB isn't reachable (no LOCAL_* env), the
// whole file skips — same graceful pattern as the visual tests off-win32. Runs on
// chromium only (the config ignores it on firefox/webkit; mobile only matches mobile).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });   // repo-root .env
const { test, expect } = require('@playwright/test');
const { reset_steps, SINGLE_XLSX } = require('./helpers');
const cfg = require('../metrics/metrics_config');

let pool = null, db_ok = false;

test.beforeAll(async () => {
  try {
    const mysql = require('mysql2/promise');
    const { local_usat_sales_db_config } = require('../../../utilities/config');
    const { ensure_table, ensure_columns } = require('../../../utilities/analytics/ensure_table');
    const { query_create_race_results_transform_events_table } =
      require('../../../src/queries/create_drop_db_table/query_create_race_results_transform_events_table');
    pool = mysql.createPool(await local_usat_sales_db_config());
    await pool.query('SELECT 1');
    await ensure_table(pool, await query_create_race_results_transform_events_table(cfg.TABLE)); // safe if server already made it
    await ensure_columns(pool, cfg.TABLE, [{ name: 'page_path', ddl: 'page_path VARCHAR(255)', after: 'event_name' }]); // migrate older tables
    db_ok = true;
  } catch (e) { db_ok = false; }
});
test.afterAll(async () => { if (pool) await pool.end(); });

async function rows_for(visitor) {
  const [r] = await pool.query('SELECT * FROM `' + cfg.TABLE + '` WHERE visitor_id = ? ORDER BY id', [visitor]);
  return r;
}
async function has_event(visitor, name) {
  return (await rows_for(visitor)).some(function (r) { return r.event_name === name; });
}

test.describe('race_results_transform — analytics DB round-trip', () => {
  test('upload → convert → download writes the expected rows to MySQL', async ({ page }) => {
    test.skip(!db_ok, 'local analytics DB not reachable (set LOCAL_* env + run the server once)');
    reset_steps();
    await page.addInitScript(() => { window.METRICS_TEST_ALLOW = true; });   // muted under automation by default — opt in
    await page.goto('/');
    // capture THIS run's anonymous id so we only read/clean our own rows
    const visitor = await page.evaluate(function () { try { return localStorage.getItem('um_visitor_id'); } catch (e) { return null; } });
    expect(visitor, 'client should have set an anonymous visitor_id').toBeTruthy();
    try {
      await expect.poll(function () { return has_event(visitor, 'page_view'); }, { timeout: 10000 }).toBe(true);

      await page.setInputFiles('#fileInput', SINGLE_XLSX);
      await expect(page.locator('#compareCard')).toBeVisible();
      await expect.poll(async function () {
        const rs = await rows_for(visitor);
        return rs.some(function (r) { return r.event_name === 'file_uploaded'; }) &&
               rs.some(function (r) { return r.event_name === 'conversion_completed'; });
      }, { timeout: 10000 }).toBe(true);

      const [download] = await Promise.all([ page.waitForEvent('download'), page.locator('#downloadBtn').click() ]);
      await download.path();
      await expect.poll(function () { return has_event(visitor, 'download'); }, { timeout: 10000 }).toBe(true);

      // ---- column-level assertions on the persisted rows ----
      const rs = await rows_for(visitor);
      const up = rs.find(function (r) { return r.event_name === 'file_uploaded'; });
      expect(up.app).toBe('race_results_transform');
      expect(up.file_type).toBe('xlsx');
      expect(String(up.file_name)).toContain('sample_race_results_FAKE');
      expect(up.created_at_utc, 'created_at_utc stamped').toBeTruthy();
      expect(up.created_at_mtn, 'created_at_mtn stamped').toBeTruthy();
      expect(up.session_id).toBeTruthy();

      // page_path records WHICH page the event came from (app is served at '/')
      const pv = rs.find(function (r) { return r.event_name === 'page_view'; });
      expect(String(pv.page_path)).toMatch(/^\//);   // e.g. '/' for the app

      const conv = rs.find(function (r) { return r.event_name === 'conversion_completed'; });
      expect(Number(conv.row_count)).toBeGreaterThan(0);
      expect(['green', 'amber', 'red']).toContain(conv.scorecard_band);
      expect(Number(conv.cols_matched)).toBeGreaterThan(0);

      const dl = rs.find(function (r) { return r.event_name === 'download'; });
      expect(dl.download_mode).toBe('single');
      // filename now travels to every post-upload event, so each row traces back to its sheet
      expect(String(conv.file_name)).toContain('sample_race_results_FAKE');
      expect(String(dl.file_name)).toContain('sample_race_results_FAKE');

      // PII guard: no raw cell/header data should ever be a column on the row
      expect(Object.keys(up).indexOf('email')).toBe(-1);

      // theme preference + start-over are tracked too
      await page.locator('#themeToggle').click();
      await expect.poll(function () { return has_event(visitor, 'theme_changed'); }, { timeout: 8000 }).toBe(true);
      const tc = (await rows_for(visitor)).find(function (r) { return r.event_name === 'theme_changed'; });
      expect(['light', 'dark']).toContain(tc.theme);
      await page.locator('#clearBtn').click();   // "Start over"
      await expect.poll(function () { return has_event(visitor, 'start_over'); }, { timeout: 8000 }).toBe(true);
    } finally {
      if (pool && visitor) await pool.query('DELETE FROM `' + cfg.TABLE + '` WHERE visitor_id = ?', [visitor]);
    }
  });

  test('events table was created with the expected schema', async () => {
    test.skip(!db_ok, 'local analytics DB not reachable (set LOCAL_* env)');
    const [cols] = await pool.query(
      'SELECT column_name AS cn FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
      [cfg.TABLE]);
    const names = cols.map(function (c) { return c.cn; });
    expect(names.length, 'table should exist with columns').toBeGreaterThan(0);
    ['id', 'created_at_utc', 'created_at_mtn', 'app', 'event_name', 'session_id', 'visitor_id',
     'is_returning', 'upload_id', 'file_name', 'file_name_hash', 'fil