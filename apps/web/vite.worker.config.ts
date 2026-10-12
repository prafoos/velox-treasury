import { defineConfig } from 'vite';

// Production build of the persistent deposit-automation worker (a Node process, not a browser or Vercel bundle).
// Workspace packages (@velox/*) ship TypeScript source, so they are bundled; npm dependencies stay external
// and are resolved from node_modules at runtime.
export default defineConfig({
  publicDir: false,
  // The worker only uses role constants from src/contracts/treasury.ts. Its frontend-only Core/adapter
  // address constants must not depend on build-time VITE_* values or the browser PROD guard.
  define: {
    'import.meta.env.PROD': 'false',
    'import.meta.env.VITE_ARC_MAINNET_CORE_ADDRESS': 'undefined',
    'import.meta.env.VITE_ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS': 'undefined',
  },
  ssr: {
    noExternal: [/^@velox\//],
  },
  build: {
    ssr: 'server/depositAutomationWorkerMain.ts',
    outDir: 'dist-worker',
    emptyOutDir: true,
    target: 'node20',
    sourcemap: false,
    minify: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'worker.mjs',
      },
    },
  },
});
