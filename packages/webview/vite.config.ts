import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // extension 的 findBundleAssets 只认单入口 JS：live2d-viewer 对
        // pixi-live2d-display/cubism4 的动态 import（规避其模块加载即检查
        // Live2DCubismCore 全局的副作用）必须内联回主 bundle，禁止分包。
        inlineDynamicImports: true,
      },
    },
  },
})
