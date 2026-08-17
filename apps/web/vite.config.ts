import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, '..', '..');

export default defineConfig({
  plugins: [react()],
  // Locally the shared .env lives at the repo root. On Vercel, env vars are
  // injected into the process and the checkout root may be this package.
  envDir: process.env.VERCEL ? webDir : repoRoot,
  server: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
});
