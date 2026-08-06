'use strict';
// Shared grounding gatherer — the SINGLE source of curated knowledge that BOTH the chatbot and the email
// queue ground on, so the two surfaces can never drift. For a queue it combines:
//   - file/context knowledge   (services/knowledge index -> load_knowledge)
//   - retrieved URL/web-page chunks (services/knowledge/chunk_store, BM25-lite top-N)
//
// CURATED KNOWLEDGE ONLY. This never reads conversations, chat turns, cases, or member PII — that data
// stays walled inside each surface. Corrections are fetched by each caller from the shared corrections
// store and passed to the model separately (they are authoritative and not retrieval-ranked).
const kb_index = require('./index');
const chunk_store = require('./chunk_store');

// Default top-N chunks to retrieve. KNOWLEDGE_RETRIEVE_N is the shared name; CHATBOT_RETRIEVE_N is honored
// as a back-compat alias so the chatbot's existing tuning still applies to both surfaces.
const DEFAULT_N = Number(process.env.KNOWLEDGE_RETRIEVE_N || process.env.CHATBOT_RETRIEVE_N || 8);

// Rank this queue's knowledge CHUNKS against `query`; returns a grounding block + the chunks used.
// Never throws — grounding must not break a draft / chat / ask.
async function retrieve(queue, query, n) {
  try {
    const used = await chunk_store.select_chunks(queue, String(query || ''), n || DEFAULT_N);
    return { block: chunk_store.knowledge_from_chunks(used), used: used || [] };
  } catch (e) { return { block: '', used: [] }; }
}

// File knowledge + retrieved chunk block, most-relevant chunks first (chunks lead so they win the token budget).
function combine(fileK, chunkBlock) {
  const parts = [];
  if (chunkBlock && String(chunkBlock).trim()) parts.push(String(chunkBlock).trim());
  if (fileK && String(fileK).trim()) parts.push(String(fileK).trim());
  return parts.join('\n\n');
}

// Gather the full curated knowledge text for a queue, retrieved against `query`.
// opts: { n, load_opts }. Returns { knowledge, used, file_chars, chunk_chars }.
async function gather(queue, query, opts) {
  const o = opts || {};
  let fileK = '';
  try { fileK = await kb_index.load_knowledge(queue, o.load_opts); } catch (e) { fileK = ''; }
  const ret = await retrieve(queue, query, o.n);
  return {
    knowledge: combine(fileK, ret.block),
    used: ret.used,
    file_chars: (fileK || '').length,
    chunk_chars: (ret.block || '').length,
  };
}

// Per-answer provenance for the chunks used (for the "sources" surface). No PII — chunk metadata only.
function provenance(used) {
  return (used || []).map(function (u) {
    return { source_ref: u.source_ref, source_title: u.source_title, category: u.category, score: u.score };
  });
}

module.exports = { gather, retrieve, combine, provenance, DEFAULT_N };
