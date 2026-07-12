#!/usr/bin/env node
'use strict';
/**
 * server_salesforce_merge_worker_8021.js — Salesforce merge worker (Phase 3).
 *
 * Background process that drains queued `salesforce_merge_run` rows (kind merge/restore/recreate) and
 * runs the existing merge/restore execution OUT of the usat_apps web process, so destructive Salesforce
 * writes never run in the web tier. Multi-worker safe (atomic DB claim) — scale with pm2 `instances`.
 * A tiny /health on :8021 (freed by the /reporting retirement) so it shows in Ops/pm2 like the other
 * server_*.js services. Env from the repo-root .env (SF_* creds, LOCAL_MYSQL_*). Mirrors the fleet.
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });

const http = require('http');
const { main } = require('./src/salesforce_merge_worker/loop');

const PORT = Number(process.env.MERGE_WORKER_PORT) || 8021;

http.createServer(function (req, res) {
  if (req.url === '/health' || req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'salesforce_merge_worker', pid: process.pid, time: new Date().toISOString() }));
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, function () { console.log('[merge_worker] health on :' + PORT); });

main().catch(function (e) { console.error('[merge_worker] fatal', e); process.exit(1); });
