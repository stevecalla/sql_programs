'use strict';
/**
 * data_dir.js — cross-platform home for the email-queue assistant's runtime data.
 *
 * Mirrors src/race_results_transform/src/data_dir.js: resolve the platform/user base with
 * utilities/determineOSPath() and create a project subfolder under it -> <base>/usat_email_queue/...
 * That base is usat/data/ on linux/mac, so data lives OUTSIDE the sql_programs repo and member
 * data (uploaded context, future corrections/history) is never committed.
 *
 *   <determineOSPath()>/email_queue/
 *     context/   user-provided knowledge the AI reads (_global + <queue_slug>)
 *
 * Created automatically (mkdir recursive) on first use. Async, because determineOSPath() is async.
 * Overrides: EQ_DATA_DIR (project root) and EQ_CONTEXT_DIR (just the context folder).
 */
const path = require('path');
const fs = require('fs');
const { determineOSPath, determineOSPathSync } = require('../../utilities/determineOSPath');

async function base() {
  if (process.env.EQ_DATA_DIR) return process.env.EQ_DATA_DIR;
  const root = await determineOSPath();            // e.g. .../usat/data/
  return path.join(root, 'usat_email_queue');
}
async function ensure(sub) {
  const d = sub ? path.join(await base(), sub) : await base();
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function config_path() { return path.join(base_sync(), 'config.json'); }
function read_config() { try { return JSON.parse(fs.readFileSync(config_path(), 'utf8')) || {}; } catch (e) { return {}; } }
function write_config(obj) { const p = base_sync(); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(config_path(), JSON.stringify(obj || {}, null, 2) + '\n'); return obj || {}; }
// Context root resolution order: EQ_CONTEXT_DIR env > saved config.context_dir (set in the UI) > default.
async function context() {
  if (process.env.EQ_CONTEXT_DIR) { try { fs.mkdirSync(process.env.EQ_CONTEXT_DIR, { recursive: true }); return process.env.EQ_CONTEXT_DIR; } catch (e) { /* fall back */ } }
  const cfg = read_config();
  if (cfg && cfg.context_dir) { try { fs.mkdirSync(cfg.context_dir, { recursive: true }); return cfg.context_dir; } catch (e) { /* bad override -> fall back to default */ } }
  return ensure('context');
}

// Sync resolver (no mkdir) for modules that compute a file path at load time (auth/corrections).
// The writers mkdir the dirname before writing, so we don't touch the filesystem here.
function base_sync() {
  if (process.env.EQ_DATA_DIR) return process.env.EQ_DATA_DIR;
  return path.join(determineOSPathSync(), 'usat_email_queue');
}
function file_sync(name) { return path.join(base_sync(), name); }

module.exports = { base: base, ensure: ensure, context: context, base_sync: base_sync, file_sync: file_sync, read_config: read_config, write_config: write_config };
