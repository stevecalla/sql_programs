#!/usr/bin/env node
/**
 * menu.js — Interactive feature launcher.
 *
 * Usage:
 *   node menu.js
 *
 * Shows all available features as a numbered list. Type the number and
 * press Enter. For commands that need arguments the menu will prompt you.
 * No extra packages required — uses Node.js built-in readline.
 */

'use strict';
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const path       = require('path');
const fs         = require('fs');
const readline   = require('readline');
const { execSync, spawn } = require('child_process');
const { determineOSPath } = require('../../utilities/determineOSPath');

const DIR = __dirname;

// OUTPUT_DIR is resolved once at startup inside main() so the rest of the
// module (including sync helpers like status_line) can read it as a constant.
// Override at the shell: EVENT_ANALYSIS_OUTPUT_DIR=/custom/path node menu.js
let OUTPUT_DIR = null;
async function resolve_output_dir() {
  if (OUTPUT_DIR) return OUTPUT_DIR;
  if (process.env.EVENT_ANALYSIS_OUTPUT_DIR) {
    OUTPUT_DIR = process.env.EVENT_ANALYSIS_OUTPUT_DIR;
  } else {
    const os_path = await determineOSPath();
    OUTPUT_DIR = require('path').join(os_path, 'usat_event_analysis_output');
  }
  require('fs').mkdirSync(OUTPUT_DIR, { recursive: true });
  return OUTPUT_DIR;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';
const RED     = '\x1b[31m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const BLUE    = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN    = '\x1b[36m';
const WHITE   = '\x1b[37m';
const BG_DK  = '\x1b[40m';

const c = (color, text) => `${color}${text}${RESET}`;

const { runMenu } = require('../../utilities/menu/menu_kit');   // shared menu shell (render/number/toggle/quit)

function run(cmd, args = []) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath ?? 'node', [cmd, ...args], {
      stdio: 'inherit',
      cwd: DIR,
      shell: false,
    });
    proc.on('close', code => resolve(code));
  });
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function open_browser(fp) {
  const url = `file://${fp.replace(/\\/g, '/')}`;
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
            : process.platform === 'darwin' ? `open "${url}"`
            : `xdg-open "${url}"`;
  try { execSync(cmd, { stdio: 'ignore' }); }
  catch { console.log(`\n  Open this file in your browser:\n  ${fp}\n`); }
}

function load_json(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

/**
 * Return the absolute path of the most recently modified file in `dir`
 * whose basename matches `regex` — or null if none exists.
 */
function find_latest(dir, regex) {
  if (!fs.existsSync(dir)) return null;
  const matches = fs.readdirSync(dir)
    .filter(name => regex.test(name))
    .map(name => {
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      return st.isFile() ? { fp, mtime: st.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return matches.length ? matches[0].fp : null;
}

// ── Menu preferences ────────────────────────────────────────────────────────
// User-toggled UI state, persisted to .menu_prefs.json next to menu.js so
// the next launch remembers the choice. Currently only `show_cli` (the
// "Show/hide CLI commands" toggle), but the shape is generic for future
// preferences without needing a new file.
const PREFS_FILE = path.join(DIR, '.menu_prefs.json');
let _show_cli = false;   // updated by load_prefs() on startup + by toggle_commands

function load_prefs() {
  try {
    const j = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
    if (typeof j.show_cli === 'boolean') _show_cli = j.show_cli;
  } catch { /* file missing or malformed — fall back to defaults */ }
}

function save_prefs() {
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify({ show_cli: _show_cli }, null, 2) + '\n');
  } catch (err) {
    console.warn(`  Could not save prefs (${err.message}) — toggle still applies for this session.`);
  }
}

// Override count comes from the DB (event_analysis_overrides), NOT the
// long-gone data/overrides.json. Loaded async on each print_menu() so the
// header reflects DB changes made by ask.js / dashboard / etc. since the
// menu started. If the DB is unreachable the count shows '?' rather than
// blocking the menu.
async function fetch_override_stats() {
  try {
    const { load_overrides } = require('./src/overrides');
    const analysis_year = Number(process.env.ANALYSIS_YEAR) || new Date().getFullYear();
    const baseline_year = Number(process.env.BASELINE_YEAR) || (analysis_year - 1);
    const { stats } = await load_overrides({ baseline_year, analysis_year, silent: true });
    return { ok: true, ...stats, baseline_year, analysis_year };
  } catch (e) {
    return { ok: false };
  }
}

async function status_line() {
  const cm  = load_json(path.join(OUTPUT_DIR, 'commentary.json'));
  const res = load_json(path.join(OUTPUT_DIR, 'analysis_results.json'));
  const ov  = await fetch_override_stats();

  const has_api  = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-ant-your-key-here');
  const mode     = cm?.mode ?? 'no build yet';
  const built    = res?.generated_at?.slice(0,10) ?? '—';
  const n_baseline      = res?.totals?.BASELINE_YEAR ?? '?';
  const n_analysis      = res?.totals?.ANALYSIS_YEAR ?? '?';
  const net      = res?.totals?.net;

  const ov_str = ov.ok
    ? `${ov.total} (${ov.approved} ✓ · ${ov.unapproved} ◦ · ${ov.stale ?? 0} ⚠)`
    : c(DIM, '(DB unreachable)');

  return [
    `  Last build: ${built}   Events: ${n_baseline} → ${n_analysis}${net !== undefined ? `  (${net > 0 ? '+' : ''}${net})` : ''}`,
    `  Commentary: ${mode}   AI key: ${has_api ? c(GREEN, 'set ✓') : c(YELLOW, 'not set')}   Active overrides: ${ov_str}`,
  ].join('\n');
}

// ── Menu definition ───────────────────────────────────────────────────────────

const SECTIONS = [
  {
    label: 'BUILD & OUTPUT',
    color: BLUE,
    items: [
      { label: 'Build everything',           desc: 'Excel + PowerPoint + Dashboard + JSON outputs (reuses cached AI commentary when inputs unchanged)',  action: 'build',           cli: 'node build_all.js' },
      { label: 'Build (rule-based only)',    desc: '--no-ai — forces rule-based commentary; no Claude API tokens spent',   action: 'build_rule_based', cli: 'node build_all.js --no-ai' },
      { label: 'Build (force fresh AI)',     desc: '--fresh-ai — bypasses commentary cache and calls Claude even when inputs are unchanged', action: 'build_fresh_ai', cli: 'node build_all.js --fresh-ai' },
      { label: 'Build (skip roster DB write)', desc: '--no-db-roster — same outputs, but does NOT write the roster snapshot to event_analysis_roster (no historical record + no pruning)', action: 'build_no_roster', cli: 'node build_all.js --no-db-roster' },
      { label: 'Build (custom years — ad hoc)', desc: 'Prompts for baseline + analysis years; defaults to skipping DB write + Slack so the historical record stays clean', action: 'build_custom_years', cli: 'node build_all.js --baseline-year <YYYY> --analysis-year <YYYY> --no-db-roster --no-slack' },
      { label: 'Check data quality',         desc: 'Validate CSVs + override conflicts before building', action: 'check',          cli: 'node check.js' },
      { label: 'Open dashboard in browser',  desc: 'Interactive charts (output/dashboard.html)',     action: 'open_dashboard' },
      { label: 'Open Excel workbook',        desc: 'Most recent output/<year>_event_calendar_analysis_*.xlsx',  action: 'open_excel' },
      { label: 'Open PowerPoint deck',       desc: 'Most recent output/<year>_event_trends_summary_*.pptx',           action: 'open_pptx' },
    ],
  },
  {
    label: 'OVERRIDES — event matching',
    color: YELLOW,
    items: [
      { label: 'List active overrides',      desc: 'Show active overrides for current year scope (+ globals) from event_analysis_overrides (DB)', action: 'list_overrides',    cli: 'node ask.js --list-overrides' },
      { label: 'Suggest overrides (AI)',     desc: 'Claude analyses unmatched events for likely pairs', action: 'suggest_overrides', cli: 'node ask.js --suggest-overrides' },
      { label: 'Add force-match',            desc: 'Force two events to be matched across years',    action: 'add_match',         cli: 'node ask.js --add-override match <sid_baseline> <sid_analysis> "note"' },
      { label: 'Add force-no-match',         desc: 'Prevent an event from matching (→ Attrited/New)', action: 'add_no_match',     cli: 'node ask.js --add-override no-match <25|26> <sid> "note"' },
      { label: 'Add force-segment',          desc: 'Override a segment classification',              action: 'add_segment',       cli: 'node ask.js --add-override segment <25|26> <sid> <segment> "note"' },
      { label: 'Remove override',            desc: 'Remove all overrides for a sanction ID',        action: 'remove_override',    cli: 'node ask.js --remove-override <sid>' },
      { label: 'Mark events as reviewed',    desc: 'CLI version of the dashboard Reviewed? checkbox -- creates the right override per segment + approves it. Tagged created_by=cli:review.', action: 'mark_reviewed', cli: 'node ask.js --mark-reviewed <sid> [<sid> ...]' },
      { label: 'Unmark events as reviewed',  desc: 'Inverse of #16 -- soft-deletes ONLY the review-tagged overrides (cli:review or dashboard:review). Manual overrides on the same sid stay intact.', action: 'unmark_reviewed', cli: 'node ask.js --unmark-reviewed <sid> [<sid> ...]' },
    ],
  },
  {
    label: 'Q&A & ANALYSIS — powered by Claude',
    color: CYAN,
    items: [
      { label: 'Ask a question',             desc: 'Ask Claude anything about the analysis results', action: 'ask',                cli: 'node ask.js "your question"' },
      { label: 'Ask and save to notes.md',   desc: 'Answer is appended to notes.md for future context', action: 'ask_save',         cli: 'node ask.js "your question" --save-notes' },
      { label: 'Rewrite a slide narrative',  desc: 'Update commentary.json directly with new text',  action: 'update_commentary',   cli: 'node ask.js "instruction" --update-commentary <key>' },
      { label: 'What changed?',              desc: 'Compare current build to prior (AI summary)',    action: 'what_changed',        cli: 'node ask.js --what-changed' },
    ],
  },
  {
    label: 'INFORMATION',
    color: GREEN,
    items: [
      { label: 'View changes since last build', desc: 'Show output/changes.txt',                    action: 'view_changes',      cli: 'cat output/changes.txt' },
      { label: 'View notes.md',              desc: 'Current analyst notes + build history',         action: 'view_notes',         cli: 'cat notes.md' },
      { label: 'View README',                desc: 'Full documentation',                             action: 'view_readme',        cli: 'cat README.md' },
    ],
  },
  {
    label: 'LOCAL SERVER — http://localhost:8016',
    color: CYAN,
    items: [
      { label: 'Start local server',         desc: 'API + override editor (/editor/) + dashboard (Ctrl-C to stop). Uses ALLOWED_IPS from .env if set.', action: 'start_server', cli: 'cd ../../ && node server_event_analysis_8016.js' },
      { label: 'Start local server (IP allowlist)', desc: 'Prompts for allowed IPs (default 127.0.0.1) and starts the server with ALLOWED_IPS injected — always restricted regardless of .env', action: 'start_server_restricted', cli: 'cd ../../ && ALLOWED_IPS=127.0.0.1 node server_event_analysis_8016.js' },
    ],
  },
  {
    label: 'TESTING — verify the code is working',
    color: MAGENTA,
    items: [
      { label: 'Run ALL tests',              desc: 'Runs every *.test.js under tests/ via node --test',               action: 'run_tests_all',        cli: 'node --test tests/' },
      { label: 'Run overrides tests only',   desc: 'tests/overrides.test.js — schema, year scoping, apply, approve, stale', action: 'run_tests_overrides', cli: 'node --test tests/overrides.test.js' },
      { label: 'Run server tests only',      desc: 'tests/server.test.js — read/write API + editor static files',     action: 'run_tests_server',     cli: 'node --test tests/server.test.js' },
      { label: 'Run menu tests only',        desc: 'tests/menu.test.js — verifies all menu options are wired correctly', action: 'run_tests_menu',     cli: 'node --test tests/menu.test.js' },
      { label: 'Run smoke tests only',       desc: 'tests/smoke.test.js — parse-checks every major source file',     action: 'run_tests_smoke',      cli: 'node --test tests/smoke.test.js' },
      { label: 'Run glossary tests only',    desc: 'tests/glossary.test.js — confirms dashboard glossary has every key term', action: 'run_tests_glossary', cli: 'node --test tests/glossary.test.js' },
      { label: 'Run download tests only',    desc: 'tests/downloads.test.js — Excel + PowerPoint Download buttons point at real files', action: 'run_tests_downloads', cli: 'node --test tests/downloads.test.js' },
      { label: 'Run build tests only',       desc: 'tests/build.test.js — commentary cache: hash stability + sensitivity + insensitivity + loader', action: 'run_tests_build', cli: 'node --test tests/build.test.js' },
      { label: 'Run roster tests only',      desc: 'tests/roster.test.js — roster snapshot insert + tiered retention (DB-backed; skips if DB unreachable)', action: 'run_tests_roster', cli: 'node --test tests/roster.test.js' },
      { label: 'Run dashboard tests only',   desc: 'tests/dashboard.test.js — date format + Day-column-collapsed regression guards', action: 'run_tests_dashboard', cli: 'node --test tests/dashboard.test.js' },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap(s => s.items);

// ── Handle actions ────────────────────────────────────────────────────────────

const NARRATIVE_KEYS = [
  'slide_2_narrative','slide_3_narrative','slide_4_narrative',
  'slide_5_narrative','slide_6_narrative','slide_7_narrative','slide_8_narrative',
  'slide_1_subtitle','slide_3_header','slide_4_header','slide_4_alert',
  'slide_7_opportunity_label','slide_8_header',
];

async function handle_action(action, rl) {
  console.log('');
  switch (action) {

    case 'build':
      await run('build_all.js');
      break;

    case 'build_rule_based': {
      // Pass --no-ai as a CLI flag — same effect as setting NO_AI used to
      // have, but with a universal cross-shell syntax. Useful when iterating
      // on dashboard / Excel / PowerPoint formatting without burning tokens.
      console.log(c(DIM, '  --no-ai → rule-based commentary only.'));
      const code = await new Promise(resolve => {
        const proc = spawn(process.execPath ?? 'node', ['build_all.js', '--no-ai'], {
          stdio: 'inherit',
          cwd:   DIR,
          shell: false,
        });
        proc.on('close', resolve);
      });
      if (code !== 0 && code !== null) console.log(c(YELLOW, `\n  Build exited with code ${code}.`));
      break;
    }

    case 'build_fresh_ai': {
      // --fresh-ai skips the input-hash cache check, so AI commentary
      // is regenerated even when the underlying numbers haven't changed.
      // Use when you've tweaked the AI prompt or just want new wording.
      console.log(c(DIM, '  --fresh-ai → bypass commentary cache, call Claude unconditionally.'));
      const code = await new Promise(resolve => {
        const proc = spawn(process.execPath ?? 'node', ['build_all.js', '--fresh-ai'], {
          stdio: 'inherit',
          cwd:   DIR,
          shell: false,
        });
        proc.on('close', resolve);
      });
      if (code !== 0 && code !== null) console.log(c(YELLOW, `\n  Build exited with code ${code}.`));
      break;
    }

    case 'build_no_roster': {
      // --no-db-roster skips the event_analysis_roster INSERT + pruning.
      // Useful when iterating locally and you don't want every throwaway
      // build to land in the historical record (and trigger the retention
      // prune that follows).
      console.log(c(DIM, '  --no-db-roster → roster snapshot will NOT be written to event_analysis_roster.'));
      const code = await new Promise(resolve => {
        const proc = spawn(process.execPath ?? 'node', ['build_all.js', '--no-db-roster'], {
          stdio: 'inherit',
          cwd:   DIR,
          shell: false,
        });
        proc.on('close', resolve);
      });
      if (code !== 0 && code !== null) console.log(c(YELLOW, `\n  Build exited with code ${code}.`));
      break;
    }

    case 'build_custom_years': {
      // Ad-hoc: prompt for a year pair, then spawn build_all.js with the
      // appropriate CLI flags. Defaults skip the DB roster write + Slack
      // notification, since the typical reason to run this is "what would
      // 2026-vs-2027 look like?" — a one-off exploration that shouldn't
      // pollute the historical roster table or ping the team channel.
      // The user can opt back in by answering 'n' to either prompt.
      console.log(c(BOLD, '  Build with custom years (ad-hoc analysis)\n'));
      console.log(c(DIM, '  Press Enter on any prompt to keep the suggested default.\n'));

      // Read the current default scope from the env so the prompts have
      // sensible suggestions (matches what `node build_all.js` would use
      // with no flags).
      const default_analysis = Number(process.env.ANALYSIS_YEAR) || new Date().getFullYear();
      const default_baseline = Number(process.env.BASELINE_YEAR) || (default_analysis - 1);

      const baseline_raw = (await prompt(rl, `  Baseline year (default ${default_baseline}): `)).trim();
      const analysis_raw = (await prompt(rl, `  Analysis year (default ${default_analysis}): `)).trim();
      const baseline = Number(baseline_raw) || default_baseline;
      const analysis = Number(analysis_raw) || default_analysis;

      if (!Number.isInteger(baseline) || !Number.isInteger(analysis) || baseline < 2000 || analysis < 2000 || baseline > 2100 || analysis > 2100) {
        console.log(c(YELLOW, `  Cancelled — years must be 4-digit integers in [2000, 2100]. Got baseline=${baseline}, analysis=${analysis}.`));
        break;
      }
      if (baseline === analysis) {
        console.log(c(YELLOW, '  Cancelled — baseline and analysis years must differ.'));
        break;
      }

      const skip_db_raw     = (await prompt(rl, `  Skip writing roster snapshot to DB? (Y/n): `)).trim().toLowerCase();
      const skip_slack_raw  = (await prompt(rl, `  Skip Slack notification? (Y/n): `)).trim().toLowerCase();
      const skip_db    = skip_db_raw    !== 'n';   // default Y
      const skip_slack = skip_slack_raw !== 'n';   // default Y

      const args = ['build_all.js', '--baseline-year', String(baseline), '--analysis-year', String(analysis)];
      if (skip_db)    args.push('--no-db-roster');
      if (skip_slack) args.push('--no-slack');

      console.log(c(DIM, `\n  Running: node ${args.join(' ')}\n`));
      const code = await new Promise(resolve => {
        const proc = spawn(process.execPath ?? 'node', args, {
          stdio: 'inherit',
          cwd:   DIR,
          shell: false,
        });
        proc.on('close', resolve);
      });
      if (code !== 0 && code !== null) console.log(c(YELLOW, `\n  Build exited with code ${code}.`));
      break;
    }

    case 'check':
      await run('check.js');
      break;

    case 'open_dashboard': {
      const fp = path.join(OUTPUT_DIR, 'dashboard.html');
      if (!fs.existsSync(fp)) { console.log(c(YELLOW, '  Run Build first to generate the dashboard.')); break; }
      open_browser(fp);
      console.log(c(GREEN, '  ✓ Dashboard opened in browser'));
      break;
    }

    case 'open_excel': {
      const fp = find_latest(path.join(OUTPUT_DIR), /^\d{4}_event_calendar_analysis_.+\.xlsx$/);
      if (!fp) { console.log(c(YELLOW, '  No xlsx in output/ — run Build first.')); break; }
      try { execSync(process.platform === 'win32' ? `start "" "${fp}"` : process.platform === 'darwin' ? `open "${fp}"` : `xdg-open "${fp}"`, { stdio: 'ignore' }); console.log(c(GREEN, `  ✓ Opened ${path.basename(fp)}`)); }
      catch { console.log(`  Path: ${fp}`); }
      break;
    }

    case 'open_pptx': {
      const fp = find_latest(path.join(OUTPUT_DIR), /^\d{4}_event_trends_summary_.+\.pptx$/);
      if (!fp) { console.log(c(YELLOW, '  No pptx in output/ — run Build first.')); break; }
      try { execSync(process.platform === 'win32' ? `start "" "${fp}"` : process.platform === 'darwin' ? `open "${fp}"` : `xdg-open "${fp}"`, { stdio: 'ignore' }); console.log(c(GREEN, `  ✓ Opened ${path.basename(fp)}`)); }
      catch { console.log(`  Path: ${fp}`); }
      break;
    }

    case 'list_overrides':
      await run('ask.js', ['--list-overrides']);
      break;

    case 'suggest_overrides':
      await run('ask.js', ['--suggest-overrides']);
      break;

    case 'add_match': {
      console.log(c(BOLD, '  Add force-match override\n'));
      const s25 = (await prompt(rl, '  2025 Sanction ID (e.g. 311655-Adult Race): ')).trim();
      const s26 = (await prompt(rl, '  2026 Sanction ID (e.g. 354307-Adult Race): ')).trim();
      const note = (await prompt(rl, '  Note (optional, press Enter to skip): ')).trim();
      if (!s25 || !s26) { console.log(c(YELLOW, '  Cancelled — both IDs required.')); break; }
      await run('ask.js', ['--add-override', 'match', s25, s26, ...(note ? [note] : [])]);
      break;
    }

    case 'add_no_match': {
      console.log(c(BOLD, '  Add force-no-match override\n'));
      const year = (await prompt(rl, '  Year (25 or 26): ')).trim();
      const sid  = (await prompt(rl, `  Sanction ID: `)).trim();
      const note = (await prompt(rl, '  Note (optional): ')).trim();
      if (!['25','26'].includes(year) || !sid) { console.log(c(YELLOW, '  Cancelled.')); break; }
      await run('ask.js', ['--add-override', 'no-match', year, sid, ...(note ? [note] : [])]);
      break;
    }

    case 'add_segment': {
      console.log(c(BOLD, '  Add force-segment override\n'));
      console.log(c(DIM, '  Valid segments: Retained, Shifted, Attrited, New, Recovered, Tried to Return\n'));
      const year = (await prompt(rl, '  Year of sanction ID (25 or 26): ')).trim();
      const sid  = (await prompt(rl, '  Sanction ID: ')).trim();
      const seg  = (await prompt(rl, '  Segment: ')).trim();
      const note = (await prompt(rl, '  Note (optional): ')).trim();
      if (!['25','26'].includes(year) || !sid || !seg) { console.log(c(YELLOW, '  Cancelled.')); break; }
      await run('ask.js', ['--add-override', 'segment', year, sid, seg, ...(note ? [note] : [])]);
      break;
    }

    case 'remove_override': {
      console.log(c(BOLD, '  Remove override\n'));
      const sid = (await prompt(rl, '  Sanction ID to remove: ')).trim();
      if (!sid) { console.log(c(YELLOW, '  Cancelled.')); break; }
      await run('ask.js', ['--remove-override', sid]);
      break;
    }

    case 'mark_reviewed': {
      console.log(c(BOLD, '  Mark events as reviewed\n'));
      console.log(c(DIM, '  Enter one or more sanction IDs separated by COMMAS.'));
      console.log(c(DIM, '  Sids may contain spaces (e.g. "310631-Adult Clinic"); commas are'));
      console.log(c(DIM, '  the only separator so spaces inside a sid are preserved.'));
      console.log(c(DIM, '  Each sid is looked up in the latest roster snapshot for the current'));
      console.log(c(DIM, '  year scope; the right override (force_match / force_segment) is'));
      console.log(c(DIM, '  created + approved + tagged created_by=cli:review.\n'));
      const raw = (await prompt(rl, '  Sanction IDs (comma-separated): ')).trim();
      // Strip outer quotes (operators paste them sometimes) then split on
      // commas only. Spaces inside a sid stay intact.
      const sids = raw
        .replace(/^["']|["']$/g, '')
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      if (!sids.length) { console.log(c(YELLOW, '  Cancelled.')); break; }
      await run('ask.js', ['--mark-reviewed', ...sids]);
      break;
    }

    case 'unmark_reviewed': {
      console.log(c(BOLD, '  Unmark events as reviewed\n'));
      console.log(c(DIM, '  Enter one or more sanction IDs separated by COMMAS.'));
      console.log(c(DIM, '  Sids may contain spaces (e.g. "310631-Adult Clinic"); commas are'));
      console.log(c(DIM, '  the only separator so spaces inside a sid are preserved.'));
      console.log(c(DIM, '  Soft-deletes ONLY the review-tagged overrides (cli:review or'));
      console.log(c(DIM, '  dashboard:review) for those sids. Manual force_match / force_segment'));
      console.log(c(DIM, '  overrides on the same sid stay intact.\n'));
      const raw = (await prompt(rl, '  Sanction IDs (comma-separated): ')).trim();
      const sids = raw
        .replace(/^["']|["']$/g, '')
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      if (!sids.length) { console.log(c(YELLOW, '  Cancelled.')); break; }
      await run('ask.js', ['--unmark-reviewed', ...sids]);
      break;
    }

    case 'ask': {
      const q = (await prompt(rl, c(BOLD, '  Your question: '))).trim();
      if (!q) { console.log(c(YELLOW, '  Cancelled.')); break; }
      await run('ask.js', [q]);
      break;
    }

    case 'ask_save': {
      const q = (await prompt(rl, c(BOLD, '  Your question (answer will be saved to notes.md): '))).trim();
      if (!q) { console.log(c(YELLOW, '  Cancelled.')); break; }
      await run('ask.js', [q, '--save-notes']);
      break;
    }

    case 'update_commentary': {
      console.log(c(BOLD, '  Rewrite a slide narrative\n'));
      console.log(c(DIM, '  Available keys:'));
      NARRATIVE_KEYS.forEach((k, i) => console.log(`    ${String(i+1).padStart(2)}. ${k}`));
      const choice = (await prompt(rl, '\n  Pick number or type key name: ')).trim();
      const key    = isNaN(choice) ? choice : NARRATIVE_KEYS[Number(choice) - 1];
      if (!key) { console.log(c(YELLOW, '  Cancelled.')); break; }
      const q = (await prompt(rl, `  Instruction for ${c(BOLD, key)}: `)).trim();
      if (!q) { console.log(c(YELLOW, '  Cancelled.')); break; }
      await run('ask.js', [q, '--update-commentary', key]);
      break;
    }

    case 'what_changed':
      await run('ask.js', ['--what-changed']);
      break;

    case 'view_changes': {
      const fp = path.join(OUTPUT_DIR, 'changes.txt');
      if (!fs.existsSync(fp)) { console.log(c(YELLOW, '  No changes.txt yet — run Build twice.')); break; }
      console.log(fs.readFileSync(fp, 'utf8'));
      break;
    }

    case 'view_notes': {
      const fp = path.join(DIR, 'notes.md');
      if (!fs.existsSync(fp)) { console.log(c(YELLOW, '  notes.md not found.')); break; }
      console.log(fs.readFileSync(fp, 'utf8'));
      break;
    }

    case 'start_server': {
      // Foreground the local read-only API server. The server lives at the
      // repo root alongside the other server_*.js services (port 8016 in
      // its filename). We spawn it from there so its relative requires and
      // .env lookup resolve correctly. Inherits stdio so Ctrl-C in the menu
      // terminal stops it cleanly. Control returns to the menu loop once
      // the server exits.
      console.log(c(BOLD, '  Starting local server (http://localhost:8016, Ctrl-C to stop)\n'));
      const root = path.join(DIR, '..', '..');
      const code = await new Promise(resolve => {
        const proc = spawn(process.execPath ?? 'node', ['server_event_analysis_8016.js'], {
          stdio: 'inherit',
          cwd:   root,
          shell: false,
        });
        proc.on('close', resolve);
      });
      if (code !== 0 && code !== null) console.log(c(YELLOW, `\n  Server exited with code ${code}.`));
      break;
    }

    case 'start_server_restricted': {
      // Same as 'start_server' but explicitly injects ALLOWED_IPS into the
      // child env so the server's IP-allowlist middleware activates
      // regardless of what's in .env. Useful for: "I want this locked down
      // right now without editing config files."
      console.log(c(BOLD, '  Start local server with IP allowlist\n'));
      const existing_allowed = (process.env.ALLOWED_IPS || '').trim();
      // Default includes BOTH IPv4 and IPv6 loopback. Node's HTTP server
      // listens dual-stack by default on Windows + Linux, and a client
      // hitting http://localhost:8016 can land on either depending on OS
      // DNS resolution. Including ::1 prevents the surprise where the
      // browser/curl comes in as ::1 and gets a confusing 403 even though
      // the user typed 127.0.0.1.
      const default_ips = existing_allowed || '127.0.0.1,::1';
      const prompt_label = existing_allowed
        ? `  Allowed IPs (default from .env: ${existing_allowed}): `
        : `  Allowed IPs (default ${default_ips}): `;
      const input = (await prompt(rl, prompt_label)).trim();
      // If the user typed just '127.0.0.1' (or any list that omits ::1),
      // be a friend and add the IPv6 loopback too -- otherwise local
      // browser traffic gets bounced and the user has to debug why.
      // The check only fires when the user clearly intended "this machine".
      let ips_csv = input || default_ips;
      const ips_arr = ips_csv.split(',').map(s => s.trim()).filter(Boolean);
      if (ips_arr.includes('127.0.0.1') && !ips_arr.includes('::1')) {
        ips_arr.push('::1');
        ips_csv = ips_arr.join(',');
        console.log(c(DIM, '  (auto-added ::1 so IPv6 localhost traffic is also allowed)'));
      }
      console.log(c(DIM, `  ALLOWED_IPS=${ips_csv} → middleware will reject any other source IP with 403.\n`));
      console.log(c(BOLD, '  Starting local server (http://localhost:8016, Ctrl-C to stop)\n'));
      const root = path.join(DIR, '..', '..');
      const code = await new Promise(resolve => {
        const proc = spawn(process.execPath ?? 'node', ['server_event_analysis_8016.js'], {
          stdio: 'inherit',
          cwd:   root,
          shell: false,
          env:   { ...process.env, ALLOWED_IPS: ips_csv },
        });
        proc.on('close', resolve);
      });
      if (code !== 0 && code !== null) console.log(c(YELLOW, `\n  Server exited with code ${code}.`));
      break;
    }

    case 'run_tests_all':
    case 'run_tests_overrides':
    case 'run_tests_server':
    case 'run_tests_menu':
    case 'run_tests_smoke':
    case 'run_tests_glossary':
    case 'run_tests_downloads':
    case 'run_tests_build':
    case 'run_tests_roster':
    case 'run_tests_dashboard': {
      // node --test runs every *.test.js it finds in the given path
      // and exits non-zero on failure. Output is TAP-style. We can't use
      // the existing run() helper because we need --test as a node flag,
      // not a script argument — so spawn directly.
      const tests_dir = path.join(DIR, 'tests');
      if (!fs.existsSync(tests_dir)) {
        console.log(c(YELLOW, '  No tests/ directory found.'));
        break;
      }
      const target = action === 'run_tests_overrides' ? path.join(tests_dir, 'overrides.test.js')
                   : action === 'run_tests_server'    ? path.join(tests_dir, 'server.test.js')
                   : action === 'run_tests_menu'      ? path.join(tests_dir, 'menu.test.js')
                   : action === 'run_tests_smoke'     ? path.join(tests_dir, 'smoke.test.js')
                   : action === 'run_tests_glossary'  ? path.join(tests_dir, 'glossary.test.js')
                   : action === 'run_tests_downloads' ? path.join(tests_dir, 'downloads.test.js')
                   : action === 'run_tests_build'     ? path.join(tests_dir, 'build.test.js')
                   : action === 'run_tests_roster'    ? path.join(tests_dir, 'roster.test.js')
                   : action === 'run_tests_dashboard' ? path.join(tests_dir, 'dashboard.test.js')
                   :                                     tests_dir;
      if (action !== 'run_tests_all' && !fs.existsSync(target)) {
        console.log(c(YELLOW, `  Test file not found: ${target}`));
        break;
      }
      const label = action === 'run_tests_overrides' ? 'overrides tests'
                  : action === 'run_tests_server'    ? 'server tests'
                  : action === 'run_tests_menu'      ? 'menu tests'
                  : action === 'run_tests_smoke'     ? 'smoke tests'
                  : action === 'run_tests_glossary'  ? 'glossary tests'
                  : action === 'run_tests_downloads' ? 'download tests'
                  : action === 'run_tests_build'     ? 'build tests'
                  : action === 'run_tests_roster'    ? 'roster tests'
                  : action === 'run_tests_dashboard' ? 'dashboard tests'
                  :                                     'all tests';
      console.log(c(DIM, `  Running ${label}: node --test ${path.relative(DIR, target) || 'tests/'}`));
      const code = await new Promise(resolve => {
        const proc = spawn(process.execPath ?? 'node', ['--test', target], {
          stdio: 'inherit',
          cwd:   DIR,
          shell: false,
        });
        proc.on('close', resolve);
      });
      if (code === 0) console.log(c(GREEN, `\n  ✓ ${label} passed.`));
      else            console.log(c(RED,   `\n  ✗ ${label} failed (exit code ${code}).`));
      break;
    }

    case 'view_readme': {
      const fp = path.join(DIR, 'README.md');
      if (!fs.existsSync(fp)) { console.log(c(YELLOW, '  README.md not found.')); break; }
      // Print with basic formatting highlights
      const lines = fs.readFileSync(fp, 'utf8').split('\n');
      lines.forEach(l => {
        if (l.startsWith('## '))  console.log(c(BOLD + CYAN,  l));
        else if (l.startsWith('### ')) console.log(c(BOLD, l));
        else if (l.startsWith('```')) console.log(c(DIM, l));
        else console.log(l);
      });
      break;
    }

    case 'toggle_commands': {
      // Flip the show-CLI toggle and persist. On the next print_menu()
      // call, every item with a `cli` field gains/loses its dimmed
      // "$ ..." second line. Choice survives across sessions via
      // .menu_prefs.json.
      _show_cli = !_show_cli;
      save_prefs();
      console.log(c(GREEN, `  ✓ CLI commands ${_show_cli ? 'shown' : 'hidden'} (saved to .menu_prefs.json).`));
      break;
    }

    default:
      console.log(c(YELLOW, `  Unknown action: ${action}`));
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

// DATA-ONLY shell via the shared kit: it renders, numbers by position, owns the [t] toggle + quit, and
// pauses. The live DB-backed status header stays via the subtitle hook (recomputed each render), and
// dispatch stays here \u2014 the kit calls onSelect, delegating to the existing handle_action switch (unchanged).
async function main() {
  await resolve_output_dir();                 // sets OUTPUT_DIR that status_line() reads
  await runMenu({
    title: 'USAT Sanctioned Event Analysis',
    color: RED,
    subtitle: () => status_line(),            // live: last build, event counts, override stats (per render)
    sections: SECTIONS,
    cwd: DIR,
    prefsFile: PREFS_FILE,
    onSelect: (item, ctx) => handle_action(item.action, ctx.rl),
  });
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { SECTIONS, ALL_ITEMS, handle_action, main };
