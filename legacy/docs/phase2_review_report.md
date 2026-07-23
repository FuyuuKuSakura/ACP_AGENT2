# Dionysus Phase 2/3 多 Agent Review 报告

**评审时间：** 2026-06-24  
**评审范围：** 当前 `main` 分支全栈代码  
**目标：** 为 Phase 2-2（整理仓库 / 去硬编码路径 / 开发文档）和 Phase 3（Tech-Flat + 移动端适配）找出阻塞项与优先级清单。

---

## 1. 关键结论

- **Phase 1 已合并并推送**，但代码中仍有大量“开发机硬编码”（`/Users/fuyuuku/ACP_AGENT2/`、固定端口、默认角色 `exusiai`），需要统一治理。
- 前后端协议存在漂移：`timestamp` 后端发 ISO 字符串、前端期望数字；`server_version`  handshake 仍是 `0.1.0`；`resume_agent_session` 命令未在前端声明。
- 移动端核心体验尚未闭环：首次启动未提示选工作目录、二维码没有 pair_token/device_token、抽屉方向仍是顶部滑入、发送消息后不会自动展开角色。
- 测试覆盖率低（<10%），且存在硬编码路径导致无法在 CI/他人机器复现的测试。

---

## 2. 各角色评审摘要

### 2.1 高级架构师

**最紧迫问题：**
1. 脚本与测试中的绝对路径硬编码（`scripts/`、`frontend/tests/`、`backend/tests/test_session_isolation.py`）。
2. 运行时 JSON 数据写到源码树（`backend/dionysus_server/main.py:39-48`、`persona/supervisor.py:436`），未使用 `Dionysus_DATA_DIR`。
3. PyInstaller `backend/dionysus_server.spec` 缺少 `dionysus_server.agent_adapters.strategies.codebuddy` hidden import。
4. 端口/主机默认值分散在 `vite.config.ts`、Electron、`launcher.py` 中。
5. `/api/open-cc-switch` 硬编码 macOS 应用路径，可移植性差。
6. 默认 persona/model（`exusiai`）散落在前后端 10+ 处。
7. 跨模块耦合：`main.py` 直接导入 `persona.loader` 的私有变量；`supervisor.py` 通过 `__self__` 调用 `SessionManager` 私有方法。

**Phase 2-2 建议：** 引入统一的 `dionysus_server.paths` 解析器；把可变成果集中到 `server.yaml`；公开 persona API；对齐前后端协议。

### 2.2 资深软件工程师

**严重缺陷：**
1. `backend/dionysus_server/agent_adapters/kimi_code_cli.py` 是死代码/重复实现，registry 已改用 `GenericCLIAdapter + KimiStrategy`。
2. `generic_cli.py` / `kimi_code_cli.py` 的 crash restart 逻辑只计数不真正重启。
3. `main.py` WebSocket `on_new_session` 闭包捕获旧 `session`，导致 adapter 被重复关闭。
4. `session/manager.py` 中 `change_working_dir` / `open_working_dir` 使用 macOS 专有 `open` 命令且写死示例路径。
5. `main.py` Live2D 上传存在路径遍历风险（未过滤 `..`）。
6. `frontend/src/stores/chatStore.ts` 的 `finalizeAgentMessage` 只检查最后一条消息，若最后是系统/用户消息则无法 finalize。
7. `chatStore` 持久化粒度粗，`sessions` 含全部消息，易撑爆 localStorage。

**Phase 2-2 建议：** 删除/合并 `kimi_code_cli.py`；修复 crash restart 与 finalize bug；上传路径校验；跨平台 `open_path` 抽象；重构 `handle_user_input`/`handle_option_selected` 重复流。

### 2.3 测试工程师

**现状：** 后端 23 个测试集中在 CodeBuddy/Supervisor/广播/注册表；前端 5 个测试只覆盖 `ThinkingSection` 与 thinking helper；核心模块（`SessionManager`、`SessionStore`、`GenericCLIAdapter`、strategy、persona engine）几乎无测试。

**P0 基础设施缺口：**
1. 无 `backend/tests/conftest.py` 与 fixtures（临时配置、临时 SQLite、fake adapter）。
2. 前端 `test-setup.ts` 未 mock `localStorage` / `matchMedia` / `fetch`，zustand persist 在测试间串状态。
3. `backend/tests/test_session_isolation.py` 硬编码数据库路径且依赖真实后端服务。
4. 无 GitHub Actions CI；QA 脚本不应在 CI 自动运行。

**Phase 2-2 建议：** 先补基础设施（fixtures、mock、store reset helper），再写核心单元测试；把真实 CLI 的 QA 脚本标记为 manual。

### 2.4 前端设计艺术家

**严重问题：**
1. 移动端 `MobileCompanionDrawer` 从顶部滑入，规划要求底部向上、占屏幕 80%。
2. 无统一 `Button`/`Card`/`BottomSheet` 基础组件，按钮样式在多处复制粘贴。
3. 主题 Token 缺少 `surface-0~3`、`text-primary/secondary`、`radius`、`shadow`、`glow` 等 Tech-Flat 语义。
4. `Live2DViewer` 没有 `live2d/image/video` 降级模式状态管理。
5. PWA manifest 引用不存在的 `/icon-192.png`、`/icon-512.png`；`theme-color` 硬编码 `#FF6B35`。
6. 触控目标过小（工具栏图标约 20×20 px）。
7. 未处理 `prefers-reduced-motion`。

**Phase 3 建议顺序：** Token 化 → 抽取基础组件 → 新增 Tech-Flat 主题 YAML → 重写底部 80% 抽屉 → Live2D 降级 → PWA 图标/字体/主题色 → 可访问性。

### 2.5 用户体验专家

**P0 体验缺口：**
1. 首次启动未提示选择工作目录；设置页没有全局 workspace 入口。
2. 二维码配对没有 `pair_token`（5 分钟）+ `device_token` 流程；无设备撤销。
3. 移动端没有 onboarding（Wi-Fi 检查 → 扫码 → 连接成功）。
4. 移动端不会自动加入主机的当前会话；没有会话列表同步端点。
5. 移动端抽屉方向/高度错误，无拖拽手柄，发送后不会自动展开。

**Phase 2/3 建议：** 在 Phase 2 先补齐首次启动 workspace picker、主机 base-URL/配对存储；Phase 3 完成底部抽屉、onboarding、二维码安全配对、消息缓存清除。

---

## 3. 统一优先级 TODO（Phase 2-2 / Phase 3）

### Phase 2-2（仓库整理与去硬编码）P0

1. **路径治理**：新建 `dionysus_server.paths`，集中处理 `CONFIG_DIR` / `DATA_DIR` / `WORKSPACE_DIR`，支持 `Dionysus_CONFIG_DIR` / `Dionysus_DATA_DIR`。
2. **运行时数据迁移**：把 `server_settings.json`、`agent_settings.json`、`wallpaper_settings.json`、`supervisor_settings.json` 写入 `DATA_DIR` 而非源码树。
3. **脚本去硬编码**：`scripts/`、`frontend/tests/*.py`、`backend/tests/test_session_isolation.py` 中的绝对路径改为项目根检测或临时目录。
4. **PyInstaller 补全**：在 `backend/dionysus_server.spec` 加入 `codebuddy` hidden import。
5. **协议对齐**：`timestamp` 统一为 Unix ms；`server_version` 统一为 `0.2.0`；前端 `ClientCommand` 补全 `resume_agent_session`。
6. **默认 persona 可配置**：在 `server.yaml` 声明 `default_persona_id` / `default_model`，前后端读取配置，减少硬编码 `exusiai`。
7. **跨平台命令抽象**：`open_working_dir` / `change_working_dir` 根据平台选择 `open`/`xdg-open`/`explorer`。
8. **修复已知 bug**：`on_new_session` 闭包、`finalizeAgentMessage`、Live2D 上传路径遍历、crash restart 无重启。
9. **测试基础设施**：新增 `backend/tests/conftest.py`（fixtures）、前端 `test-utils.tsx`（renderWithProviders、store reset）。

### Phase 3（Tech-Flat + 移动端适配）P0

10. **设计 Token 系统**：扩展 Theme 类型与 `tailwind.config.js`，新增 Tech-Flat 语义 Token。
11. **基础 UI 组件**：`Button`、`IconButton`、`Card`、`Input`、`BottomSheet`。
12. **Tech-Flat 主题 YAML**：保留默认主题，新增 `tech_flat.yaml`。
13. **重写 MobileCompanionDrawer**：底部 80% 抽屉、拖拽手柄、发送后自动展开、气泡在角色上方。
14. **Live2D 降级模式**：`live2d/image/video` 手动/自动切换。
15. **二维码安全配对**：后端 `/api/pair` + 一次性 `pair_token` + 长期 `device_token`；移动端 onboarding + 扫码。
16. **首次启动 workspace picker**：Electron/PWA 选择目录、支持“不再提醒”、设置中保留入口。
17. **PWA 资产补齐**：`icon-192.png` / `icon-512.png`、manifest 主题色同步、删除未用 Google Fonts。

---

## 4. 风险提醒

- `kimi_code_cli.py` 删除前需确认没有任何地方仍引用它。
- 路径改造可能影响 Electron 打包后的 `userData` 布局，需要在 macOS 上实际打包验证。
- 协议 `timestamp` 改动会影响已持久化的 localStorage 会话数据，升级时应做版本迁移或仅影响新消息。
- Tech-Flat 主题替换要保留默认主题，避免用户升级后视觉突变。

---

*本报告由 5 个 specialization agent（架构师、软件工程师、测试、前端设计、UX）独立评审后合成。*
