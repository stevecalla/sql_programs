import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express server (port 8022) so `npm run dev` works against the real
// backend. `npm run build` emits to dist/, which server_usat_apps_8022.js serves in production.
// Served at the usat-app root behind the :8000 proxy, so the default base '/' is correct.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { '/api': 'http://localhost:8022' },
    // Poll for file changes — agent/synced writes don't always emit native fs events.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
