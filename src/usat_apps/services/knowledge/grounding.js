'use strict';
// Shared grounding gatherer — the SINGLE source of curated knowledge that BOTH the chatbot and the email
// queue ground on, so the two surfaces can never drift. For a queue it combines:
//   - file/context knowledge   (services/knowledge index -> load_knowledge)
//   - retrieved URL/web-page chunks (services/knowledge/chunk_store), ranked by:
//       * KEYWORD only (BM25-lite) when the shared retrieval weight is 0 (default), OR
//       * a HYBRID blend of keyword + SEMANTIC (embeddings) when the weight is > 0.
//
// CURATED KNOWLEDGE ONLY. Never reads conversations, chat turns, cases, or member PII. Corrections are
// fetched by each caller from the shared store and passed to the model separately.
const kb_index = require('./index');
const chunk_store = require('./chunk_store');
const chunker = require('./chunk');
const embeddings = require('./embeddings');
const settings = require('./knowledge_settings');

const DEFAULT_N = Number(process.env.KNOWLEDGE_RETRIEVE_N || process.env.CHATBOT_RETRIEVE_N || 8);

// Rank this queue's knowledge CHUNKS against `query`; returns a grounding block + the chunks used (with
// keyword / semantic / blended scores). Never throws — grounding must not break a draft / chat / ask.
async function retrieve(queue, query, n) {
  const top = Math.max(1, Math.min(50, Number(n) || DEFAULT_N));
  try {
    const st = settings.get();
    // Keyword-only fast path (embeddings off) — no candidate vectors loaded, no embed call.
    if (!st.embeddings_enabled) {
      const used = await chunk_store.select_chunks(queue, query, top);
      return { block: chunk_store.knowledge_from_chunks(used), used: used, mode: 'keyword' };
    }
    return await retrieve_hybrid(queue, query, top, st);
  } catch (e) {
    // Any failure (embed error, DB hiccup) -> fall back to keyword so grounding still works.
    try { const used = await chunk_store.select_chunks(queue, query, top); return { block: chunk_store.knowledge_from_chunks(used), used: used, mode: 'keyword' }; }
    catch (e2) { return { block: '', used: [], mode: 'keyword' }; }
  }
}

// Hybrid: load candidates (with vectors), score keyword + semantic over the SAME set, blend by weight.
async function retrieve_hybrid(queue, query, top, st) {
  const cands = await chunk_store.candidates(queue);
  if (!cands.length) return { block: '', used: [], mode: 'hybrid' };

  // keyword scores over all candidates (0 for no-hit chunks)
  const kwRanked = chunker.score(cands, query, cands.length);
  const kwMap = {};
  kwRanked.forEach(function (r) { kwMap[r.chunk.chunk_id] = { score: r.score, hits: r.hits }; });
  const kwArr = cands.map(function (c) { return (kwMap[c.chunk_id] && kwMap[c.chunk_id].score) || 0; });

  // semantic scores: embed the query once, cosine vs each candidate's vector (same model only). On any
  // failure, leave semantic all-zero so the blend degrades to keyword ordering.
  let semArr = cands.map(function () { return 0; });
  try {
    const qv = (await embeddings.embed_texts([String(query || '')], { model: st.embedding_model }))[0];
    if (qv && qv.length) {
      semArr = cands.map(function (c) {
        if (!c.embedding || c.embed_model !== st.embedding_model) return 0;
        return embeddings.cosine(qv, embeddings.from_buffer(c.embedding));
      });
    }
  } catch (e) { /* keyword-only ordering */ }

  const blended = embeddings.blend(kwArr, semArr, st.retrieval_weight);
  const scored = cands.map(function (c, i) {
    return {
      chunk_id: c.chunk_id, source_ref: c.source_ref, source_title: c.source_title, category: c.category, text: c.text,
      score: Math.round(blended[i] * 1000) / 1000,
      keyword: Math.round((kwArr[i] || 0) * 1000) / 1000,
      semantic: Math.round((semArr[i] || 0) * 1000) / 1000,
      hits: (kwMap[c.chunk_id] && kwMap[c.chunk_id].hits) || [],
    };
  }).filter(function (r) { return r.score > 0; });
  scored.sort(function (a, b) { return b.score - a.score; });
  const used = scored.slice(0, top);
  return { block: chunk_store.knowledge_from_chunks(used), used: used, mode: 'hybrid' };
}

// File knowledge + retrieved chunk block, most-relevant chunks first (chunks lead so they win the token budget).
function combine(fileK, chunkBlock) {
  const parts = [];
  if (chunkBlock && String(chunkBlock).trim()) parts.push(String(chunkBlock).trim());
  if (fileK && String(fileK).trim()) parts.push(String(fileK).trim());
  return parts.join('\n\n');
}

// Gather the full curated knowledge text for a queue, retrieved against `query`.
// opts: { n, load_opts }. Returns { knowledge, used, mode, file_chars, chunk_chars }.
async function gather(queue, query, opts) {
  const o = opts || {};
  let fileK = '';
  try { fileK = await kb_index.load_knowledge(queue, o.load_opts); } catch (e) { fileK = ''; }
  const ret = await retrieve(queue, query, o.n);
  return {
    knowledge: combine(fileK, ret.block),
    used: ret.used,
    mode: ret.mode,
    file_chars: (fileK || '').length,
    chunk_chars: (ret.block || '').length,
  };
}

// Per-answer provenance for the chunks used (for the "sources" surface). No PII — chunk metadata + scores + a
// short text preview so a reviewer can SEE what each retrieved chunk actually contained (and confirm whether a
// specific link/date in the answer really came from the knowledge).
function provenance(used) {
  return (used || []).map(function (u) {
    return {
      source_ref: u.source_ref, source_title: u.source_title, category: u.category,
      score: u.score, keyword: u.keyword, semantic: u.semantic,
      snippet: String(u.text || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    };
  });
}

module.exports = { gather, retrieve, combine, provenance, DEFAULT_N };
