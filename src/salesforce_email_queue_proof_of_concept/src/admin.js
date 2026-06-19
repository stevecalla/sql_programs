'use strict';
// User management for the POC. Usage:
//   node src/admin.js add [user]      (prompts for password + optional SF email)
//   node src/admin.js list
//   node src/admin.js remove <user>
const path = require('path');
(function load_env() {
  const fs = require('fs');
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../../../.env'), 'utf8');
    raw.split(/\r?\n/).forEach(function (l) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (!m) return; let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (process.env[m[1]] === undefined) process.env[m[1]] = v; });
  } catch (e) { /* ignore */ }
})();
const readline = require('readline');
const store = require('../auth/auth_store');
function ask(rl, q) { return new Promise(function (r) { rl.question(q, r); }); }
async function main() {
  const [cmd, a1] = process.argv.slice(2);
  if (cmd === 'list') { const u = store.list_users(); if (!u.length) console.log('(no users)'); u.forEach(function (x) { console.log('  ' + x.user + (x.sf_email ? '  <' + x.sf_email + '>' : '')); }); return; }
  if (cmd === 'passwd' || cmd === 'reset') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const user = (a1 || (await ask(rl, 'Username to reset: '))).trim();
    if (!store.list_users().some(function (u) { return u.user === user; })) { console.log('No such user: ' + user); rl.close(); return; }
    const pass = (await ask(rl, 'New password: ')).trim();
    store.add_user(user, pass); console.log('Password updated for: ' + user); rl.close(); return;
  }
  if (cmd === 'remove') { console.log(store.remove_user(a1) ? 'Removed: ' + a1 : 'No such user: ' + a1); return; }
  if (cmd === 'add') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const user = (a1 || (await ask(rl, 'Username: '))).trim();
    const pass = (await ask(rl, 'Password: ')).trim();
    const sf = (await ask(rl, 'SF email (optional, for future per-user sending): ')).trim();
    store.add_user(user, pass, sf); console.log('Added/updated user: ' + user); rl.close(); return;
  }
  console.log('usage: node src/admin.js add [user] | passwd <user> | list | remove <user>');
}
main();
