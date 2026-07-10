'use strict';
// Smoke tests for the reporting API — no DB, no build required. Mirrors the merge tool's test style
// (create_app + listen on port 0). Run: node --test src/reporting/tests
process.env.REPORTING_SESSION_SECRET = process.env.REPORTING_SESSION_SECRET || require('node:crypto').randomBytes(24).toString('hex');
const test = require('node:test');
const assert = require('node:assert');
const { create_app } = require('../../../server_reporting_8021.js');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}
async function get(port, path, headers) {
  const r = await fetch('http://127.0.0.1:' + port + path, { headers: headers || {} });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

test('GET /api/status is public and reports the app name', async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  try {
    const { status, body } = await get(port, '/api/status');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.app, 'reporting');
  } finally { server.close(); }
});

test('GET /api/me is 401 when signed out', async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  try {
    const { status } = await get(port, '/api/me');
    assert.strictEqual(status, 401);
  } finally { server.close(); }
});

test('GET /api/bootstrap requires auth (401 signed out)', async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  try {
    const { status } = await get(port, '/api/bootstrap');
    assert.strictEqual(status, 401);
  } finally { server.close(); }
});

test('GET /api/dataset requires auth (401 signed out)', async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  try {
    const { status } = await get(port, '/api/dataset');
    assert.strictEqual(status, 401);
  } finally { server.close(); }
});
