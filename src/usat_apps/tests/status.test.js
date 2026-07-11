"use strict";
// Adapted from src/reporting/tests/status.test.js. Smoke tests for the usat_apps platform API — no DB
// and no build required (create_app + listen on port 0). Isolates the data dir so session/auth setup
// never touches real files. Run: npm run usat_apps_test
const os = require("os");
const path = require("path");
const fs = require("fs");
// Isolate BEFORE requiring the server (module paths + recovery creds resolve at load).
process.env.USATAPPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "usat_apps_status_"));
process.env.USATAPPS_ADMIN_USER = process.env.USATAPPS_ADMIN_USER || "recovery_admin";
process.env.USATAPPS_ADMIN_PASS = process.env.USATAPPS_ADMIN_PASS || require("node:crypto").randomBytes(12).toString("hex");

const test = require("node:test");
const assert = require("node:assert");
const { create_app } = require("../../../server_usat_apps_8022.js");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}
async function get(port, p, headers) {
  const r = await fetch("http://127.0.0.1:" + port + p, { headers: headers || {} });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body: body };
}

test("GET /api/status is public and reports the app name", async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  try {
    const { status, body } = await get(port, "/api/status");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.app, "usat_apps");
  } finally { server.close(); }
});

test("GET /api/me is 401 when signed out", async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  try {
    assert.strictEqual((await get(port, "/api/me")).status, 401);
  } finally { server.close(); }
});

test("GET /api/modules requires auth (401 signed out)", async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  try {
    assert.strictEqual((await get(port, "/api/modules")).status, 401);
  } finally { server.close(); }
});

test("participation-maps API is panel-gated (401 signed out)", async () => {
  const app = create_app();
  const { server, port } = await listen(app);
  try {
    assert.strictEqual((await get(port, "/api/participation-maps/bootstrap")).status, 401);
    assert.strictEqual((await get(port, "/api/participation-maps/dataset")).status, 401);
  } finally { server.close(); }
});
