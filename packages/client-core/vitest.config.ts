import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // architecture.md §12：client-core 用 vitest + jsdom。
    environment: 'jsdom',
  },
})
