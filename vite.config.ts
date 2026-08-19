import { defineConfig } from 'vite';

// GitHub Pages serves at https://<user>.github.io/<repo>/
// Vercel serves at root /. Detect GH Pages build via env GH_PAGES
// @ts-ignore - process is available in Node during build
const isGhPages = (typeof process !== 'undefined' && (process.env.GH_PAGES === 'true' || process.env.GITHUB_ACTIONS === 'true'));
const repoBase = '/MicroFlight-Simulator-2027-Mobile-/';

export default defineConfig({
  base: isGhPages ? repoBase : '/',
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
