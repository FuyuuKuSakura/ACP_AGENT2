/**
 * vitest 用的 vscode 模块桩：单测只验证模块可导入与函数签名，
 * 不真正调用 VS Code API；宿主集成测试在 Phase 3 用 @vscode/test-electron 跑。
 */
export {}
