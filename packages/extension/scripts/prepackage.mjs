/**
 * vsce 打包前置：把 monorepo 内两份运行时资产拷进扩展目录，使 vsix 自包含。
 * - packages/webview/dist → packages/extension/webview-dist/
 *   （webview-provider.resolveWebviewDist 打包态优先读 extensionUri/webview-dist）
 * - packages/mobile/dist → packages/extension/mobile-dist/
 *   （webview-provider.resolveMobileDist 打包态优先读 extensionUri/mobile-dist，
 *   lan-server 静态托管移动端应用）
 * - 仓库根 assets/{live2d,personas} → packages/extension/assets/
 *   （resolveAssetsRoot 打包态读 extensionUri/assets；assets/icon.svg 为源码资产，保留）
 * 产物目录已入 .gitignore，每次打包全量重建。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const extRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(extRoot, '..', '..')

function replaceDir(src, dest, label) {
  if (!fs.existsSync(src)) throw new Error(`${label} 源目录不存在：${src}（请先构建对应包）`)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log(`[prepackage] ${label}: ${path.relative(repoRoot, src)} -> ${path.relative(repoRoot, dest)}`)
}

replaceDir(path.join(repoRoot, 'packages', 'webview', 'dist'), path.join(extRoot, 'webview-dist'), 'webview 产物')
replaceDir(path.join(repoRoot, 'packages', 'mobile', 'dist'), path.join(extRoot, 'mobile-dist'), 'mobile 产物')
for (const sub of ['live2d', 'personas']) {
  replaceDir(path.join(repoRoot, 'assets', sub), path.join(extRoot, 'assets', sub), `出厂素材 ${sub}/`)
}
