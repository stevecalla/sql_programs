import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express server (port 8022) so `npm run dev` works against the real
// backend. `npm run build` emits to dist/, which server_usat_apps_8022.js serves in production.
// Served at the usat-app root behind the :8000 proxy, so the default base '/' is correct.
//
// /api/event-coi is the DEDICATED Insurance-COI backend (port 8023) — listed first so it wins over the
// general /api rule (vite matches keys in order). Start it in dev with `npm run event_coi_server`
// (or event_coi_dev). Vite doesn't rewrite the path, so :8023 receives the full /api/event-coi/*.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api/event-coi': 'http://localhost:8023',
      '/api': 'http://localhost:8022',
    },
    // Poll for file changes — agent/synced writes don't always emit native fs events.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
