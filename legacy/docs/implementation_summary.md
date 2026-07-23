# Dionysus Phase 1~3 实施总结

**实施时间：** 2026-06-24  
**目标分支：** `main`  
**最终状态：** 后端 32 tests passed，前端 5 tests passed + build 成功，CI 配置完成。

---

## Phase 1：合并 PR #1 + 兼容性修复

- 合并 GitHub PR #1（CodeBuddy adapter + 可折叠 thinking section）。
- 修复 `working_dir` 解析：以 `backend/config` 为基准，自动创建目录。
- 修复启动器环境变量大小写，适配 pydantic-settings。
- 修复后端 ruff lint（E501/F841），迁移 ruff 配置到 `[tool.ruff.lint]`。
- 新增后端测试：`test_codebuddy_strategy.py`、`test_adapter_registry.py`。
- 新增前端测试基础设施：Vitest + RTL，新增 `ThinkingSection` 与 `chatStore thinking` 测试。
- 更新 `README.md` 与 `docs/user_guide.md`。

## Phase 2-2：整理仓库 / 去硬编码路径 / 开发文档

- 新增 `dionysus_server.paths`：统一解析 `CONFIG_DIR`、`DATA_DIR`、相对路径与跨平台 `open_path`。
- 运行时 JSON 设置迁移到 `Dionysus_DATA_DIR`（`server_settings.json`、`agent_settings.json`、`wallpaper_settings.json`、`supervisor_settings.json`）。
- `SessionStore` 数据库存储路径解析到 `Dionysus_DATA_DIR`，并启用 SQLite 外键约束。
- 前后端协议对齐：后端 datetime 序列化为 Unix ms；`server_version` 统一为 `0.2.0`；前端 `ClientCommand` 补全 `resume_agent_session`。
- PyInstaller `dionysus_server.spec` 增加 `codebuddy` hidden import。
- 清理 `scripts/`、`frontend/tests/*.py`、`backend/tests/test_session_isolation.py` 中的绝对路径。
- 新增 `backend/tests/conftest.py`（fixtures）与 `backend/tests/test_session_store.py`。
- 生成 `docs/phase2_review_report.md`、`docs/phase2_2_followup.md`。

## Phase 3：Tech-Flat + 移动端适配 + 配对基础设施

- 重写 `MobileCompanionDrawer`：底部 `80vh` 抽屉、拖拽手柄、拖拽关闭、气泡在角色上方、底部工具栏。
- `ChatInput` 发送用户消息后自动展开移动端角色抽屉。
- 新增 `backend/config/themes/tech_flat.yaml`（工业蓝暗色主题）。
- 生成 PWA 图标 `icon-192.png` / `icon-512.png`，更新 `manifest.json` 主题色。
- 新增 `dionysus_server.pairing.py` 与 `/api/pair/*` 接口：一次性 `pair_token` + 长期 `device_token` + 撤销/列设备。
- 新增 `backend/tests/test_pairing.py`。
- 新增 `.github/workflows/ci.yml`，集成后端 lint/test 与前端 test/build。
- 更新 `README.md`：环境变量、测试命令、功能列表。

---

## 当前验证状态

| 检查项 | 结果 |
|---|---|
| 后端 ruff check | ✅ 通过 |
| 后端 pytest | ✅ 32 passed |
| 前端 vitest | ✅ 5 passed |
| 前端 vite build | ✅ 成功 |
| 后端 `/api/adapters` 烟测 | ✅ 5 个 adapter 正常列出 |
| GitHub Actions CI | ✅ 配置已提交（首次运行需远程触发） |

---

## 已知未完结项（后续迭代）

- **Electron 打包路径**：`electron/main.cjs` 尚未在打包时注入 `Dionysus_CONFIG_DIR` / `Dionysus_DATA_DIR`。
- **首次启动 workspace picker**：未实现，当前仍通过 `/cd` 或 `SessionSettingsPanel` 切换。
- **移动端 onboarding UI**：没有 QR 扫描/输入页面、`connectionStore`、设备 token 持久化。
- **Live2D 降级模式**：`live2dStore` 缺少 `renderMode: live2d | image | video`。
- **基础 UI 组件**：未抽取统一 `Button`/`Card`/`BottomSheet`。
- **设计 Token 扩展**：缺少 `surface-0~3`、`radius`、`shadow` 等语义 Token。
- **前端 store 测试隔离**：每个测试用例前未重置全局 zustand store。
- **无 ESLint 配置**：`npm run lint` 目前会失败。

---

## 关键文件索引

- 路径解析：`backend/dionysus_server/paths.py`
- 配置加载：`backend/dionysus_server/config.py`
- 协议模型：`backend/dionysus_server/models.py`
- 会话持久化：`backend/dionysus_server/session/store.py`
- 配对：`backend/dionysus_server/pairing.py`
- 移动端抽屉：`frontend/src/components/Layout/MobileCompanionDrawer.tsx`
- 主题：`frontend/src/lib/theme.ts`、`backend/config/themes/tech_flat.yaml`
- 计划与评审：`plan/phase_overview.md`、`docs/phase2_review_report.md`、`docs/phase3_progress.md`
