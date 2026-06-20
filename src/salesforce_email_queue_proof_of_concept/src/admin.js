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
  if (cmd === 'remove') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const users = store.list_users();
    if (!users.length) { console.log('(no users to remove)'); rl.close(); return; }
    let user = a1;
    if (!user) {
      console.log('Users:');
      users.forEach(function (u, i) { console.log('  ' + (i + 1) + ') ' + u.user + (u.sf_email ? '  <' + u.sf_email + '>' : '')); });
      const sel = (await ask(rl, 'Pick a number (or type a username) to remove: ')).trim();
      const idx = parseInt(sel, 10);
      user = (idx >= 1 && idx <= users.length) ? users[idx - 1].user : sel;
    }
    if (!users.some(function (u) { return u.user === user; })) { console.log('No such user: ' + user); rl.close(); return; }
    const yn = (await ask(rl, 'Remove "' + user + '"? (y/N): ')).trim().toLowerCase();
    if (yn === 'y' || yn === 'yes') console.log(store.remove_user(user) ? 'Removed: ' + user : 'No such user: ' + user);
    else console.log('Cancelled.');
    rl.close(); return;
  }
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
