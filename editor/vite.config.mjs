import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// CRA -> Vite. The old editor is React 16 with JSX in `.js` files and CRA's
// NODE_PATH='src/' absolute imports (only the `Editor/` root is used).
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Replaces NODE_PATH='src/' for src-absolute imports. Only `Editor/` and
    // `resources/` are used as bare roots (the latter for image/asset imports).
    alias: {
      Editor: fileURLToPath(new URL('./src/Editor', import.meta.url)),
      resources: fileURLToPath(new URL('./src/resources', import.meta.url)),
    },
  },
  // Treat JSX inside `.js` files (CRA convention) as JSX, for both source
  // transform and dependency pre-bundling.
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: { loader: { '.js': 'jsx' } },
  },
  // CRA exposed process.env.PUBLIC_URL (the public/ base). twip serves at root,
  // so it is the empty string — `process.env.PUBLIC_URL + '/x'` becomes '/x'.
  // NODE_ENV is replaced by Vite itself. Avoids editing the source call sites.
  define: {
    'process.env.PUBLIC_URL': '""',
  },
  // Keep CRA's REACT_APP_* env vars working alongside Vite's VITE_* prefix.
  envPrefix: ['VITE_', 'REACT_APP_'],
  // Tauri (src-tauri/tauri.conf.json) points frontendDist at ../build.
  build: { outDir: 'build' },
  server: { port: 3000 },
})
