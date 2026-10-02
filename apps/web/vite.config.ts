import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin proxy to the local Jadal API. Using this instead of a
      // cross-origin VITE_API_BASE keeps the browser on one origin (no CORS).
      // Override with VITE_API_PROXY_TARGET when the API runs elsewhere.
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
