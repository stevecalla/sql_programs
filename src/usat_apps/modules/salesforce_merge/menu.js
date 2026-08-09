#!/usr/bin/env node
'use strict';
/**
 * menu.js — salesforce_merge module operations (folded into the usat_apps platform).
 *
 *   node src/usat_apps/modules/salesforce_merge/menu.js
 *
 * The merge UI + API are served by the platform (:8022). The heavy Salesforce writes run in an ISOLATED
 * worker process (server_salesforce_merge_worker_8021.js, port 8021) that claims queued jobs from
 * salesforce_merge_run and executes them — so one bad merge can't take the platform down. This menu
 * drives that worker (start / stop / logs / cluster), the DB migrations, and quick status / opens.
 *
 * DATA-ONLY: rendering, numbering (by position), the CLI toggle, spawn, HTTP status, and quit handling
 * all come from the shared kit. See utilities/menu/menu_kit.js + plans_and_notes/MENU_CONVENTIONS.md.
 */
const path = require('path');
const { runMenu, c, COLORS } = require('../../../../utilities/menu/menu_kit');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WORKER_PORT = 8021;
const PLATFORM_PORT = 8022;

const M = 'src/usat_apps/modules/salesforce_merge';   // script path prefix (cwd = repo root)
const PULL_HELP = c(COLORS.CYAN, '  Pull a dossier .xlsx out of MySQL\n') +
  '    list:  SELECT id, action, survivor_name, filename, byte_size, created_at_mtn\n' +
  '           FROM salesforce_merge_dossier ORDER BY id DESC;\n' +
  '    node:  menu item “Extract a dossier → Downloads” (interactive), or\n' +
  `           node ${M}/extract_dossier.js <id>\n` +
  '    app:   GET /api/salesforce-merge/merge/dossier/<id>/download   (the History 📎 link)\n' +
  c(COLORS.YELLOW, '    Files land in <home>/Downloads. Do NOT use the mysql CLI “>” redirect on Windows —\n') +
  c(COLORS.YELLOW, '    it corrupts the .xlsx; the node/app paths are byte-exact.');
const VIEW_SF_HELP = c(COLORS.CYAN, '  Find / download the dossier File in Salesforce (Dev Console / Workbench)\n') +
  "    by record:  SELECT ContentDocument.Title, ContentDocument.LatestPublishedVersionId, LinkedEntityId\n" +
  "                FROM ContentDocumentLink WHERE LinkedEntityId = '<survivor_or_loser_id>'\n" +
  "    by name:    SELECT Id, Title, FileExtension, ContentSize, CreatedDate\n" +
  "                FROM ContentVersion WHERE Title = '<filename>' ORDER BY CreatedDate DESC\n" +
  "    bytes:      SELECT VersionData FROM ContentVersion WHERE Id = '<ContentVersionId>'\n" +
  '    In the UI:  the survivor account → Files (after a restore/recreate, every affected record).';

const SECTIONS = [
  { label: 'WORKER · production (pm2)', color: 'RED', items: [
    { label: 'pm2 start worker', desc: 'Start the isolated write worker on :8021 (autorestart on)', bin: 'npm', args: ['run', 'pm2_start_salesforce_merge_worker'], cli: 'npm run pm2_start_salesforce_merge_worker' },
    { label: 'pm2 start worker CLUSTER (x2)', desc: 'Two worker instances sharing the queue (pm2 -i 2) — parallel merges', bin: 'npm', args: ['run', 'pm2_start_salesforce_merge_worker_cluster'], cli: 'npm run pm2_start_salesforce_merge_worker_cluster' },
    { label: 'pm2 restart worker', desc: 'Restart the worker pm2 process', bin: 'npm', args: ['run', 'restart_salesforce_merge_worker'], cli: 'npm run restart_salesforce_merge_worker' },
    { label: 'pm2 stop worker', desc: 'Stop the worker (queued jobs stay queued until it returns)', bin: 'npm', args: ['run', 'stop_salesforce_merge_worker'], cli: 'npm run stop_salesforce_merge_worker' },
    { label: 'pm2 logs worker', desc: 'Tail the worker pm2 logs', bin: 'npm', args: ['run', 'pm2_logs_salesforce_merge_worker'], cli: 'npm run pm2_logs_salesforce_merge_worker' },
  ] },
  { label: 'WORKER · dev', color: 'YELLOW', items: [
    { label: 'Run worker (foreground)', desc: 'node server_salesforce_merge_worker_8021.js — Ctrl-C to stop', bin: 'npm', args: ['run', 'salesforce_merge_worker'], cli: 'npm run salesforce_merge_worker' },
    { label: 'Dev worker (nodemon)', desc: 'Auto-restarts on changes to the worker + merge store', bin: 'npm', args: ['run', 'salesforce_merge_worker_dev'], cli: 'npm run salesforce_merge_worker_dev' },
  ] },
  // Merge test runners now live on the main platform menu (node src/usat_apps/menu.js -> TESTS).
  { label: 'DATABASE (idempotent migrations)', color: 'GREEN', items: [
    { label: 'Migrate: created_at_mtn / created_at_utc', desc: 'Add the MTN/UTC timestamp columns to the four merge tables (also auto-applied on boot).', bin: 'node', args: ['src/queries/create_drop_db_table/alter_salesforce_merge_timestamps.js'], cli: 'node src/queries/create_drop_db_table/alter_salesforce_merge_timestamps.js' },
    { label: 'Migrate: Phase-3 worker columns', desc: 'Ensure claimed_by / claimed_at / cancel_requested / params / result on salesforce_merge_run.', bin: 'node', args: ['src/queries/create_drop_db_table/alter_salesforce_merge_run_phase3.js'], cli: 'node src/queries/create_drop_db_table/alter_salesforce_merge_run_phase3.js' },
    { label: 'Migrate: Phase-1 job columns (parallel)', desc: 'Ensure job_id / batch_index / batch_total on salesforce_merge_run + normalize column order (created_at_* last). Also auto-applied on :8022 boot.', bin: 'node', args: ['src/queries/create_drop_db_table/alter_salesforce_merge_run_jobs.js'], cli: 'node src/queries/create_drop_db_table/alter_salesforce_merge_run_jobs.js' },
    { label: 'Create: settings table (live tuning)', desc: 'Create salesforce_merge_settings (parallel/chunk/max_batch/worker_target/apex cap — DB-backed, admin-tunable). Also auto-applied on :8022 boot.', bin: 'node', args: ['src/queries/create_drop_db_table/create_salesforce_merge_settings.js'], cli: 'node src/queries/create_drop_db_table/create_salesforce_merge_settings.js' },
  ] },
  { label: 'STATUS & OPEN', color: 'GREEN', items: [
    { label: 'Worker status (:8021)', desc: 'GET :8021/api/status — is the worker online? (the "no worker online" banner uses this)', status: WORKER_PORT, statusLabel: 'worker', cli: 'curl http://localhost:8021/api/status' },
    { label: 'Platform status (:8022)', desc: 'GET :8022/api/status — usat_apps health (public)', status: PLATFORM_PORT, statusLabel: 'platform', cli: 'curl http://localhost:8022/api/status' },
    { label: 'Open merge in the platform', desc: 'usat_apps at :8022 — the Salesforce merge page', open: `http://localhost:${PLATFORM_PORT}/salesforce/merge`, cli: `open http://localhost:${PLATFORM_PORT}/salesforce/merge` },
    { label: 'Open via proxy (:8000)', desc: 'The merge page through the :8000 proxy', open: 'http://localhost:8000/salesforce/merge', cli: 'open http://localhost:8000/salesforce/merge' },
  ] },
  { label: 'SALESFORCE AUTH · connection', color: 'GREEN', items: [
    { label: 'SF auth — Sandbox · Auto', desc: 'Normal path — tries OAuth (External Client App), falls back to SOAP; reports which one connected.', bin: 'node', args: [`${M}/check_sf_auth.js`], cli: `node ${M}/check_sf_auth.js` },
    { label: 'SF auth — Production · Auto', desc: 'Normal path — tries OAuth (External Client App), falls back to SOAP; reports which one connected.', bin: 'node', args: [`${M}/check_sf_auth.js`, '--prod'], cli: `node ${M}/check_sf_auth.js --prod` },
    { label: 'SF auth — Sandbox · OAuth', desc: 'OAuth only (no fallback) — confirms the new auth is working.', bin: 'node', args: [`${M}/check_sf_auth.js`, '--oauth'], cli: `node ${M}/check_sf_auth.js --oauth` },
    { label: 'SF auth — Production · OAuth', desc: 'OAuth only (no fallback) — confirms the new auth is working.', bin: 'node', args: [`${M}/check_sf_auth.js`, '--prod', '--oauth'], cli: `node ${M}/check_sf_auth.js --prod --oauth` },
    { label: 'SF auth — Sandbox · SOAP', desc: 'SOAP only (the method retiring Summer 2027) — confirms it still works / flags when it goes offline.', bin: 'node', args: [`${M}/check_sf_auth.js`, '--soap'], cli: `node ${M}/check_sf_auth.js --soap` },
    { label: 'SF auth — Production · SOAP', desc: 'SOAP only (the method retiring Summer 2027) — confirms it still works / flags when it goes offline.', bin: 'node', args: [`${M}/check_sf_auth.js`, '--prod', '--soap'], cli: `node ${M}/check_sf_auth.js --prod --soap` },
  ] },
  { label: 'DOSSIER · files & data', color: 'CYAN', items: [
    { label: 'Check Files permission (sandbox)', desc: 'Does the SF write user identity + can it create Files (ContentVersion / ContentDocumentLink)?', bin: 'node', args: [`${M}/check_dossier_access.js`], cli: `node ${M}/check_dossier_access.js` },
    { label: 'Check Files permission (PROD, live)', desc: 'Production check that actually creates + deletes a throwaway File to prove the write path', bin: 'node', args: [`${M}/check_dossier_access.js`, '--prod', '--live'], cli: `node ${M}/check_dossier_access.js --prod --live` },
    { label: 'Extract a dossier → Downloads', desc: 'List recent dossiers, pick an id, write the .xlsx to <home>/Downloads (byte-exact)', bin: 'node', args: [`${M}/extract_dossier.js`], cli: `node ${M}/extract_dossier.js` },
    { label: 'Pull a dossier from SQL — how', desc: 'Print the SELECT / node / app-endpoint ways to get the .xlsx out of MySQL', info: PULL_HELP },
    { label: 'View a dossier in Salesforce (SOQL)', desc: 'Print the SOQL to find / download the attached File (by record or by name)', info: VIEW_SF_HELP },
    { label: 'Repair loser file shares', desc: 'Re-link a restored loser’s Files that stayed on the survivor. Shows usage; run with --queue <id> (add --apply to write).', bin: 'node', args: [`${M}/repair_file_shares.js`], cli: `node ${M}/repair_file_shares.js --queue <id> [--apply]` },
  ] },
  { label: 'RESET · testing (destructive)', color: 'RED', items: [
    { label: 'Reset merge tables — DRY RUN', desc: 'Show row counts for the 7 merge tool tables; changes nothing', bin: 'node', args: [`${M}/reset_merge_tables.js`], cli: `node ${M}/reset_merge_tables.js` },
    { label: 'Reset merge tables — APPLY', desc: 'CLEARS the 7 merge tool tables (queue/snapshots/history/run/dossier); leaves the finder input', bin: 'node', args: [`${M}/reset_merge_tables.js`, '--apply'], cli: `node ${M}/reset_merge_tables.js --apply` },
  ] },
  { label: 'STRESS TEST · sandbox', color: 'CYAN', items: [
    { label: 'Show cluster-size distribution', desc: 'Histogram of duplicate cluster sizes for the loaded dataset (default sandbox; add --env production). Shows the dataset stamp + lets you pick a representative min/max size band', bin: 'node', args: [`${M}/stress_test.js`, 'distribution'], cli: `node ${M}/stress_test.js distribution` },
    { label: 'Clear run tables (stress)', desc: 'Empty the merge queue/history/snapshot/run/dossier tables for a clean run (finder input untouched). Type CLEAR to confirm', bin: 'node', args: [`${M}/stress_test.js`, 'clear'], cli: `node ${M}/stress_test.js clear` },
    { label: 'Run merges (select → queue → approve → process)', desc: 'Interactive: env, source, count, batch, size band, seed; simulate by default (type MERGE + --execute for real writes). Report to /data', bin: 'node', args: [`${M}/stress_test.js`, 'run'], cli: `node ${M}/stress_test.js run` },
    { label: 'Run merges — PARALLEL (worker cluster)', desc: 'Same as Run merges but enqueues ALL batches at once so 2 workers (start the cluster first) drain them side by side — to test the cluster. Shows workers-active + finishes ~2x faster.', bin: 'node', args: [`${M}/stress_test.js`, 'parallel'], cli: `node ${M}/stress_test.js parallel` },
    { label: 'Run merges — JOB FAN-OUT (Phase 1 test)', desc: 'Drives the REAL /merge/process fan-out: splits the approved sets with the same chunker + settings the endpoint uses into N chunk-runs sharing a job_id, then polls job_progress (batches/sets/workers). Needs the cluster. Set chunk < count to see the fan-out.', bin: 'node', args: [`${M}/stress_test.js`, 'job'], cli: `node ${M}/stress_test.js job` },
    { label: 'Restore last merged sets (stress)', desc: 'Undo the currently-restorable (recently-merged) sets from the CLI + write a restore report. Type RESTORE to confirm', bin: 'node', args: [`${M}/stress_test.js`, 'restore'], cli: `node ${M}/stress_test.js restore` },
    { label: 'Full sequence (clear → merge → restore)', desc: 'Runs the whole sequence into one workbook — prompts the options once', bin: 'node', args: [`${M}/stress_test.js`, 'sequence'], cli: `node ${M}/stress_test.js sequence` },
    { label: 'Open stress report folder', desc: 'Open the /data folder where the stress-test Excel reports are written', bin: 'node', args: [`${M}/stress_test.js`, 'open'], cli: `node ${M}/stress_test.js open` },
  ] },
  { label: 'DIAGNOSTICS · data safety (read-only)', color: 'CYAN', items: [
    { label: 'Probe donor/gift attachment (sandbox)', desc: 'Read-only check: is a "Donor Gift Summary" a master-detail child (cascade-deleted by a merge → data-loss risk) or a lookup (SF re-parents, low risk)? Also flags if the integrated user can\'t see the object. Finds a foundation/donor duplicate to test.', bin: 'node', args: [`${M}/probe_donor_gift.js`], cli: `node ${M}/probe_donor_gift.js` },
    { label: 'Probe donor/gift attachment (PRODUCTION)', desc: 'Same read-only probe against production (DESCRIBE + SELECT only, never writes).', bin: 'node', args: [`${M}/probe_donor_gift.js`, '--prod'], cli: `node ${M}/probe_donor_gift.js --prod` },
  ] },
];
const ALL = SECTIONS.flatMap((s) => s.items);

if (require.main === module) {
  runMenu({
    title: 'USAT Apps · Salesforce merge',
    color: 'CYAN',
    sections: SECTIONS,
    cwd: REPO_ROOT,
    prefsFile: path.join(__dirname, '.menu_prefs.json'),
    back: true,
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { SECTIONS, ALL };
