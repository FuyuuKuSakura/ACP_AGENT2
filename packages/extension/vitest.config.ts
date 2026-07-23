import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // 'vscode' 只在扩展宿主内存在，单测中用空桩替代（见 src/__mocks__/vscode.ts）
      vscode: new URL('./src/__mocks__/vscode.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
