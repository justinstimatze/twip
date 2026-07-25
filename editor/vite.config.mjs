import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/*
 * Put the un-migrated stylesheets in a cascade layer so Tailwind utilities can win.
 *
 * Tailwind v4 emits its utilities inside `@layer utilities`. The editor's original
 * stylesheets are unlayered, and unlayered CSS beats layered CSS at any specificity — so
 * `.wick-input { width: 100% }` silently overrode `w-10` on the element that had both, and
 * the field rendered at 111px with the build green and the class present in the DOM. That
 * is the wrong way round: a utility written today should beat a rule the redesign is in the
 * middle of deleting. `src/index.css` declares `legacy` before Tailwind's layers, which puts
 * it lowest.
 *
 * Wrapping happens before sass runs, so `@import 'Editor/_wickbrand.scss'` still resolves
 * and variables still work — sass nests the imported rules into the block. Order *among*
 * these files is untouched, since they all land in the same layer. `!important` inside a
 * layer still wins outright: important declarations reverse layer order, which is what the
 * 35 `!important` declarations across 8 files are relying on.
 *
 * This plugin deletes itself along with the last .scss file.
 */
function legacyCssLayer () {
  return {
    name: 'twip:legacy-css-layer',
    enforce: 'pre',
    transform (code, id) {
      if (!/\.scss(\?|$)/.test(id)) return null
      if (id.includes('/node_modules/')) return null
      return { code: `@layer legacy {\n${code}\n}\n`, map: null }
    },
  }
}

// CRA -> Vite. The old editor is React 16 with JSX in `.js` files and CRA's
// NODE_PATH='src/' absolute imports (only the `Editor/` root is used).
export default defineConfig({
  plugins: [legacyCssLayer(), react(), tailwindcss()],
  resolve: {
    // Replaces NODE_PATH='src/' for src-absolute imports. Only `Editor/` and
    // `resources/` are used as bare roots (the latter for image/asset imports).
    // `@/` is the shadcn convention and points at src/, which is where ui/ and lib/ live.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
  // The CRA->Vite move swapped node-sass for dart-sass, which deprecates the global
  // darken()/lighten() that _wickbrand.scss uses throughout. Every rebuild printed
  // dozens of identical warnings and buried real output. Silenced rather than migrated
  // to color.adjust(): this SCSS is replaced wholesale by the Tailwind redesign, so
  // rewriting the colour maths now is throwaway work. If that redesign is ever dropped,
  // this becomes real debt — sass ships an automated migrator for it.
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['color-functions', 'global-builtin', 'import'],
      },
    },
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
