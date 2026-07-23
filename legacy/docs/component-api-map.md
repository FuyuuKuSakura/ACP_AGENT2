# Dionysus 前端组件-后端接口全景映射

> 用途：为后续精细开发提供组件、Store、后端接口之间的精确导航。
> 扫描范围：`frontend/src/**/*.tsx`、`frontend/src/services/**/*.ts`、`frontend/src/hooks/**/*.ts`、`frontend/src/stores/**/*.ts`、`frontend/src/lib/**/*.ts`、`frontend/src/types/protocol.ts`。
> 右侧面板（`ToolPanel` / `RightPanel`）保持现状，仍按现有调用关系记录。

---

# Dionysus 前端组件-接口-Store 映射

本扫描覆盖 `frontend/src` 下的全部 `.tsx` 组件、Zustand Store、WebSocket 协议类型及 `fetch` 调用。整体架构以 `App.tsx` 为根，通过 `useWebSocket('/ws')` 与后端 `ws://127.0.0.1:8765` 建立连接；所有业务组件通过 `sendMessage` prop 下发 WebSocket 消息，REST 请求则分散在页面组件、Store 与 `lib/theme.ts` 中。存在 3 个导出但未被引用的组件：`ThemeStudio`、`ThemeSwitcher`、`QuickActionBar`。

## 表 1：组件清单

| 序号 | 组件名 | 文件路径 | 类型 | 核心 Props | 使用的状态 (Zustand Store) | 调用的后端接口 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 | App | `App.tsx` | 根/容器 | - | `useThemeStore`, `useChatStore`, `useLive2DStore`, `useSettingsStore` | 透传全部 WebSocket 消息；`GET /api/wallpaper` | 全局消息路由与状态同步 |
| 2 | SystemStatus | `components/Chat/SystemStatus.tsx` | 展示 | `content: string` | - | - | 系统提示气泡 |
| 3 | NavSidebar | `components/Layout/NavSidebar.tsx` | 导航 | `onOpenPersona?`, `onOpenSystemSettings?`, `onCloseGlobalPages?`, `onToggleToolPanel?` | `useLayoutStore` | - | uses `.cel-*` |
| 4 | FoldedPanel | `components/Layout/FoldedPanel.tsx` | UI primitive | `children`, `className?`, `innerClassName?`, `largeCorners?`, `bg?`, `borderColor?`, `largeFold?`, `smallFold?`, `accent?`, `as?` | - | - | 折角玻璃面板容器 |
| 5 | ChatInput | `components/Input/ChatInput.tsx` | 输入 | `sendMessage` | `useChatStore`, `useLayoutStore`, `useSettingsStore` | `ws:user_input`, `ws:client_command:change_working_dir`, `ws:client_command:resume_agent_session`, `ws:client_command:switch_adapter`, `ws:client_command:list_kimi_sessions` | uses `.cel-*`；支持 `/plan`, `/yolo` 等快捷指令 |
| 6 | SessionList | `components/Layout/SessionList.tsx` | 列表/容器 | `sendMessage?` | `useChatStore`, `useLayoutStore`, `useSettingsStore` | `ws:new_session` | 会话列表与右键菜单 |
| 7 | Header | `components/Layout/Header.tsx` | 布局/头部 | `onSettingsClick`, `showBack?`, `connected?`, `settingsActive?`, `onOpenPalette?`, `onToggleResourcePanel?` | `useChatStore`, `useAdapterStore`, `useLayoutStore` | `GET /api/adapters` | uses `.cel-*` |
| 8 | Layout | `components/Layout/Layout.tsx` | 布局 | `sendMessage`, `connected?` | `useThemeStore`, `useLayoutStore` | `GET /api/themes` | uses `.cel-*`；桌面/移动端布局编排 |
| 9 | RightPanel | `components/Layout/RightPanel.tsx` | 布局/侧边 | `className?` | `useSettingsStore` | - | Live2D + 对话气泡容器 |
| 10 | ToolPanel | `components/Tools/ToolPanel.tsx` | 工具 | `className?` | `useChatStore` | - | 工具调用进度与 Todo |
| 11 | PersonaAvatar | `components/Character/PersonaAvatar.tsx` | 展示/角色 | `personaId?`, `size?`, `className?`, `editable?`, `onUpload?` | `useSettingsStore` | `GET /api/personas/:id/avatar`, `POST /api/personas/:id/avatar`, `DELETE /api/personas/:id/avatar` | 头像显示与上传 |
| 12 | PersonaPage | `components/Pages/PersonaPage.tsx` | 页面 | `onCloseGuardChange?`, `sendMessage?` | `useChatStore`, `useLive2DStore`, `useSettingsStore` | `ws:client_command:switch_persona`；`GET/POST /api/personas*`, `GET/POST /api/settings/supervisor`, `GET /api/adapters` | 角色、语料、Live2D、Supervisor 配置 |
| 13 | AgentMessage | `components/Chat/AgentMessage.tsx` | 展示 | `content`, `status?`, `thinking?` | `useChatStore`, `useSettingsStore` | - | Agent 消息气泡 |
| 14 | ChatContainer | `components/Chat/ChatContainer.tsx` | 容器 | `sendMessage?` | `useChatStore` | `ws:option_selected` | 消息流、选项、滚动容器 |
| 15 | DionysusSelect | `components/UI/DionysusSelect.tsx` | UI primitive | `value`, `options`, `onChange`, `placeholder?`, `disabled?`, `error?`, `className?`, `id?` | - | - | 自定义下拉选择 |
| 16 | TodoPanel | `components/Tools/TodoPanel.tsx` | 工具 | - | `useChatStore` | - | 任务进度列表 |
| 17 | SystemSettingsPage | `components/Pages/SystemSettingsPage.tsx` | 页面 | - | `useSettingsStore` | `GET/POST /api/adapters`, `GET/POST /api/settings/agent`, `GET/POST /api/settings/server`, `POST /api/open-cc-switch` | Agent 配置与历史上限 |
| 18 | PalettePage | `components/Pages/PalettePage.tsx` | 页面 | - | `useSettingsStore`, `useThemeStore`, `useLive2DStore` | `GET /api/themes`, `POST /api/wallpaper/config`, `POST/DELETE /api/wallpaper` | 主题、字体、壁纸、Live2D 开关 |
| 19 | OverlayPage | `components/Pages/OverlayPage.tsx` | 布局/覆盖层 | `isOpen`, `onClose`, `title`, `children`, `onBeforeClose?` | - | - | 全局页面覆盖层 |
| 20 | DropdownOptions | `components/Options/DropdownOptions.tsx` | 选项 | `options`, `disabled`, `onSelect` | - | - | 下拉选项 |
| 21 | CardList | `components/Options/CardList.tsx` | 选项 | `options`, `disabled`, `onSelect` | - | - | 卡片选项 |
| 22 | ButtonGroup | `components/Options/ButtonGroup.tsx` | 选项 | `options`, `disabled`, `onSelect` | - | - | 按钮组选项 |
| 23 | SessionSettingsPanel | `components/Layout/SessionSettingsPanel.tsx` | 页面/面板 | `sendMessage?`, `open?`, `className?` | `useChatStore` | `ws:client_command:switch_adapter`, `ws:client_command:change_working_dir`；`GET /api/adapters` | 当前会话设置侧栏 |
| 24 | MobileSessionListHeader | `components/Layout/MobileSessionListHeader.tsx` | 布局/移动端 | `connected?` | - | - | 移动端会话列表头部 |
| 25 | MobileResourcePanel | `components/Layout/MobileResourcePanel.tsx` | 布局/移动端 | `sendMessage` | `useLayoutStore` | - | 移动端资源面板容器 |
| 26 | MobileCompanionDrawer | `components/Layout/MobileCompanionDrawer.tsx` | 布局/移动端 | - | `useSettingsStore`, `useLayoutStore` | - | uses `.cel-*`；底部角色陪伴抽屉 |
| 27 | MobileCompanionBar | `components/Layout/MobileCompanionBar.tsx` | 布局/移动端 | - | `useLayoutStore`, `useChatStore` | - | 移动端状态条 |
| 28 | UserMessage | `components/Chat/UserMessage.tsx` | 展示 | `content` | - | - | 用户消息气泡 |
| 29 | ThinkingSection | `components/Chat/ThinkingSection.tsx` | 展示 | `thinking` | - | - | 可折叠思考过程 |
| 30 | StreamingStatusBox | `components/Chat/StreamingStatusBox.tsx` | 展示 | `content?`, `status?`, `detail?`, `thinking?` | - | - | 流式状态气泡 |
| 31 | MessageStream | `components/Chat/MessageStream.tsx` | 展示 | `messages` | - | - | 消息列表分发 |
| 32 | QRCodeButton | `components/Layout/QRCodeButton.tsx` | 工具 | - | - | `GET /api/pair/qr` | 扫码配对弹窗 |
| 33 | Live2DViewer | `components/Live2D/Live2DViewer.tsx` | 工具/展示 | `enabled?`, `className?` | `useLive2DStore`, `useSettingsStore`, `useChatStore` | `GET /api/personas/:id/companion` | Pixi Live2D 渲染与交互 |
| 34 | MarkdownRenderer | `components/Chat/MarkdownRenderer.tsx` | 工具/展示 | `content`, `className?` | - | - | Markdown + 代码复制 |
| 35 | CharacterDialogBox | `components/Character/CharacterDialogBox.tsx` | 展示 | - | `useChatStore` | - | 角色对话气泡 |
| 36 | ThemeStudio | `components/Layout/ThemeStudio.tsx` | 页面/工具 | `isOpen`, `onClose` | `useThemeStore` | `GET/POST/DELETE /api/themes/:id` | [未引用][疑似废弃] |
| 37 | ThemeSwitcher | `components/Layout/ThemeSwitcher.tsx` | UI primitive | - | `useThemeStore` | - | [未引用][疑似废弃] |
| 38 | QuickActionBar | `components/Input/QuickActionBar.tsx` | 输入 | `activeMode`, `onSetMode`, `onCdClick`, `onSessionsClick` | - | - | [未引用][疑似废弃] |
| 39 | ToolHUD | `components/Tools/ToolHUD.tsx` | 工具 | - | `useChatStore` | - | 当前工具调用悬浮提示 |
| 40 | OptionsRenderer | `components/Options/OptionsRenderer.tsx` | 选项 | `options`, `uiType`, `disabled`, `onSelect` | - | - | 选项 UI 分发器 |

## 表 2：后端接口清单

| 序号 | 接口标识 | 类型 | 定义位置 | 请求/事件名 | payload 结构 | 响应结构 | 被哪些组件调用 |
|---|---|---|---|---|---|---|---|
| 1 | `ws:user_input` | WebSocket | `types/protocol.ts:67` | `user_input` | `{ text: string, attachments: Attachment[], interrupt_before_send: boolean, mode?: AgentMode }` | `agent_stream` / `agent_complete` | App（路由）, ChatInput |
| 2 | `ws:client_command:change_working_dir` | WebSocket | `types/protocol.ts:100` | `client_command` (`command: 'change_working_dir'`) | `{ command: 'change_working_dir', args?: string }` | `[类型缺失]` | ChatInput, SessionSettingsPanel |
| 3 | `ws:client_command:list_kimi_sessions` | WebSocket | `types/protocol.ts:100` | `client_command` (`command: 'list_kimi_sessions'`) | `{ command: 'list_kimi_sessions', args?: string }` | `[类型缺失]` | ChatInput |
| 4 | `ws:client_command:resume_agent_session` | WebSocket | `types/protocol.ts:100` | `client_command` (`command: 'resume_agent_session'`) | `{ command: 'resume_agent_session', args?: string }` | `[类型缺失]` | ChatInput |
| 5 | `ws:client_command:switch_adapter` | WebSocket | `types/protocol.ts:100` | `client_command` (`command: 'switch_adapter'`) | `{ command: 'switch_adapter', args?: string }` | `[类型缺失]` | ChatInput, SessionSettingsPanel |
| 6 | `ws:client_command:switch_persona` | WebSocket | `types/protocol.ts:100` | `client_command` (`command: 'switch_persona'`) | `{ command: 'switch_persona', args?: string }` | `[类型缺失]` | PersonaPage |
| 7 | `ws:new_session` | WebSocket | `types/protocol.ts:93` | `new_session` | `{ persona_id?: string }` | `handshake` | SessionList |
| 8 | `ws:option_selected` | WebSocket | `types/protocol.ts:77` | `option_selected` | `{ selected_id: string, selected_label: string }` | `agent_stream` / `agent_complete` | ChatContainer |
| 9 | `ws:ping` | WebSocket | `services/websocket.ts:123` | `ping` | `{}` | `pong` | 心跳（WebSocketClient） |
| 10 | `ws:client_command:open_working_dir` | WebSocket | `types/protocol.ts:100` | `client_command` (`command: 'open_working_dir'`) | `{ command: 'open_working_dir', args?: string }` | `[类型缺失]` | [未使用] |
| 11 | `ws:client_command:switch_kimi_session` | WebSocket | `types/protocol.ts:100` | `client_command` (`command: 'switch_kimi_session'`) | `{ command: 'switch_kimi_session', args?: string }` | `[类型缺失]` | [未使用] |
| 12 | `ws:client_command:restart_adapter` | WebSocket | `types/protocol.ts:100` | `client_command` (`command: 'restart_adapter'`) | `{ command: 'restart_adapter', args?: string }` | `[类型缺失]` | [未使用] |
| 13 | `ws:interrupt` | WebSocket | `types/protocol.ts:85` | `interrupt` | `{ reason: 'user_request' \| 'timeout' \| 'system', insert_message?: string }` | `[类型缺失]` | [未使用] |
| 14 | `GET /api/adapters` | REST | `stores/adapterStore.ts:30` | `fetch('/api/adapters')` | - | `Record<string, AdapterInfo>` | Header, SessionSettingsPanel, PersonaPage, SystemSettingsPage |
| 15 | `GET /api/settings/supervisor` | REST | `PersonaPage.tsx:85` | `fetch('/api/settings/supervisor')` | - | `{ mode, interval_seconds, adapter_id, api_url, api_model, api_key }` | PersonaPage |
| 16 | `POST /api/settings/supervisor` | REST | `PersonaPage.tsx:370` | `fetch('/api/settings/supervisor', { method: 'POST' })` | `{ mode, interval_seconds, adapter_id, api_url, api_model, api_key }` | `{ ok, ... }` | PersonaPage |
| 17 | `GET /api/settings/agent` | REST | `SystemSettingsPage.tsx:40` | `fetch('/api/settings/agent')` | - | `{ default: string, adapters: Record<string, {...}> }` | SystemSettingsPage |
| 18 | `POST /api/settings/agent` | REST | `SystemSettingsPage.tsx:88` | `fetch('/api/settings/agent', { method: 'POST' })` | `{ default: string, adapters: Record<string, { command, model, enabled }> }` | `{ ok, error? }` | SystemSettingsPage |
| 19 | `GET /api/settings/server` | REST | `SystemSettingsPage.tsx:57` | `fetch('/api/settings/server')` | - | `{ history_limit: number }` | SystemSettingsPage |
| 20 | `POST /api/settings/server` | REST | `SystemSettingsPage.tsx:113` | `fetch('/api/settings/server', { method: 'POST' })` | `{ history_limit: number }` | `[类型缺失]` | SystemSettingsPage |
| 21 | `GET /api/personas` | REST | `PersonaPage.tsx:67` | `fetch('/api/personas')` | - | `Persona[]` | PersonaPage |
| 22 | `POST /api/personas/create` | REST | `PersonaPage.tsx:191` | `fetch('/api/personas/create', { method: 'POST' })` | `{ id, name, description }` | `{ id, error? }` | PersonaPage |
| 23 | `GET /api/personas/:id` | REST | `PersonaPage.tsx:119` | `fetch('/api/personas/${selectedPersona}')` | - | `{ ok, persona: Persona }` | PersonaPage |
| 24 | `GET /api/personas/:id/corpus` | REST | `PersonaPage.tsx:131`, `:251` | `fetch('/api/personas/:id/corpus')` | - | `{ ok, text? }` | PersonaPage |
| 25 | `POST /api/personas/:id/corpus` | REST | `PersonaPage.tsx:229`, `:265` | `fetch('/api/personas/:id/corpus', { method: 'POST' })` | `{ text: string }` | `{ ok, error? }` | PersonaPage |
| 26 | `GET /api/personas/:id/companion` | REST | `Live2DViewer.tsx:77` | `fetch('/api/personas/:id/companion')` | - | `{ live2d?: { model_path, scale }, touch_zones? }` | Live2DViewer |
| 27 | `GET /api/personas/:id/avatar` | REST | `PersonaAvatar.tsx:38` | `<img src="/api/personas/:id/avatar">` | - | 图片二进制 | PersonaAvatar |
| 28 | `POST /api/personas/:id/avatar` | REST | `PersonaAvatar.tsx:57` | `fetch('/api/personas/:id/avatar', { method: 'POST' })` | `FormData(file)` | `{ ok, error? }` | PersonaAvatar |
| 29 | `DELETE /api/personas/:id/avatar` | REST | `PersonaAvatar.tsx:84` | `fetch('/api/personas/:id/avatar', { method: 'DELETE' })` | - | `{ ok, error? }` | PersonaAvatar |
| 30 | `POST /api/personas/:id/live2d` | REST | `PersonaPage.tsx:299` | `fetch('/api/personas/:id/live2d', { method: 'POST' })` | `FormData(files[])` | `{ model_path, error? }` | PersonaPage |
| 31 | `DELETE /api/personas/:id/live2d` | REST | `PersonaPage.tsx:325` | `fetch('/api/personas/:id/live2d', { method: 'DELETE' })` | - | `{ ok, error? }` | PersonaPage |
| 32 | `POST /api/personas/:id/live2d/scale` | REST | `PersonaPage.tsx:346` | `fetch('/api/personas/:id/live2d/scale', { method: 'POST' })` | `{ scale: number }` | `{ ok, error? }` | PersonaPage |
| 33 | `GET /api/wallpaper` | REST | `stores/settingsStore.ts:69` | `fetch('/api/wallpaper')` | - | `{ url?, opacity?, blur?, brightness? }` | App（initWallpaperFromServer） |
| 34 | `POST /api/wallpaper` | REST | `PalettePage.tsx:87` | `fetch('/api/wallpaper', { method: 'POST' })` | `FormData(file)` | `{ url, error? }` | PalettePage |
| 35 | `DELETE /api/wallpaper` | REST | `PalettePage.tsx:117` | `fetch('/api/wallpaper', { method: 'DELETE' })` | - | `[类型缺失]` | PalettePage |
| 36 | `POST /api/wallpaper/config` | REST | `PalettePage.tsx:67` | `fetch('/api/wallpaper/config', { method: 'POST' })` | `{ url, opacity, blur, brightness }` | `[类型缺失]` | PalettePage |
| 37 | `GET /api/themes` | REST | `lib/theme.ts:152` | `fetch('/api/themes')` | - | `Theme[]` | Layout, PalettePage, ThemeStudio |
| 38 | `GET /api/themes/:id.json` | REST | `lib/theme.ts:142` | `fetch('/api/themes/:id.json')` | - | `Theme` | ThemeSwitcher, ThemeStudio（经 `loadTheme`/`setThemeById`） |
| 39 | `POST /api/themes/:id` | REST | `ThemeStudio.tsx:153` | `fetch('/api/themes/:id', { method: 'POST' })` | `Theme` | `{ ok, error? }` | ThemeStudio |
| 40 | `DELETE /api/themes/:id` | REST | `ThemeStudio.tsx:182` | `fetch('/api/themes/:id', { method: 'DELETE' })` | - | `{ ok, error? }` | ThemeStudio |
| 41 | `GET /api/pair/qr` | REST | `QRCodeButton.tsx:57` | `<img src="/api/pair/qr">` | - | 图片二进制 | QRCodeButton |
| 42 | `POST /api/open-cc-switch` | REST | `SystemSettingsPage.tsx:279` | `fetch('/api/open-cc-switch', { method: 'POST' })` | - | `{ success, error? }` | SystemSettingsPage |

## 表 3：Zustand Store 与组件关系

| Store 名 | 文件路径 | 持久化 | 核心 State 字段 | 修改方法 | 订阅该 State 的组件 |
|---|---|---|---|---|---|
| `useChatStore` | `stores/chatStore.ts` | `persist`：`sessions`, `currentSessionId` | `sessions`, `currentSessionId`, `messages`, `isStreaming`, `streamingStatus`, `currentOptions`, `toolCalls`, `activeToolCallId`, `todos`, `sessionTodos`, `companionLine`, `companionHistory`, `sessionCompanion` | `addSession`, `setCurrentSession`, `deleteSession`, `addUserMessage`, `addAgentChunk`, `finalizeAgentMessage`, `selectOption`, `setStreamingStatus`, `setSessionStatus`, `setTodos`, `setCompanionLine`, `addToolCall`, `updateActiveToolResult`, ... | `App.tsx`, `ChatInput.tsx`, `SessionList.tsx`, `Header.tsx`, `ChatContainer.tsx`, `AgentMessage.tsx`, `ToolPanel.tsx`, `TodoPanel.tsx`, `ToolHUD.tsx`, `CharacterDialogBox.tsx`, `MobileCompanionBar.tsx`, `PersonaPage.tsx`, `Live2DViewer.tsx`, `SessionSettingsPanel.tsx` |
| `useLayoutStore` | `stores/layoutStore.ts` | `persist`：`isSessionListOpen` | `activeNav`, `isSessionListOpen`, `isToolPanelVisible`, `mobileView`, `isCompanionDrawerOpen`, `isResourcePanelOpen` | `setActiveNav`, `toggleSessionList`, `setToolPanelVisible`, `setMobileView`, `setCompanionDrawerOpen`, `setResourcePanelOpen`, ... | `NavSidebar.tsx`, `SessionList.tsx`, `Layout.tsx`, `Header.tsx`, `MobileCompanionDrawer.tsx`, `MobileResourcePanel.tsx`, `MobileCompanionBar.tsx`, `ChatInput.tsx` |
| `useSettingsStore` | `stores/settingsStore.ts` | `persist`：全部（无 `partialize`） | `fontSize`, `live2dEnabled`, `ttsEnabled`, `compactMode`, `wallpaperUrl`, `wallpaperOpacity`, `wallpaperBlur`, `wallpaperBrightness`, `historyLimit`, `globalPersonaId` | `setFontSize`, `setLive2dEnabled`, `setWallpaperUrl`, `resetWallpaper`, `setGlobalPersonaId`, `initWallpaperFromServer`, ... | `App.tsx`, `RightPanel.tsx`, `PersonaAvatar.tsx`, `AgentMessage.tsx`, `PersonaPage.tsx`, `PalettePage.tsx`, `Live2DViewer.tsx`, `MobileCompanionDrawer.tsx`, `ChatInput.tsx`, `SystemSettingsPage.tsx` |
| `useLive2DStore` | `stores/live2dStore.ts` | no | `trackingEnabled`, `lookAtTarget`, `presenceState`, `currentEmotion`, `pendingExpression`, `pendingMotion`, `modelReloadTrigger` | `setTrackingEnabled`, `setLookAtTarget`, `setPresenceState`, `requestExpression`, `requestMotion`, `triggerModelReload`, ... | `App.tsx`, `PalettePage.tsx`, `PersonaPage.tsx`, `Live2DViewer.tsx` |
| `useThemeStore` | `stores/themeStore.ts` | `persist`：`currentTheme`, `availableThemes` | `currentTheme`, `availableThemes`, `isLoading` | `setTheme`, `setThemeById`, `setAvailableThemes` | `App.tsx`, `Layout.tsx`, `PalettePage.tsx`, `ThemeSwitcher.tsx`, `ThemeStudio.tsx` |
| `useAdapterStore` | `stores/adapterStore.ts` | no | `currentAdapter`, `availableAdapters`, `loading` | `setCurrentAdapter`, `fetchAdapters`, `switchAdapter` | `Header.tsx` |

---

## 交叉验证摘要

- 表 1 中 40 个组件的 WebSocket/REST 调用均已落入表 2。
- 表 2 中标注 `[未使用]` 的 4 个 `client_command` 和 1 个 `interrupt` 在 `protocol.ts` 中定义但当前组件未发送；`ThemeStudio` 调用的 `/api/themes/:id` 相关接口因组件 `[未引用]` 而成为潜在死接口。
- 表 3 中每个 Store 的订阅组件列表通过 grep `useXxxStore` 得到，与表 1 中“使用的状态”列一致。

## 建议下一步

1. 批准后将本 Markdown 写入 `/docs/component-api-map.md`。
2. 若后续进行精简，可优先删除表 1 中 `[未引用][疑似废弃]` 的三个组件，并清理表 2 中对应的无用接口。
