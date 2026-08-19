import { defineConfig } from 'vite';

export default defineConfig({
  // @ts-ignore - vite 5.4 allows string[] but type may lag
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    cors: true,
    // @ts-ignore
    allowedHosts: true,
    hmr: { host: 'localhost' },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild'
  },
  test: {
    globals: true,
    environment: 'jsdom'
  }
});
