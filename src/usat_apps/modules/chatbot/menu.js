#!/usr/bin/env node
'use strict';
/**
 * menu.js — chatbot module operations (folded into the usat_apps platform).
 *
 *   node src/usat_apps/modules/chatbot/menu.js
 *
 * The chatbot has TWO surfaces served by the platform server (:8022): the internal operator page
 * (/chatbot/training, auth'd) and the public embeddable widget (/api/public-chatbot/*, unauth'd). The
 * public widget can ALSO be served by the optional dedicated server_public_chatbot_8024.js (:8024).
 *
 * This CLI runs/verifies all of it: the shared-brain unit tests, live probes of the three public endpoints
 * (widget HTML, widget.js loader, POST /ask) against the dev proxy (:5175), the built server (:8022), and
 * the dedicated :8024 server, status pings, browser opens, and the shared knowledge-sync pulls.
 *
 * DATA-ONLY shell: rendering, numbering (by position), the CLI toggle, spawn, and quit handling come from
 * the shared kit. The widget probes keep this module's RICH hit() (content-type / CSP / 429 detail) via the
 * kit's run() escape hatch. See utilities/menu/menu_kit.js + plans_and_notes/MENU_CONVENTIONS.md.
 */
const path = require('path');
const http = require('http');
const { runMenu } = require('../../../../utilities/menu/menu_kit');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');   // .../modules/chatbot -> repo root
const PLATFORM_PORT = 8022;   // built server (single port: API + UI)
const DEV_PORT = 5175;        // Vite dev server — proxies /api to :8022
const PROXY_PORT = 8000;      // reverse proxy (usat-app host)
const PUBLIC_PORT = 8024;     // dedicated public-chatbot server (server_public_chatbot_8024.js)
const PUBLIC_BASE = '/api/public-chatbot';

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', GRAY = '\x1b[90m';
const c = (color, t) => `${color}${t}${RESET}`;

// Flexible HTTP probe: GET or POST (JSON) against 127.0.0.1:<port><path>. Prints status + content-type,
// the widget-relevant headers (CSP frame-ancestors), and a short body snippet / the parsed answer.
function hit(opts) {
  const { method = 'GET', port, pathname, body = null, snippet = 180 } = opts;
  const payload = body ? JSON.stringify(body) : null;
  const reqOpts = {
    host: '127.0.0.1', port, path: pathname, method,
    headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
  };
  return new Promise((resolve) => {
    const req = http.request(reqOpts, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => {
        const ok = res.statusCode < 400;
        console.log(c(ok ? GREEN : YELLOW, `  ${method} :${port}${pathname} -> HTTP ${res.statusCode}`));
        const ct = res.headers['content-type'] || '(none)';
        console.log(c(GRAY, `    content-type: ${ct}`));
        if (res.headers['content-security-policy']) console.log(c(GRAY, `    CSP: ${res.headers['content-security-policy']}`));
        const trimmed = b.trim();
        if (ct.indexOf('application/json') >= 0) {
          try { const j = JSON.parse(trimmed); console.log('    ' + c(BOLD, 'answer: ') + (j.answer != null ? JSON.stringify(j.answer) : JSON.stringify(j))); }
          catch { console.log('    ' + trimmed.slice(0, snippet)); }
        } else {
          console.log(c(GRAY, `    ${b.length} bytes; head: `) + JSON.stringify(trimmed.slice(0, snippet)) + (trimmed.length > snippet ? ' …' : ''));
        }
        if (res.statusCode === 429) console.log(c(DIM, '    (429 = rate limited — CHATBOT_PUBLIC_RATE per IP/min. Wait a minute.)'));
        resolve();
      });
    });
    req.on('error', (e) => { console.log(c(YELLOW, `  Not reachable on :${port} — is it running? (${e.code || e.message})`)); if (port === DEV_PORT) console.log(c(DIM, '    (dev proxy :5175 must be up AND :8022 behind it — the widget is server-rendered by :8022.)')); resolve(); });
    if (payload) req.write(payload);
    req.end();
  });
}

// A default, safe test question for the /ask probe (curated Team USA knowledge only).
const SAMPLE_Q = 'What is USA Triathlon?';

// run() handler: prompt for a message, then POST it to the public /ask endpoint on the given port.
async function ask_question(ctx, port) {
  const msg = (await ctx.ask(c(BOLD, '  Your question: '))).trim();
  if (!msg) { console.log(c(YELLOW, '  (empty — skipped)')); return; }
  console.log('');
  await hit({ method: 'POST', port, pathname: `${PUBLIC_BASE}/ask`, body: { message: msg } });
}

// run() handler: pick a bubble style + port, then open the widget URL. Lets you flip styles fast.
const BUBBLE_STYLES = ['plain', 'triathlon', 'athlete', 'speedlines', 'emoji', 'usat', 'random'];
async function pick_bubble(ctx) {
  console.log(c(BOLD, '  Bubble styles:'));
  BUBBLE_STYLES.forEach((s, i) => console.log('    ' + c(CYAN, (i + 1) + ')') + ' ' + s));
  const a = (await ctx.ask(c(BOLD, '  Pick a style [1-' + BUBBLE_STYLES.length + ']: '))).trim();
  const style = BUBBLE_STYLES[parseInt(a, 10) - 1] || 'triathlon';
  const p = (await ctx.ask(c(BOLD, '  Port [' + DEV_PORT + ' dev / ' + PLATFORM_PORT + ' built] [' + DEV_PORT + ']: '))).trim() || String(DEV_PORT);
  ctx.openUrl('http://localhost:' + p + PUBLIC_BASE + '/widget?bubble=' + style);
}

const SECTIONS = [
  { label: 'TESTS — shared brain (unit, no DB)', color: 'CYAN', items: [
    { label: 'Knowledge tests', desc: 'services/knowledge — chunk (BM25-lite), embeddings (cosine/blend), knowledge gather, URL safety', bin: 'node', args: ['src/usat_apps/run_tests.js', 'services/knowledge'], cli: 'node src/usat_apps/run_tests.js services/knowledge' },
    { label: 'Corrections tests', desc: 'services/corrections — the operator corrections the bot follows (shared with the email queue)', bin: 'node', args: ['src/usat_apps/run_tests.js', 'services/corrections'], cli: 'node src/usat_apps/run_tests.js services/corrections' },
    { label: 'AI service tests', desc: 'services/ai — model registry, providers, completion normalize, respond/ask', bin: 'node', args: ['src/usat_apps/run_tests.js', 'services/ai'], cli: 'node src/usat_apps/run_tests.js services/ai' },
    { label: 'All shared-brain tests', desc: 'knowledge + corrections + ai in one run (everything the chatbot grounds on)', bin: 'node', args: ['src/usat_apps/run_tests.js', 'services/knowledge', 'services/corrections', 'services/ai'], cli: 'node src/usat_apps/run_tests.js services/knowledge services/corrections services/ai' },
    { label: 'Syntax-check public surface', desc: 'node --check on public.js + widget_page.js (fast; no server needed)', bin: process.platform === 'win32' ? 'cmd' : 'sh', args: process.platform === 'win32'
        ? ['/c', 'node --check src/usat_apps/modules/chatbot/public.js && node --check src/usat_apps/modules/chatbot/widget_page.js && echo OK']
        : ['-c', 'node --check src/usat_apps/modules/chatbot/public.js && node --check src/usat_apps/modules/chatbot/widget_page.js && echo OK'],
      cli: 'node --check .../public.js && node --check .../widget_page.js' },
  ]},
  { label: 'PUBLIC WIDGET — live probes (dev proxy :5175)', color: 'MAGENTA', items: [
    { label: 'GET widget HTML (:5175)', desc: 'The embeddable page. Expect HTTP 200, text/html, and a CSP "frame-ancestors" header.', run: () => hit({ method: 'GET', port: DEV_PORT, pathname: `${PUBLIC_BASE}/widget` }), cli: `curl -i http://localhost:5175${PUBLIC_BASE}/widget` },
    { label: 'GET widget.js loader (:5175)', desc: 'The GTM loader script. Expect HTTP 200 and content-type application/javascript (NOT html).', run: () => hit({ method: 'GET', port: DEV_PORT, pathname: `${PUBLIC_BASE}/widget.js` }), cli: `curl -i http://localhost:5175${PUBLIC_BASE}/widget.js` },
    { label: 'POST /ask (:5175)', desc: `Ask "${SAMPLE_Q}" — expect a grounded JSON answer (or the polite "don't have that" fallback).`, run: () => hit({ method: 'POST', port: DEV_PORT, pathname: `${PUBLIC_BASE}/ask`, body: { message: SAMPLE_Q } }), cli: `curl -sX POST http://localhost:5175${PUBLIC_BASE}/ask -H "Content-Type: application/json" -d '{"message":"${SAMPLE_Q}"}'` },
    { label: 'POST /ask — your question (:5175)', desc: 'Prompts for a message, then POSTs it to the public /ask endpoint.', run: (ctx) => ask_question(ctx, DEV_PORT), cli: `curl -sX POST http://localhost:5175${PUBLIC_BASE}/ask -H "Content-Type: application/json" -d '{"message":"…"}'` },
  ]},
  { label: 'PUBLIC WIDGET — live probes (built server :8022)', color: 'MAGENTA', items: [
    { label: 'GET widget HTML (:8022)', desc: 'Same page straight off the platform server (no proxy). Prod-style path.', run: () => hit({ method: 'GET', port: PLATFORM_PORT, pathname: `${PUBLIC_BASE}/widget` }), cli: `curl -i http://localhost:8022${PUBLIC_BASE}/widget` },
    { label: 'GET widget.js loader (:8022)', desc: 'The loader off :8022 — this is the src you point the GTM Custom HTML tag at.', run: () => hit({ method: 'GET', port: PLATFORM_PORT, pathname: `${PUBLIC_BASE}/widget.js` }), cli: `curl -i http://localhost:8022${PUBLIC_BASE}/widget.js` },
    { label: 'POST /ask (:8022)', desc: `Ask "${SAMPLE_Q}" straight off :8022.`, run: () => hit({ method: 'POST', port: PLATFORM_PORT, pathname: `${PUBLIC_BASE}/ask`, body: { message: SAMPLE_Q } }), cli: `curl -sX POST http://localhost:8022${PUBLIC_BASE}/ask -H "Content-Type: application/json" -d '{"message":"${SAMPLE_Q}"}'` },
  ]},
  { label: 'OPEN in a browser', color: 'GREEN', items: [
    { label: 'Open widget (dev :5175)', desc: 'See the floating bubble render; open it and ask a question.', open: `http://localhost:${DEV_PORT}${PUBLIC_BASE}/widget`, cli: `open http://localhost:5175${PUBLIC_BASE}/widget` },
    { label: 'Open widget (built :8022)', desc: 'The same page off the platform server.', open: `http://localhost:${PLATFORM_PORT}${PUBLIC_BASE}/widget`, cli: `open http://localhost:8022${PUBLIC_BASE}/widget` },
    { label: 'Open Public widget panel', desc: 'The in-app admin page: preview + copy the GTM/iframe embed (Chatbot → Public widget).', open: `http://localhost:${DEV_PORT}/chatbot/widget`, cli: `open http://localhost:5175/chatbot/widget` },
    { label: 'Open Bot training (operator page)', desc: 'The auth\'d internal operator surface (/chatbot/training).', open: `http://localhost:${DEV_PORT}/chatbot/training`, cli: `open http://localhost:5175/chatbot/training` },
    { label: 'Open Chatbot metrics', desc: 'Usage + cost dashboard — conversations, grounding, AI spend, and embedding spend (Metrics → Chatbot, /metrics/chatbot).', open: `http://localhost:${DEV_PORT}/metrics/chatbot`, cli: `open http://localhost:5175/metrics/chatbot` },
  ]},
  { label: 'STATUS & OPEN (platform)', color: 'GREEN', items: [
    { label: 'Platform status (:8022)', desc: 'GET :8022/api/status — the server both surfaces mount on.', run: () => hit({ method: 'GET', port: PLATFORM_PORT, pathname: '/api/status' }), cli: 'curl http://localhost:8022/api/status' },
    { label: 'Dev proxy status (:5175 → :8022)', desc: 'Confirms Vite is up and proxying /api to :8022.', run: () => hit({ method: 'GET', port: DEV_PORT, pathname: '/api/status' }), cli: 'curl http://localhost:5175/api/status' },
    { label: 'Open via proxy (:8000)', desc: 'The widget through the :8000 reverse proxy (usat-app host).', open: `http://localhost:${PROXY_PORT}${PUBLIC_BASE}/widget`, cli: `open http://localhost:8000${PUBLIC_BASE}/widget` },
  ]},
  { label: 'DEDICATED PUBLIC SERVER (:8024)', color: 'MAGENTA', items: [
    { label: 'Start dedicated public chatbot server (:8024)', desc: 'Runs server_public_chatbot_8024.js — the isolated, unauthenticated public-widget server. Blocks; Ctrl-C to stop. Optional: the platform :8022 already serves these routes for the in-app preview.', bin: 'npm', args: ['run', 'public_chatbot_server'], cli: 'npm run public_chatbot_server' },
    { label: 'Dedicated server status (:8024)', desc: 'GET :8024/api/status — confirms the dedicated server is up.', run: () => hit({ method: 'GET', port: PUBLIC_PORT, pathname: '/api/status' }), cli: 'curl http://localhost:8024/api/status' },
    { label: 'GET widget.js on (:8024)', desc: 'The GTM loader served by the dedicated server (expect application/javascript).', run: () => hit({ method: 'GET', port: PUBLIC_PORT, pathname: `${PUBLIC_BASE}/widget.js` }), cli: `curl -i http://localhost:8024${PUBLIC_BASE}/widget.js` },
  ]},
  { label: 'KNOWLEDGE (shared with Email Queue)', color: 'YELLOW', items: [
    { label: 'Pull corrections from prod', desc: 'SSH to prod, export corrections, copy back, import here (idempotent). Needs PROD_SSH in .env. Shared brain.', bin: 'node', args: ['src/usat_apps/knowledge_sync/pull_corrections.js'], cli: 'node src/usat_apps/knowledge_sync/pull_corrections.js' },
    { label: 'Pull content files from prod', desc: 'Copy prod\'s context/knowledge tree into this machine\'s data dir. Needs PROD_SSH in .env.', bin: 'node', args: ['src/usat_apps/knowledge_sync/pull_content.js'], cli: 'node src/usat_apps/knowledge_sync/pull_content.js' },
    { label: 'Pull knowledge URLs from prod', desc: 'Export knowledge_sources + knowledge_chunks from prod and import here (parity). Needs PROD_SSH in .env.', bin: 'node', args: ['src/usat_apps/knowledge_sync/pull_urls.js'], cli: 'node src/usat_apps/knowledge_sync/pull_urls.js' },
    { label: 'Reindex embeddings (fill missing/stale)', desc: 'Embed only chunks that lack a vector or were embedded by another model — the same as the admin card\'s Reindex, run directly against this machine\'s DB. Needs OPENAI_API_KEY. Prints coverage + embedding spend.', bin: 'node', args: ['src/usat_apps/knowledge_sync/reindex_cli.js'], cli: 'node src/usat_apps/knowledge_sync/reindex_cli.js' },
    { label: 'Re-embed ALL — backfill cost', desc: 'Force re-embed every chunk (even already-embedded ones) so embedding tokens + cost are captured on chunks vectorized before cost-tracking. Mirrors the card\'s "Re-embed all (cost)" button. Embeddings are cheap; needs OPENAI_API_KEY.', bin: 'node', args: ['src/usat_apps/knowledge_sync/reindex_cli.js', '--force'], cli: 'node src/usat_apps/knowledge_sync/reindex_cli.js --force' },
    { label: 'Embeddings / reindex — how-to', desc: 'The two items above run reindex from the CLI (direct DB). The full admin UI is the Knowledge & AI → Embedding models card: a registry (default / provider / model / label / $ per 1M) — set the default + price, Reindex, or "Re-embed all (cost)". Off by default until retrieval_weight > 0.', note: 'Admin → Knowledge & AI → Retrieval blend + Embedding models cards. Embedding spend shows on the Chatbot metrics page (/metrics/chatbot).' },
  ]},
  { label: 'BUBBLE STYLES (open the widget with a chosen bubble)', color: 'BLUE', items: [
    { label: 'Open widget — pick a bubble style', desc: 'Choose plain / triathlon / athlete / speedlines / emoji / random, pick the port, and open it in the browser. (Restart :8022 first so the animated bubble is live.)', run: (ctx) => pick_bubble(ctx), cli: `open http://localhost:5175${PUBLIC_BASE}/widget?bubble=<style>` },
  ]},
];
const ALL = SECTIONS.flatMap((s) => s.items);

if (require.main === module) {
  runMenu({
    title: 'USAT Apps · AI Chat Bot',
    subtitle: 'Shared-brain tests · public-widget probes (:5175 dev / :8022 built / :8024 dedicated) · status/open.',
    color: 'CYAN',
    sections: SECTIONS,
    cwd: REPO_ROOT,
    prefsFile: path.join(__dirname, '.menu_prefs.json'),
    back: true,
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SECTIONS, ALL };
