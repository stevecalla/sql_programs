'use strict';
// Chunking + keyword retrieval for the shared knowledge layer (URL context + uploaded files).
//   chunk(text, meta)          -> [{ chunk_id, seq, category, source_title, source_ref, source_type, text, char_len }]
//   score(chunks, question, n) -> [{ chunk, score, hits }]  (BM25-lite keyword ranking, top-n)
// Pure logic, no deps, no DB — so it unit-tests standalone and both callers (store, tests) share it.
// The DB chunk store persists what chunk() returns and calls score() inside select_chunks().

// Tuning knobs — constants so they're easy to adjust after seeing real pages.
const MAX = 1100;   // hard ceiling per chunk (chars)
const WIN = 800;    // window size when a section is larger than MAX
const OVER = 120;   // overlap between windows so a fact spanning a boundary isn't lost
const MIN = 180;    // sections smaller than this merge upward, to avoid fragment noise

// Split already-extracted text (may contain markdown '# / ## / ###' headings) into categorized chunks.
// meta: { source_ref, source_title, source_type, scope, queue }
function chunk(text, meta) {
  const m = meta || {};
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const sections = []; const stack = []; let cur = null;
  const flush = function () { if (cur && cur.body.trim()) sections.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,3})\s+(.*\S)\s*$/.exec(lines[i]);
    if (h) {
      flush();
      const level = h[1].length; const title = h[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level: level, title: title });
      cur = { category: stack.map(function (x) { return x.title; }).join(' › '), body: '', heading: true };
    } else {
      if (!cur) cur = { category: m.source_title || '', body: '', heading: false };
      cur.body += (cur.body ? '\n' : '') + lines[i];
    }
  }
  flush();

  // Merge only heading-LESS fragments (loose preamble text) into the previous section, so a stray
  // sentence doesn't become its own chunk. Heading-defined sections are always kept — their breadcrumb
  // category is the whole point, even when the section is short.
  const merged = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (merged.length && !s.heading && s.body.trim().length < MIN) {
      merged[merged.length - 1].body += '\n\n' + s.body.trim();
    } else merged.push({ category: s.category, body: s.body.trim() });
  }

  // split oversized sections into overlapping windows, breaking on whitespace
  const out = []; let seq = 0;
  for (let i = 0; i < merged.length; i++) {
    const cat = merged[i].category; const body = merged[i].body;
    if (!body) continue;
    if (body.length <= MAX) { out.push(mk(seq++, cat, body, m)); continue; }
    let pos = 0; let part = 1;
    while (pos < body.length) {
      let end = Math.min(pos + WIN, body.length);
      if (end < body.length) { const sp = body.lastIndexOf(' ', end); if (sp > pos + 400) end = sp; }
      out.push(mk(seq++, cat + ' (part ' + part + ')', body.slice(pos, end).trim(), m));
      if (end >= body.length) break;
      pos = end - OVER; part++;
    }
  }
  return out;
}

function mk(seq, category, text, m) {
  return {
    chunk_id: (m.source_ref || 'src') + '#' + seq,
    seq: seq,
    category: category || (m.source_title || ''),
    source_title: m.source_title || '',
    source_ref: m.source_ref || '',
    source_type: m.source_type || 'file',
    scope: m.scope || 'global',
    queue: m.queue || '',
    text: text,
    char_len: text.length
  };
}

// --- keyword retrieval (BM25-lite) ---
const STOP = new Set(('a an the of to in on for and or is are was were be been being do does did done how what ' +
  'when where which who whom whose will would can could should may might must with without your you our we it ' +
  'this that these those as at by from about into over under than then so if not no yes i me my mine us they them').split(/\s+/));
function tokenize(s) {
  return (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(function (w) { return w.length > 2 && !STOP.has(w); });
}

// Rank chunks against a question; returns top-n [{ chunk, score, hits }] with score > 0.
function score(chunks, question, n) {
  const list = chunks || []; const N = list.length; const top = n || 8;
  if (!N) return [];
  const q = Array.from(new Set(tokenize(question)));
  if (!q.length) return [];
  const df = {};
  const docs = list.map(function (c) {
    const t = tokenize((c.text || '') + ' ' + (c.category || ''));
    const tf = {}; t.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
    Object.keys(tf).forEach(function (w) { df[w] = (df[w] || 0) + 1; });
    return { tf: tf, len: t.length };
  });
  const avg = docs.reduce(function (a, d) { return a + d.len; }, 0) / N || 1;
  const k1 = 1.4; const b = 0.72;
  const scored = [];
  for (let i = 0; i < N; i++) {
    const d = docs[i]; let s = 0; const hits = [];
    const catToks = new Set(tokenize(list[i].category || ''));
    for (let j = 0; j < q.length; j++) {
      const term = q[j]; const f = d.tf[term] || 0; if (!f) continue;
      const idf = Math.log(1 + (N - (df[term] || 0) + 0.5) / ((df[term] || 0) + 0.5));
      const base = idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
      s += base * (catToks.has(term) ? 1.35 : 1);   // boost hits in the section heading/category
      hits.push(term);
    }
    if (s > 0) scored.push({ chunk: list[i], score: Math.round(s * 1000) / 1000, hits: hits });
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, top);
}

module.exports = { chunk: chunk, score: score, tokenize: tokenize, MAX: MAX, WIN: WIN, OVER: OVER, MIN: MIN };
