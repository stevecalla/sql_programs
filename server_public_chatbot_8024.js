#!/usr/bin/env node
/**
 * server_public_chatbot_8024.js — dedicated, hardened host for the PUBLIC embeddable chatbot widget.
 *
 * Lives at the repo root beside the other server_*.js services (port 8024 follows 8023 event_coi).
 * Serves ONLY the isolated public surface (src/usat_apps/modules/chatbot/public.js -> /api/public-chatbot/*):
 * the embeddable widget page, the GTM loader (widget.js), and the /ask endpoint. It is UNAUTHENTICATED and
 * internet-facing, so it deliberately runs as its OWN process — separate from the authenticated platform
 * (:8022). No admin routes, no Salesforce, and no member PII are even present in this process. It grounds
 * ONLY on curated knowledge via the shared services, and reads the SAME database + config.json (public_bots)
 * the platform panel writes, so bots you configure in the app drive this server automatically.
 *
 * (The platform :8022 still mounts the same public routes for the in-app live preview; this server is the
 * one you point external embeds / the GTM loader at, ideally behind its own subdomain.)
 *
 * Mirrors server_usat_apps_8022.js: create_app() builds the Express app, start_server() listens with NO host
 * arg -> dual-stack '::' (IPv6 + IPv4), and a fleet-standard SIGINT/SIGTERM cleanup makes Ctrl-C / `pm2 stop`
 * exit cleanly.
 *
 * Usage:
 *   node server_public_chatbot_8024.js            # default port 8024 (CHATBOT_PUBLIC_PORT overrides)
 *
 * Importable: tests can call create_app() and listen on port 0.
 */
'use strict';

const path = require('path');
const dotenv = require('dotenv');
// Repo-root .env (LOCAL_MYSQL_* DB creds, OPENAI_API_KEY, CHATBOT_PUBLIC_* / CHATBOT_WIDGET_*) regardless of cwd.
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const publicApi = require('./src/usat_apps/modules/chatbot/public');

const DEFAULT_PORT = Number(process.env.CHATBOT_PUBLIC_PORT) || 8024;
const PROD_URL = process.env.CHATBOT_PUBLIC_URL || 'https://usat-app.kidderwise.org/';

function create_app() {
  const app = express();
  app.disable('x-powered-by');
  // Behind the :8000 proxy / Cloudflare — trust X-Forwarded-For so per-IP rate limiting uses the real client
  // IP (not the proxy's). Matches how this surface is fronted in prod.
  app.set('trust proxy', true);

  // NOTE: intentionally NO permissive CORS here. The widget's /ask calls are same-origin (they run inside the
  // iframe this server serves), and cross-site framing is governed by the CSP frame-ancestors public.js sets.
  // Keeping this surface same-origin is part of hardening the public process.

  // One concise log line per request — confirms the proxy/CDN reaches this process.
  app.use(function (req, res, next) {
    const ts = new Date().toISOString();
    console.log('[' + ts + '] ' + req.method + ' ' + req.originalUrl + '  host=' + (req.headers.host || '?'));
    next();
  });

  // Public payloads are tiny (a chat message, capped at 2000 chars in public.js) — hard-cap the body.
  app.use(express.json({ limit: '64kb' }));

  // Lightweight health check for monitoring / the proxy (the platform uses /api/status).
  app.get(['/', '/healthz', '/api/status'], function (req, res) {
    res.json({ ok: true, service: 'public-chatbot', ts: new Date().toISOString() });
  });

  // The isolated public surface: /api/public-chatbot/widget, /widget.js, /ask.
  publicApi.mount(app);

  return app;
}

function start_server(port) {
  const p = port || DEFAULT_PORT;
  const app = create_app();
  // No host arg -> dual-stack bind (IPv6 + IPv4), matching the other servers.
  const server = app.listen(p, function () {
    const actual = server.address().port;
    console.log('\nPublic ChatBot - dedicated widget server');
    console.log('  -> http://localhost:' + actual + '/api/public-chatbot/widget      (embeddable widget page)');
    console.log('  -> http://localhost:' + actual + '/api/public-chatbot/widget.js    (GTM loader script)');
    console.log('  -> http://localhost:' + actual + '/api/status                      (health check)');
    console.log('  -> ' + PROD_URL + '   (production host — proxy / Cloudflare)');
    console.log('  Unauthenticated, curated-knowledge only — no admin, no Salesforce, no PII in this process.');
    console.log('  One log line per request below. Press Ctrl-C to stop.\n');
  });
  server.on('error', function (e) {
    if (e && e.code === 'EADDRINUSE') console.error('PORT ' + p + ' is already in use — stop the other process or set CHATBOT_PUBLIC_PORT.');
    else console.error(e);
  });
  return server;
}

// Graceful shutdown (fleet-standard) so Ctrl-C and `pm2 stop` exit cleanly even with an open DB pool.
async function cleanup() {
  console.log('\nGracefully shutting down...');
  process.exit();
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

if (require.main === module) start_server();

module.exports = { create_app, start_server };
