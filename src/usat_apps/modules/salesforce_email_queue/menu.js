#!/usr/bin/env node
'use strict';
/**
 * menu.js — salesforce_email_queue module operations (folded into the usat_apps platform).
 *
 *   node src/usat_apps/modules/salesforce_email_queue/menu.js
 *
 * The Email Queue UI + API are served by the platform (:8022) — read-only (no Salesforce writes), no
 * worker. This CLI menu is rendered FROM the same allow-list the admin → Operations web panel uses
 * (admin/console_registry.js), so the two surfaces stay ALIGNED by construction. It adds a platform-only
 * cutover section + a STATUS & OPEN section. Metrics "AI ask" items prompt for their params, then run via
 * the shared arg-assembler (console_runner.assemble_argv) — the exact one the web panel uses.
 *
 * DATA-ONLY shell: rendering, numbering (by position), the CLI toggle, spawn, HTTP status, and quit
 * handling come from the shared kit. Param-forms use the kit's run() escape hatch so behavior is identical.
 * See utilities/menu/menu_kit.js + plans_and_notes/MENU_CONVENTIONS.md.
 */
const path = require('path');
const { runMenu, c, COLORS } = require('../../../../utilities/menu/menu_kit');
const registry = require('./admin/console_registry');   // the shared Operations allow-list (source of truth)
const runner = require('./admin/console_runner');        // reuse the exact arg-assembler the web panel uses

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PLATFORM_PORT = 8022;
const PROXY_PORT = 8000;

// Prompt each param, assemble the argv with the shared runner, then spawn — the run() escape hatch that
// reproduces the old run_form + web:'form' path exactly, but on the kit's readline/spawn lifecycle.
async function run_form_exec(ctx, it) {
  const params = {};
  for (const p of (it.params || [])) {
    const def = p.default != null ? String(p.default) : '';
    const ans = (await ctx.ask(c(COLORS.BOLD, `  ${p.label || p.name}${def ? ` [${def}]` : ''}${p.required ? ' *' : ''}: `))).trim();
    params[p.name] = ans || def;
  }
  const built = runner.assemble_argv(it, params);
  console.log('');
  if (!built.ok) { console.log(c(COLORS.RED, '  ' + (built.error || 'bad params'))); return; }
  await ctx.runCmd(it.bin, built.argv, it.label);
}

// Command sections come straight from the Operations allow-list (aligned with /admin → Operations), then a
// platform-only cutover + STATUS & OPEN section. Items are CLONED so the kit's by-position numbering never
// mutates the shared registry objects. Param-form items get a run() handler; the rest stay declarative.
const CMD_SECTIONS = registry.SECTIONS.map((s) => ({
  label: s.label,
  color: String(s.color || 'CYAN').toUpperCase(),
  items: s.items.map((it) => {
    const clone = Object.assign({}, it);
    delete clone.id;   // the kit numbers by position — never carry the registry's id
    if (clone.params) clone.run = (ctx) => run_form_exec(ctx, clone);
    return clone;
  }),
}));

const PULL = 'src/usat_apps/knowledge_sync/pull_corrections.js';
const PULLC = 'src/usat_apps/knowledge_sync/pull_content.js';
const PULLU = 'src/usat_apps/knowledge_sync/pull_urls.js';
const CUTOVER_SECTION = { label: 'Pull from prod → dev (corrections + content + URLs)', color: 'YELLOW', items: [
  { label: 'Pull corrections from prod', desc: 'From DEV: SSH to prod, export corrections, copy back, import here (idempotent). Needs PROD_SSH in .env.', bin: 'node', argv: [PULL], cli: 'node ' + PULL },
  { label: 'Pull content files from prod', desc: 'From DEV: copy prod\'s context/knowledge tree into this machine\'s data dir (additive/overwrite). Needs PROD_SSH in .env.', bin: 'node', argv: [PULLC], cli: 'node ' + PULLC },
  { label: 'Pull knowledge URLs from prod', desc: 'From DEV: SSH to prod, export knowledge_sources + knowledge_chunks, copy back, import here (exact parity - upserts sources, replaces chunks). Needs PROD_SSH in .env.', bin: 'node', argv: [PULLU], cli: 'node ' + PULLU },
] };
const STATUS_SECTION = { label: 'Status & open (platform)', color: 'GREEN', items: [
  { label: 'Platform status (:8022)', desc: 'GET :8022/api/status — usat_apps health (the module mounts here)', status: PLATFORM_PORT, statusLabel: 'platform', cli: 'curl http://localhost:8022/api/status' },
  { label: 'Open Email Queue (:8022)', desc: 'The operator page on the platform', open: `http://localhost:${PLATFORM_PORT}/salesforce/email-queue`, cli: `open http://localhost:${PLATFORM_PORT}/salesforce/email-queue` },
  { label: 'Open via proxy (:8000)', desc: 'The operator page through the :8000 proxy', open: `http://localhost:${PROXY_PORT}/salesforce/email-queue`, cli: `open http://localhost:${PROXY_PORT}/salesforce/email-queue` },
] };

const SECTIONS = CMD_SECTIONS.concat([CUTOVER_SECTION, STATUS_SECTION]);
const ALL = SECTIONS.flatMap((s) => s.items);

if (require.main === module) {
  runMenu({
    title: 'USAT Apps · Email Queue',
    subtitle: 'Aligned with admin → Operations · ' + registry.ALL.length + ' commands + cutover + status/open.',
    color: 'CYAN',
    sections: SECTIONS,
    cwd: REPO_ROOT,
    prefsFile: path.join(__dirname, '.menu_prefs.json'),
    back: true,
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SECTIONS, ALL };
