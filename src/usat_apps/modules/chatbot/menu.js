#!/usr/bin/env node
'use strict';
/**
 * menu.js — chatbot module operations (folded into the usat_apps platform).
 *
 *   node src/usat_apps/modules/chatbot/menu.js
 *
 * The chatbot has TWO surfaces, both served by the platform server (:8022) — there is NO dedicated
 * chatbot/widget server:
 *   1. Internal operator page   — /chatbot/training   (auth'd; grounds on curated knowledge, never PII)
 *   2. Public embeddable widget — /api/public-chatbot/*  (UNauth'd, strict grounding, pinned to
 *      CHATBOT_PUBLIC_QUEUE = "Team USA", curated knowledge only, rate-limited, logs is_test=1)
 * Both mount from modules/chatbot/module.js (api.mount + publicApi.mount). The public widget is embedded
 * on external sites either via a raw <iframe> or the GTM loader script (/api/public-chatbot/widget.js).
 *
 * This CLI records how to run/verify all of it: the shared-brain unit tests, live probes of the three
 * public endpoints (widget HTML, widget.js loader, POST /ask) against BOTH the dev proxy (:5175) and the
 * built server (:8022), status pings, browser opens, and the shared knowledge-sync pulls.
 *
 * Launched from the platform menu (src/usat_apps/menu.js -> MODULES -> AI Chat Bot), or run directly.
 * Self-contained (Node readline + http, no extra packages); mirrors the email-queue module menu's style.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');   // .../modules/chatbot -> repo root
const PREFS_FILE = path.join(__dirname, '.menu_prefs.json');
const PLATFORM_PORT = 8022;   // built server (single port: API + UI)
const DEV_PORT = 5175;        // Vite dev server — proxies /api to :8022
const PROXY_PORT = 8000;      // reverse proxy (usat-app host)
const PUBLIC_BASE = '/api/public-chatbot';

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', BLUE = '\x1b[34m', MAGENTA = '\x1b[35m', CYAN = '\x1b[36m', GRAY = '\x1b[90m';
const c = (color, t) => `${color}${t}${RESET}`;

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) { /* defaults */ } }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) { /* ignore */ } }
function prompt(rl, q) { return new Promise((res) => rl.question(q, res)); }

function run_cmd(bin, args, label) {
  console.log(c(DIM, `  Running: ${bin} ${args.join(' ')}  (cwd: repo root)  (Ctrl-C to stop)\n`));
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    proc.on('close', (code) => { console.log(code === 0 ? c(GREEN, `\n  ✓ ${label} done.`) : c(RED, `\n  ✗ ${label} exited (${code}).`)); resolve(code); });
  });
}
function open_url(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  try { execSync(cmd, { stdio: 'ignore' }); console.log(c(DIM, `  Opened ${url}`)); }
  catch { console.log(`  Open manually: ${url}`); }
}

// Flexible HTTP probe: GET or POST (JSON) against 127.0.0.1:<port><path>. Prints status + content-type,
// a couple of the headers that matter for the widget (CSP frame-ancestors), and a short body snippet /
// the parsed answer. Used for all three public endpoints on either port.
function hit(opts) {
  const { method = 'GET', port, pathname, body = null, label = '', snippet = 180 } = opts;
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
        // If JSON, pretty-print the answer; else show a short snippet of the body.
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

const SECTIONS = [
  { label: 'TESTS — shared brain (unit, no DB)', color: CYAN, items: [
    { id: 1, label: 'Knowledge tests', desc: 'services/knowledge — chunk (BM25-lite), embeddings (cosine/blend), knowledge gather, URL safety', bin: 'node', argv: ['src/usat_apps/run_tests.js', 'services/knowledge'], cli: 'node src/usat_apps/run_tests.js services/knowledge' },
    { id: 2, label: 'Corrections tests', desc: 'services/corrections — the operator corrections the bot follows (shared with the email queue)', bin: 'node', argv: ['src/usat_apps/run_tests.js', 'services/corrections'], cli: 'node src/usat_apps/run_tests.js services/corrections' },
    { id: 3, label: 'AI service tests', desc: 'services/ai — model registry, providers, completion normalize, respond/ask', bin: 'node', argv: ['src/usat_apps/run_tests.js', 'services/ai'], cli: 'node src/usat_apps/run_tests.js services/ai' },
    { id: 4, label: 'All shared-brain tests', desc: 'knowledge + corrections + ai in one run (everything the chatbot grounds on)', bin: 'node', argv: ['src/usat_apps/run_tests.js', 'services/knowledge', 'services/corrections', 'services/ai'], cli: 'node src/usat_apps/run_tests.js services/knowledge services/corrections services/ai' },
    { id: 5, label: 'Syntax-check public surface', desc: 'node --check on public.js + widget_page.js (fast; no server needed)', bin: process.platform === 'win32' ? 'cmd' : 'sh', argv: process.platform === 'win32'
        ? ['/c', 'node --check src/usat_apps/modules/chatbot/public.js && node --check src/usat_apps/modules/chatbot/widget_page.js && echo OK']
        : ['-c', 'node --check src/usat_apps/modules/chatbot/public.js && node --check src/usat_apps/modules/chatbot/widget_page.js && echo OK'],
      cli: 'node --check .../public.js && node --check .../widget_page.js' },
  ]},
  { label: 'PUBLIC WIDGET — live probes (dev proxy :5175)', color: MAGENTA, items: [
    { id: 6, label: 'GET widget HTML (:5175)', desc: 'The embeddable page. Expect HTTP 200, text/html, and a CSP "frame-ancestors" header.', hit: { method: 'GET', port: DEV_PORT, pathname: `${PUBLIC_BASE}/widget` }, cli: `curl -i http://localhost:5175${PUBLIC_BASE}/widget` },
    { id: 7, label: 'GET widget.js loader (:5175)', desc: 'The GTM loader script. Expect HTTP 200 and content-type application/javascript (NOT html).', hit: { method: 'GET', port: DEV_PORT, pathname: `${PUBLIC_BASE}/widget.js` }, cli: `curl -i http://localhost:5175${PUBLIC_BASE}/widget.js` },
    { id: 8, label: 'POST /ask (:5175)', desc: `Ask "${SAMPLE_Q}" — expect a grounded JSON answer (or the polite "don't have that" fallback).`, hit: { method: 'POST', port: DEV_PORT, pathname: `${PUBLIC_BASE}/ask`, body: { message: SAMPLE_Q } }, cli: `curl -sX POST http://localhost:5175${PUBLIC_BASE}/ask -H "Content-Type: application/json" -d '{"message":"${SAMPLE_Q}"}'` },
    { id: 9, label: 'POST /ask — your question (:5175)', desc: 'Prompts for a message, then POSTs it to the public /ask endpoint.', ask: DEV_PORT, cli: `curl -sX POST http://localhost:5175${PUBLIC_BASE}/ask -H "Content-Type: application/json" -d '{"message":"…"}'` },
  ]},
  { label: 'PUBLIC WIDGET — live probes (built server :8022)', color: MAGENTA, items: [
    { id: 10, label: 'GET widget HTML (:8022)', desc: 'Same page straight off the platform server (no proxy). Prod-style path.', hit: { method: 'GET', port: PLATFORM_PORT, pathname: `${PUBLIC_BASE}/widget` }, cli: `curl -i http://localhost:8022${PUBLIC_BASE}/widget` },
    { id: 11, label: 'GET widget.js loader (:8022)', desc: 'The loader off :8022 — this is the src you point the GTM Custom HTML tag at.', hit: { method: 'GET', port: PLATFORM_PORT, pathname: `${PUBLIC_BASE}/widget.js` }, cli: `curl -i http://localhost:8022${PUBLIC_BASE}/widget.js` },
    { id: 12, label: 'POST /ask (:8022)', desc: `Ask "${SAMPLE_Q}" straight off :8022.`, hit: { method: 'POST', port: PLATFORM_PORT, pathname: `${PUBLIC_BASE}/ask`, body: { message: SAMPLE_Q } }, cli: `curl -sX POST http://localhost:8022${PUBLIC_BASE}/ask -H "Content-Type: application/json" -d '{"message":"${SAMPLE_Q}"}'` },
  ]},
  { label: 'OPEN in a browser', color: GREEN, items: [
    { id: 13, label: 'Open widget (dev :5175)', desc: 'See the floating bubble render; open it and ask a question.', open: `http://localhost:${DEV_PORT}${PUBLIC_BASE}/widget`, cli: `open http://localhost:5175${PUBLIC_BASE}/widget` },
    { id: 14, label: 'Open widget (built :8022)', desc: 'The same page off the platform server.', open: `http://localhost:${PLATFORM_PORT}${PUBLIC_BASE}/widget`, cli: `open http://localhost:8022${PUBLIC_BASE}/widget` },
    { id: 15, label: 'Open Public widget panel', desc: 'The in-app admin page: preview + copy the GTM/iframe embed (Chatbot → Public widget).', open: `http://localhost:${DEV_PORT}/chatbot/widget`, cli: `open http://localhost:5175/chatbot/widget` },
    { id: 16, label: 'Open Bot training (operator page)', desc: 'The auth\'d internal operator surface (/chatbot/training).', open: `http://localhost:${DEV_PORT}/chatbot/training`, cli: `open http://localhost:5175/chatbot/training` },
  ]},
  { label: 'STATUS & OPEN (platform)', color: GREEN, items: [
    { id: 17, label: 'Platform status (:8022)', desc: 'GET :8022/api/status — the server both surfaces mount on.', hit: { method: 'GET', port: PLATFORM_PORT, pathname: '/api/status' }, cli: 'curl http://localhost:8022/api/status' },
    { id: 18, label: 'Dev proxy status (:5175 → :8022)', desc: 'Confirms Vite is up and proxying /api to :8022.', hit: { method: 'GET', port: DEV_PORT, pathname: '/api/status' }, cli: 'curl http://localhost:5175/api/status' },
    { id: 19, label: 'Open via proxy (:8000)', desc: 'The widget through the :8000 reverse proxy (usat-app host).', open: `http://localhost:${PROXY_PORT}${PUBLIC_BASE}/widget`, cli: `open http://localhost:8000${PUBLIC_BASE}/widget` },
  ]},
  { label: 'KNOWLEDGE (shared with Email Queue)', color: YELLOW, items: [
    { id: 20, label: 'Pull corrections from prod', desc: 'SSH to prod, export corrections, copy back, import here (idempotent). Needs PROD_SSH in .env. Shared brain.', bin: 'node', argv: ['src/usat_apps/knowledge_sync/pull_corrections.js'], cli: 'node src/usat_apps/knowledge_sync/pull_corrections.js' },
    { id: 21, label: 'Pull content files from prod', desc: 'Copy prod\'s context/knowledge tree into this machine\'s data dir. Needs PROD_SSH in .env.', bin: 'node', argv: ['src/usat_apps/knowledge_sync/pull_content.js'], cli: 'node src/usat_apps/knowledge_sync/pull_content.js' },
    { id: 22, label: 'Pull knowledge URLs from prod', desc: 'Export knowledge_sources + knowledge_chunks from prod and import here (parity). Needs PROD_SSH in .env.', bin: 'node', argv: ['src/usat_apps/knowledge_sync/pull_urls.js'], cli: 'node src/usat_apps/knowledge_sync/pull_urls.js' },
    { id: 23, label: 'Embeddings / reindex — how-to', desc: 'Reindex runs from the Knowledge & AI admin (POST /api/knowledge-admin/reindex, admin session). Off by default (retrieval_weight 0). Turn it on + set the model there, then Reindex.', note: 'Admin → Knowledge & AI → Retrieval blend + Embeddings cards. No CLI — it needs an admin browser session.' },
  ]},
  { label: 'BUBBLE STYLES (open the widget with a chosen bubble)', color: BLUE, items: [
    { id: 24, label: 'Open widget — pick a bubble style', desc: 'Choose plain / triathlon / athlete / speedlines / emoji / random, pick the port, and open it in the browser. (Restart :8022 first so the animated bubble is live.)', bubble: true, cli: `open http://localhost:5175${PUBLIC_BASE}/widget?bubble=<style>` },
  ]},
];
const ALL = SECTIONS.flatMap((s) => s.items);

function print_menu() {
  console.clear();
  const rule = '='.repeat(64);
  console.log(c(CYAN, rule));
  console.log(c(CYAN, c(BOLD, '  USAT Apps · AI Chat Bot')));
  console.log(c(GRAY, '  Shared-brain tests · public-widget probes (:5175 dev / :8022 built) · status/open.'));
  console.log(c(GRAY, '  No dedicated widget server — both surfaces mount on the platform (:8022).'));
  console.log(c(CYAN, rule));
  for (const s of SECTIONS) {
    console.log('');
    console.log(c(s.color, c(BOLD, '  ' + s.label)));
    console.log(c(s.color, '  ' + '-'.repeat(s.label.length)));
    for (const it of s.items) {
      console.log('   ' + c(s.color, c(BOLD, '[' + it.id + ']')) + ' ' + c(BOLD, it.label));
      if (it.desc) console.log('       ' + c(GRAY, it.desc));
      if (_show_cli && it.cli) console.log('       ' + c(GRAY, '$ ' + it.cli));
    }
  }
  console.log('');
  console.log('  ' + c(BOLD, c(YELLOW, '[t]')) + c(GRAY, ' toggle CLI commands (' + (_show_cli ? 'on' : 'off') + ')    ') + c(BOLD, c(YELLOW, '[q]')) + c(GRAY, ' quit') + c(GRAY, '    (or 0)'));
}

async function ask_question(rl, port) {
  const msg = (await prompt(rl, c(BOLD, '  Your question: '))).trim();
  if (!msg) { console.log(c(YELLOW, '  (empty — skipped)')); return; }
  console.log('');
  await hit({ method: 'POST', port, pathname: `${PUBLIC_BASE}/ask`, body: { message: msg } });
}

// Pick a bubble style + port, then open the widget URL in the browser. Lets you flip between styles fast.
const BUBBLE_STYLES = ['plain', 'triathlon', 'athlete', 'speedlines', 'emoji', 'random'];
async function pick_bubble(rl) {
  console.log(c(BOLD, '  Bubble styles:'));
  BUBBLE_STYLES.forEach((s, i) => console.log('    ' + c(CYAN, (i + 1) + ')') + ' ' + s));
  const a = (await prompt(rl, c(BOLD, '  Pick a style [1-' + BUBBLE_STYLES.length + ']: '))).trim();
  const style = BUBBLE_STYLES[parseInt(a, 10) - 1] || 'triathlon';
  const p = (await prompt(rl, c(BOLD, '  Port [' + DEV_PORT + ' dev / ' + PLATFORM_PORT + ' built] [' + DEV_PORT + ']: '))).trim() || String(DEV_PORT);
  open_url('http://localhost:' + p + PUBLIC_BASE + '/widget?bubble=' + style);
}

async function main() {
  load_prefs();
  let rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  while (true) {
    print_menu();
    const ans = (await prompt(rl, c(BOLD, '\n  Select: '))).trim().toLowerCase();
    if (ans === 'q' || ans === 'quit' || ans === 'b' || ans === 'back' || ans === '0') { console.log(c(DIM, '\n  Back.')); rl.close(); return; }
    if (ans === 't') { _show_cli = !_show_cli; save_prefs(); continue; }
    const it = ALL.find((x) => x.id === parseInt(ans, 10));
    console.log('');
    if (!it) { console.log(c(YELLOW, '  Invalid choice.')); }
    else if (it.hit) { await hit(it.hit); }
    else if (it.ask) { await ask_question(rl, it.ask); }
    else if (it.bubble) { await pick_bubble(rl); }
    else if (it.open) { open_url(it.open); }
    else if (it.bin) {
      rl.close();                                     // release stdin so a child can read its own prompts
      await run_cmd(it.bin, it.argv, it.label);
      rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    }
    else if (it.note) { console.log(c(DIM, '  ' + it.note)); }
    else { console.log(c(DIM, '  (nothing to run — see the operator app / platform)')); }
    await prompt(rl, c(DIM, '\n  Press Enter to continue…'));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };
