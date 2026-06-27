import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express server (port 8020) so `npm run dev` works against the
// real backend. `npm run build` emits to dist/, which the Express server serves in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8020' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
