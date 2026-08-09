#!/usr/bin/env node
/**
 * menu.js — interactive launcher for race_results_transform.
 *
 * Usage:  node menu.js
 *
 * Numbered, sectioned list of actions with a one-line description each. Toggle
 * "Show/hide CLI commands" to print the underlying `$ ...` command beneath each
 * item (choice persists in .menu_prefs.json). Built on Node's readline — no deps.
 * Matches the conventions of src/event_analysis/menu.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, execSync } = require('child_process');
const data_dir = require('./src/data_dir');
const { runMenu } = require('../../utilities/menu/menu_kit');   // shared menu shell (render/number/toggle/quit)

const DIR = __dirname;
const SERVER = path.join(DIR, '..', '..', 'server_race_results_transform_8018.js');
const PREFS_FILE = path.join(DIR, '.menu_prefs.json');

// ── colors ──
const R = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m';
const CYAN = '\x1b[36m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', BLUE = '\x1b[34m', MAGENTA = '\x1b[35m', GRAY = '\x1b[90m';
function c(col, s) { return col + s + R; }

let _show_cli = false;
function load_prefs() { try { const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli; } catch (e) {} }
function save_prefs() { try { fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n'); } catch (e) {} }

// The kit's context for the item currently running (set in onSelect) — lets the shared ask()/run()/handle()
// reach the kit's readline + spawn instead of owning their own readline (which would collide with the kit's).
let _ctx = null;
function ask(q) { return _ctx ? _ctx.ask(q) : Promise.resolve(''); }
function clean(p) { return String(p || '').trim().replace(/^["']|["']$/g, ''); }

function run(cmd, args) {
  // The kit's runCmd closes/reopens its readline around the child (child owns Ctrl-C; menu resumes on close)
  // and never shell-wraps `node` on Windows — same guarantees this menu relied on. Fallback spawn is only for
  // the (unused) no-context path.
  if (_ctx) return _ctx.runCmd(cmd, args, cmd + ' ' + args.join(' '));
  return new Promise(function (resolve) {
    const need_shell = process.platform === 'win32' && cmd !== 'node';
    const p = spawn(cmd, args, { cwd: DIR, stdio: 'inherit', shell: need_shell });
    p.on('close', resolve);
  });
}
// Capture the bot's channels as JSON (via the CLI, which loads .env) for a numbered pick-list.
function slack_channels_json() {
  try {
    const out = execSync('node src/cli.js slack:channels --json', { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out.trim());
  } catch (e) { return null; }
}
// Show a numbered list of the bot's channels and return the chosen id (blank = SLACK_CHANNEL_ID default).
async function slack_pick_channel() {
  const chans = slack_channels_json();
  if (!chans) { console.log(c(YELLOW, '  Could not load channels (is SLACK_BOT_TOKEN set in .env?).')); return clean(await ask('  Channel (id or name, blank = default): ')); }
  if (!chans.length) { console.log(c(YELLOW, '  The bot is in no channels yet — /invite it in Slack first.')); return ''; }
  console.log(c(DIM, '\n  Channels the bot is in:'));
  chans.forEach(function (ch, i) { console.log('    ' + c(BOLD, '[' + (i + 1) + ']') + ' ' + (ch.is_private ? '🔒 ' : '#  ') + ch.name + c(GRAY, '  ' + ch.id)); });
  const pick = clean(await ask('  Pick a number (or type an id/name; blank = SLACK_CHANNEL_ID default): '));
  if (!pick) return '';
  const idx = Number(pick);
  if (idx >= 1 && idx <= chans.length) return chans[idx - 1].id;
  return pick;   // user typed an id/name directly
}
async function run_test(file, label) {
  console.log(c(DIM, '\n  running ' + label + '…\n'));
  const code = await run('node', ['--test', file]);
  console.log(code === 0 ? c(GREEN, '\n  ✓ ' + label + ' passed') : c(YELLOW, '\n  ✗ ' + label + ' had failures'));
}

// ── menu definition ──
// The catalog (sections/ids/labels/descriptions/the "$ ..." line) is the SINGLE SOURCE OF TRUTH in
// admin/console_registry.js so menu.js and the /admin Operations panel never drift. The real SECTIONS
// is derived from the registry just below this literal; DEAD_INLINE_SECTIONS is unused (kept only so the
// diff is reviewable) and can be deleted.
const console_registry = require('./admin/console_registry');
const COLOR_BY_NAME = { CYAN: CYAN, BLUE: BLUE, MAGENTA: MAGENTA, GREEN: GREEN, GRAY: GRAY, YELLOW: YELLOW };
// Derived from the shared Operations registry (single source of truth with the /admin panel). Drop the
// registry's toggle/quit entries — the kit provides [t]/[q] as footer keys — and DON'T copy ids: the kit
// numbers by position. Colors stay as the registry's ANSI codes (the kit passes raw codes through).
const SECTIONS = console_registry.SECTIONS.map(function (s) {
  return {
    label: s.label,
    color: COLOR_BY_NAME[s.color] || CYAN,
    items: s.items
      .filter(function (it) { return it.action !== 'toggle' && it.action !== 'quit'; })
      .map(function (it) { return { label: it.label, desc: it.desc, cli: it.cli, action: it.action }; })
  };
}).filter(function (s) { return s.items.length > 0; });
const ALL = SECTIONS.flatMap(function (s) { return s.items; });

async function handle(item) {
  switch (item.action) {
    case 'convert': {
      const f = clean(await ask('Path to .xlsx/.csv: ')); if (!f) return;
      const o = clean(await ask('Output path (blank = auto): '));
      const args = ['src/cli.js', 'convert', f]; if (o) args.push('-o', o);
      await run('node', args); break;
    }
    case 'batch': { const d = clean(await ask('Folder: ')); if (d) await run('node', ['src/cli.js', 'batch', d]); break; }
    case 'inspect': { const f = clean(await ask('Path to .xlsx/.csv: ')); if (f) await run('node', ['src/cli.js', 'inspect', f]); break; }
    case 'examples': await run('node', ['src/cli.js', 'batch', await data_dir.inputs(), '-o', await data_dir.outputs()]); break;
    case 'test_all': {
      const tdir = path.join(DIR, 'tests');
      const files = fs.readdirSync(tdir).filter(function (f) { return /\.test\.js$/.test(f); }).sort()
        .map(function (f) { return path.join('tests', f); });
      console.log(c(DIM, '\n  Running all ' + files.length + ' test files: node --test tests/\n'));
      const code = await run('node', ['--test'].concat(files));
      console.log(code === 0 ? c(GREEN, '\n  \u2713 all node tests passed') : c(YELLOW, '\n  \u2717 some node tests failed'));
      break;
    }
    case 'test_smoke': await run_test('tests/smoke.test.js', 'smoke tests'); break;
    case 'ask_question': {
      try {
        const { CATALOG } = require('./metrics/ask/db');
        console.log(c(DIM, '\n  Read-only AI query over: ' + CATALOG.map(function (t) { return t.name; }).join(', ')));
      } catch (e) { /* ignore */ }
      let example = 'How many people used the converter last week?';
      try { const qs = require('./metrics/ask/context').load_context().example_questions || []; if (qs.length) example = qs[Math.floor(Math.random() * qs.length)]; } catch (e) { /* ignore */ }
      const q = clean(await ask(c(DIM, '\n  Your question  [Enter for example: ' + example + ']: '))) || example;
      let models = [];
      try { models = require('./metrics/ask/models').list(); } catch (e) { /* ignore */ }
      if (!models.length) models = [{ provider: 'openai', model: process.env.OPENAI_MODEL || '(OPENAI_MODEL)', label: 'OpenAI' }];
      console.log(c(DIM, '\n  Model (edit metrics/ask/models.js to add more):'));
      models.forEach(function (m, i) { console.log(c(DIM, '    ' + (i + 1) + ') ' + m.label + '  \u00b7 ' + m.model + (i === 0 ? '   [default]' : ''))); });
      const pick = clean(await ask(c(DIM, '  Pick a model [1]: ')));
      const idx = (Number(pick) >= 1 && Number(pick) <= models.length) ? Number(pick) - 1 : 0;
      const chosen = models[idx];
      console.log(c(DIM, '  Using: ' + chosen.provider + ' \u00b7 ' + chosen.model));
      await run('node', ['src/cli.js', 'ask', q, '--provider', chosen.provider, '--model', chosen.model]);
      break;
    }
    case 'ask_log': await run('node', ['src/cli.js', 'ask:log']); break;
    case 'ask_corrections': await run('node', ['src/cli.js', 'ask:corrections']); break;
    case 'ask_test_corrections': await run('node', ['src/cli.js', 'ask:test:corrections']); break;
    case 'ask_test_threads': await run('node', ['src/cli.js', 'ask:test:threads']); break;
    case 'ask_eval': await run('node', ['src/cli.js', 'ask:eval']); break;
    case 'ask_sql': {
      const sql = clean(await ask(c(DIM, '\n  Read-only SQL (SELECT only): ')));
      if (sql) { await run('node', ['src/cli.js', 'ask:sql', sql]); }
      break;
    }
    case 'ask_demo': {
      try {
        const { CATALOG } = require('./metrics/ask/db');
        console.log(c(DIM, '\n  Tables you may query (read-only allowlist):'));
        CATALOG.forEach(function (t) { console.log(c(DIM, '    \u2022 ' + t.name + (t.grain ? '  (' + t.grain + ')' : ''))); });
      } catch (e) { /* ignore */ }
      const sql = clean(await ask(c(DIM, '\n  SQL to test (blank = run examples): ')));
      await run('node', sql ? ['metrics/ask/demo_guard.js', '--no-header', sql] : ['metrics/ask/demo_guard.js', '--no-header']);
      break;
    }
    case 'test_ask': { console.log(c(DIM, '\n  running AI ask guard/catalog tests\u2026\n')); const code = await run('node', ['--test', 'tests/ask_db.test.js', 'tests/ask_guard.test.js']); console.log(code === 0 ? c(GREEN, '\n  \u2713 ask tests passed') : c(YELLOW, '\n  \u2717 ask tests failed')); break; }
    case 'test_normalize': await run_test('tests/normalize.test.js', 'value-normalization tests'); break;
    case 'test_match': await run_test('tests/match.test.js', 'column-matching tests'); break;
    case 'test_display': await run_test('tests/display.test.js', 'display-format tests'); break;
    case 'test_io': await run_test('tests/io.test.js', 'I/O round-trip tests'); break;
    case 'test_reconcile': await run_test('tests/reconcile.test.js', 'integrity tests'); break;
    case 'test_fixtures': await run_test('tests/fixtures.test.js', 'golden-fixture tests'); break;
    case 'test_lint': await run_test('tests/lint_snake_case.test.js', 'snake_case lint'); break;
    case 'test_config': await run_test('tests/config_wiring.test.js', 'config-wiring checks'); break;
    case 'test_try_me': await run_test('tests/try_me.test.js', 'Try-me UI + is_demo wiring tests'); break;
    case 'test_metrics_report': await run_test('tests/metrics_report.test.js', 'metrics report (last-activity + demo split) tests'); break;
    case 'metrics_demo_split': {
      const sql = "SELECT CASE WHEN is_demo=1 THEN 'Try Me' ELSE 'Real' END kind, " +
        "SUM(event_name='file_uploaded') uploads, SUM(event_name='conversion_completed') conversions, " +
        "SUM(event_name IN ('download','split_download_used')) downloads " +
        "FROM race_results_transform_events GROUP BY kind";
      console.log(c(DIM, '\n  Try Me vs real activity (read-only):'));
      await run('node', ['src/cli.js', 'ask:sql', sql]);
      break;
    }
    case 'e2e_run': console.log(c(DIM, '\n  running Playwright browser tests, headless (run "Install browser E2E" first if this fails)…\n')); await run('npm', ['run', 'e2e']); break;
    case 'e2e_headed': console.log(c(DIM, '\n  opening Chrome (headed, slowed)…\n')); await run('npm', ['run', 'e2e:headed']); break;
    case 'e2e_step': console.log(c(DIM, '\n  opening Chrome with the Inspector — click Resume to advance each step…\n')); await run('npm', ['run', 'e2e:step']); break;
    case 'e2e_install': console.log(c(DIM, '\n  installing Playwright + Chromium (one-time)…\n')); await run('npm', ['run', 'e2e:install']); break;
    case 'e2e_chromium': console.log(c(DIM, '\n  running browser tests on chromium only…\n')); await run('npm', ['run', 'e2e:chromium']); break;
    case 'e2e_snap': console.log(c(DIM, '\n  refreshing visual snapshot baselines…\n')); await run('npm', ['run', 'e2e:snap']); break;
    case 'e2e_db': console.log(c(DIM, '\n  browser→MySQL round-trip (needs local DB)…\n')); await run('npm', ['run', 'e2e:db']); break;
    case 'metrics_stats': await run('node', ['src/cli.js', 'stats']); break;
    case 'metrics_size': await run('node', ['src/cli.js', 'metrics:size']); break;
    case 'metrics_cleanup': await run('node', ['src/cli.js', 'metrics:cleanup']); break;
    case 'metrics_purge_test': await run('node', ['src/cli.js', 'metrics:purge-test']); break;
    case 'metrics_purge_all': await run('node', ['src/cli.js', 'metrics:purge-all']); break;
    case 'sf_list': await run('node', ['src/cli.js', 'sf:list', '--today']); break;
    case 'sf_list_recent': {
      console.log(c(DIM, '  Environment: [1] production  [2] test sandbox'));
      const envpick = clean(await ask('  Choose [1]: ')) || '1';
      const test_args = envpick === '2' ? ['--test'] : [];
      console.log(c(DIM, '  Search term:'));
      console.log(c(DIM, '    [1] precise (default) — only "Race Results Doc" titles. Cleanest + fewest files; may miss oddly-named ones.'));
      console.log(c(DIM, '    [2] broad — OR of "Race Results Doc" / "Race Results" / Race / Results. Also catches race-results files'));
      console.log(c(DIM, '        NOT titled "Race Results Doc", but pulls in more unrelated spreadsheets that mention race or results.'));
      const spick = clean(await ask('  Choose [1]: ')) || '1';
      const search_args = spick === '2' ? ['--search', 'Race Results Doc,Race Results,Race,Results'] : [];
      const n = clean(await ask('  How many (blank = 25): '));
      const args = ['src/cli.js', 'sf:list'].concat(test_args, search_args, ['--limit', n || '25']);
      await run('node', args);
      break;
    }
    case 'sf_list_email': {
      console.log(c(DIM, '  Environment: [1] production  [2] test sandbox'));
      const envpick = clean(await ask('  Choose [1]: ')) || '1';
      const test_args = envpick === '2' ? ['--test'] : [];
      console.log(c(DIM, '  Status: [1] Is Not Closed  [2] Is Closed  [3] All'));
      const stpick = clean(await ask('  Choose [1]: ')) || '1';
      const status_args = stpick === '2' ? ['--status', 'closed'] : (stpick === '3' ? ['--status', 'all'] : []);
      const n = clean(await ask('  How many (blank = 50): '));
      await run('node', ['src/cli.js', 'sf:list-email'].concat(test_args, status_args, ['--limit', n || '50']));
      break;
    }
    case 'sf_pull_email': {
      console.log(c(DIM, '  Environment: [1] production  [2] test sandbox'));
      const envpick = clean(await ask('  Choose [1]: ')) || '1';
      const test_args = envpick === '2' ? ['--test'] : [];
      console.log(c(DIM, '  Status: [1] open only  [2] all statuses'));
      const stpick = clean(await ask('  Choose [1]: ')) || '1';
      const status_args = stpick === '2' ? ['--all'] : [];
      const folder = clean(await ask('  Save to folder (blank = ./sf_email_race_result_downloads): '));
      await run('node', ['src/cli.js', 'sf:pull-email'].concat(test_args, status_args, ['-o', folder || 'sf_email_race_result_downloads', '--strategy', 'add_new']));
      break;
    }
    case 'sf_pull': {
      console.log(c(DIM, '  Date: [1] today  [2] a specific date  [3] a date range  [4] any (latest)'));
      const pick = clean(await ask('  Choose [1]: ')) || '1';
      const date_args = [];
      if (pick === '2') { const d = clean(await ask('  Date (YYYY-MM-DD): ')); if (d) date_args.push('--date', d); }
      else if (pick === '3') { const a = clean(await ask('  Start (YYYY-MM-DD): ')); const b = clean(await ask('  End (YYYY-MM-DD): ')); if (a) date_args.push('--start', a); if (b) date_args.push('--end', b); }
      else if (pick === '4') { /* all */ }
      else date_args.push('--today');
      const folder = clean(await ask('  Save to folder (blank = ./sf_race_result_downloads): '));
      console.log(c(DIM, '  If a file already exists: [1] add new only  [2] overwrite same names  [3] delete all, then add'));
      const sp = clean(await ask('  Choose [1]: ')) || '1';
      const strategy = sp === '2' ? 'replace' : (sp === '3' ? 'wipe_all' : 'add_new');
      const args = ['src/cli.js', 'sf:pull'].concat(date_args, ['-o', folder || 'sf_race_result_downloads', '--strategy', strategy]);
      await run('node', args);
      break;
    }
    case 'slack_probe': {
      const ch = clean(await ask('  Probe a channel too? (id or name, blank = just list channels): '));
      const ch_args = ch ? ['--channel', ch] : [];
      await run('node', ['src/cli.js', 'slack:probe'].concat(ch_args));
      break;
    }
    case 'slack_channels': await run('node', ['src/cli.js', 'slack:channels']); break;
    case 'slack_list': {
      const ch = await slack_pick_channel();
      const ch_args = ch ? ['--channel', ch] : [];
      console.log(c(DIM, '  Date: [1] today  [2] a specific date  [3] a date range  [4] any (latest)'));
      const pick = clean(await ask('  Choose [4]: ')) || '4';
      const date_args = [];
      if (pick === '1') date_args.push('--today');
      else if (pick === '2') { const d = clean(await ask('  Date (YYYY-MM-DD): ')); if (d) date_args.push('--date', d); }
      else if (pick === '3') { const a = clean(await ask('  Start (YYYY-MM-DD): ')); const b = clean(await ask('  End (YYYY-MM-DD): ')); if (a) date_args.push('--start', a); if (b) date_args.push('--end', b); }
      await run('node', ['src/cli.js', 'slack:list'].concat(ch_args, date_args));
      break;
    }
    case 'slack_pull': {
      const ch = await slack_pick_channel();
      const ch_args = ch ? ['--channel', ch] : [];
      console.log(c(DIM, '  Date: [1] today  [2] a specific date  [3] a date range  [4] any (latest)'));
      const pick = clean(await ask('  Choose [4]: ')) || '4';
      const date_args = [];
      if (pick === '1') date_args.push('--today');
      else if (pick === '2') { const d = clean(await ask('  Date (YYYY-MM-DD): ')); if (d) date_args.push('--date', d); }
      else if (pick === '3') { const a = clean(await ask('  Start (YYYY-MM-DD): ')); const b = clean(await ask('  End (YYYY-MM-DD): ')); if (a) date_args.push('--start', a); if (b) date_args.push('--end', b); }
      const folder = clean(await ask('  Save to folder (blank = ./slack_race_result_downloads): '));
      await run('node', ['src/cli.js', 'slack:pull'].concat(ch_args, date_args, ['-o', folder || 'slack_race_result_downloads', '--strategy', 'add_new']));
      break;
    }
    case 'slack_tests': { console.log(c(DIM, '\n  running Slack engine + UI tests…\n')); const code = await run('node', ['--test', 'tests/slack_dates.test.js', 'tests/slack_client.test.js', 'tests/slack_ui.test.js']); console.log(code === 0 ? c(GREEN, '\n  ✓ Slack tests passed') : c(YELLOW, '\n  ✗ Slack tests failed')); break; }
    case 'slack_howto': {
      console.log(c(BLUE, '\n  Slack intake — setup & how-to (future self)\n'));
      console.log('  One-time app setup (api.slack.com → your app):');
      console.log(c(DIM, '    1. OAuth & Permissions → Bot Token Scopes: files:read, channels:read, channels:history,'));
      console.log(c(DIM, '       groups:read, groups:history, users:read. Then reinstall the app.'));
      console.log(c(DIM, '    2. Copy the Bot User OAuth Token (xoxb-…) into .env as SLACK_BOT_TOKEN (keep it local).'));
      console.log('\n  Self-service channels (no config, no redeploy):');
      console.log(c(DIM, '    In Slack, run  /invite @your-bot  in any channel → it auto-appears in the picker (↻ Refresh).'));
      console.log(c(DIM, '    The web app shows this instruction + a copy button next to the channel dropdown.'));
      console.log('\n  Point at a different/real channel: just invite the bot there — no env change needed.');
      console.log('\n  Verify: ' + c(DIM, 'node src/cli.js slack:probe') + '  ·  plan: ' + c(DIM, 'plans_and_notes/SLACK_INTAKE_PLAN.md') + '\n');
      break;
    }
    case 'metrics_backfill_source': await run('node', ['src/cli.js', 'metrics:backfill-source']); break;
    case 'server': console.log(c(DIM, 'Starting server… Ctrl-C to stop.')); await run('node', [SERVER]); break;
    case 'open': {
      const url = 'http://localhost:8018';
      const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
      try { execSync(cmd, { stdio: 'ignore' }); console.log(c(GREEN, '  ✓ Opened ' + url)); } catch (e) { console.log(c(YELLOW, '  Could not open a browser — go to ' + url)); }
      break;
    }
    case 'toggle': _show_cli = !_show_cli; save_prefs(); console.log(c(GREEN, '  CLI commands ' + (_show_cli ? 'shown' : 'hidden'))); break;
    case 'quit': return 'quit';
  }
}

// DATA-ONLY shell via the shared kit: it renders the registry-derived sections, numbers by position, owns
// the [t] toggle + [q] quit + the pause, and calls onSelect for each item — delegating to the existing
// handle() switch (unchanged: convert/inspect/tests/slack/server/etc). See plans_and_notes/MENU_CONVENTIONS.md.
async function onSelect(item, ctx) {
  _ctx = ctx;
  return handle(item);
}

async function main() {
  await runMenu({
    title: 'race_results_transform  ·  race results → USAT template',
    color: CYAN,
    sections: SECTIONS,
    cwd: DIR,
    prefsFile: PREFS_FILE,
    onSelect: onSelect,
  });
}

if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });

module.exports = { SECTIONS, ALL };
