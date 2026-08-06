'use strict';
/**
 * data_dir.js — cross-platform home for the SHARED knowledge/brain runtime data (used by the email queue
 * AND the AI Chat Bot). Renamed usat_email_queue -> usat_knowledge (shared-brain plan, item 4); a
 * prefer-existing fallback keeps the old folder working until a one-time `mv` per host.
 *
 * Mirrors src/race_results_transform/src/data_dir.js: resolve the platform/user base with
 * utilities/determineOSPath() and create a project subfolder under it -> <base>/usat_knowledge/...
 * That base is usat/data/ on linux/mac, so data lives OUTSIDE the sql_programs repo and member
 * data (uploaded context, future corrections/history) is never committed.
 *
 *   <determineOSPath()>/usat_knowledge/   (falls back to usat_email_queue if that folder still exists)
 *     context/        user-provided knowledge the AI reads (_global + <queue_slug>)
 *     auth.json       local user store
 *     corrections.json operator corrections
 *     queue_access.json queue allow-list (general + per-user)
 *     config.json     non-secret app config (context_dir override, exclusions)
 *
 * Created automatically (mkdir recursive) on first use. Async, because determineOSPath() is async.
 * Overrides: KNOWLEDGE_DATA_DIR (project root) and KNOWLEDGE_CONTEXT_DIR (just the context folder).
 *   The older EQ_DATA_DIR / EQ_CONTEXT_DIR names remain valid as fallbacks (shared-brain plan, item 2).
 */
const path = require('path');
const fs = require('fs');
const { determineOSPath, determineOSPathSync } = require('../../../../utilities/determineOSPath');

// Env overrides — KNOWLEDGE_* are the current names; EQ_* remain valid as aliases so nothing breaks.
function env_data_dir() { return process.env.KNOWLEDGE_DATA_DIR || process.env.EQ_DATA_DIR || ''; }
function env_context_dir() { return process.env.KNOWLEDGE_CONTEXT_DIR || process.env.EQ_CONTEXT_DIR || ''; }

// The shared data folder was renamed usat_email_queue -> usat_knowledge (item 4). Prefer the new name; if it
// doesn't exist yet but the old one does, keep using the old one until a one-time `mv` is done on that host
// (avoids split-brain between new writes and old reads). New installs get the new name.
const NEW_DIR = 'usat_knowledge';
const OLD_DIR = 'usat_email_queue';
function resolve_base(root) {
  const nw = path.join(root, NEW_DIR);
  if (fs.existsSync(nw)) return nw;
  const old = path.join(root, OLD_DIR);
  if (fs.existsSync(old)) return old;
  return nw;   // neither exists yet -> create the new one
}

async function base() {
  const ed = env_data_dir();
  if (ed) return ed;
  return resolve_base(await determineOSPath());
}
async function ensure(sub) {
  const d = sub ? path.join(await base(), sub) : await base();
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function config_path() { return path.join(base_sync(), 'config.json'); }
function read_config() { try { return JSON.parse(fs.readFileSync(config_path(), 'utf8')) || {}; } catch (e) { return {}; } }
function write_config(obj) { const p = base_sync(); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(config_path(), JSON.stringify(obj || {}, null, 2) + '\n'); return obj || {}; }
// Context root resolution order: KNOWLEDGE_CONTEXT_DIR/EQ_CONTEXT_DIR env > saved config.context_dir (UI) > default.
async function context() {
  const ec = env_context_dir();
  if (ec) { try { fs.mkdirSync(ec, { recursive: true }); return ec; } catch (e) { /* fall back */ } }
  const cfg = read_config();
  if (cfg && cfg.context_dir) { try { fs.mkdirSync(cfg.context_dir, { recursive: true }); return cfg.context_dir; } catch (e) { /* bad override -> fall back to default */ } }
  return ensure('context');
}

// Sync resolver (no mkdir) for modules that compute a file path at load time (auth/corrections).
// The writers mkdir the dirname before writing, so we don't touch the filesystem here.
function base_sync() {
  const ed = env_data_dir();
  if (ed) return ed;
  return resolve_base(determineOSPathSync());
}
function file_sync(name) { return path.join(base_sync(), name); }

module.exports = { base: base, ensure: ensure, context: context, base_sync: base_sync, file_sync: file_sync, read_config: read_config, write_config: write_config };
