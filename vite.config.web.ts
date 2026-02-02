import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Browser build config for GitHub Pages deployment
// Build output: dist-web/
// Deploy URL: https://dsmmcken.github.io/vdo-samurai/

export default defineConfig({
  // Base path for GitHub Pages (repo name)
  base: '/vdo-samurai/',

  plugins: [react(), tailwindcss()],

  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    sourcemap: true,
    // Target modern browsers
    target: 'es2020',
    rollupOptions: {
      output: {
        // Code splitting for better caching
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          p2p: ['trystero'],
          state: ['zustand']
        }
      }
    }
  },

  // Development server headers for WebRTC
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by some WebRTC implementations)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },

  // Preview server (for testing production build locally)
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
