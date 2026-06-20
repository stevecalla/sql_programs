'use strict';
// Knowledge loader (tier-4 grounding). Knowledge = files in the CONTEXT folder(s), read recursively:
//   <base>/usat_email_queue/context/_global/**      applied to EVERY queue
//   <base>/usat_email_queue/context/<queue_slug>/** applied to that queue only
// A "folder" added from the UI is stored as a named subfolder, so it can be excluded as a group.
// Files can be EXCLUDED from grounding (by file key OR folder key) without deleting them from disk.
// Text (md/txt/csv/html/json...) is extracted; pdf/docx/xlsx via optional parsers; png/jpeg/gif/webp
// go to the vision model. Overrides: EQ_CONTEXT_DIR / EQ_DATA_DIR.
const fs = require('fs');
const path = require('path');
const extract = require('./extract');
const data_dir = require('../data_dir');

const DEFAULT_CAP = 20000;

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
async function context_dir() { return data_dir.context(); }

// Scan roots for a queue: primary _global + <slug>. Returns [{dir, scope}].
async function scan_specs(queue_name) {
  const root = await context_dir();
  const sl = slug(queue_name);
  const specs = [{ dir: path.join(root, '_global'), scope: 'global' }];
  if (sl) specs.push({ dir: path.join(root, sl), scope: 'queue' });
  return specs;
}

// Recursively list files under a dir -> [{ rel, size, full }] (rel uses '/'; dotfiles skipped).
function walk_rel(dir) {
  const out = [];
  (function rec(d, prefix) {
    let names; try { names = fs.readdirSync(d); } catch (e) { return; }
    names.sort().forEach(function (fn) {
      if (fn.charAt(0) === '.') return;
      const full = path.join(d, fn);
      let st; try { st = fs.statSync(full); } catch (e) { return; }
      if (st.isDirectory()) rec(full, prefix ? prefix + '/' + fn : fn);
      else if (st.isFile()) out.push({ rel: prefix ? prefix + '/' + fn : fn, size: st.size, full: full });
    });
  })(dir, '');
  return out;
}

function is_meta_skip(base) { const low = base.toLowerCase(); return low === 'readme.md' || low === 'readme.txt'; }
function scope_prefix(scope, queue_name) { return scope === 'global' ? '_global' : (scope === 'queue' ? slug(queue_name) : String(scope)); }
function ctx_key(scope, queue_name, rel) { return scope_prefix(scope, queue_name) + '/' + rel; }
function excluded_set() { return new Set(data_dir.read_config().excluded_context || []); }
// A file is excluded if its key, or any ancestor folder key, is in the excluded set.
function is_excluded(exSet, key) {
  const parts = key.split('/'); let acc = '';
  for (let i = 0; i < parts.length; i++) { acc = acc ? acc + '/' + parts[i] : parts[i]; if (exSet.has(acc)) return true; }
  return false;
}

async function load_context_files(queue_name, opts) {
  const o = opts || {}; const cap = o.cap || DEFAULT_CAP;
  const out = []; let total = 0;
  const specs = await scan_specs(queue_name); const exSet = excluded_set();
  for (let d = 0; d < specs.length; d++) {
    const files = walk_rel(specs[d].dir);
    for (let i = 0; i < files.length; i++) {
      const base = path.basename(files[i].rel); if (is_meta_skip(base)) continue;
      if (is_excluded(exSet, ctx_key(specs[d].scope, queue_name, files[i].rel))) continue;
      const ext = (base.split('.').pop() || '').toLowerCase();
      let text = '';
      try { const buf = fs.readFileSync(files[i].full); const r = await extract.extract_text(buf, { file_extension: ext, title: base, content_size: files[i].size }); text = (r && r.text) || ''; }
      catch (e) { text = ''; }
      if (!text) continue;
      if (total + text.length > cap) text = text.slice(0, Math.max(0, cap - total));
      if (!text) break;
      out.push({ name: files[i].rel, text: text });
      total += text.length;
      if (total >= cap) return out;
    }
  }
  return out;
}

async function load_knowledge(queue_name, opts) {
  const files = await load_context_files(queue_name, opts);
  if (!files.length) return '';
  const parts = ['=== KNOWLEDGE / CONTEXT (operator-provided) ==='];
  files.forEach(function (f) { parts.push('-- ' + f.name + ' --\n' + f.text); });
  return parts.join('\n\n');
}

const ALLOWED_EXT = [
  'md', 'txt', 'csv', 'tsv', 'html', 'htm', 'json', 'xml', 'log', 'yaml', 'yml', 'rtf',
  'pdf', 'docx', 'xlsx', 'xls',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'svg'
];
function safe_name(n) { return (String(n || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120)) || 'file'; }

// Listing for the UI: each file gets a stable key + folder + excluded flag.
async function list_context_meta(queue_name) {
  const out = []; const specs = await scan_specs(queue_name); const exSet = excluded_set();
  specs.forEach(function (spec) {
    walk_rel(spec.dir).forEach(function (file) {
      const base = path.basename(file.rel); if (is_meta_skip(base)) return;
      const key = ctx_key(spec.scope, queue_name, file.rel);
      const folder = file.rel.indexOf('/') >= 0 ? file.rel.split('/')[0] : '';
      out.push({
        name: file.rel, base: base, size: file.size, scope: spec.scope,
        ext: (base.split('.').pop() || '').toLowerCase(),
        key: key, folder: folder,
        folder_key: folder ? ctx_key(spec.scope, queue_name, folder) : '',
        excluded: is_excluded(exSet, key)
      });
    });
  });
  return out;
}

// Save an uploaded file to the PRIMARY folder. scope: 'global'|'queue'; optional folder = named subfolder.
async function save_context_file(scope, queue_name, name, buffer, folder) {
  const fn = safe_name(name);
  const ext = (fn.split('.').pop() || '').toLowerCase();
  if (ALLOWED_EXT.indexOf(ext) < 0) throw new Error('Unsupported file type: .' + ext);
  const root = await context_dir();
  const base = (scope === 'queue' && slug(queue_name)) ? slug(queue_name) : '_global';
  const dir = folder ? path.join(root, base, safe_name(folder)) : path.join(root, base);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fn), buffer);
  return { name: fn, scope: (scope === 'queue' ? 'queue' : 'global'), folder: folder ? safe_name(folder) : '' };
}

const VISION_MEDIA = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
async function load_context_images(queue_name, opts) {
  const o = opts || {}; const maxN = o.max || 4; const maxBytes = o.max_bytes || 4 * 1024 * 1024;
  const out = []; const specs = await scan_specs(queue_name); const exSet = excluded_set();
  for (let d = 0; d < specs.length; d++) {
    const files = walk_rel(specs[d].dir);
    for (let i = 0; i < files.length; i++) {
      const base = path.basename(files[i].rel);
      const ext = (base.split('.').pop() || '').toLowerCase(); const media = VISION_MEDIA[ext]; if (!media) continue;
      if (is_excluded(exSet, ctx_key(specs[d].scope, queue_name, files[i].rel))) continue;
      if (files[i].size > maxBytes) continue;
      try { out.push({ name: files[i].rel, media_type: media, data_base64: fs.readFileSync(files[i].full).toString('base64') }); } catch (e) { continue; }
      if (out.length >= maxN) return out;
    }
  }
  return out;
}

const SAMPLE_CONTEXT = [
  '# USAT Email Queue - knowledge / context  (SAMPLE - edit or delete)',
  '',
  'This file lives in the assistant\'s CONTEXT folder. The AI reads every file in the context folders as',
  'grounding. Add real, vetted facts for your queues below; remove this sample when ready.',
  '',
  '## Operator',
  '- The operator name (the staff person signed in to this assistant) is: Skip.',
  '',
  '## Contacts',
  '- Membership questions: memberservices@usatriathlon.org',
  '- Coaching certification questions: coaching@usatriathlon.org',
  ''
].join('\n');
async function seed_sample_context() {
  try {
    const dir = path.join(await context_dir(), '_global');
    const fp = path.join(dir, 'knowledge_SAMPLE.md');
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, SAMPLE_CONTEXT);
    return { seeded: true, dir: dir };
  } catch (e) { return { seeded: false, error: (e && e.message) || String(e) }; }
}

// Exclude/include a file OR a folder (by key) from grounding WITHOUT deleting it (stored in config).
function set_context_excluded(key, excluded) {
  const cfg = data_dir.read_config();
  let arr = (cfg.excluded_context || []).filter(function (k) { return k !== String(key); });
  if (excluded) arr.push(String(key));
  cfg.excluded_context = arr; data_dir.write_config(cfg); return arr;
}

const PREVIEW_IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
// Minimal RFC-4180-ish delimited parser (quotes + embedded delimiters/newlines).
function parse_delimited(text, delim) {
  const rows = []; let row = [], field = '', i = 0, q = false; const s = String(text == null ? '' : text);
  while (i < s.length) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
    i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
// Resolve the absolute path of a context file (searching all scan folders).
async function find_context_path(queue_name, name) {
  const rel = String(name || '').split('/').map(safe_name).join('/');
  const specs = await scan_specs(queue_name);
  for (let i = 0; i < specs.length; i++) { const cand = path.join.apply(path, [specs[i].dir].concat(rel.split('/'))); try { if (fs.statSync(cand).isFile()) return cand; } catch (e) { /* keep looking */ } }
  throw new Error('File not found: ' + rel);
}
async function read_context_file(scope, queue_name, name) {
  const fp = await find_context_path(queue_name, name);
  const base = path.basename(fp); const ext = (base.split('.').pop() || '').toLowerCase();
  const buf = fs.readFileSync(fp);
  if (PREVIEW_IMAGE[ext]) return { kind: 'image', name: base, media_type: PREVIEW_IMAGE[ext], data_base64: buf.toString('base64') };
  if (ext === 'pdf') return { kind: 'pdf', name: base };
  if (ext === 'csv' || ext === 'tsv') return { kind: 'table', name: base, rows: parse_delimited(buf.toString('utf8'), ext === 'tsv' ? '\t' : ',').slice(0, 500) };
  if (ext === 'xlsx' || ext === 'xls') {
    try { const XLSX = require('xlsx'); const wb = XLSX.read(buf, { type: 'buffer' }); const ws = wb.Sheets[wb.SheetNames[0]]; return { kind: 'table', name: base, rows: XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }).slice(0, 500), note: 'Sheet: ' + wb.SheetNames[0] }; }
    catch (e) { /* fall through to text */ }
  }
  const r = await extract.extract_text(buf, { file_extension: ext, title: base, content_size: buf.length });
  return { kind: 'text', name: base, text: (r && r.text) || '', note: (r && r.note) || '' };
}

module.exports = {
  load_context_files, load_context_images, load_knowledge, slug, ALLOWED_EXT,
  list_context_meta, save_context_file, context_dir, read_context_file, find_context_path,
  set_context_excluded, seed_sample_context
};
