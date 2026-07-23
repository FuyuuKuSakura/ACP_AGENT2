# 前端组件盘点与迁移分类（v2 → v3 webview）

> 目标读者：把 v2 React 前端（`frontend/src`，约 8200 行）迁移到 v3（VS Code 插件 webview + 手机浏览器）的工程师。
> 迁移分类四类：**可直接迁移** / **需改造迁移** / **丢弃** / **移动端重建参考**（QR 配对与移动端抽屉专属）。
> 行数来自 `wc -l` 实测；行号引用均已核实。

## 1. 依赖清单与迁移判断

runtime 依赖（frontend/package.json:64-76）：

| 依赖 | 版本 | 判断 | 说明 |
|---|---|---|---|
| react / react-dom | ^18.2.0 | webview 可继续用 | VS Code webview 与移动端均可用 |
| zustand | ^4.5.2 | webview 可继续用 | 全部状态管理基于它 + persist 中间件 |
| framer-motion | ^11.0.8 | webview 可继续用 | 7 个组件的动效（清单见 design-style.md §4.6） |
| lucide-react | ^0.356.0 | webview 可继续用 | 全站唯一图标库 |
| react-markdown + remark-gfm | ^9.0.1 / ^4.0.0 | webview 可继续用 | MarkdownRenderer 的唯一渲染链 |
| clsx + tailwind-merge | ^2.1.0 / ^2.2.1 | webview 可继续用 | clsx 在 FoldedPanel/PersonaAvatar 使用；**tailwind-merge 无人引用，可丢** |
| tailwindcss（devDep） | ^3.4.1 | webview 可继续用 | 需确认 webview CSP 下构建期注入即可（编译产物无运行时依赖） |
| pixi.js | ^7.4.3 | webview 可继续用（**必须锁 v7**） | pixi-live2d-display 只兼容 PixiJS v7，升 v8 会直接坏 |
| pixi-live2d-display | ^0.5.0-beta | webview 可继续用 | 需配 `pixi-live2d-display/cubism4` 入口（Live2DViewer.tsx:4）+ 全局 `live2dcubismcore.min.js`（index.html:16） |
| electron / electron-builder（devDep） | ^31.7.7 / ^25.0.0 | **丢弃** | v3 形态改为 VS Code 插件 |
| vite-plugin-pwa（devDep） | ^0.19.2 | 移动端可继续用，桌面丢弃 | manifest 里的 theme_color `#FF6B35` 与现行金色主题不一致，历史残留 |

## 2. 逐目录组件盘点

### 2.1 components/Chat（消息流，风格最稳定的一块）

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| Chat/MarkdownRenderer.tsx | 78 | react-markdown 封装 + 代码块复制按钮 | 可直接迁移 |
| Chat/UserMessage.tsx | 15 | 用户气泡（金色右对齐） | 可直接迁移 |
| Chat/AgentMessage.tsx | 41 | agent 气泡 + 头像 + 中断标记 | 可直接迁移 |
| Chat/SystemStatus.tsx | 13 | 居中系统通知药丸 | 可直接迁移 |
| Chat/StreamingStatusBox.tsx | 74 | 流式状态气泡（转圈+计时） | 可直接迁移 |
| Chat/ThinkingSection.tsx | 50 | 思考过程折叠面板 | 可直接迁移 |
| Chat/MessageStream.tsx | 41 | 消息列表分发器（user/agent/system/streaming） | 可直接迁移 |
| Chat/ChatContainer.tsx | 74 | 滚动容器 + 选项渲染 + 自动滚底 | 需改造迁移（`sendMessage` prop 换消息桥） |
| Chat/__tests__/ThinkingSection.test.tsx | 34 | 折叠面板单测 | 可直接迁移 |

### 2.2 components/Input

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| Input/ChatInput.tsx | 270 | 输入框 + 斜杠指令解析（/plan /yolo /cd /switch /adapter，:27-57）+ 模式切换 + 历史浮窗 + IME composition 保护（:243-248） | 需改造迁移（transport 换消息桥；指令协议保留） |
| Input/QuickActionBar.tsx | 77 | Plan/Yolo/cd/Sessions 快捷按钮条 | **丢弃**（死代码：全仓库无任何引用） |

### 2.3 components/Layout

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| Layout/FoldedPanel.tsx | 106 | 四角折叠 clip-path 面板（标志性视觉） | 可直接迁移 |
| Layout/Header.tsx | 160 | 顶栏：返回/标题/adapter 状态 pill/连接状态/工具图标 | 需改造迁移（桌面端大量按钮在 VS Code 语境无意义，移动端参考保留） |
| Layout/Layout.tsx | 239 | 桌面三栏 + 移动双视图总布局 | **丢弃**（v3 桌面是 webview 单栏，整体结构重写；移动端布局逻辑见第四类） |
| Layout/NavSidebar.tsx | 105 | 桌面 w-32 导航条（4 项 + QR + 身份区） | **丢弃**（VS Code 活动栏取代之；QR 按钮逻辑移出） |
| Layout/RightPanel.tsx | 30 | 桌面右栏：对话框 + Live2D 组合 | 可直接迁移（纯组合组件） |
| Layout/SessionList.tsx | 263 | 会话列表 + 右键菜单 + 重命名内联编辑 | 需改造迁移（改 VS Code TreeView 或 webview 列表；新建/删除会话走 RPC） |
| Layout/SessionSettingsPanel.tsx | 209 | 会话设置抽屉（标题/Adapter/工作目录） | 需改造迁移（fetch 换 RPC） |
| Layout/ThemeStudio.tsx | 505 | 主题编辑器抽屉 + 手写 YAML 双向转换 | 需改造迁移（**先修 yamlToTheme `\s` bug，:480；正则 YAML 整体换 yaml 库，:459-505**） |
| Layout/ThemeSwitcher.tsx | 29 | 主题下拉切换 | 可直接迁移 |
| Layout/QRCodeButton.tsx | 87 | 配对二维码弹窗（portal，z-200） | **移动端重建参考**（配对入口，v3 桌面宿主改为插件内视图） |
| Layout/MobileCompanionBar.tsx | 45 | 移动端陪伴状态条 | **移动端重建参考** |
| Layout/MobileCompanionDrawer.tsx | 87 | 移动端 80vh 底部陪伴抽屉（可拖拽关闭） | **移动端重建参考** |
| Layout/MobileResourcePanel.tsx | 27 | 移动端右侧资源抽屉 | **移动端重建参考** |
| Layout/MobileSessionListHeader.tsx | 37 | 移动端会话列表头（搜索框无逻辑） | **移动端重建参考** |

### 2.4 components/Character

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| Character/CharacterDialogBox.tsx | 108 | 陪伴台词气泡 + 历史展开 + 打字三点动效 | 可直接迁移 |
| Character/PersonaAvatar.tsx | 159 | 角色头像（含上传/恢复菜单） | 需改造迁移（头像 URL 经 extension 中转） |

### 2.5 components/Live2D

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| Live2D/Live2DViewer.tsx | 466 | PixiJS + Live2D 渲染、注视参数注入、表情/动作队列、点触互动、降级 webm | 可直接迁移（核心渲染逻辑原样可用；仅 `/api/personas/{id}/companion` 一处 fetch :77 换桥；**锁死 pixi.js v7**） |

### 2.6 components/Options（选项交互三形态）

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| Options/OptionsRenderer.tsx | 24 | ui_type 分发（button_group/dropdown/card_list/input_confirm） | 可直接迁移 |
| Options/ButtonGroup.tsx | 32 | 药丸按钮组 | 可直接迁移 |
| Options/DropdownOptions.tsx | 36 | 原生 select 下拉 | 可直接迁移 |
| Options/CardList.tsx | 35 | 卡片列表 | 可直接迁移 |

### 2.7 components/Tools

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| Tools/ToolPanel.tsx | 169 | 执行进度 + 进度条 + 工具调用卡列表 | 可直接迁移 |
| Tools/ToolHUD.tsx | 54 | 当前工具浮动提示卡 | 可直接迁移 |
| Tools/TodoPanel.tsx | 70 | TODO 进度条 + 清单 | 可直接迁移 |

### 2.8 components/Pages

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| Pages/OverlayPage.tsx | 64 | 覆盖页容器（Esc 关闭、spring 浮入） | 可直接迁移 |
| Pages/PalettePage.tsx | 311 | 调色盘页：主题/字号/Live2D 开关 + **壁纸设置** | 需改造迁移（外观设置保留；壁纸部分 :60-120 整体剔除） |
| Pages/PersonaPage.tsx | 783 | 角色管理（CRUD、语料、Live2D 模型上传、supervisor 设置），13 处 fetch | 需改造迁移（REST 全换 RPC） |
| Pages/SystemSettingsPage.tsx | 304 | 系统设置（adapter 配置、历史条数、CC Switch） | 需改造迁移（fetch 换 RPC；`open-cc-switch` 桌面专属可丢） |

### 2.9 stores / hooks / lib / services / types

| 文件 | 行数 | 职责 | 分类 |
|---|---|---|---|
| stores/chatStore.ts | 773 | 会话/消息/选项/工具/陪伴/TODO 全部状态 | 需改造迁移（**按正确结构重写**，见 §5） |
| stores/themeStore.ts | 60 | 主题 persist + legacy 迁移 | 可直接迁移 |
| stores/layoutStore.ts | 67 | 面板开合 + 移动端视图路由 | 需改造迁移（桌面面板逻辑保留、mobileView 部分移交移动端） |
| stores/live2dStore.ts | 111 | Live2D 状态（presence/表情/动作/look_at） | 可直接迁移 |
| stores/settingsStore.ts | 97 | 字号/Live2D/TTS/历史条数 + **壁纸 5 字段** | 需改造迁移（剔除壁纸字段 :11-14 及 initWallpaperFromServer :67-91） |
| stores/adapterStore.ts | 47 | adapter 列表 | 需改造迁移（fetch 换 RPC） |
| stores/__tests__/chatStore.thinking.test.ts | 30 | thinking 追加单测 | 可直接迁移 |
| hooks/useMouseTracking.ts | 231 | 鼠标/触摸→Live2D 注视参数（lerp 平滑 + look_at 覆盖） | 可直接迁移 |
| hooks/useWebSocket.ts | 77 | WS 生命周期 hook + session_id 恢复拼参 | 需改造迁移（桌面换 postMessage 桥；移动端保留 WS） |
| services/websocket.ts | 133 | WS 客户端（指数退避重连、30s 心跳 ping） | 需改造迁移（移动端直接复用；桌面被消息桥取代） |
| lib/theme.ts | 158 | Theme 合并/注入/加载 | 需改造迁移（`fetch` :142,152 换桥；merge/apply 逻辑原样） |
| lib/tools.ts | 57 | 工具调用文本协议解析（🔧/🛠️ 正则） | 可直接迁移 |
| lib/layout.ts | 12 | panelWidthClasses 常量 | 可直接迁移 |
| types/protocol.ts | 342 | 全部 WS 消息与领域类型 | 可直接迁移（v3 协议的事实起点） |
| App.tsx | 321 | 根组件：主题应用 + WS 消息总线 + presence 映射 | 需改造迁移（WS 分发 switch :104-261 是核心资产；壁纸层 :299-311 丢弃） |
| main.tsx | 10 | React 入口 | 可直接迁移 |
| styles/index.css / variables.css | 208 / 91 | 全局样式 + token 兜底 | 可直接迁移（修正双源不一致，见 design-style.md §7） |

## 3. API 端点清单（裸 `fetch('/api/...')`，实测 32 处 / 10 个文件）

这些调用决定 extension 需要提供哪些消息/RPC。逐条列出（方法按上下文判断；GET 为默认）：

**lib/theme.ts**
1. `lib/theme.ts:142` GET `/api/themes/{themeId}.json` — 加载单主题
2. `lib/theme.ts:152` GET `/api/themes` — 主题列表

**stores（3 处）**
3. `stores/settingsStore.ts:69` GET `/api/wallpaper` — 初始化壁纸设置（v3 丢弃）
4. `stores/adapterStore.ts:30` GET `/api/adapters` — adapter 列表

**Live2D/Live2DViewer.tsx**
5. `Live2DViewer.tsx:77` GET `/api/personas/{personaId}/companion` — 陪伴配置（模型路径/缩放/触摸区）

**Pages/SystemSettingsPage.tsx（6 处）**
6. `:35` GET `/api/adapters`
7. `:40` GET `/api/settings/agent` — agent 配置
8. `:57` GET `/api/settings/server` — 服务器设置
9. `:88` POST `/api/settings/agent` — 保存 agent 配置
10. `:113` POST `/api/settings/server` — 保存服务器设置
11. `:279` POST `/api/open-cc-switch` — 打开本机 CC Switch.app（桌面专属，v3 丢弃）

**Pages/PersonaPage.tsx（13 处）**
12. `:67` GET `/api/personas` — 角色列表
13. `:85` GET `/api/settings/supervisor` — 陪伴 supervisor 配置
14. `:104` GET `/api/adapters`
15. `:119` GET `/api/personas/{id}` — 单角色详情（YAML 文本）
16. `:131` GET `/api/personas/{id}/corpus` — 语料
17. `:191` POST `/api/personas/create` — 新建角色
18. `:229` POST `/api/personas/{id}/corpus` — 上传语料文件
19. `:251` GET `/api/personas/{id}/corpus`
20. `:265` POST `/api/personas/{id}/corpus` — 保存语料文本
21. `:299` POST `/api/personas/{id}/live2d` — 上传 Live2D 模型包
22. `:325` DELETE `/api/personas/{id}/live2d`
23. `:346` POST `/api/personas/{id}/live2d/scale` — 调整模型缩放
24. `:370` POST `/api/settings/supervisor`

**Pages/PalettePage.tsx（3 处，均壁纸，v3 丢弃）**
25. `:67` POST `/api/wallpaper/config` — 保存壁纸参数
26. `:87` POST `/api/wallpaper` — 上传壁纸
27. `:117` DELETE `/api/wallpaper`

**Character/PersonaAvatar.tsx（2 处）**
28. `:57` POST `/api/personas/{id}/avatar` — 上传头像（FormData）
29. `:84` DELETE `/api/personas/{id}/avatar` — 恢复默认头像

**Layout/SessionSettingsPanel.tsx**
30. `:31` GET `/api/adapters`

**Layout/ThemeStudio.tsx（2 处）**
31. `:153` POST `/api/themes/{themeId}` — 保存自定义主题
32. `:182` DELETE `/api/themes/{themeId}`

**非 fetch 的隐式 HTTP 依赖**（迁移时同样要走桥）：`PersonaAvatar` 的头像 `<img src="/api/personas/{id}/avatar">`（PersonaAvatar.tsx:37-38）、`QRCodeButton` 的 `<img src="/api/pair/qr">`（QRCodeButton.tsx:57）、Live2D 模型/纹理静态目录（Live2DViewer.tsx:16 `/exusiai_live2d/...`）。extension 侧需用 `asWebviewUri` 或本地 HTTP 端口替代。

**RPC 合并建议**：32 处可归并为 ~10 个 extension 消息族——`themes.*`（list/get/save/delete）、`personas.*`（list/get/create/corpus/avatar/live2d/companion）、`adapters.list`、`settings.agent/server/supervisor`（get/set）、`wallpaper.*`（弃）、`pair.*`（移动端专属）。

## 4. Electron 耦合点清单

比预期少：**`frontend/src` 内没有任何 `window.electronAPI` 调用**（grep 无结果）。耦合全在工程层：

1. `frontend/package.json:5` — `"main": "electron/main.cjs"`；:7-53 electron-builder 打包配置（含把 backend dist/config 打进 extraResources）；:60-62 `electron:*` 脚本；:87-88 electron 依赖。
2. `electron/main.cjs`（仓库根）与 `frontend/electron/main.cjs` — 启动时 spawn Python 后端（`backend/.venv/bin/python scripts/launcher.py --no-frontend`），轮询 `/api/server/info` 就绪后 `loadURL`，窗口关闭时 kill 后端。
3. `electron/preload.cjs` — `contextBridge.exposeInMainWorld('dionysus', { platform })`，**前端从未消费 `window.dionysus`**（死接口）。
4. `frontend/src/stores/chatStore.ts:78` — `process.env.VITEST` 检测（Node 全局，仅为测试旁路 persist，非 Electron）。
5. 部署耦合（非 Electron 但需解除）：后端 `app.mount("/", StaticFiles(...))` 直接托管前端构建产物（backend/dionysus_server/main.py:1088），v3 桌面端不再需要后端托管静态页。
6. `App.tsx:50-53` — DEV 下挂 `window.__Dionysus_CHAT_STORE__` 供 QA 脚本使用（playwright 脚本依赖它，迁移测试基建时注意）。

## 5. chatStore.ts 重写要点（773 行，为什么必须重写而非搬运）

1. **双路径 action 重复（约占 40% 代码量）**：同一逻辑写两遍——"当前会话"版与"指定 sessionId"版。成对出现的有：`addAgentChunk` / `addAgentChunkToSession`（chatStore.ts:234 / :289）、`addThinkingChunk` / `addThinkingChunkToSession`（:327 / :361）、`finalizeAgentMessage` / `finalizeAgentMessageInSession`（:397 / :429）、`setOptions` / `setOptionsForSession`（:462 / :470）、`setStreamingStatus` / `setStreamingStatusById`（:536 / :540）、`setSessionStatus` / `setSessionStatusById`（:624 / :634）、`appendSystemMessage` / `appendSystemMessageToSession`（:643 / :664）、`setTodos` / `setTodosForSession`（:610 / :612）、`setCompanionLine` / `setSessionCompanionLine`（:550 / :559）。v3 应统一为"所有 action 带 sessionId，selector 层投影当前会话"。
2. **冗余镜像**：`messages` 是 `sessions[currentSessionId].messages` 的实时镜像（每个 action 都双向同步，如 :259-261, :319-323）；`todos` 镜像 `sessionTodos[currentSessionId]`（:610-621）；`companionLine`/`companionHistory` 镜像 `sessionCompanion[currentSessionId]`（:559-591）。镜像带来大量条件同步分支（`isCurrent ? ... : state.xxx`），是 bug 温床；v3 用派生 selector 取代镜像。
3. **persist 只存 sessions + currentSessionId**（:760-763），rehydrate 时手工把 messages 重新指回（:764-771）——进一步证明镜像多余。
4. `isTest` 环境嗅探改变 store 创建方式（:78, :755-772），测试基建味渗入生产代码。
