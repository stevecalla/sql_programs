import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express server (port 8021) so `npm run dev` works against the real
// backend. `npm run build` emits to dist/, which server_reporting_8021.js serves in production.
// Behind the :8000 proxy the app is built path-aware: `npm run build -- --base=/reporting/`.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:8021' },
    // Poll for file changes — agent/synced writes don't always emit native fs events.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
