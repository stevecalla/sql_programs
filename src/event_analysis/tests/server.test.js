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

  // ── POST /api/overrides force_no_match ─────────────────────────────────

  test('POST /api/overrides force_no_match without side returns 400', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'force_no_match', sid_baseline: 'STEP8-NM-25' }),
    });
    assert.equal(res.status, 400);
  });

  test('POST /api/overrides force_no_match baseline-side inserts with sid_baseline only', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_no_match',
        side: 'baseline',
        sid_baseline: 'STEP8-NMB-25',
        note: 'cancelled',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.side, 'baseline');

    const c = await step8_db();
    const [rows] = await c.query('SELECT sid_baseline, sid_analysis FROM event_analysis_overrides WHERE id = ?', [body.id]);
    assert.equal(rows[0].sid_baseline, 'STEP8-NMB-25');
    assert.equal(rows[0].sid_analysis, null);
  });

  test('POST /api/overrides force_no_match analysis-side inserts with sid_analysis only', async () => {
    const res = await fetch(`${base}/api/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'force_no_match',
        side: 'analysis',
        sid_analysis: 'STEP8-NMA-26',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();

    const c = await step8_db();
    const [rows] = await c.query('SELECT sid_baseline, sid_analysis FROM event_analysis_overrides WHERE id = ?', [body.id]);
    assert.equal(rows[0].sid_baseline, null);
    assert.equal(rows[0].sid_analysis, 'STEP8-NMA-26');
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
        side: 'baseline',
        sid_baseline: 'STEP8-APR-25',
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
        side: 'baseline',
        sid_baseline: 'STEP8-APR-BY',
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
        side: 'baseline',
        sid_baseline: 'STEP8-UNAPR-25',
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
