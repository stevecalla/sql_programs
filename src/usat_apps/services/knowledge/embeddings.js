'use strict';
// Embeddings + hybrid-blend math for knowledge retrieval. Pure functions (cosine, normalize, blend, and
// Float32 <-> Buffer serialization) are separated from the ONE impure call (embed_texts -> provider) so the
// blend logic is fully unit-testable with no network or DB. Used by services/knowledge/grounding to combine
// the keyword (BM25-lite) score with a semantic (vector) score under an operator-set weight.
//
// SHARED, curated-knowledge only — vectors are computed from chunk TEXT, never from conversations/cases/PII.

// ---- Float32 vector <-> MEDIUMBLOB bytes (little-endian) ----
function to_buffer(vec) {
  const arr = (vec instanceof Float32Array) ? vec : Float32Array.from(vec || []);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}
function from_buffer(buf) {
  if (!buf || !buf.length) return null;
  // Copy so we get a clean, aligned Float32Array regardless of the Buffer's backing store.
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 4));
}

// ---- similarity ----
function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---- normalization: scale a list of raw scores to 0..1 (min-max) so keyword and semantic are comparable ----
function minmax(scores) {
  const s = (scores || []).map(function (x) { return Number(x) || 0; });
  if (!s.length) return [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < s.length; i++) { if (s[i] < lo) lo = s[i]; if (s[i] > hi) hi = s[i]; }
  if (!(hi > lo)) return s.map(function (x) { return hi > 0 ? 1 : 0; });   // all equal -> 1 if there's signal, else 0
  const span = hi - lo;
  return s.map(function (x) { return (x - lo) / span; });
}

// ---- weighted blend ----
// keywordScores[] and semanticScores[] are aligned raw scores for the SAME candidate list. weight in [0,1] is
// the SEMANTIC weight (0 = keyword only, 1 = semantic only). Returns blended scores in [0,1]. A missing
// semantic score (chunk not embedded / other model) is treated as 0 so it simply leans on keyword.
function blend(keywordScores, semanticScores, weight) {
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  const kn = minmax(keywordScores || []);
  const sn = minmax(semanticScores || []);
  const n = Math.max(kn.length, sn.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = kn[i] || 0, s = sn[i] || 0;
    out.push((1 - w) * k + w * s);
  }
  return out;
}

// ---- provider call (impure) — OpenAI embeddings. Returns { vectors: Float32Array[] aligned to `texts`,
// tokens: total input tokens billed (usage.total_tokens), model }. Throws on failure so callers can fall
// back to keyword. This token-aware form powers embedding-cost tracking. ----
// opts: { model, api_key, base_url?, dim?, fetch? }.
async function embed_batch(texts, opts) {
  const o = opts || {};
  const list = (texts || []).map(function (t) { return String(t == null ? '' : t); });
  const model = o.model || 'text-embedding-3-small';
  if (!list.length) return { vectors: [], tokens: 0, model: model };
  const key = o.api_key || process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!key) throw new Error('embed_texts: no OpenAI API key');
  const url = (o.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/embeddings';
  const doFetch = o.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('embed_texts: fetch unavailable');
  const body = { model: model, input: list };
  if (o.dim) body.dimensions = o.dim;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text().catch(function () { return ''; }); throw new Error('embed_texts: ' + res.status + ' ' + t.slice(0, 200)); }
  const json = await res.json();
  const data = (json && json.data) || [];
  // Preserve request order (API returns an index per item).
  const byIndex = [];
  data.forEach(function (d) { byIndex[d.index != null ? d.index : byIndex.length] = Float32Array.from(d.embedding || []); });
  const usage = (json && json.usage) || {};
  const tokens = Number(usage.total_tokens != null ? usage.total_tokens : usage.prompt_tokens) || 0;
  return { vectors: list.map(function (_, i) { return byIndex[i] || null; }), tokens: tokens, model: model };
}

// Vectors-only convenience (backward compatible) — Float32Array[] aligned to `texts`.
async function embed_texts(texts, opts) { return (await embed_batch(texts, opts)).vectors; }

module.exports = { to_buffer, from_buffer, cosine, minmax, blend, embed_texts, embed_batch };
