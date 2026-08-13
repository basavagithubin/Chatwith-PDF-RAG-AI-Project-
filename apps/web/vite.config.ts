import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

// The monorepo keeps a single .env at the repo root, so read env from there
// instead of the default (this package's directory).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  server: {
    host: '0.0.0.0',
    port: 4173,
  },
});
