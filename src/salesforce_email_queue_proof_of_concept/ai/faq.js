'use strict';
// Knowledge / FAQ + user-context loader (tier 4 grounding).
//  - load_faq(queue): markdown FAQ from data/faq/_global.md + data/faq/<slug>.md (sync).
//  - load_context_files(queue): ANY files a user drops in data/context/_global/ and
//    data/context/<slug>/ - md, txt, csv, html natively; pdf, docx, xlsx, xls via optional parsers.
//  - load_knowledge(queue): faq + extracted context-file text, capped, for the AI grounding.
// Context folder override via EQ_CONTEXT_DIR (tests). Reuses ai/extract for binary formats.
const fs = require('fs');
const path = require('path');
const extract = require('./extract');

const FAQ_DIR = path.join(__dirname, '..', 'data', 'faq');
const CONTEXT_DIR = process.env.EQ_CONTEXT_DIR || path.join(__dirname, '..', 'data', 'context');
const DEFAULT_CAP = 20000; // max chars of context-file text fed to the model per request

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function read(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { return ''; } }

function load_faq(queue_name) {
  const parts = [];
  const g = read(path.join(FAQ_DIR, '_global.md')); if (g) parts.push(g);
  const q = read(path.join(FAQ_DIR, slug(queue_name) + '.md')); if (q) parts.push(q);
  return parts.join('\n\n');
}

function context_dirs(queue_name) {
  const dirs = [path.join(CONTEXT_DIR, '_global')];
  const sl = slug(queue_name); if (sl) dirs.push(path.join(CONTEXT_DIR, sl));
  return dirs;
}

// Read + extract text from every file in the global + per-queue context folders (capped).
async function load_context_files(queue_name, opts) {
  const o = opts || {}; const cap = o.cap || DEFAULT_CAP;
  const out = []; let total = 0;
  const dirs = context_dirs(queue_name);
  for (let d = 0; d < dirs.length; d++) {
    let names = []; try { names = fs.readdirSync(dirs[d]); } catch (e) { continue; }
    names.sort();
    for (let i = 0; i < names.length; i++) {
      const fn = names[i];
      const low = fn.toLowerCase();
      if (fn.charAt(0) === '.' || low === 'readme.md' || low === 'readme.txt') continue;
      const fp = path.join(dirs[d], fn);
      let st; try { st = fs.statSync(fp); } catch (e) { continue; }
      if (!st.isFile()) continue;
      const ext = (fn.split('.').pop() || '').toLowerCase();
      let text = '';
      try { const buf = fs.readFileSync(fp); const r = await extract.extract_text(buf, { file_extension: ext, title: fn, content_size: st.size }); text = (r && r.text) || ''; }
      catch (e) { text = ''; }
      if (!text) continue;
      if (total + text.length > cap) text = text.slice(0, Math.max(0, cap - total));
      if (!text) break;
      out.push({ name: fn, text: text });
      total += text.length;
      if (total >= cap) return out;
    }
  }
  return out;
}

// Combined grounding: FAQ markdown + user context files (this is passed to the AI as the FAQ tier).
async function load_knowledge(queue_name, opts) {
  const parts = [];
  const faqStr = load_faq(queue_name); if (faqStr) parts.push(faqStr);
  const files = await load_context_files(queue_name, opts);
  if (files.length) {
    parts.push('=== CONTEXT FILES (user-provided) ===');
    files.forEach(function (f) { parts.push('-- ' + f.name + ' --\n' + f.text); });
  }
  return parts.join('\n\n');
}

const ALLOWED_EXT = ['md', 'txt', 'csv', 'tsv', 'html', 'htm', 'json', 'pdf', 'docx', 'xlsx', 'xls'];
function safe_name(n) { return (String(n || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120)) || 'file'; }

// Lightweight listing (no extraction) for the UI: [{ name, size, scope, ext }].
function list_context_meta(queue_name) {
  const out = []; const dirs = context_dirs(queue_name); const labels = ['global', 'queue'];
  dirs.forEach(function (dir, idx) {
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.sort().forEach(function (fn) {
      const low = fn.toLowerCase();
      if (fn.charAt(0) === '.' || low === 'readme.md' || low === 'readme.txt') return;
      let st; try { st = fs.statSync(path.join(dir, fn)); } catch (e) { return; }
      if (!st.isFile()) return;
      out.push({ name: fn, size: st.size, scope: labels[idx], ext: (fn.split('.').pop() || '').toLowerCase() });
    });
  });
  return out;
}
// Save an uploaded context file. scope: 'global'|'queue'. Returns { name, scope }.
function save_context_file(scope, queue_name, name, buffer) {
  const dir = (scope === 'queue' && slug(queue_name)) ? path.join(CONTEXT_DIR, slug(queue_name)) : path.join(CONTEXT_DIR, '_global');
  const fn = safe_name(name);
  const ext = (fn.split('.').pop() || '').toLowerCase();
  if (ALLOWED_EXT.indexOf(ext) < 0) throw new Error('Unsupported file type: .' + ext);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fn), buffer);
  return { name: fn, scope: (scope === 'queue' ? 'queue' : 'global') };
}

module.exports = { load_faq, load_context_files, load_knowledge, slug, CONTEXT_DIR, FAQ_DIR, ALLOWED_EXT, list_context_meta, save_context_file };
