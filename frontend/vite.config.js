import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {'/api/v1': 'http://127.0.0.1:8787'}
  },
  build: {
    outDir: '../dist/frontend',
    emptyOutDir: true,
    sourcemap: false
  }
});
