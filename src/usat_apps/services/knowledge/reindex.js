'use strict';
// Backfill / refresh chunk VECTORS so hybrid retrieval has a semantic score to blend. Batches chunk text
// through the embedding provider and writes the vectors back. Used by the shared knowledge-admin Reindex
// action and, for a single source, right after URL ingest. Curated chunk text only — never conversations/PII.
const chunk_store = require('./chunk_store');
const embeddings = require('./embeddings');
const settings = require('./knowledge_settings');

const BATCH = Number(process.env.KNOWLEDGE_EMBED_BATCH || 64);

// Embed {id, text} rows with `model`; write each vector. Returns how many were written.
async function embed_rows(rows, model) {
  const list = (rows || []).filter(function (r) { return r && r.text; });
  if (!list.length) return 0;
  let done = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const vecs = await embeddings.embed_texts(batch.map(function (r) { return r.text; }), { model: model });
    for (let j = 0; j < batch.length; j++) {
      const v = vecs[j];
      if (v && v.length) { await chunk_store.set_chunk_embedding(batch[j].id, embeddings.to_buffer(v), model); done++; }
    }
  }
  return done;
}

// Embed ONE source's chunks right after ingest — only when embeddings are enabled. Never throws (ingest
// must not fail because embedding did).
async function embed_source(source_ref, scope, queue) {
  try {
    const st = settings.get();
    if (!st.embeddings_enabled) return { embedded: 0, skipped: 'disabled' };
    const rows = await chunk_store.chunks_for_source(source_ref, scope, queue);
    return { embedded: await embed_rows(rows, st.embedding_model) };
  } catch (e) { return { embedded: 0, error: (e && e.message) || String(e) }; }
}

// Backfill missing/stale vectors for the current (or given) model, up to `max` chunks per call, so the
// Reindex button can drive it and poll status. Returns { embedded, remaining, status }.
async function reindex(opts) {
  const o = opts || {};
  const st = settings.get();
  const model = o.model || st.embedding_model;
  const max = Math.max(1, Math.min(5000, Number(o.max) || 500));
  let embedded = 0;
  while (embedded < max) {
    const rows = await chunk_store.chunks_missing_embedding(model, Math.min(BATCH, max - embedded));
    if (!rows.length) break;
    const n = await embed_rows(rows, model);
    embedded += n;
    if (n === 0) break;   // nothing written (all failed) — stop rather than loop forever
  }
  const status = await chunk_store.embedding_status(model);
  return { embedded: embedded, remaining: status.missing + status.stale, status: status };
}

module.exports = { embed_rows, embed_source, reindex, BATCH };
