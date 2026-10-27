import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any GitHub Pages path (user.github.io/<repo>/).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // Pre-bundle up front: otherwise the dev server discovers mediabunny when the
  // render worker first loads and force-reloads every open page mid-session.
  optimizeDeps: { include: ['react', 'react-dom/client', '@vdoninja/sdk', 'mediabunny'] },
  build: { target: 'es2022' },
});
