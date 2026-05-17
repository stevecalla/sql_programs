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
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const CYAN   = '\x1b[36m';
const WHITE  = '\x1b[37m';
const BG_DK  = '\x1b[40m';

const c = (color, text) => `${color}${text}${RESET}`;

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

function status_line() {
  const cm  = load_json(path.join(OUTPUT_DIR, 'commentary.json'));
  const res = load_json(path.join(OUTPUT_DIR, 'analysis_results.json'));
  const ov_raw = load_json(path.join(DIR, 'data', 'overrides.json')) ?? {};
  const clean  = arr => (arr ?? []).filter(e => Object.keys(e).some(k => !k.startsWith('_')));
  const ov_count = clean(ov_raw.force_match).length + clean(ov_raw.force_no_match).length + clean(ov_raw.force_segment).length;

  const has_api  = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-ant-your-key-here');
  const mode     = cm?.mode ?? 'no build yet';
  const built    = res?.generated_at?.slice(0,10) ?? '—';
  const n_baseline      = res?.totals?.BASELINE_YEAR ?? '?';
  const n_analysis      = res?.totals?.ANALYSIS_YEAR ?? '?';
  const net      = res?.totals?.net;

  return [
    `  Last build: ${built}   Events: ${n_baseline} → ${n_analysis}${net !== undefined ? `  (${net > 0 ? '+' : ''}${net})` : ''}`,
    `  Commentary: ${mode}   AI key: ${has_api ? c(GREEN, 'set ✓') : c(YELLOW, 'not set')}   Active overrides: ${ov_count}`,
  ].join('\n');
}

// ── Menu definition ───────────────────────────────────────────────────────────

const SECTIONS = [
  {
    label: 'BUILD & OUTPUT',
    color: BLUE,
    items: [
      { id: 1,  label: 'Build everything',           desc: 'Excel + PowerPoint + Dashboard + JSON outputs',  action: 'build' },
      { id: 2,  label: 'Check data quality',         desc: 'Validate CSVs + override conflicts before building', action: 'check' },
      { id: 3,  label: 'Open dashboard in browser',  desc: 'Interactive charts (output/dashboard.html)',     action: 'open_dashboard' },
      { id: 4,  label: 'Open Excel workbook',        desc: 'Most recent output/<year>_event_calendar_analysis_*.xlsx',  action: 'open_excel' },
      { id: 5,  label: 'Open PowerPoint deck',       desc: 'Most recent output/<year>_event_trends_summary_*.pptx',           action: 'open_pptx' },
    ],
  },
  {
    label: 'OVERRIDES — event matching',
    color: YELLOW,
    items: [
      { id: 6,  label: 'List active overrides',      desc: 'Show all entries in data/overrides.json',        action: 'list_overrides' },
      { id: 7,  label: 'Suggest overrides (AI)',     desc: 'Claude analyses unmatched events for likely pairs', action: 'suggest_overrides' },
      { id: 8,  label: 'Add force-match',            desc: 'Force two events to be matched across years',    action: 'add_match' },
      { id: 9,  label: 'Add force-no-match',         desc: 'Prevent an event from matching (→ Attrited/New)', action: 'add_no_match' },
      { id: 10, label: 'Add force-segment',          desc: 'Override a segment classification',              action: 'add_segment' },
      { id: 11, label: 'Remove override',            desc: 'Remove all overrides for a sanction ID',        action: 'remove_override' },
    ],
  },
  {
    label: 'Q&A & ANALYSIS — powered by Claude',
    color: CYAN,
    items: [
      { id: 12, label: 'Ask a question',             desc: 'Ask Claude anything about the analysis results', action: 'ask' },
      { id: 13, label: 'Ask and save to notes.md',   desc: 'Answer is appended to notes.md for future context', action: 'ask_save' },
      { id: 14, label: 'Rewrite a slide narrative',  desc: 'Update commentary.json directly with new text',  action: 'update_commentary' },
      { id: 15, label: 'What changed?',              desc: 'Compare current build to prior (AI summary)',    action: 'what_changed' },
    ],
  },
  {
    label: 'INFORMATION',
    color: GREEN,
    items: [
      { id: 16, label: 'View changes since last build', desc: 'Show output/changes.txt',                    action: 'view_changes' },
      { id: 17, label: 'View notes.md',              desc: 'Current analyst notes + build history',         action: 'view_notes' },
      { id: 18, label: 'View README',                desc: 'Full documentation',                             action: 'view_readme' },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap(s => s.items);

// ── Print menu ────────────────────────────────────────────────────────────────

function print_menu() {
  console.clear();
  console.log(c(BOLD + RED, '\n  USAT Sanctioned Event Analysis'));
  console.log(c(DIM, '  ─────────────────────────────────────────────'));
  console.log(status_line());
  console.log(c(DIM, '  ─────────────────────────────────────────────\n'));

  for (const section of SECTIONS) {
    console.log(c(section.color + BOLD, `  ${section.label}`));
    for (const item of section.items) {
      const num = String(item.id).padStart(3);
      console.log(`  ${c(BOLD, num + '.')} ${item.label.padEnd(32)} ${c(DIM, item.desc)}`);
    }
    console.log('');
  }
  console.log(c(DIM, '    0. Exit\n'));
}

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

    default:
      console.log(c(YELLOW, `  Unknown action: ${action}`));
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  await resolve_output_dir();
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    console.log(c(DIM, '\n  Goodbye.\n'));
    process.exit(0);
  });

  while (true) {
    print_menu();

    const raw = (await prompt(rl, c(BOLD, '  Select (0–18): '))).trim();
    const num = parseInt(raw, 10);

    if (raw === '0' || raw.toLowerCase() === 'q' || raw.toLowerCase() === 'exit') {
      console.log(c(DIM, '\n  Goodbye.\n'));
      rl.close();
      break;
    }

    const item = ALL_ITEMS.find(i => i.id === num);
    if (!item) {
      console.log(c(YELLOW, `\n  Invalid selection "${raw}". Press Enter to continue.`));
      await prompt(rl, '');
      continue;
    }

    console.log(c(DIM, `\n  Running: ${item.label}\n  ${'─'.repeat(50)}`));
    await handle_action(item.action, rl);
    console.log(c(DIM, `\n  ${'─'.repeat(50)}\n  Done. Press Enter to return to menu.`));
    await prompt(rl, '');
  }
}

main().catch(err => {
  console.error('Menu error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
