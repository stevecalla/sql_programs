'use strict';
// Smoke test for Salesforce auth through the shared helper. By default it uses the normal path
// (OAuth External Client App, falling back to SOAP login). Flags test ONE method in isolation —
// handy to (a) prove the new External Client App works, and (b) watch the SOAP login(), which
// Salesforce retires in Summer '27, so you know the moment it goes offline. Read-only (a LIMIT 1 query).
//
//   node src/usat_apps/modules/salesforce_merge/check_sf_auth.js            # sandbox · auto (OAuth -> fallback)
//   node src/usat_apps/modules/salesforce_merge/check_sf_auth.js --prod     # production · auto
//   node ... check_sf_auth.js --oauth      # OAuth (External Client App) ONLY — no fallback
//   node ... check_sf_auth.js --soap       # SOAP ONLY — the retiring method ('--legacy' also accepted)
//   ...combine --oauth / --soap with --prod for production.
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }
const { connect_salesforce, COLORS } = require('../../../../utilities/salesforce/salesforceConnect');
const paint = (color, text) => `${COLORS[color] || ''}${text}${COLORS.reset}`;

async function main() {
  const argv = process.argv.slice(2);
  const is_test = !argv.includes('--prod');
  const mode = argv.includes('--oauth') ? 'oauth'
    : (argv.includes('--soap') || argv.includes('--legacy')) ? 'soap'
    : (process.env.SF_AUTH_MODE || 'auto');
  const env_label = is_test ? 'SANDBOX' : 'PRODUCTION';
  const mode_label = mode === 'oauth' ? 'OAuth only (External Client App)'
    : mode === 'soap' ? 'SOAP only (retires Summer 2027)'
    : 'Auto (OAuth → fall back to SOAP)';
  console.log(`\nSalesforce auth smoke test — ${env_label} — requested: ${mode_label}`);

  // Force the mode for THIS run only, without disturbing the ambient process env.
  const env = { ...process.env, SF_AUTH_MODE: mode };
  const { conn, mode: used, org_id } = await connect_salesforce({ is_test, env });
  const r = await conn.query('SELECT Id, Name FROM Account LIMIT 1');

  // Loud, unmistakable statement of the method that ACTUALLY connected (OAuth = green, SOAP = cyan) —
  // this is the source of truth; the menu's completion line only echoes the requested mode.
  const used_label = used === 'oauth' ? 'OAuth' : 'SOAP';
  const color = used === 'oauth' ? 'green' : 'cyan';
  const note = mode !== 'auto' ? ''
    : used === 'oauth' ? '  (OAuth worked — no fallback needed)'
    : '  (OAuth failed → fell back to SOAP)';
  console.log('\n' + paint(color, `★ AUTH METHOD USED: ${used_label}`) + paint('dim', note));
  console.log(`  ${env_label.toLowerCase()} · org ${org_id || '(unknown)'} · query returned ${r.totalSize} row(s).`);
  if (r.records && r.records[0]) console.log(`  sample: ${r.records[0].Id} — ${r.records[0].Name || '(no name)'}`);
  console.log('');
  process.exit(0);
}
main().catch((e) => { console.error('\n' + paint('red', '✖ FAILED: ' + e.message) + '\n'); process.exit(1); });
