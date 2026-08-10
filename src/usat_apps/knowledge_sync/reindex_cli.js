'use strict';
try { require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '..', '.env') }); } catch (e) { /* dotenv optional */ }
// CLI reindex of knowledge embeddings — runs the SAME reindex the Knowledge & AI admin "Embedding models"
// card runs, but DIRECTLY against the DB (no admin HTTP session needed). Mirrors the card's two buttons:
//   node src/usat_apps/knowledge_sync/reindex_cli.js            -> Reindex: embed only missing / stale (other-model) vectors
//   node src/usat_apps/knowledge_sync/reindex_cli.js --force    -> Re-embed ALL chunks (backfill embed tokens + cost)
//   node src/usat_apps/knowledge_sync/reindex_cli.js --max 1000 -> cap chunks per run (default 500; click/run again to continue)
// Uses the DB in this machine's .env and needs OPENAI_API_KEY. Prints coverage + running embedding spend.
const reindex = require('../services/knowledge/reindex');
const chunk_store = require('../services/knowledge/chunk_store');
const settings = require('../services/knowledge/knowledge_settings');

function argVal(name, def) { const i = process.argv.indexOf('--' + name); return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : def; }

(async () => {
  try {
    const force = process.argv.includes('--force');
    const max = Math.max(1, Number(argVal('max', 500)) || 500);
    const st = settings.get();
    console.log((force ? 'Re-embedding ALL chunks' : 'Reindexing missing/stale vectors') + ' — model ' + st.embedding_model + ' @ $' + st.embedding_price_in + '/1M (max ' + max + ')…');
    const r = await reindex.reindex({ max: max, force: force });
    const s = r.status || {};
    console.log('Done · embedded ' + r.embedded + ' this run · ' + r.remaining + ' remaining' +
      ' (index: ' + s.embedded + '/' + s.total + ' embedded, ' + s.stale + ' stale, ' + s.missing + ' missing)');
    if (r.remaining > 0 && !force) console.log('  → run again to continue (embeds up to ' + max + ' per run).');
    const cost = await chunk_store.embedding_cost_summary();
    console.log('Embedding spend so far: $' + (cost.cost_usd || 0).toFixed(6) + ' · ' + cost.tokens + ' tokens · ' + cost.embedded + ' chunks with cost.');
    try { await require('../store/db').end(); } catch (e) { /* ignore */ }
    process.exit(0);
  } catch (e) {
    console.error('FAIL reindex:', (e && e.message) || e);
    try { await require('../store/db').end(); } catch (x) { /* ignore */ }
    process.exit(1);
  }
})();
