'use strict';
// Backfill / refresh chunk VECTORS so hybrid retrieval has a semantic score to blend. Batches chunk text
// through the embedding provider and writes the vectors back. Used by the shared knowledge-admin Reindex
// action and, for a single source, right after URL ingest. Curated chunk text only — never conversations/PII.
const chunk_store = require('./chunk_store');
const embeddings = require('./embeddings');
const settings = require('./knowledge_settings');

const BATCH = Number(process.env.KNOWLEDGE_EMBED_BATCH || 64);

// Embed {id, text} rows with `model`; write each vector + its token/cost share. Returns how many were written.
// The provider bills per BATCH (usage.total_tokens); we split that across the batch's chunks in proportion to
// each chunk's text length so the per-chunk figures SUM back to the exact amount billed. cost = tokens x price
// (USD per 1M input tokens, from the embedding-model registry).
async function embed_rows(rows, model) {
  const list = (rows || []).filter(function (r) { return r && r.text; });
  if (!list.length) return 0;
  const price_in = settings.price_in_for(model);   // USD / 1M tokens
  let done = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const out = await embeddings.embed_batch(batch.map(function (r) { return r.text; }), { model: model });
    const vecs = out.vectors || [];
    const lens = batch.map(function (r) { return Math.max(1, String(r.text || '').length); });
    const totalLen = lens.reduce(function (a, b) { return a + b; }, 0) || 1;
    const totalTokens = Number(out.tokens) || 0;
    for (let j = 0; j < batch.length; j++) {
      const v = vecs[j];
      if (v && v.length) {
        const tok = Math.round(totalTokens * (lens[j] / totalLen));   // this chunk's share of the batch tokens
        const cost = Math.round(((tok / 1e6) * price_in) * 1e6) / 1e6;
        await chunk_store.set_chunk_embedding(batch[j].id, embeddings.to_buffer(v), model, tok, cost);
        done++;
      }
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
  if (o.force) {
    // FORCE: re-embed already-embedded chunks too (backfill token/cost). Page by offset since re-embedding
    // doesn't shrink the pool. Advance by rows fetched (not just embedded) so a failed row can't loop forever.
    let offset = 0;
    while (embedded < max) {
      const want = Math.min(BATCH, max - embedded);
      const rows = await chunk_store.chunks_all_embeddable(want, offset);
      if (!rows.length) break;
      embedded += await embed_rows(rows, model);
      offset += rows.length;
      if (rows.length < want) break;   // last page
    }
  } else {
    while (embedded < max) {
      const rows = await chunk_store.chunks_missing_embedding(model, Math.min(BATCH, max - embedded));
      if (!rows.length) break;
      const n = await embed_rows(rows, model);
      embedded += n;
      if (n === 0) break;   // nothing written (all failed) — stop rather than loop forever
    }
  }
  const status = await chunk_store.embedding_status(model);
  return { embedded: embedded, remaining: status.missing + status.stale, status: status };
}

module.exports = { embed_rows, embed_source, reindex, BATCH };
