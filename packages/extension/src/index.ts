/**
 * 插件打包入口（package.json main → dist/extension.js，esbuild 以本文件为 entry）。
 * activate/deactivate 的实现按 architecture.md §6.1 放在 extension.ts，
 * 此处只做转发，保持 §6.1 的模块划分。
 */
export { activate, deactivate } from './extension'
