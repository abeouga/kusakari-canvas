import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.KUSAKARI_CANVAS_WEB_BASE || '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@kusakari/site-header'],
    include: ['lucide-react'],
  },
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': process.env.KUSAKARI_CANVAS_API_TARGET ?? 'http://127.0.0.1:8080',
    },
  },
});
