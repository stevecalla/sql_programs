import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express server (port 8020) so `npm run dev` works against the
// real backend. `npm run build` emits to dist/, which the Express server serves in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8020' },
    // Poll for file changes — agent/synced writes don't always emit native fs events, so the
    // default watcher can miss them and HMR stays silent. Polling re-checks mtimes on an interval.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
