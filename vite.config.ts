import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site lives in ./playground and imports the engine in ./src as `system-canvas`.
// `base: './'` keeps every asset path relative, so dist/ works from any static host
// (GitHub Pages project URLs included).
export default defineConfig({
  root: 'playground',
  base: './',
  plugins: [react()],
  resolve: {
    alias: { 'system-canvas': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  },
  build: { outDir: '../dist', emptyOutDir: true },
})
