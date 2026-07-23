/**
 * e2e 入口脚本：下载真实 VS Code（默认 stable，缓存在 .vscode-test/）并启动
 * 扩展宿主跑 dist-e2e/index.js（esbuild 打包的 runner）。
 * 用法：npm run test:e2e（会先 build + build:e2e）。
 */
import { runTests } from '@vscode/test-electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const extensionDevelopmentPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

const start = Date.now()
await runTests({
  extensionDevelopmentPath,
  extensionTestsPath: path.join(extensionDevelopmentPath, 'dist-e2e', 'index.js'),
  // 隔离用户已装扩展；开发中的扩展不受 --disable-extensions 影响
  launchArgs: ['--disable-extensions'],
})
console.log(`[e2e] VS Code ${process.env.VSCODE_TEST_VERSION ?? 'stable'} 运行总耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`)
