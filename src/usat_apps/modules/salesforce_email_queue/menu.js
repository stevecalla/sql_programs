#!/usr/bin/env node
'use strict';
// modules/salesforce_email_queue/menu.js — dev & ops for the Email Queue module (folded into usat_apps).
// Launched from the platform menu (src/usat_apps/menu.js) or directly:
//   node src/usat_apps/modules/salesforce_email_queue/menu.js
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const R = '\x1b[0m', BOLD = '\x1b[1m', CYAN = '\x1b[36m', GREEN = '\x1b[32m', DIM = '\x1b[2m';
const c = (col, s) => col + s + R;
const M = 'src/usat_apps/modules/salesforce_email_queue';
const ITEMS = [
  { label: 'Run module tests (sf + api gate) - no DB/SF', cmd: 'node', args: ['src/usat_apps/run_tests.js', 'modules/salesforce_email_queue'] },
  { label: 'Run shared services tests - no DB/SF', cmd: 'node', args: ['src/usat_apps/run_tests.js', 'services'] },
  { label: 'Verify SF read (production) - live', cmd: 'node', args: [M + '/check_sf_read.js'] },
  { label: 'Verify SF read (sandbox) - live', cmd: 'node', args: [M + '/check_sf_read.js', '--sandbox'] },
  { label: 'Corrections DB smoke (writes a test row) - needs DB', cmd: 'node', args: [M + '/check_corrections_db.js'] },
];
function menu() {
  console.log('\n' + c(CYAN, '='.repeat(58)));
  console.log(c(BOLD, '  Email Queue - dev & ops   (folded into usat_apps :8022)'));
  console.log(c(CYAN, '='.repeat(58)));
  ITEMS.forEach(function (it, i) { console.log('  ' + c(GREEN, String(i + 1)) + '  ' + it.label); });
  console.log('  ' + c(GREEN, 'q') + '  quit');
  console.log(c(DIM, '  (commands run from ' + REPO_ROOT + ')'));
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function prompt() {
  menu();
  rl.question('\n> ', function (a) {
    a = (a || '').trim().toLowerCase();
    if (a === 'q' || a === 'quit') { rl.close(); return; }
    const it = ITEMS[parseInt(a, 10) - 1];
    if (!it) { prompt(); return; }
    console.log(c(DIM, '\n$ ' + it.cmd + ' ' + it.args.join(' ') + '\n'));
    const ch = spawn(it.cmd, it.args, { cwd: REPO_ROOT, stdio: 'inherit' });
    ch.on('exit', function () { prompt(); });
  });
}
prompt();
