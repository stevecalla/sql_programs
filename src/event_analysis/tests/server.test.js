/**
 * server.test.js — Smoke tests for the local Express server (Step 7).
 *
 * Spins up the server on an ephemeral port (port 0) so the suite never
 * collides with a developer-run instance on 7474. Uses Node's built-in
 * fetch (Node 18+) to hit each endpoint and asserts shape + status.
 *
 * Run via:
 *   node --test tests/server.test.js
 *   node --test tests/   # runs alongside overrides.test.js
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Server lives at the repo root alongside the other server_*.js services.
// From src/event_analysis/tests/ that's three levels up.
const { create_app } = require('../../../server_event_analysis_8016');

// ── Shared server lifecycle ─────────────────────────────────────────────

let server  = null;
let base    = null;

before(async () => {
  // Pin env vars so /api/status / /api/overrides have a predictable scope
  // regardless of when the suite is run.
  process.env.BASELINE_YEAR = '2025';
  process.env.ANALYSIS_YEAR = '2026';

  const app = await create_app();
  await new Promise((resolve, reject) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      base = `http://localhost:${port}`;
      resolve();
    });
    server.on('error', reject);
  });
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('Step 7 — server: read-only API', () => {

  test('GET / returns the HTML index page', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const body = await res.text();
    assert.match(body, /USAT Event Analysis/);
    assert.match(body, /\/api\/status/, 'index should reference the status endpoint');
    assert.match(body, /\/output\/dashboard\.html/, 'index should link to the dashboard');
  });

  test('GET /api/status returns ok + year scope + iso time', async () => {
    const res = await fetch(`${base}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.baseline_year, 2025);
    assert.equal(body.analysis_year, 2026);
    assert.ok(typeof body.output_dir === 'string' && body.output_dir.length > 0);
    assert.match(body.time, /^\d{4}-\d{2}-\d{2}T/, 'time should be ISO 8601');
  });

  test('GET /api/overrides returns scope + three override arrays', async () => {
    const res = await fetch(`${base}/api/overrides`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.scope, { baseline_year: 2025, analysis_year: 2026 });
    assert.ok(Array.isArray(body.force_match),    'force_match should be an array');
    assert.ok(Array.isArray(body.force_no_match), 'force_no_match should be an array');
    assert.ok(Array.isArray(body.force_segment),  'force_segment should be an array');
    assert.ok(body.stats && typeof body.stats.total === 'number', 'stats should be present');
  });

  test('GET /api/overrides honours query-param scope override', async () => {
    const res = await fetch(`${base}/api/overrides?baseline_year=1999&analysis_year=2000`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scope.baseline_year, 1999, 'query param should override default baseline');
    assert.equal(body.scope.analysis_year, 2000, 'query param should override default analysis');
  });

  test('GET /api/overrides enriches each row with name_baseline + name_analysis fields', async () => {
    // Server-side enrichment joins event_data_metrics so the editor UI can
    // show "311655-Adult Race · Alpha Win Sarasota FL" instead of bare
    // sanction IDs. The fields must be present on every override row
    // (value null when the underlying event has been deleted from source
    // data — the UI handles that with a placeholder).
    const res = await fetch(`${base}/api/overrides`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const all = [...body.force_match, ...body.force_no_match, ...body.force_segment];

    // Empty-overrides DB is acceptable for this assertion — just confirm
    // the contract for any rows that DO exist.
    for (const ov of all) {
      assert.ok(Object.prototype.hasOwnProperty.call(ov, 'name_baseline'),
        `override id=${ov.id} missing name_baseline field`);
      assert.ok(Object.prototype.hasOwnProperty.call(ov, 'name_analysis'),
        `override id=${ov.id} missing name_analysis field`);
      assert.ok(Object.prototype.hasOwnProperty.call(ov, 'month_baseline'),
        `override id=${ov.id} missing month_baseline field`);
      assert.ok(Object.prototype.hasOwnProperty.call(ov, 'month_analysis'),
        `override id=${ov.id} missing month_analysis field`);
      // Values are either a string (joined) or null (deleted event /
      // single-sided override) — never undefined.
      assert.notEqual(typeof ov.name_baseline, 'undefined',
        `name_baseline should be string or null, never undefined (id=${ov.id})`);
      assert.notEqual(typeof ov.name_analysis, 'undefined',
        `name_analysis should be string or null, never undefined (id=${ov.id})`);
    }
  });

  test('GET /api/events with no year param returns 400', async () => {
    const res = await fetch(`${base}/api/events`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /year/, 'error message should mention the year param');
  });

  test('GET /api/events?year=garbage returns 400', async () => {
    const res = await fetch(`${base}/api/events?year=garbage`);
    assert.equal(res.status, 400);
  });

  test('GET /api/events?year=2026 returns events array + counts', async () => {
    const res = await fetch(`${base}/api/events?year=2026`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.year, 2026);
    assert.equal(typeof body.count, 'number');
    assert.equal(typeof body.total_in_year, 'number');
    assert.equal(body.include_excluded, false, 'default should filter out CANCELLED/DECLINED/DELETED');
    assert.ok(Array.isArray(body.events));
    if (body.events.length > 0) {
      const e = body.events[0];
      // Spot-check the column-map: known field names should be present.
      assert.ok('sanction_id' in e || 'name' in e, 'mapped event objects should have keyed fields');
    }
  });

  test('GET /api/events?year=2026&include=excluded includes CANCELLED rows', async () => {
    const res = await fetch(`${base}/api/events?year=2026&include=excluded`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.include_excluded, true);
    // count should equal total_in_year when nothing is filtered out
    assert.equal(body.count, body.total_in_year);
  });

  test('GET /unknown returns a JSON 404', async () => {
    const res = await fetch(`${base}/some/unknown/path`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'not found');
    assert.equal(body.path, '/some/unknown/path');
  });

  test('CORS header present (so the future dashboard can fetch from a different origin)', async () => {
    const res = await fetch(`${base}/api/status`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 8 — Write endpoints
// ═══════════════════════════════════════════════════════════════════════════
//
// Each write test sends a real HTTP request to the test server (port 0 from
// the before() hook), then queries the DB to verify the row exists with the
// expected shape. Cleanup uses a STEP8- sid prefix so the suite cleans up
// after itself even though the rows get tagged `created_by = 'server'`
// (matching production HTTP writes).

const mysqlP_step8 = require('mysql2/promise');
const { local_usat_sales_db_config: db_cfg_step8 } = require('../../../utilities/config');

let step8_conn = null;
async function step8_db() {
  if (!step8_conn) {
    const cfg = await db_cfg_step8();
    step8_conn = await mysqlP_step8.createConnection(cfg);
  }
  return step8_conn;
}

async function step8_cleanup() {
  const c = await step8_db();
  // Delete every row whose sid starts with STEP8- regardless of created_by
  // (server-tagged via the HTTP API, or test_suite-tagged via direct insert).
  await c.query(
    `DELETE FROM event_analysis_overrides
       WHERE sid_baseline LIKE 'STEP8-%'
          OR sid_analysis LIKE 'STEP8-%'`
  );
}

describe('Step 8 — write endpoints', () => {

  before(async () => {
    // before() at the file top already pinned BASELINE_YEAR/ANALYSIS_YEAR.
    await step8_cleanup();
  });

  after(async () => {
    await step8_cleanup();
    if (step8_conn) await step8_conn.end();
  });

  // ── POST /api/overrides — validation ────────────────────────────────────

  test('POST /api/overrides with no body returns 400', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid type/);
  });

  test('POST /api/overrides with bad type returns 400', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'force_garbage' }),
    });
    assert.equal(res.status, 400);
  });

  test('POST /api/overrides force_match without both sids returns 400', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'force_match', sid_baseline: 'STEP8-MISSING-B' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /both sid_baseline and sid_analysis/);
  });

  // ── POST /api/overrides force_match — happy path ───────────────────────

  test('POST /api/overrides force_match inserts and is tagged created_by=server', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_match',
        sid_baseline: 'STEP8-FM-25',
        sid_analysis: 'STEP8-FM-26',
        note: 'http-test',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.type, 'force_match');
    assert.equal(body.status, 'inserted');
    assert.ok(body.id, 'response should include the inserted id');

    const c = await step8_db();
    const [rows] = await c.query(
      'SELECT override_type, sid_baseline, sid_analysis, created_by, note, baseline_year, analysis_year FROM event_analysis_overrides WHERE id = ?',
      [body.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].override_type, 'force_match');
    assert.equal(rows[0].sid_baseline,  'STEP8-FM-25');
    assert.equal(rows[0].sid_analysis,  'STEP8-FM-26');
    assert.equal(rows[0].created_by,    'server', 'HTTP writes should be tagged "server"');
    assert.equal(rows[0].baseline_year, 2025);
    assert.equal(rows[0].analysis_year, 2026);
  });

  test('POST /api/overrides force_match second call returns 200 with status=exists', async () => {
    // first call already inserted in the previous test — but we cleaned up
    // between describe blocks, so we re-insert here, then call a second time
    // to exercise the duplicate-guard path through HTTP.
    const insert = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_match',
        sid_baseline: 'STEP8-DUP-25',
        sid_analysis: 'STEP8-DUP-26',
      }),
    });
    assert.equal(insert.status, 201);

    const second = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_match',
        sid_baseline: 'STEP8-DUP-25',
        sid_analysis: 'STEP8-DUP-26',
      }),
    });
    assert.equal(second.status, 200, 'duplicate insert should not 201');
    const body = await second.json();
    assert.equal(body.status, 'exists');
  });

  test('POST /api/overrides force_match with global:true writes NULL/NULL scope', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_match',
        sid_baseline: 'STEP8-GLB-25',
        sid_analysis: 'STEP8-GLB-26',
        global: true,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();

    const c = await step8_db();
    const [rows] = await c.query('SELECT baseline_year, analysis_year FROM event_analysis_overrides WHERE id = ?', [body.id]);
    assert.equal(rows[0].baseline_year, null, 'global: true should produce NULL baseline_year');
    assert.equal(rows[0].analysis_year, null, 'global: true should produce NULL analysis_year');
  });

  // ── POST /api/overrides force_no_match (unlink) ──────────────────────────

  test('POST /api/overrides force_no_match without both sids returns 400', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'force_no_match', sid_baseline: 'STEP8-NM-25' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /both/, 'should mention both sids required');
  });

  test('POST /api/overrides force_no_match inserts with both sids and default segments', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_no_match',
        sid_baseline: 'STEP8-NMB-25',
        sid_analysis: 'STEP8-NMA-26',
        note: 'unlinked pair',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();

    const c = await step8_db();
    const [rows] = await c.query(
      'SELECT sid_baseline, sid_analysis, segment_baseline, segment_analysis FROM event_analysis_overrides WHERE id = ?',
      [body.id]
    );
    assert.equal(rows[0].sid_baseline, 'STEP8-NMB-25');
    assert.equal(rows[0].sid_analysis, 'STEP8-NMA-26');
    assert.equal(rows[0].segment_baseline, 'Lost', 'default baseline segment');
    assert.equal(rows[0].segment_analysis, 'New', 'default analysis segment');
  });

  test('POST /api/overrides force_no_match accepts custom per-side segments', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_no_match',
        sid_baseline: 'STEP8-NM2-25',
        sid_analysis: 'STEP8-NM2-26',
        segment_baseline: 'Tried to Return',
        segment_analysis: 'Recovered',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();

    const c = await step8_db();
    const [rows] = await c.query(
      'SELECT segment_baseline, segment_analysis FROM event_analysis_overrides WHERE id = ?',
      [body.id]
    );
    assert.equal(rows[0].segment_baseline, 'Tried to Return');
    assert.equal(rows[0].segment_analysis, 'Recovered');
  });

  test('POST /api/overrides force_no_match rejects invalid segment_baseline', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_no_match',
        sid_baseline: 'STEP8-NM3-25',
        sid_analysis: 'STEP8-NM3-26',
        segment_baseline: 'NotReal',
      }),
    });
    assert.equal(res.status, 400);
  });

  // ── POST /api/overrides force_segment ──────────────────────────────────

  test('POST /api/overrides force_segment with bad segment returns 400', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_segment',
        side: 'baseline',
        sid_baseline: 'STEP8-SEG-25',
        segment: 'NotARealSegment',
      }),
    });
    assert.equal(res.status, 400);
  });

  test('POST /api/overrides force_segment inserts a force_segment row', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_segment',
        side: 'baseline',
        sid_baseline: 'STEP8-SEG-25',
        segment: 'Lost',
        note: 'manual override',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.segment, 'Lost');

    const c = await step8_db();
    const [rows] = await c.query('SELECT override_type, segment FROM event_analysis_overrides WHERE id = ?', [body.id]);
    assert.equal(rows[0].override_type, 'force_segment');
    assert.equal(rows[0].segment, 'Lost');
  });

  // ── DELETE /api/overrides/:sid ─────────────────────────────────────────

  test('DELETE /api/overrides/:sid for unknown sid returns 404', async () => {
    const res = await fetch(`${base}/api/overrides/STEP8-NOPE-25`, { method: 'DELETE' });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.removed, 0);
  });

  test('DELETE /api/overrides/:sid soft-deletes existing rows', async () => {
    // Seed via the API
    const ins = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_match',
        sid_baseline: 'STEP8-DEL-25',
        sid_analysis: 'STEP8-DEL-26',
      }),
    });
    assert.equal(ins.status, 201);
    const ins_body = await ins.json();

    // Delete (URL-encoded sid)
    const del = await fetch(`${base}/api/overrides/${encodeURIComponent('STEP8-DEL-25')}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const del_body = await del.json();
    assert.equal(del_body.ok, true);
    assert.ok(del_body.removed >= 1, 'should report at least one soft-delete');

    // Verify active=0
    const c = await step8_db();
    const [rows] = await c.query('SELECT active FROM event_analysis_overrides WHERE id = ?', [ins_body.id]);
    assert.equal(rows[0].active, 0, 'soft-delete should set active=0');
  });

  // ── POST /api/approve/:sid + /api/unapprove/:sid ───────────────────────

  test('POST /api/approve/:sid for unknown sid returns 404', async () => {
    const res = await fetch(`${base}/api/approve/STEP8-NOPE-APR`, { method: 'POST' });
    assert.equal(res.status, 404);
  });

  test('POST /api/approve/:sid flips approved + sets approval_state', async () => {
    // Seed an un-approved override
    const ins = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_no_match',
        sid_baseline: 'STEP8-APR-25',
        sid_analysis: 'STEP8-APR-26',
      }),
    });
    assert.equal(ins.status, 201);
    const ins_body = await ins.json();

    // Approve via HTTP. approved_by defaults to "server" when not provided.
    const apr = await fetch(`${base}/api/approve/${encodeURIComponent('STEP8-APR-25')}`, { method: 'POST' });
    assert.equal(apr.status, 200);
    const apr_body = await apr.json();
    assert.equal(apr_body.ok, true);
    assert.equal(apr_body.approved, 1, 'should approve 1 row');

    const c = await step8_db();
    const [rows] = await c.query(
      'SELECT approved, approval_state, approved_by FROM event_analysis_overrides WHERE id = ?',
      [ins_body.id]
    );
    assert.equal(rows[0].approved,       1);
    assert.equal(rows[0].approval_state, 'approved');
    assert.equal(rows[0].approved_by,    'server', 'HTTP approve should tag approved_by="server"');
  });

  test('POST /api/approve/:sid respects approved_by from body', async () => {
    const ins = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_no_match',
        sid_baseline: 'STEP8-APR-BY',
        sid_analysis: 'STEP8-APR-BY-26',
      }),
    });
    const ins_body = await ins.json();

    const apr = await fetch(`${base}/api/approve/${encodeURIComponent('STEP8-APR-BY')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved_by: 'dashboard:skip@example.com' }),
    });
    assert.equal(apr.status, 200);

    const c = await step8_db();
    const [rows] = await c.query('SELECT approved_by FROM event_analysis_overrides WHERE id = ?', [ins_body.id]);
    assert.equal(rows[0].approved_by, 'dashboard:skip@example.com');
  });

  test('POST /api/unapprove/:sid clears approval state', async () => {
    // Seed + approve
    const ins = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_no_match',
        sid_baseline: 'STEP8-UNAPR-25',
        sid_analysis: 'STEP8-UNAPR-26',
      }),
    });
    const ins_body = await ins.json();
    await fetch(`${base}/api/approve/${encodeURIComponent('STEP8-UNAPR-25')}`, { method: 'POST' });

    // Unapprove
    const un = await fetch(`${base}/api/unapprove/${encodeURIComponent('STEP8-UNAPR-25')}`, { method: 'POST' });
    assert.equal(un.status, 200);
    const un_body = await un.json();
    assert.equal(un_body.unapproved, 1);

    const c = await step8_db();
    const [rows] = await c.query(
      'SELECT approved, approval_state, event_signature_baseline FROM event_analysis_overrides WHERE id = ?',
      [ins_body.id]
    );
    assert.equal(rows[0].approved,                 0);
    assert.equal(rows[0].approval_state,           null);
    assert.equal(rows[0].event_signature_baseline, null);
  });

  test('POST /api/unapprove/:sid for unknown sid returns 404', async () => {
    const res = await fetch(`${base}/api/unapprove/STEP8-NOPE-UNAPR`, { method: 'POST' });
    assert.equal(res.status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 9 — Override editor SPA (static files)
// ═══════════════════════════════════════════════════════════════════════════
//
// The editor itself is plain HTML + vanilla JS — it talks to the same API
// that's already exercised above. These tests just confirm the server is
// actually serving the three files with sensible content-types, and that
// the API index page links to /editor/.

describe('Step 9 — override editor static files', () => {

  test('GET /editor/ serves the editor HTML', async () => {
    const res = await fetch(`${base}/editor/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const body = await res.text();
    assert.match(body, /USAT Override Editor/);
    assert.match(body, /editor\.css/, 'editor HTML should reference the CSS');
    assert.match(body, /editor\.js/,  'editor HTML should reference the JS');
  });

  test('GET /editor/index.html serves the same page', async () => {
    const res = await fetch(`${base}/editor/index.html`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /USAT Override Editor/);
  });

  test('GET /editor/editor.css serves CSS', async () => {
    const res = await fetch(`${base}/editor/editor.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/css/);
    const body = await res.text();
    assert.match(body, /\.btn|\.card|\.toast/, 'CSS should contain known editor selectors');
  });

  test('GET /editor/editor.js serves JS', async () => {
    const res = await fetch(`${base}/editor/editor.js`);
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type') ?? '';
    assert.ok(/javascript/.test(ct) || /text\/plain/.test(ct), `unexpected content-type: ${ct}`);
    const body = await res.text();
    assert.match(body, /USAT Override Editor/, 'JS file-header comment should mention the editor');
    assert.match(body, /\/api\/overrides/, 'JS should call the overrides API');
  });

  test('GET /editor/nope returns 404', async () => {
    const res = await fetch(`${base}/editor/does-not-exist.html`);
    assert.equal(res.status, 404);
  });

  test('API index at / links to the editor', async () => {
    const res = await fetch(`${base}/`);
    const body = await res.text();
    assert.match(body, /href="\/editor\/"/, 'API index page should link to /editor/');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 9 integration + Step 9.5 — dashboard editor panel + /api/build
// ═══════════════════════════════════════════════════════════════════════════
//
// These tests confirm that:
//   1. The freshly-built dashboard.html includes the editor panel + override
//      status column + rebuild banner produced by dashboard.js's template.
//   2. The new /api/build SSE endpoint streams the expected event names.
//
// The dashboard.html being tested is whatever exists in the output directory
// at suite-run time (last successful build). If no dashboard.html exists, the
// content tests skip gracefully.

const fs_step9 = require('fs');
const path_step9 = require('path');

async function find_dashboard_html() {
  // Resolve output dir the same way the server does.
  const out_dir = process.env.EVENT_ANALYSIS_OUTPUT_DIR
    || (await require('../../../utilities/determineOSPath').determineOSPath().then(p => path_step9.join(p, 'usat_event_analysis_output'))
       .catch(() => null));
  if (!out_dir) return null;
  const fp = path_step9.join(out_dir, 'dashboard.html');
  return fs_step9.existsSync(fp) ? fp : null;
}

describe('Step 9 integration — dashboard editor panel', () => {

  test('dashboard.html contains the inline editor panel + status column', async (t) => {
    const fp = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs_step9.readFileSync(fp, 'utf8');

    // Detect pre-step-9 dashboards (built before the integration). The fastest
    // signal is the presence of any `dash-ov-` marker. If none → skip with a
    // pointer to rebuild, rather than failing every assertion below.
    if (!/dash-ov-editor|dash-ov-cell|dash-ov-rebuild/.test(html)) {
      t.skip('dashboard.html predates Step 9 integration — run node build_all.js to regenerate, then re-run this test');
      return;
    }

    // Editor panel markers
    assert.match(html, /id="dash-ov-editor"/,         'editor panel container should be present');
    assert.match(html, /id="dash-ov-form"/,           'add-override form should be present');
    assert.match(html, /id="dash-ov-list"/,           'overrides list container should be present');
    assert.match(html, /id="dash-ov-toast"/,          'toast element should be present');

    // Override column markers — only meaningful when the roster has data
    // (has_table === true at build time). When the dataset is empty the
    // template skips the whole roster + editor block.
    assert.match(html, /class="col-override"/,        'roster should have an Override column header');
    assert.match(html, /dash-ov-cell/,                'each row should have an override status cell');
    assert.match(html, /data-sid="/,                  'rows should carry data-sid for click delegation');

    // Rebuild banner + button
    assert.match(html, /id="dash-ov-rebuild-banner"/, 'rebuild banner should be present');
    assert.match(html, /id="dash-ov-rebuild-btn"/,    'rebuild button should be present');
    assert.match(html, /dash_ov_rebuild\(\)/,         'rebuild handler should be wired');

    // Editor JS hooks the API
    assert.match(html, /\/api\/overrides/,            'editor JS should call /api/overrides');
    assert.match(html, /\/api\/approve\//,            'editor JS should call /api/approve/');
    assert.match(html, /\/api\/build/,                'rebuild handler should call /api/build');

    // Stale Override Manager markers should be gone
    assert.doesNotMatch(html, /localhost:7474/,       'old port references should be gone');

    // Every inline <script> block we GENERATE must parse as JS. Catches
    // template-literal escape pitfalls (e.g. a stray \n inside a string that
    // gets converted to a real newline by the outer dashboard.js template,
    // breaking JS strings). We intentionally skip the embedded Chart.js
    // library — it's third-party minified code that contains literal
    // `</script>` substrings in error templates, which trip a simple regex.
    const vm = require('node:vm');
    const script_re = /<script>([\s\S]*?)<\/script>/g;
    let m, idx = 0, parse_errors = [];
    while ((m = script_re.exec(html)) !== null) {
      idx++;
      const body = m[1];
      if (!body.trim()) continue;
      // Heuristic: skip third-party minified library blocks. Chart.js
      // identifies itself in its leading comment; minified IIFEs are
      // typically dense and don't include our marker comments.
      const is_third_party = /\/\*!\s*Chart\.js/.test(body) ||
                              /Chart\.js v\d/.test(body.slice(0, 200)) ||
                              body.length > 80000;  // Chart.js minified ~ 200KB
      if (is_third_party) continue;
      try { new vm.Script(body); }
      catch (e) { parse_errors.push(`<script> #${idx}: ${e.message}`); }
    }
    assert.deepEqual(parse_errors, [], 'all OUR inline <script> blocks in dashboard.html should parse as JS');
    assert.doesNotMatch(html, /SERVER_URL = 'http:/,  'old SERVER_URL global should be gone');
  });

  // NOTE: glossary content is verified in tests/glossary.test.js — kept
  // separate so the educational copy can be edited without touching the
  // server/editor suite.
});

describe('Step 9.5 — /api/build SSE endpoint', () => {

  test('GET /api/build is reachable and starts streaming SSE events', async () => {
    // We use the raw stream (not EventSource — node:test runs in Node which
    // doesn't have a built-in EventSource). Read enough bytes to confirm the
    // content-type header and at least one event is emitted, then abort.
    const ctrl = new AbortController();
    let res;
    try {
      res = await fetch(`${base}/api/build`, { signal: ctrl.signal });
    } catch (err) {
      // If the build process can't even spawn (missing build script, DB
      // unreachable), the endpoint still returns 200 + an err event before
      // a done event — that's a valid pass. Hard failure here is unexpected.
      throw err;
    }
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

    // Pull the first chunk so we know the connection is alive and streaming.
    // Crucial subtlety for cross-OS test stability: when we ctrl.abort() the
    // request below, any in-flight `reader.read()` promise rejects with an
    // AbortError. If that rejection happens AFTER the test function returns
    // (race-condition territory — varies by OS, Linux exposes it more
    // reliably than Windows), node:test's "async activity after end" guard
    // flags it as an unhandledRejection and marks the test failed.
    //
    // To prevent that:
    //   1. Wrap the read in `.then(ok, err)` so its rejection is consumed
    //      INSIDE the promise — it can no longer leak past the test boundary.
    //   2. After abort+cancel, `await` the wrapped promise so settlement
    //      happens before the test function returns.
    const reader = res.body.getReader();
    const safe_read = reader.read().then(
      v => v,
      () => ({ value: undefined, done: true })   // AbortError lands here
    );
    const { value } = await Promise.race([
      safe_read,
      new Promise(resolve => setTimeout(() => resolve({ value: new Uint8Array() }), 3000)),
    ]);
    // Abort so the server-side build process is killed and we don't block.
    ctrl.abort();
    try { await reader.cancel(); } catch {}
    // Drain the wrapped read promise — if the timeout won the race above,
    // safe_read is still pending and will settle (with AbortError caught)
    // momentarily. Awaiting here ensures we don't return early.
    await safe_read;
    // We don't assert on chunk contents (build_all.js prints variable output);
    // reaching here without throwing is the contract this test cares about.
    assert.ok(value !== undefined, 'should at least open the stream');
  });

  test('concurrent /api/build attempts trigger the build-lock', async () => {
    // The previous test aborted its stream which spawns an async kill on
    // the server side. _build_running may still be true for a few ms after
    // the abort. Wait for it to actually clear by polling with retries.
    // (We can't `await` a process.exit from here; this is the pragmatic fix.)
    async function wait_for_lock_release(max_ms = 3000) {
      const start = Date.now();
      while (Date.now() - start < max_ms) {
        // A non-streaming probe wouldn't be representative; instead, fire a
        // throwaway build request. If it's 200 we got the lock — release it
        // immediately by aborting. If 409, the previous build is still
        // wrapping up; wait and retry.
        const ctrl = new AbortController();
        const res = await fetch(`${base}/api/build`, { signal: ctrl.signal });
        if (res.status === 200) {
          ctrl.abort();
          try { await res.body?.cancel(); } catch {}
          // Now wait once more for THIS aborted build to clear before the
          // real test fires its concurrent pair.
          await new Promise(r => setTimeout(r, 400));
          return;
        }
        try { await res.body?.cancel(); } catch {}
        await new Promise(r => setTimeout(r, 150));
      }
      throw new Error('lock never released — previous test leaked state');
    }
    await wait_for_lock_release();

    // Fire two requests near-simultaneously. Node's single-threaded event
    // loop makes the lock check + set atomic, so exactly one must win.
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    const [res1, res2] = await Promise.all([
      fetch(`${base}/api/build`, { signal: ctrl1.signal }),
      fetch(`${base}/api/build`, { signal: ctrl2.signal }),
    ]);
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409],
      `expected exactly one 200 + one 409 from concurrent /api/build, got ${statuses.join(', ')}`);

    // Clean up both streams so the test runner exits cleanly.
    ctrl1.abort(); ctrl2.abort();
    try { await res1.body?.cancel(); } catch {}
    try { await res2.body?.cancel(); } catch {}
  });
});
