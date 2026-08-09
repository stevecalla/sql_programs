'use strict';
/**
 * menu_kit.js — the shared runtime for every module's interactive `menu.js`.
 *
 * WHY THIS EXISTS: each menu used to be a hand-copied clone (its own colors, spawn helper, render loop,
 * numbering, prefs toggle, quit handling). Copies drift → inconsistent styling, naming, and out-of-order
 * numbers. This module owns all of that ONCE. A menu file becomes just its data (SECTIONS) + one runMenu()
 * call. See plans_and_notes/MENU_CONVENTIONS.md.
 *
 * NUMBERING: item numbers are assigned BY POSITION here (1..N in display order). Never hand-write an `id`.
 * Insert/reorder items freely — numbering can't drift.
 *
 * ITEM SCHEMA (each item sets exactly ONE action; dispatch precedence is the order below):
 *   { label, desc?, cli?,           // display: title, gray sub-line, and a $cli line shown when toggle is on
 *     run?:   async (ctx) => {},     // arbitrary behavior — the universal escape hatch
 *     bin?:   'npm'|'node', args?:[] // spawn a child process (argv also accepted); + env?, cwd?, confirm?
 *     open?:  'https://…',           // open a URL / file in the OS
 *     hit?:   { method?, port, pathname, body?, host?, hint? },  // HTTP request, prints status+body
 *     status?: 8022, statusLabel?,   // shorthand for hit GET :port/api/status
 *     note?:  'text' (alias info),   // print-only guidance, runs nothing
 *   }
 * A menu with opaque `action` slugs instead passes `onSelect(item, ctx)` to runMenu and keeps its own
 * dispatcher; the kit calls onSelect for any item that carries no declarative action field above.
 *
 * ctx (passed to run()/onSelect): { rl, ask, runCmd, hit, openUrl, c, COLORS, colors, cwd }.
 */

const readline = require('readline');
const http = require('http');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

// ---- colors -----------------------------------------------------------------
const COLORS = {
  RESET: '\x1b[0m', BOLD: '\x1b[1m', DIM: '\x1b[2m',
  RED: '\x1b[31m', GREEN: '\x1b[32m', YELLOW: '\x1b[33m', BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m', CYAN: '\x1b[36m', WHITE: '\x1b[37m', GRAY: '\x1b[90m',
};
function c(color, t) { return (color || '') + t + COLORS.RESET; }
// Registry-style menus store color as a NAME string ('CYAN'); map it to the code.
const COLOR_BY_NAME = Object.assign({}, COLORS);
function color_code(nameOrCode) {
  if (!nameOrCode) return COLORS.CYAN;
  return COLOR_BY_NAME[nameOrCode] || nameOrCode; // pass a raw code through unchanged
}

// ---- prefs (the [t] CLI-command toggle, persisted per menu) ------------------
function load_show_cli(prefsFile) {
  if (!prefsFile) return false;
  try { const j = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); return typeof j.show_cli === 'boolean' ? j.show_cli : false; }
  catch (e) { return false; }
}
function save_show_cli(prefsFile, show_cli) {
  if (!prefsFile) return;
  try { fs.writeFileSync(prefsFile, JSON.stringify({ show_cli }, null, 2) + '\n'); } catch (e) { /* non-fatal */ }
}

// ---- prompt -----------------------------------------------------------------
function ask(rl, q) { return new Promise((res) => rl.question(q, res)); }

// ---- open a URL / file in the OS --------------------------------------------
function openUrl(target) {
  const plat = process.platform;
  const cmd = plat === 'win32' ? 'start ""' : plat === 'darwin' ? 'open' : 'xdg-open';
  try { execSync(`${cmd} "${target}"`, { stdio: 'ignore', shell: true }); console.log('  ' + c(COLORS.GREEN, 'Opened: ') + target); }
  catch (e) { console.log('  ' + c(COLORS.YELLOW, 'Open this manually: ') + target); }
}

// ---- HTTP request (status probes, endpoint hits) ----------------------------
function hit(opts) {
  const { method = 'GET', port, host = '127.0.0.1', pathname, body = null, hint } = opts;
  return new Promise((resolve) => {
    const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const headers = {};
    if (payload != null) { headers['Content-Type'] = typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    console.log('  ' + c(COLORS.BOLD, method + ' ') + c(COLORS.GRAY, 'http://' + host + ':' + port + pathname));
    const req = http.request({ host, port, path: pathname, method, headers }, (res) => {
      let data = ''; res.on('data', (ch) => (data += ch));
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        console.log('  ' + c(ok ? COLORS.GREEN : COLORS.YELLOW, 'HTTP ' + res.statusCode));
        const trimmed = (data || '').trim();
        if (trimmed) { try { console.log('  ' + c(COLORS.DIM, JSON.stringify(JSON.parse(trimmed)).slice(0, 400))); } catch (e) { console.log('  ' + c(COLORS.DIM, trimmed.slice(0, 400))); } }
        resolve();
      });
    });
    req.on('error', (e) => { console.log('  ' + c(COLORS.RED, 'Request failed: ') + e.message + (hint ? '\n  ' + c(COLORS.DIM, hint) : '')); resolve(); });
    if (payload != null) req.write(payload);
    req.end();
  });
}

// ---- render -----------------------------------------------------------------
function assign_ids(sections) {
  const all = sections.flatMap((s) => s.items);
  all.forEach((it, i) => { it.id = i + 1; });
  return all;
}

async function resolve(v) { return typeof v === 'function' ? await v() : v; }

async function print_menu(cfg, sections, all, show_cli) {
  console.clear();
  const rule = (cfg.rule !== false) ? '='.repeat(cfg.ruleWidth || 64) : null;
  const accent = color_code(cfg.color || 'CYAN');
  if (rule) console.log(c(accent, rule));
  console.log(c(accent, c(COLORS.BOLD, '  ' + cfg.title)));
  const subtitle = await resolve(cfg.subtitle);
  if (subtitle) String(subtitle).split('\n').forEach((line) => console.log(c(COLORS.GRAY, '  ' + line)));
  if (rule) console.log(c(accent, rule));

  const width = String(all.length).length;
  for (const s of sections) {
    console.log('');
    const scol = color_code(s.color || accent);
    console.log(c(scol, c(COLORS.BOLD, '  ' + s.label)));
    console.log(c(scol, '  ' + '-'.repeat(s.label.length)));
    for (const it of s.items) {
      console.log('   ' + c(scol, c(COLORS.BOLD, '[' + String(it.id).padStart(width) + ']')) + ' ' + c(COLORS.BOLD, it.label));
      if (it.desc) console.log('       ' + c(COLORS.GRAY, it.desc));
      if (show_cli && it.cli) console.log('       ' + c(COLORS.GRAY, '$ ' + it.cli));
    }
  }
  console.log('');
  const backWord = cfg.back ? 'back / quit' : 'quit';
  const toggle = cfg.prefsFile || cfg.toggle !== false ? c(COLORS.BOLD, c(COLORS.YELLOW, '[t]')) + c(COLORS.GRAY, ' toggle CLI (' + (show_cli ? 'on' : 'off') + ')    ') : '';
  console.log('  ' + toggle + c(COLORS.BOLD, c(COLORS.YELLOW, '[q]')) + c(COLORS.GRAY, ' ' + backWord + '    (or 0)'));
}

// ---- dispatch one item ------------------------------------------------------
async function dispatch(it, cfg, state) {
  const ctx = state.ctx;
  if (typeof it.run === 'function') return it.run(ctx);
  const bin = it.bin, args = it.args || it.argv;
  if (bin) {
    if (it.confirm) { const a = (await ask(state.rl, '  ' + c(COLORS.YELLOW, (typeof it.confirm === 'string' ? it.confirm : 'Continue?') + ' (y/N): '))).trim().toLowerCase(); if (a !== 'y' && a !== 'yes') { console.log(c(COLORS.DIM, '  Aborted.')); return; } }
    return ctx.runCmd(bin, args || [], it.label, { env: it.env, cwd: it.cwd });
  }
  if (it.open) return openUrl(it.open);
  if (it.hit) return hit(it.hit);
  if (it.status) return hit({ method: 'GET', port: it.status, pathname: '/api/status', hint: (it.statusLabel || 'server') + ' not reachable — is it running?' });
  const note = it.note || it.info;
  if (note != null) { String(note).split('\n').forEach((l) => console.log('  ' + l)); return; } // raw: preserves any embedded color codes in help blobs
  if (typeof cfg.onSelect === 'function') return cfg.onSelect(it, ctx);
  console.log(c(COLORS.DIM, '  (nothing to run for this item)'));
}

// ---- the loop ---------------------------------------------------------------
async function runMenu(cfg) {
  const REPO_CWD = cfg.cwd || process.cwd();
  const state = { rl: null, ctx: null };
  let show_cli = load_show_cli(cfg.prefsFile);

  // runCmd closes readline so a child owns stdin (its own prompts / Ctrl-C), then recreates it.
  function runCmd(bin, args, label, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      console.log('  ' + c(COLORS.DIM, 'Running: ' + bin + ' ' + (args || []).join(' ')));
      const had = !!state.rl; if (state.rl) { state.rl.close(); state.rl = null; }
      const env = opts.env ? Object.assign({}, process.env, opts.env) : process.env;
      const child = spawn(bin, args || [], { cwd: opts.cwd || REPO_CWD, stdio: 'inherit', shell: process.platform === 'win32', env });
      child.on('close', (code) => {
        console.log('  ' + (code === 0 ? c(COLORS.GREEN, '✓ ' + (label || bin) + ' done') : c(COLORS.RED, '✗ ' + (label || bin) + ' exited ' + code)));
        if (had) state.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        resolve(code);
      });
      child.on('error', (e) => { console.log('  ' + c(COLORS.RED, 'Spawn failed: ' + e.message)); if (had && !state.rl) state.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }); resolve(1); });
    });
  }

  const sections = await resolve(cfg.sections);
  const all = assign_ids(sections);
  state.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  state.ctx = { get rl() { return state.rl; }, ask: (q) => ask(state.rl, q), runCmd, hit, openUrl, c, COLORS, colors: COLOR_BY_NAME, cwd: REPO_CWD };

  const quitTokens = new Set(['q', 'quit', '0'].concat(cfg.back ? ['b', 'back'] : []));
  while (true) {
    await print_menu(cfg, sections, all, show_cli);
    const ans = (await ask(state.rl, c(COLORS.BOLD, '\n  Select: '))).trim().toLowerCase();
    if (quitTokens.has(ans)) { console.log(c(COLORS.DIM, cfg.back ? '\n  Back.' : '\n  Bye.')); state.rl.close(); return; }
    if (ans === 't' && (cfg.prefsFile || cfg.toggle !== false)) { show_cli = !show_cli; save_show_cli(cfg.prefsFile, show_cli); continue; }
    const it = all.find((x) => x.id === parseInt(ans, 10));
    console.log('');
    if (!it) { console.log(c(COLORS.YELLOW, '  Invalid choice.')); }
    else { try { await dispatch(it, cfg, state); } catch (e) { console.log('  ' + c(COLORS.RED, 'Action failed: ' + (e && e.message ? e.message : e))); } }
    if (state.rl) await ask(state.rl, c(COLORS.DIM, '\n  Press Enter to continue…'));
  }
}

module.exports = { runMenu, COLORS, c, color_code, openUrl, hit, ask, assign_ids };
