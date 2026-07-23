import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // extension 的 lan-server 只托管单入口静态应用，禁止分包。
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    // architecture.md §12：mobile 用 vitest + jsdom。
    environment: 'jsdom',
  },
})
