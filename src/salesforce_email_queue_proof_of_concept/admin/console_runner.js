'use strict';
/**
 * console_runner.js — runs the curated console_registry commands for the /admin Operations panel.
 * (Ported from src/race_results_transform/admin/console_runner.js — same security model and lifecycle.)
 *
 * Security model (everything here is reached only behind require_admin in web/routes.js):
 *   - allowlist by id: the client sends only { id, params, confirm }, never a command string.
 *   - argv assembled HERE from the registry item; spawned with shell:false (no shell = no injection)
 *     for `node`. (This POC's registry uses only `node`, so no shell is ever needed.)
 *   - params validated against their declared type/options; enum must match, int must be digits, date must
 *     be YYYY-MM-DD, path must stay inside the run dir (no `..`, no absolute).
 *   - destructive items (klass 'destruct') require a typed confirm token equal to the command id.
 *   - per-run output cap + timeout; an in-memory run table with SSE subscribers; a sanitized audit line.
 */

const path = require('path');
const { spawn } = require('child_process');
const registry = require('./console_registry');

const RUN_DIR = path.join(__dirname, '..');            // .../salesforce_email_queue_proof_of_concept (where menu.js runs)
const MAX_LINES = 5000;                                // output ring cap per run
const RUN_TIMEOUT_MS = 15 * 60 * 1000;                 // 15 min hard cap
const MAX_CONCURRENT = 4;
const KEEP_FINISHED_MS = 10 * 60 * 1000;               // forget a finished run after 10 min

const runs = new Map();                                // run_id -> run record
const audit = [];                                      // recent { at, id, action, status, code }
let seq = 0;

function strip_ansi(s) {
  // remove ANSI color/escape sequences so the browser shows clean text
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

// ---- param validation + argv assembly ------------------------------------------------------------
function valid_path(v) {
  if (typeof v !== 'string' || !v) return false;
  if (v.indexOf('..') >= 0) return false;
  if (path.isAbsolute(v)) return false;
  if (/[\0\n\r]/.test(v)) return false;
  return true;
}

function assemble_argv(item, params) {
  params = params || {};
  const extra = [];
  const specs = item.params || [];
  for (let i = 0; i < specs.length; i++) {
    const p = specs[i];
    let raw = params[p.name];
    if (raw === undefined || raw === null) raw = (p.default !== undefined ? p.default : '');
    const val = String(raw);

    if (p.type === 'enum') {
      const opt = (p.options || []).find(function (o) { return String(o.value) === val; });
      if (!opt) {
        if (p.required) return { ok: false, error: 'invalid choice for ' + p.name };
        continue;   // optional + unmatched -> skip
      }
      (opt.args || []).forEach(function (a) { extra.push(a); });
      continue;
    }
    if (val === '') {
      if (p.required) return { ok: false, error: 'missing required field: ' + p.name };
      continue;     // optional + blank -> omit
    }
    if (p.type === 'int') {
      if (!/^\d+$/.test(val)) return { ok: false, error: p.name + ' must be a whole number' };
      if (p.flag) extra.push(p.flag);
      extra.push(val);
      continue;
    }
    if (p.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return { ok: false, error: p.name + ' must be YYYY-MM-DD' };
      if (p.flag) extra.push(p.flag);
      extra.push(val);
      continue;
    }
    if (p.type === 'path') {
      if (!valid_path(val)) return { ok: false, error: 'invalid folder for ' + p.name + ' (must be a relative path, no "..")' };
      if (p.flag) extra.push(p.flag);
      extra.push(val);
      continue;
    }
    // text / sql -> single argv element (positional or flag+value)
    if (/[\0]/.test(val)) return { ok: false, error: 'invalid characters in ' + p.name };
    if (p.positional) { extra.push(val); continue; }
    if (p.flag) extra.push(p.flag);
    extra.push(val);
  }
  return { ok: true, argv: (item.argv || []).concat(extra) };
}

// ---- run lifecycle --------------------------------------------------------------------------------
function active_count() {
  let n = 0;
  runs.forEach(function (r) { if (r.status === 'running') n++; });
  return n;
}

function push_line(run, stream, text) {
  strip_ansi(text).split(/\r?\n/).forEach(function (line, idx, arr) {
    if (idx === arr.length - 1 && line === '') return;   // skip trailing empty from the split
    const evt = { stream: stream, line: line };
    run.lines.push(evt);
    if (run.lines.length > MAX_LINES) { run.lines.shift(); run.capped = true; }
    run.subs.forEach(function (res) { send_sse(res, 'line', evt); });
  });
}

function send_sse(res, event, data) {
  try { res.write('event: ' + event + '\n'); res.write('data: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* client gone */ }
}

function finish(run, status, code) {
  if (run.status !== 'running') return;
  run.status = status;
  run.code = code;
  run.ended = Date.now();
  if (run.timer) clearTimeout(run.timer);
  run.subs.forEach(function (res) { send_sse(res, 'exit', { status: status, code: code, capped: run.capped }); try { res.end(); } catch (e) {} });
  run.subs.clear();
  audit.unshift({ at: new Date().toISOString(), id: run.item.id, action: run.item.action, status: status, code: code });
  if (audit.length > 200) audit.pop();
  console.log('[admin-console] run ' + run.run_id + ' (' + run.item.action + ') ' + status + ' code=' + code);
  setTimeout(function () { runs.delete(run.run_id); }, KEEP_FINISHED_MS);
}

function start_run(item, params, confirm) {
  if (!item) return { ok: false, error: 'unknown command' };
  if (item.web !== 'run' && item.web !== 'form') return { ok: false, error: 'this command can only be run from the terminal' };
  if (item.confirm && String(confirm) !== String(item.id)) return { ok: false, error: 'confirmation required' };
  if (active_count() >= MAX_CONCURRENT) return { ok: false, error: 'too many commands running — wait for one to finish' };

  const built = assemble_argv(item, params);
  if (!built.ok) return built;

  const bin = item.bin || 'node';
  const need_shell = process.platform === 'win32' && bin !== 'node';
  let child;
  try {
    child = spawn(bin, built.argv, { cwd: RUN_DIR, shell: need_shell, env: process.env });
  } catch (e) {
    return { ok: false, error: 'failed to start: ' + e.message };
  }

  const run_id = 'r' + (++seq) + '_' + Date.now().toString(36);
  const run = {
    run_id: run_id, item: item, bin: bin, argv: built.argv,
    status: 'running', code: null, lines: [], subs: new Set(),
    started: Date.now(), ended: null, capped: false, child: child
  };
  runs.set(run_id, run);

  push_line(run, 'meta', '$ ' + bin + ' ' + built.argv.join(' '));
  child.stdout.on('data', function (d) { push_line(run, 'out', d.toString()); });
  child.stderr.on('data', function (d) { push_line(run, 'err', d.toString()); });
  child.on('error', function (e) { push_line(run, 'err', 'spawn error: ' + e.message); finish(run, 'error', -1); });
  child.on('close', function (code) { finish(run, code === 0 ? 'ok' : 'failed', code); });
  run.timer = setTimeout(function () { try { child.kill('SIGTERM'); } catch (e) {} push_line(run, 'err', '… timed out, killed'); finish(run, 'timeout', -1); }, RUN_TIMEOUT_MS);

  return { ok: true, run_id: run_id };
}

function subscribe(run_id, res) {
  const run = runs.get(run_id);
  if (!run) { send_sse(res, 'error', { error: 'no such run' }); try { res.end(); } catch (e) {} return; }
  // replay what we have, then stream (or close if already finished)
  run.lines.forEach(function (evt) { send_sse(res, 'line', evt); });
  if (run.status !== 'running') { send_sse(res, 'exit', { status: run.status, code: run.code, capped: run.capped }); try { res.end(); } catch (e) {} return; }
  run.subs.add(res);
  res.on('close', function () { run.subs.delete(res); });
}

function kill_run(run_id) {
  const run = runs.get(run_id);
  if (!run) return { ok: false, error: 'no such run' };
  if (run.status !== 'running') return { ok: true, already: true };
  try { run.child.kill('SIGTERM'); } catch (e) {}
  push_line(run, 'err', '… cancelled by admin');
  return { ok: true };
}

function list_runs() {
  const out = [];
  runs.forEach(function (r) { out.push({ run_id: r.run_id, action: r.item.action, label: r.item.label, status: r.status, started: r.started }); });
  return out.sort(function (a, b) { return b.started - a.started; });
}

module.exports = {
  RUN_DIR: RUN_DIR,
  assemble_argv: assemble_argv,
  valid_path: valid_path,
  start_run: start_run,
  subscribe: subscribe,
  kill_run: kill_run,
  list_runs: list_runs,
  recent_audit: function () { return audit.slice(0, 50); },
  commands: function () { return registry.web_sections(); }
};
