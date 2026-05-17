#!/usr/bin/env node
/**
 * server.js — Local Override Manager server for the USAT event analysis dashboard.
 *
 * Runs a tiny Express server on localhost:7474 that lets the dashboard HTML
 * actually read, write, and apply overrides without any copy-paste.
 *
 * Usage:
 *   node server.js              # starts server + opens dashboard in default browser
 *   node server.js --no-open   # starts server without opening browser
 *   node server.js --port 8080  # use a different port
 *
 * Endpoints:
 *   GET  /api/overrides         — read current overrides.json
 *   POST /api/overrides         — write (replace) overrides.json
 *   POST /api/overrides/add     — add a single override entry
 *   POST /api/overrides/remove  — remove a specific override entry
 *   GET  /api/rebuild           — run node build_all.js and stream output
 *   GET  /api/status            — server health check + last build time
 *   GET  /dashboard             — serve the latest dashboard.html
 */

'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const { spawn }  = require('child_process');

const DIR     = __dirname;
const OV_PATH = path.join(DIR, 'data', 'overrides.json');
const DASH    = path.join(DIR, 'output', 'dashboard.html');

const DEFAULT_PORT = 7474;
const argv = process.argv.slice(2);
const PORT = (() => {
  const i = argv.indexOf('--port');
  return i >= 0 ? parseInt(argv[i + 1], 10) || DEFAULT_PORT : DEFAULT_PORT;
})();
const OPEN_BROWSER = !argv.includes('--no-open');

// ── Helpers ───────────────────────────────────────────────────────────────────

function load_overrides() {
  if (!fs.existsSync(OV_PATH)) {
    return { force_match: [], force_no_match: [], force_segment: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(OV_PATH, 'utf8'));
  } catch {
    return { force_match: [], force_no_match: [], force_segment: [] };
  }
}

function save_overrides(obj) {
  // Ensure all three arrays exist
  const out = {
    force_match:    obj.force_match    ?? [],
    force_no_match: obj.force_no_match ?? [],
    force_segment:  obj.force_segment  ?? [],
  };
  fs.writeFileSync(OV_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return out;
}

let last_build = null;
let build_running = false;

// ── App ────────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Health / status
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    last_build,
    build_running,
    overrides_path: OV_PATH,
    dashboard_exists: fs.existsSync(DASH),
  });
});

// Read overrides
app.get('/api/overrides', (req, res) => {
  res.json(load_overrides());
});

// Replace entire overrides file
app.post('/api/overrides', (req, res) => {
  try {
    const saved = save_overrides(req.body);
    res.json({ ok: true, saved });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Add a single override entry
// Body: { type: 'force_match'|'force_no_match'|'force_segment', entry: {...} }
app.post('/api/overrides/add', (req, res) => {
  const { type, entry } = req.body || {};
  const VALID = ['force_match', 'force_no_match', 'force_segment'];
  if (!VALID.includes(type)) {
    return res.status(400).json({ ok: false, error: `Invalid type. Must be: ${VALID.join(', ')}` });
  }
  if (!entry || typeof entry !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing entry object' });
  }
  try {
    const ov = load_overrides();
    ov[type] = ov[type] ?? [];
    ov[type].push({ ...entry, _added: new Date().toISOString() });
    const saved = save_overrides(ov);
    console.log(`  [override] Added ${type}:`, JSON.stringify(entry));
    res.json({ ok: true, saved, total: saved[type].length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Remove an override entry
// Body: { type: 'force_match'|..., index: 0 }  OR  { type: '...', sid_25: '...', sid_26: '...' }
app.post('/api/overrides/remove', (req, res) => {
  const { type, index, sid_25, sid_26 } = req.body || {};
  const VALID = ['force_match', 'force_no_match', 'force_segment'];
  if (!VALID.includes(type)) {
    return res.status(400).json({ ok: false, error: 'Invalid type' });
  }
  try {
    const ov = load_overrides();
    const arr = ov[type] ?? [];
    let removed = null;
    if (typeof index === 'number') {
      removed = arr.splice(index, 1)[0];
    } else {
      const i = arr.findIndex(e =>
        (sid_25 && e.sid_25 === sid_25) || (sid_26 && e.sid_26 === sid_26)
      );
      if (i >= 0) removed = arr.splice(i, 1)[0];
    }
    if (!removed) return res.status(404).json({ ok: false, error: 'Entry not found' });
    ov[type] = arr;
    const saved = save_overrides(ov);
    console.log(`  [override] Removed ${type}:`, JSON.stringify(removed));
    res.json({ ok: true, saved, removed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Run build — streams stdout/stderr via SSE
app.get('/api/rebuild', (req, res) => {
  if (build_running) {
    res.status(409).json({ ok: false, error: 'Build already running' });
    return;
  }
  build_running = true;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'start', ts: new Date().toISOString() });

  const child = spawn('node', ['build_all.js'], { cwd: DIR });
  child.stdout.on('data', d => {
    d.toString().split('\n').forEach(line => { if (line.trim()) send({ type: 'out', line }); });
  });
  child.stderr.on('data', d => {
    d.toString().split('\n').forEach(line => { if (line.trim()) send({ type: 'err', line }); });
  });
  child.on('close', code => {
    last_build = new Date().toISOString();
    build_running = false;
    send({ type: 'done', code, ts: last_build });
    res.end();
  });
});

// Serve the dashboard HTML
app.get('/dashboard', (req, res) => {
  if (!fs.existsSync(DASH)) {
    return res.status(404).send('<h2>Dashboard not found — run <code>node build_all.js</code> first.</h2>');
  }
  res.sendFile(DASH);
});

// Also serve output directory for any referenced assets
app.use('/output', express.static(path.join(DIR, 'output')));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', () => {
  console.log('\n  USAT Override Manager Server');
  console.log('  ════════════════════════════════');
  console.log(`  Running at:  http://localhost:${PORT}`);
  console.log(`  Dashboard:   http://localhost:${PORT}/dashboard`);
  console.log(`  Overrides:   http://localhost:${PORT}/api/overrides`);
  console.log(`  Rebuild:     http://localhost:${PORT}/api/rebuild`);
  console.log('');
  console.log(`  Overrides file: ${OV_PATH}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.\n');

  if (OPEN_BROWSER) {
    // Try to open the dashboard in the default browser
    const open_cmd = process.platform === 'darwin' ? 'open'
                   : process.platform === 'win32'  ? 'start'
                   : 'xdg-open';
    const { exec } = require('child_process');
    exec(`${open_cmd} http://localhost:${PORT}/dashboard`, err => {
      if (err) console.log(`  (Could not auto-open browser — navigate manually to http://localhost:${PORT}/dashboard)`);
    });
  }
});
