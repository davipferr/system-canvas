import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { 'system-canvas': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // The engine is pure data and math, so plain Node is enough.
    environment: 'node',
  },
})
