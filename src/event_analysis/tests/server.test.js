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
