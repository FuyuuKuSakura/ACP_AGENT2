import path from 'path'
import { defineConfig } from 'vitest/config'

process.env.VITEST = 'true'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    env: {
      VITEST: 'true',
    },
  },
})
