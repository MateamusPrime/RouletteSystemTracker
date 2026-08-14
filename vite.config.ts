import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * `npm run build` produces the usual dist/ folder for hosting.
 *
 * `npm run build:standalone` inlines every script, style and asset into one
 * HTML file that runs by double-clicking it — no dev server, no npm, nothing
 * to install. That is the version to use on a machine where scripts are
 * locked down.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone'
  return {
    plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
    build: standalone
      ? {
          outDir: 'standalone',
          // Everything in one file, so the page has nothing to fetch.
          assetsInlineLimit: 100_000_000,
          cssCodeSplit: false,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : undefined,
  }
})
