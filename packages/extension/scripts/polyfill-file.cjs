/**
 * Node 18 兼容桩：Node 20+ 才有全局 File；@vscode/vsce 依赖链（cheerio → undici）
 * 在模块加载时引用 File 绑定，Node 18 下直接 ReferenceError。打包流程不会真正
 * 构造 File 对象，空类桩即可。经 package:vsix 的 NODE_OPTIONS=--require 注入。
 */
if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File {}
}
