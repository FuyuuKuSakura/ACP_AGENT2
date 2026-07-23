# Dionysus Agent Lens 全栈全流程实施方案

> **⚠️ 已废弃（Superseded）**：本文档为 v2.0 设计草稿（2025-07-12），其描述的 Node monorepo 架构从未按此实现（v2 实际实现为 Python FastAPI + Electron + React），现已被 v3 架构取代。当前有效架构见 `docs/v3/architecture.md`，旧实现行为规格见 `docs/v3/extract/`。本文档仅保留作历史/概念参考（适配器+策略分离、核心共享+双模式部署、状态驱动协议等思想在 v3 中延续）。

> **版本**: v2.0-fullstack  
> **产品**: Dionysus Agent Lens — Agent 执行可视化 + Live2D 角色管家  
> **核心形态**: VS Code Extension（主）+ 可选 dionysus-bridge CLI（常驻）+ Mobile PWA（远程）  
> **日期**: 2025-07-12  
> **状态**: 技术方案（Draft）

---

## 0. 方案总览

### 0.1 核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Dionysus Agent Lens                         │
│                                                                 │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │ @dionysus/extension  │    │ @dionysus/bridge (optional)  │  │
│  │ VS Code Extension    │    │ npx dionysus-bridge          │  │
│  │                      │    │                              │  │
│  │ • WebView 面板       │    │ • 独立 WS 服务器             │  │
│  │ • 角色渲染           │◄──►│ • CLI 进程管理               │  │
│  │ • 仪表盘             │    │ • 管家引擎                   │  │
│  │ • IDE 集成           │    │ • 会话持久化                 │  │
│  └──────┬───────────────┘    └──────────┬───────────────────┘  │
│         │                                 │                     │
│         └──────────┬──────────────────────┘                     │
│                    │                                            │
│         ┌──────────▼──────────────┐                            │
│         │  @dionysus/core (npm)   │                            │
│         │                         │                            │
│         │ • AgentPool (进程管理)   │                            │
│         │ • ParserEngine (解析)    │                            │
│         │ • ButlerEngine (管家)    │                            │
│         │ • SessionStore (存储)    │                            │
│         │ • WS Server/Client       │                            │
│         │ • 多 Agent 适配器        │                            │
│         └──────────┬──────────────┘                            │
│                    │                                            │
│    ┌───────────────┼───────────────┐                          │
│    │               │               │                          │
│ ┌──▼───┐      ┌───▼───┐      ┌───▼────┐                     │
│ │Claude│      │ Kimi  │      │ Codex  │  ... 更多 CLI       │
│ │ Code │      │ Code  │      │ CLI    │                     │
│ └──┬───┘      └───┬───┘      └───┬────┘                     │
│    │               │               │                          │
│    └───────────────┴───────────────┘                          │
│                    │                                            │
│              Wi-Fi 局域网                                       │
│                    │                                            │
│         ┌──────────▼──────────┐                               │
│         │  Mobile PWA         │                               │
│         │ • 简化角色 (CSS)    │                               │
│         │ • 发送指令          │                               │
│         │ • 接收推送通知      │                               │
│         └─────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

### 0.2 技术栈一览

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **前端 UI** | React + TypeScript + Vite | ^18.3 + ^5.7 + ^6.0 | Extension WebView / PWA |
| **前端状态** | Zustand | ^5.0 | 全局状态管理 |
| **前端动画** | Framer Motion | ^11.15 | 角色动画 + 气泡 |
| **角色渲染** | pixi-live2d-display + PixiJS | ^0.5 + ^7.4 | Live2D WebGL |
| **前端样式** | CSS Modules + CSS Variables | - | 设计 Token 系统 |
| **后端运行时** | Node.js | ^20.10 LTS | Extension + Bridge |
| **后端通信** | ws (WebSocket) | ^8.18 | 三端实时通信 |
| **CLI 进程** | node-pty | ^1.0 | 伪终端管理 |
| **流处理** | readline + strip-ansi | 原生 + ^7.1 | stdout 解析 |
| **数据存储** | lowdb | ^7.0 | JSON 文件数据库 |
| **打包构建** | tsup | ^8.3 | npm 包构建 |
| **测试** | Vitest | ^2.1 | 单元测试 |

### 0.3 包结构

```
dionysus/
├── packages/
│   ├── @dionysus/core/          # 共享核心（npm 包）
│   ├── @dionysus/extension/     # VS Code Extension
│   ├── @dionysus/bridge/        # CLI 桥接器（npm 全局命令）
│   └── @dionysus/mobile/        # PWA 移动端
├── package.json                  # workspace 根
└── turbo.json                    # Turborepo 构建编排
```

---

# Dionysus Agent Lens — 前端组件库与设计规范

> 本章节定义 Dionysus Agent Lens 的前端技术架构、组件设计规范及核心组件实现细节。涵盖 VS Code Extension WebView、React 组件库、Live2D 渲染系统、CSS 设计 Token 体系及移动端 PWA 的技术选型与目录结构。

---

## 1. 前端技术架构总览

### 1.1 前端分层架构

Dionysus Agent Lens 的前端采用**四层分层架构**，从 VS Code Extension Host 到 WebView 渲染层形成清晰的单向数据流：

```
┌─────────────────────────────────────────────────────────────┐
│                  Extension Host 层                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Extension   │  │ WebSocket   │  │ File System Watcher │ │
│  │ Activation  │  │ Server      │  │ (agent metadata)    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                    │             │
│         └────────────────┼────────────────────┘             │
│                          ▼                                  │
│         ┌─────────────────────────────────────┐             │
│         │  VS Code API (postMessage / Commands)│             │
│         └─────────────────────────────────────┘             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   WebView 容器层                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  WebView Panel (vscode.WebviewPanel)                │   │
│  │  ├── Character Panel (主面板: Live2D + 气泡)        │   │
│  │  ├── Dashboard Panel (仪表盘: 执行状态)             │   │
│  │  └── Settings Panel (设置面板)                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│  ┌───────────────────────▼──────────────────────────────┐  │
│  │  Vite Dev Server / Production Build (ESM Bundle)    │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  React 应用层                                 │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │  App    │  │ Zustand  │  │  Router  │  │ VS Code API  │ │
│  │ Root    │  │ Stores   │  │ (View)   │  │ Bridge       │ │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘ │
│       └─────────────┴─────────────┴───────────────┘         │
│                          │                                  │
│       ┌──────────────────▼──────────────────┐              │
│       │     Panel Components (页面级)       │              │
│       │  CharacterPanel / DashboardPanel    │              │
│       └──────────────────┬──────────────────┘              │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  组件与渲染层                                 │
│  ┌─────────────────┐  ┌───────────────────────────────────┐│
│  │  UI 基础组件    │  │  业务组件                         ││
│  │  (原子组件)     │  │  Live2DViewer                     ││
│  │  Button / Card  │  │  ├── PixiJS Application           ││
│  │  Badge / Input  │  │  ├── pixi-live2d-display          ││
│  │  ...            │  │  ├── EmotionEngine                ││
│  └─────────────────┘  │  └── TouchHandler                 ││
│                       ├───────────────────────────────────┤│
│  ┌─────────────────┐  │  BubbleSystem                     ││
│  │ 动画系统         │  │  ├── BubbleQueue (优先级队列)      ││
│  │ Framer Motion   │  │  └── AnimatePresence              ││
│  │ CSS Transitions │  ├───────────────────────────────────┤│
│  └─────────────────┘  │  StatusDashboard                  ││
│                       │  ├── StatusBar / ProgressRing     ││
│                       │  ├── FileChangeList               ││
│                       │  └── Timer                        ││
│                       └───────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**数据流向**：Extension Host 通过 `postMessage` 向 WebView 推送 Agent 状态变更 → WebView 内的 VS Code API Bridge 接收消息 → Zustand Store 更新 → React 组件重渲染 → Framer Motion / PixiJS 执行动画。反向流（用户点击角色、气泡确认）通过 `acquireVsCodeApi().postMessage()` 回传至 Extension Host。

---

### 1.2 技术栈选型（精确到包名+版本）

| 层级 | 技术选型 | 版本 | 选型理由 | 替代方案及淘汰原因 |
|------|---------|------|---------|----------------|
| UI 框架 | `react` | `^18.3.1` | 团队熟悉、生态成熟、Concurrent Features 支持 | Preact（节省 100KB 但对 Extension 不重要，且兼容风险高）、Vue（团队技术栈不匹配，迁移成本高） |
| 构建工具 | `vite` | `^6.0.0` | 极速 HMR（<50ms）、ESM 原生支持、插件生态丰富 | Webpack（配置复杂、冷启动慢 5-10 倍）、Turbopack（尚不稳定，Vite 6 已足够快） |
| 语言 | `typescript` | `^5.7.0` | 类型安全、VS Code 生态深度一致、类型推断增强 | JavaScript（无类型，大型项目维护困难）、Deno（生态不成熟，npm 兼容层有坑） |
| 组件样式 | CSS Modules | — | 作用域隔离零冲突、无运行时开销、与 VS Code 主题变量天然契合 | Styled-components（运行时开销约 3-5KB，CSS-in-JS 在 WebView 中偶发注入顺序问题）、Tailwind（在 WebView 中需引入 15KB+ 的 Preflight 样式，与 VS Code 主题冲突风险高） |
| 状态管理 | `zustand` | `^5.0.0` | 体积极轻（~1KB）、无需 Provider 包裹、TS 类型推导完美、支持 Selector 自动优化重渲染 | Redux（样板代码过多，RTK 也要 10KB+）、Jotai（原子化心智模型过度设计，Zustand 足够）、MobX（装饰器语法争议，包体积大） |
| 动画引擎 | `framer-motion` | `^11.15.0` | 声明式 API 与 React 深度集成、AnimatePresence 处理进出场动画、手势拖拽支持 | GSAP（命令式 API，与 React 生命周期配合困难，学习成本高）、React Spring（维护滞后，v9 长期 beta，文档混乱） |
| Live2D 渲染 | `pixi-live2d-display` | `^0.5.0-beta` | Live2D 官方推荐 WebGL 渲染方案、支持 Cubism 4/5 模型格式、社区维护活跃 | 自研 WebGL 渲染（维护成本极高，需处理模型解析/骨骼动画/贴图管理等复杂逻辑，迭代周期长） |
| WebGL 引擎 | `pixi.js` | `^7.4.2` | `pixi-live2d-display` 的 peer dependency、成熟的 2D WebGL 渲染管线、自动回退 Canvas2D | Three.js（过重，核心包 150KB+，2D 场景大材小用）、自研 WebGL（开发周期不可控） |
| 气泡系统 | 自研（CSS Modules + Framer Motion） | — | 高度定制化需求（角色关联、优先级队列、自适应位置、Tail 指向）、无现成库满足 | `react-toastify`（Toast 样式不满足角色气泡场景）、`react-hot-toast`（同理，无 Tail 指向、无角色绑定） |
| 图标库 | `lucide-react` | `^0.460.0` | 轻量（单个图标按需引入）、树摇优化彻底、设计线条风格与 VS Code 原生图标一致 | FontAwesome（体积大，免费版图标有限，品牌风格过重）、`@mdi/react`（Material Design 风格与 VS Code 不符） |
| 表单处理 | `react-hook-form` | `^7.54.0` | 性能最优（非受控组件，无重渲染）、验证集成友好、体积小（~9KB gzipped） | Formik（重、API 陈旧，已停止积极维护）、React Final Form（同样重，学习曲线陡峭） |
| 验证库 | `zod` | `^3.24.0` | TS-first schema 定义、错误信息可定制、与 react-hook-form 通过 `@hookform/resolvers` 无缝集成 | Yup（非 TS-first，类型推导弱）、Joi（体积大 30KB+，浏览器端不适合）、Valibot（生态不如 Zod 成熟） |
| 测试框架 | `vitest` + `@testing-library/react` | `^2.0.0` / `^16.0.0` | Vite 原生集成（共享配置）、React Testing Library 行业标准、JSDOM 模式支持 | Jest（需额外配置 ESM/TypeScript 支持，与 Vite 配置重复维护） |
| 代码规范 | `eslint` + `@typescript-eslint` + `prettier` | `^9.0.0` / `^8.0.0` / `^3.4.0` | VS Code 生态标准、插件丰富、团队最熟悉 | Biome（生态不成熟，部分 ESLint 规则缺失）、Rome（已停止维护） |
| PWA 支持 | `vite-plugin-pwa` | `^0.21.0` | Vite 官方 PWA 插件、自动 Service Worker 生成、manifest 管理 | `workbox-webpack-plugin`（需要 Webpack）、手动编写 SW（维护成本高） |

#### 关键依赖版本锁定说明

以下包存在跨版本兼容约束，必须在 `package.json` 中严格锁定：

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^5.0.0",
    "framer-motion": "^11.15.0",
    "pixi.js": "^7.4.2",
    "pixi-live2d-display": "^0.5.0-beta",
    "lucide-react": "^0.460.0",
    "react-hook-form": "^7.54.0",
    "zod": "^3.24.0",
    "@hookform/resolvers": "^3.9.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "prettier": "^3.4.0",
    "vite-plugin-pwa": "^0.21.0"
  }
}
```

**版本约束说明**：
- `pixi-live2d-display@^0.5.0-beta` 必须搭配 `pixi.js@^7.x`，PixiJS v8 已重构核心（迁移到 WebGPU 优先），该插件尚未适配。
- `zustand@^5.0.0` 相比 v4 大幅优化了 TypeScript 类型推导，且引入 `createWithEqualityFn` 解决选择器引用稳定问题。
- `framer-motion@^11.15.0` 支持 React 18 Concurrent Mode 的 `useId` 兼容，AnimatePresence 的 `mode="popLayout"` 布局动画更稳定。

---

### 1.3 目录结构（精确到文件级别）

```
extension/webview/                           # VS Code WebView 前端工程
├── src/
│   ├── main.tsx                             # WebView 入口：创建 React Root，注入 VS Code API
│   ├── App.tsx                              # 根组件 + 视图路由（Character/Dashboard/Settings）
│   ├── index.css                            # 全局样式 + CSS Custom Properties（Design Token）
│   │
│   ├── stores/                              # Zustand 状态管理（按领域拆分）
│   │   ├── useAgentStore.ts                 # Agent 状态：idle/connecting/thinking/executing/success/error
│   │   ├── useCharacterStore.ts             # 角色状态：emotion/position/scale/modelPath
│   │   ├── useBubbleStore.ts                # 气泡系统状态：队列/优先级/超时管理
│   │   ├── useDashboardStore.ts             # 仪表盘状态：progress/filesChanged/duration
│   │   └── useSettingsStore.ts              # 用户设置：角色选择/主题偏好/行为配置
│   │
│   ├── components/                          # 组件目录（按领域组织）
│   │   ├── Live2DViewer/                    # Live2D 渲染核心组件
│   │   │   ├── Live2DViewer.tsx             # 主渲染组件：PIXI.Application 生命周期管理
│   │   │   ├── Live2DViewer.css             # 画布容器样式（尺寸/定位/交互热区）
│   │   │   ├── EmotionEngine.ts             # 情绪映射引擎：emotion → Live2D Parameter 映射
│   │   │   ├── TouchHandler.ts             # 触摸/点击交互：点击区域检测 → 动画触发
│   │   │   └── ModelLoader.ts              # 模型加载管理：异步加载/缓存/错误处理
│   │   │
│   │   ├── BubbleSystem/                    # 气泡对话系统
│   │   │   ├── BubbleSystem.tsx             # 气泡渲染：AnimatePresence 管理进出场
│   │   │   ├── BubbleSystem.css             # 气泡样式：气泡框/Tail 指向/打字机光标
│   │   │   └── BubbleQueue.ts              # 气泡优先级队列：去重/超时/插队逻辑
│   │   │
│   │   ├── StatusDashboard/                 # 执行状态仪表盘
│   │   │   ├── StatusDashboard.tsx          # 仪表盘主组件：状态卡片组合
│   │   │   ├── StatusBar.tsx                # 状态栏：状态标签 + 脉冲动画
│   │   │   ├── ProgressRing.tsx             # 环形进度条：SVG stroke-dashoffset 动画
│   │   │   ├── FileChangeList.tsx           # 文件变更列表：新增/修改/删除文件卡片
│   │   │   └── Timer.tsx                    # 执行计时器：mm:ss 格式化显示
│   │   │
│   │   ├── PlanModeView/                    # Plan Mode 可视化
│   │   │   ├── PlanModeView.tsx             # Plan 视图主组件：步骤列表容器
│   │   │   ├── StepCard.tsx                 # 单个步骤卡片：序号/标题/状态/描述
│   │   │   └── OptionPicker.tsx             # 选项选择器：单选/多选/确认按钮
│   │   │
│   │   ├── IdleMode/                        # 空闲模式管理
│   │   │   ├── IdleModeManager.ts           # 空闲检测：无操作计时器 + 状态切换
│   │   │   └── IdleAnimations.ts            # 空闲动画集：呼吸/眨眼/随机表情定义
│   │   │
│   │   └── ui/                              # 基础 UI 组件（原子组件库）
│   │       ├── Button.tsx                   # 按钮：variants(primary/secondary/ghost/danger) × sizes(sm/md/lg)
│   │       ├── Card.tsx                     # 卡片：variants(default/elevated/outlined) × padding
│   │       ├── Badge.tsx                    # 徽章：variants(success/warning/error/info/neutral) + 脉冲动画
│   │       ├── Tooltip.tsx                  # 工具提示：定位算法 + 延迟显示
│   │       ├── Skeleton.tsx                 # 加载骨架屏：宽度/高度/闪烁动画
│   │       ├── ScrollArea.tsx               # 滚动区域：自定义滚动条 + 平滑滚动
│   │       ├── Collapsible.tsx              # 可折叠面板：展开/收起动画
│   │       ├── Tabs.tsx                     # 标签页：横向/纵向切换
│   │       └── Input.tsx                    # 输入框：variants(outlined/filled) + 错误状态
│   │
│   ├── panels/                              # VS Code 面板页面级组件
│   │   ├── CharacterPanel.tsx               # 角色面板（主面板）：Live2DViewer + BubbleSystem
│   │   ├── DashboardPanel.tsx               # 仪表盘面板：StatusDashboard 容器
│   │   └── SettingsPanel.tsx                # 设置面板：表单 + 预览
│   │
│   ├── hooks/                               # 自定义 React Hooks
│   │   ├── useWebSocket.ts                  # WebSocket 连接管理：自动重连/心跳/断开检测
│   │   ├── useAgentStatus.ts                # Agent 状态订阅：Extension Host 消息监听
│   │   ├── useCharacterEmotion.ts           # 角色情绪计算：Agent 状态 → 情绪映射
│   │   ├── usePerformanceMonitor.ts         # 性能监控：FPS/内存/帧时间统计
│   │   └── useDegradeRender.ts              # 渲染降级：低性能环境自动降级策略
│   │
│   ├── types/                               # TypeScript 类型定义（按领域组织）
│   │   ├── agent.ts                         # Agent 类型：AgentStatus / AgentMetadata / ExecutionStep
│   │   ├── character.ts                     # 角色类型：EmotionType / CharacterConfig / ModelDef
│   │   ├── websocket.ts                     # WebSocket 消息类型：MessageType / Payload 联合类型
│   │   └── settings.ts                      # 设置类型：UserSettings / ThemeConfig / BehaviorConfig
│   │
│   ├── utils/                               # 工具函数
│   │   ├── logger.ts                        # 日志工具：分级日志（debug/info/warn/error）
│   │   ├── time.ts                          # 时间格式化：秒 → mm:ss / 相对时间
│   │   ├── throttle.ts                      # 节流防抖：requestAnimationFrame 节流
│   │   └── color.ts                         # 颜色工具：hex ↔ hsl / 颜色变亮变暗
│   │
│   └── lib/
│       └── vscode-api.ts                    # VS Code WebView API 封装：acquireVsCodeApi 类型安全包装
│
├── index.html                               # WebView HTML 入口：引入 VS Code CSP + 模块脚本
├── vite.config.ts                           # Vite 配置：WebView 适配（base 路径、CSS 变量注入）
├── tsconfig.json                            # TS 配置：严格模式 + 路径别名 @/
└── package.json                             # 依赖清单

mobile/                                      # 移动端 PWA 工程
├── src/
│   ├── main.tsx                             # PWA 入口：注册 Service Worker
│   ├── App.tsx                              # 移动端根组件：简化路由
│   ├── index.css                            # 移动端全局样式：适配手机屏幕
│   ├── components/                          # 移动端专用组件
│   │   ├── MobileCharacter.tsx              # 移动端简化角色：CSS 动画替代 Live2D
│   │   ├── MobileBubble.tsx                 # 移动端气泡：触摸优化
│   │   ├── MobileDashboard.tsx              # 移动端仪表盘：卡片式布局
│   │   ├── AgentSelector.tsx                # Agent 选择器：下拉/模态框
│   │   ├── MessageInput.tsx                 # 消息输入：移动端键盘适配
│   │   ├── QuickCommands.tsx                # 快捷指令：常用操作按钮组
│   │   └── ConnectionStatus.tsx             # 连接状态：WebSocket 状态指示器
│   ├── stores/
│   │   └── useMobileStore.ts                # 移动端统一状态：合并精简版
│   ├── hooks/
│   │   ├── useWebSocket.ts                  # 移动端 WebSocket（含后台重连）
│   │   └── usePushNotification.ts           # 推送通知：Service Worker 通知
│   └── types/
│       └── mobile.ts                        # 移动端特有类型
├── index.html                               # PWA HTML 入口
├── vite.config.ts                           # Vite PWA 配置
├── sw.ts                                    # Service Worker：缓存策略 + 后台同步
└── manifest.json                            # PWA 配置：theme_color/icons/display
```

---

## 2. 前端设计规范

### 2.1 设计 Token（CSS Custom Properties）

所有 Design Token 通过 CSS Custom Properties 定义在 `:root` 作用域，在 WebView 的 `index.css` 中全局注入。Token 分为 **9 大系统**：颜色、字体、间距、圆角、阴影、动画、布局尺寸、响应式断点、层级（z-index）。

```css
:root {
  /* ============================================================
     1. 颜色系统（Color System）
     ============================================================ */

  /* 1.1 主色（Primary）- Sky Blue 调 */
  --d-primary-50: #f0f9ff;
  --d-primary-100: #e0f2fe;
  --d-primary-200: #bae6fd;
  --d-primary-300: #7dd3fc;
  --d-primary-400: #38bdf8;
  --d-primary-500: #0ea5e9;       /* 主色：按钮/链接/强调 */
  --d-primary-600: #0284c7;
  --d-primary-700: #0369a1;
  --d-primary-800: #075985;
  --d-primary-900: #0c4a6e;

  /* 1.2 语义色（Semantic Colors） */
  --d-success: #22c55e;           /* 成功：文件保存/任务完成 */
  --d-warning: #f59e0b;           /* 警告：长任务/等待确认 */
  --d-error: #ef4444;             /* 错误：执行失败/异常 */
  --d-info: #3b82f6;              /* 信息：连接中/思考中 */

  /* 1.3 中性色（Neutral Colors）- 自动适配 VS Code 主题 */
  --d-bg-primary: var(--vscode-editor-background, #1e1e1e);
  --d-bg-secondary: var(--vscode-panel-background, #252526);
  --d-bg-tertiary: var(--vscode-input-background, #3c3c3c);
  --d-bg-hover: var(--vscode-list-hoverBackground, #2a2d2e);
  --d-bg-active: var(--vscode-list-activeSelectionBackground, #094771);

  --d-text-primary: var(--vscode-editor-foreground, #d4d4d4);
  --d-text-secondary: var(--vscode-descriptionForeground, #bbbbbb);
  --d-text-muted: #808080;
  --d-text-inverse: #ffffff;

  --d-border: var(--vscode-panel-border, #3e3e42);
  --d-border-subtle: rgba(255, 255, 255, 0.06);
  --d-border-focus: var(--vscode-focusBorder, #007fd4);

  /* ============================================================
     2. 字体系统（Typography System）
     ============================================================ */
  --d-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --d-font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace;

  --d-font-size-xs: 11px;         /* 标签/徽章 */
  --d-font-size-sm: 12px;         /* 次要文字 */
  --d-font-size-base: 13px;       /* 正文（VS Code 默认字号） */
  --d-font-size-md: 14px;         /* 面板标题 */
  --d-font-size-lg: 16px;         /* 大标题 */
  --d-font-size-xl: 20px;         /* 面板头部 */
  --d-font-size-2xl: 24px;        /* 强调数字 */

  --d-font-weight-normal: 400;
  --d-font-weight-medium: 500;
  --d-font-weight-semibold: 600;
  --d-font-weight-bold: 700;

  --d-line-height-tight: 1.25;    /* 标题 */
  --d-line-height-normal: 1.5;    /* 正文 */
  --d-line-height-relaxed: 1.75;  /* 长文本 */

  /* ============================================================
     3. 间距系统（Spacing System）- 基于 2px 的 8pt 网格
     ============================================================ */
  --d-space-1: 2px;
  --d-space-2: 4px;
  --d-space-3: 6px;
  --d-space-4: 8px;
  --d-space-5: 10px;
  --d-space-6: 12px;
  --d-space-8: 16px;
  --d-space-10: 20px;
  --d-space-12: 24px;
  --d-space-16: 32px;
  --d-space-20: 40px;
  --d-space-24: 48px;

  /* ============================================================
     4. 圆角系统（Border Radius System）
     ============================================================ */
  --d-radius-sm: 4px;             /* 小标签/徽章 */
  --d-radius-md: 6px;             /* 按钮/输入框 */
  --d-radius-lg: 8px;             /* 卡片/面板 */
  --d-radius-xl: 12px;            /* 大卡片/弹窗 */
  --d-radius-2xl: 16px;           /* 角色容器 */
  --d-radius-full: 9999px;        /* 圆形（头像/状态点） */

  /* ============================================================
     5. 阴影系统（Shadow System）- 暗色主题优化
     ============================================================ */
  --d-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --d-shadow-md: 0 4px 8px rgba(0, 0, 0, 0.4);
  --d-shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.5);
  --d-shadow-xl: 0 16px 32px rgba(0, 0, 0, 0.6);
  --d-shadow-glow: 0 0 12px rgba(14, 165, 233, 0.3);           /* 主色光晕 */
  --d-shadow-glow-success: 0 0 12px rgba(34, 197, 94, 0.3);    /* 成功光晕 */
  --d-shadow-glow-error: 0 0 12px rgba(239, 68, 68, 0.3);      /* 错误光晕 */

  /* ============================================================
     6. 动画系统（Animation System）
     ============================================================ */
  --d-duration-instant: 0ms;
  --d-duration-fast: 150ms;        /* 悬停/按下 */
  --d-duration-normal: 250ms;      /* 状态切换 */
  --d-duration-slow: 350ms;        /* 面板展开 */
  --d-duration-slower: 500ms;      /* 页面过渡 */

  --d-easing-default: cubic-bezier(0.4, 0, 0.2, 1);             /* Material Standard */
  --d-easing-decelerate: cubic-bezier(0, 0, 0.2, 1);            /* 进入 */
  --d-easing-accelerate: cubic-bezier(0.4, 0, 1, 1);            /* 退出 */
  --d-easing-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);         /* 弹性（气泡） */
  --d-easing-smooth: cubic-bezier(0.25, 0.1, 0.25, 1);          /* 柔和 */

  /* ============================================================
     7. 布局尺寸（Layout Dimensions）
     ============================================================ */
  --d-panel-width: 360px;          /* 侧边栏面板宽度 */
  --d-character-height: 260px;     /* 角色区域高度 */
  --d-dashboard-min-height: 200px; /* 仪表盘最小高度 */
  --d-header-height: 40px;         /* 面板头部高度 */
  --d-footer-height: 36px;         /* 面板底部高度 */
  --d-bubble-max-width: 280px;     /* 气泡最大宽度 */

  /* ============================================================
     8. 响应式断点（Responsive Breakpoints）- PWA 适配
     ============================================================ */
  --d-bp-mobile: 375px;            /* 小屏手机 */
  --d-bp-mobile-lg: 414px;         /* 大屏手机 */
  --d-bp-tablet: 768px;            /* 平板 */

  /* ============================================================
     9. 层级系统（Z-Index System）
     ============================================================ */
  --d-z-base: 0;
  --d-z-character: 10;             /* 角色画布 */
  --d-z-bubble: 20;                /* 气泡层 */
  --d-z-overlay: 30;               /* 遮罩层 */
  --d-z-dropdown: 40;              /* 下拉菜单 */
  --d-z-modal: 50;                 /* 模态框 */
  --d-z-toast: 60;                 /* 全局通知 */
}
```

**Token 使用约定**：
- 所有 Token 以 `--d-` 为前缀（`d` = Dionysus），避免与 VS Code 内置 CSS 变量冲突。
- 颜色 Token 使用 CSS `var()` 的回退机制（`var(--vscode-xxx, fallback)`），确保在独立浏览器（如移动端 PWA）中也能正常渲染。
- 间距 Token 遵循 8pt 网格系统（以 2px 为最小单位），确保视觉节奏一致。

---

### 2.2 组件设计规范

#### 2.2.1 Button 组件

```typescript
// components/ui/Button.tsx
import type { LucideIcon } from 'lucide-react';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
  children?: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

// 样式映射（CSS Modules）
const variantStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:   `${styles.btn} ${styles.primary}`,   /* bg-primary-500, hover:bg-primary-600 */
  secondary: `${styles.btn} ${styles.secondary}`, /* bg-tertiary, hover:bg-border */
  ghost:     `${styles.btn} ${styles.ghost}`,     /* transparent, hover:bg-tertiary */
  danger:    `${styles.btn} ${styles.danger}`,    /* bg-error/10, hover:bg-error/20 */
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: styles.sm,   /* h-6 px-2 text-xs  gap-1.5 */
  md: styles.md,   /* h-8 px-3 text-sm  gap-2   */
  lg: styles.lg,   /* h-10 px-4 text-base gap-2  */
};
```

**CSS Modules 实现**：

```css
/* Button.module.css */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--d-space-2);
  border-radius: var(--d-radius-md);
  font-family: var(--d-font-sans);
  font-weight: var(--d-font-weight-medium);
  line-height: var(--d-line-height-tight);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color var(--d-duration-fast) var(--d-easing-default),
              border-color var(--d-duration-fast) var(--d-easing-default),
              opacity var(--d-duration-fast) var(--d-easing-default);
  white-space: nowrap;
  user-select: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Variants */
.primary {
  background: var(--d-primary-500);
  color: white;
  border-color: var(--d-primary-500);
}
.primary:hover:not(:disabled) { background: var(--d-primary-600); border-color: var(--d-primary-600); }
.primary:active:not(:disabled) { background: var(--d-primary-700); border-color: var(--d-primary-700); }

.secondary {
  background: var(--d-bg-tertiary);
  color: var(--d-text-primary);
  border-color: var(--d-border);
}
.secondary:hover:not(:disabled) { background: var(--d-border); }

.ghost {
  background: transparent;
  color: var(--d-text-secondary);
  border-color: transparent;
}
.ghost:hover:not(:disabled) { background: var(--d-bg-tertiary); color: var(--d-text-primary); }

.danger {
  background: color-mix(in srgb, var(--d-error) 10%, transparent);
  color: var(--d-error);
  border-color: color-mix(in srgb, var(--d-error) 20%, transparent);
}
.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--d-error) 20%, transparent); }

/* Sizes */
.sm { height: 24px; padding: 0 var(--d-space-2); font-size: var(--d-font-size-xs); gap: var(--d-space-1); }
.md { height: 32px; padding: 0 var(--d-space-3); font-size: var(--d-font-size-sm); gap: var(--d-space-2); }
.lg { height: 40px; padding: 0 var(--d-space-4); font-size: var(--d-font-size-base); gap: var(--d-space-2); }

/* Loading spinner */
.loading {
  position: relative;
  color: transparent !important;
}
.loading::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--d-radius-full);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

#### 2.2.2 Card 组件

```typescript
// components/ui/Card.tsx
export interface CardProps {
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}
```

**样式映射**：

```css
/* Card.module.css */
.card {
  background: var(--d-bg-secondary);
  border-radius: var(--d-radius-lg);
  overflow: hidden;
  transition: box-shadow var(--d-duration-fast) var(--d-easing-default);
}

.default   { box-shadow: var(--d-shadow-sm); }
.elevated  { box-shadow: var(--d-shadow-md); }
.outlined  { box-shadow: none; border: 1px solid var(--d-border); }

.padding-none { padding: 0; }
.padding-sm   { padding: var(--d-space-3); }
.padding-md   { padding: var(--d-space-4); }
.padding-lg   { padding: var(--d-space-6); }

.header {
  padding: var(--d-space-3) var(--d-space-4);
  border-bottom: 1px solid var(--d-border-subtle);
  font-weight: var(--d-font-weight-semibold);
  font-size: var(--d-font-size-md);
}

.footer {
  padding: var(--d-space-3) var(--d-space-4);
  border-top: 1px solid var(--d-border-subtle);
}
```

#### 2.2.3 Badge 组件

```typescript
// components/ui/Badge.tsx
export interface BadgeProps {
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  size?: 'sm' | 'md';
  dot?: boolean;           /* 是否显示前置状态圆点 */
  pulse?: boolean;         /* 是否启用脉冲动画（用于执行中状态） */
  children: React.ReactNode;
  className?: string;
}
```

**颜色映射与脉冲动画**：

```css
/* Badge.module.css */
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--d-space-1);
  padding: var(--d-space-1) var(--d-space-2);
  border-radius: var(--d-radius-full);
  font-size: var(--d-font-size-xs);
  font-weight: var(--d-font-weight-medium);
  line-height: var(--d-line-height-tight);
  white-space: nowrap;
}

/* Variant colors */
.success { background: color-mix(in srgb, var(--d-success) 10%, transparent); color: var(--d-success); }
.warning { background: color-mix(in srgb, var(--d-warning) 10%, transparent); color: var(--d-warning); }
.error   { background: color-mix(in srgb, var(--d-error) 10%, transparent);   color: var(--d-error); }
.info    { background: color-mix(in srgb, var(--d-info) 10%, transparent);    color: var(--d-info); }
.neutral { background: var(--d-bg-tertiary); color: var(--d-text-secondary); }

/* Status dot */
.dot {
  width: 6px;
  height: 6px;
  border-radius: var(--d-radius-full);
  background: currentColor;
}

/* Pulse animation for executing state */
.pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

### 2.3 布局规范

面板采用 Flexbox 纵向布局，自上而下分为 **Header → Character Area → Dashboard Area → Footer** 四个区域：

```css
/* 面板根容器 - 占据整个 WebView 视口 */
.d-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  min-height: 0;                    /* 关键：允许子元素收缩 */
  background: var(--d-bg-primary);
  color: var(--d-text-primary);
  font-family: var(--d-font-sans);
  font-size: var(--d-font-size-base);
  line-height: var(--d-line-height-normal);
  overflow: hidden;
}

/* 面板头部 */
.d-panel-header {
  flex: 0 0 auto;
  height: var(--d-header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--d-space-4);
  border-bottom: 1px solid var(--d-border-subtle);
  font-weight: var(--d-font-weight-semibold);
  font-size: var(--d-font-size-md);
}

/* 角色区域 - 固定高度，底部对齐 */
.d-character-area {
  flex: 0 0 auto;
  height: var(--d-character-height);
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding: var(--d-space-4);
  position: relative;
  overflow: hidden;
  background: linear-gradient(180deg, var(--d-bg-primary) 0%, var(--d-bg-secondary) 100%);
}

/* 仪表盘区域 - 自适应填充剩余空间 */
.d-dashboard-area {
  flex: 1 1 auto;
  min-height: 0;                    /* 关键：允许溢出滚动 */
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--d-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--d-space-6);
  scroll-behavior: smooth;
}

/* 面板底部 */
.d-panel-footer {
  flex: 0 0 auto;
  height: var(--d-footer-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--d-space-4);
  border-top: 1px solid var(--d-border-subtle);
  font-size: var(--d-font-size-xs);
  color: var(--d-text-muted);
}

/* 自定义滚动条 */
.d-dashboard-area::-webkit-scrollbar {
  width: 6px;
}
.d-dashboard-area::-webkit-scrollbar-track {
  background: transparent;
}
.d-dashboard-area::-webkit-scrollbar-thumb {
  background: var(--d-border);
  border-radius: var(--d-radius-full);
}
.d-dashboard-area::-webkit-scrollbar-thumb:hover {
  background: var(--d-text-muted);
}

/* 气泡定位层 - 叠加在角色区域上方 */
.d-bubble-layer {
  position: absolute;
  top: var(--d-space-4);
  left: var(--d-space-4);
  right: var(--d-space-4);
  z-index: var(--d-z-bubble);
  pointer-events: none;             /* 允许点击穿透到角色 */
}
.d-bubble-layer > * {
  pointer-events: auto;             /* 气泡自身可交互 */
}
```

---

### 2.4 VS Code 主题适配

WebView 通过 VS Code 注入的 CSS 变量自动继承当前主题色。Extension Host 侧负责监听主题变化并通过 `postMessage` 推送更新。

```typescript
// lib/vscode-theme.ts

/** VS Code 主题颜色映射表 - 将 VS Code 主题色映射到 Dionysus Token */
const VSCODE_COLOR_MAP: Record<string, string> = {
  /* 背景色 */
  '--d-bg-primary':   '--vscode-editor-background',
  '--d-bg-secondary': '--vscode-panel-background',
  '--d-bg-tertiary':  '--vscode-input-background',
  '--d-bg-hover':     '--vscode-list-hoverBackground',
  '--d-bg-active':    '--vscode-list-activeSelectionBackground',

  /* 文字色 */
  '--d-text-primary':   '--vscode-editor-foreground',
  '--d-text-secondary': '--vscode-descriptionForeground',

  /* 边框 */
  '--d-border':       '--vscode-panel-border',
  '--d-border-focus': '--vscode-focusBorder',

  /* 主色（从 VS Code 按钮色继承） */
  '--d-primary-500': '--vscode-button-background',
  '--d-primary-600': '--vscode-button-hoverBackground',
  '--d-primary-700': '--vscode-button-background',
};

/**
 * 初始化 VS Code 主题同步
 * 在 WebView 加载时调用一次，后续通过 message 事件监听变化
 */
export function syncVSCodeTheme(): void {
  const root = document.documentElement;

  // 1. 初始同步：直接读取 VS Code 注入的 CSS 变量
  Object.entries(VSCODE_COLOR_MAP).forEach(([dionysusToken, vscodeToken]) => {
    const vscodeValue = getComputedStyle(root).getPropertyValue(vscodeToken).trim();
    if (vscodeValue) {
      root.style.setProperty(dionysusToken, vscodeValue);
    }
  });

  // 2. 监听 Extension Host 推送的主题变更
  window.addEventListener('message', (event: MessageEvent<ThemeChangeMessage>) => {
    const message = event.data;
    if (message.type === 'theme') {
      const colors = message.colors;
      Object.entries(colors).forEach(([token, value]) => {
        if (value) {
          root.style.setProperty(token, value);
        }
      });
    }
  });
}

/** 主题变更消息类型 */
interface ThemeChangeMessage {
  type: 'theme';
  colors: Record<string, string>;
}

/**
 * 检测当前主题明暗模式
 * 用于条件性调整语义色（如暗色主题下调低语义色饱和度）
 */
export function detectColorScheme(): 'dark' | 'light' | 'high-contrast' {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--vscode-editor-background')
    .trim();

  // 高对比度主题检测
  const hc = getComputedStyle(document.documentElement)
    .getPropertyValue('--vscode-contrastActiveBorder')
    .trim();
  if (hc && hc !== 'transparent') {
    return 'high-contrast';
  }

  // 通过背景亮度判断暗色/亮色
  const rgb = bg.match(/\d+/g)?.map(Number) ?? [30, 30, 30];
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.5 ? 'light' : 'dark';
}
```

**Extension Host 侧主题推送**：

```typescript
// extension/src/themeManager.ts
import { window, ColorThemeKind, type WebviewPanel } from 'vscode';

export function notifyThemeChange(panel: WebviewPanel): void {
  const themeKind = window.activeColorTheme.kind;
  const colors = collectThemeColors();

  panel.webview.postMessage({
    type: 'theme',
    kind: themeKind,        // 1=Light, 2=Dark, 3=HighContrast
    colors,
  });
}

function collectThemeColors(): Record<string, string> {
  // 通过 VS Code API 获取当前主题的具体颜色值
  return {
    '--d-bg-primary':   getCssVariable('--vscode-editor-background'),
    '--d-bg-secondary': getCssVariable('--vscode-panel-background'),
    // ... 其他映射
  };
}
```

---

### 2.5 动画规范

所有动画统一通过 Framer Motion 的预设配置管理，确保全局动画一致性。

```typescript
// lib/animations.ts - Framer Motion 动画预设
import type { Transition, Variants } from 'framer-motion';

/** 过渡动画预设 */
export const transitions = {
  fast:    { duration: 0.15, ease: [0.4, 0, 0.2, 1] } as Transition,
  normal:  { duration: 0.25, ease: [0.4, 0, 0.2, 1] } as Transition,
  slow:    { duration: 0.35, ease: [0.4, 0, 0.2, 1] } as Transition,
  slower:  { duration: 0.50, ease: [0.4, 0, 0.2, 1] } as Transition,

  bounce:  { type: 'spring', stiffness: 500, damping: 25 } as Transition,
  spring:  { type: 'spring', stiffness: 300, damping: 30 } as Transition,
  gentle:  { type: 'spring', stiffness: 200, damping: 25 } as Transition,

  layout:  { type: 'spring', stiffness: 400, damping: 30 } as Transition,
};

/** 通用动画变体 */
export const animations = {
  /** 淡入淡出 */
  fadeIn: {
    initial: { opacity: 0 },
    animate:  { opacity: 1, transition: transitions.normal },
    exit:     { opacity: 0, transition: transitions.fast },
  } satisfies Variants,

  /** 向上滑入 */
  slideUp: {
    initial: { opacity: 0, y: 12 },
    animate:  { opacity: 1, y: 0, transition: transitions.normal },
    exit:     { opacity: 0, y: -8, transition: transitions.fast },
  } satisfies Variants,

  /** 向下滑入 */
  slideDown: {
    initial: { opacity: 0, y: -12 },
    animate:  { opacity: 1, y: 0, transition: transitions.normal },
    exit:     { opacity: 0, y: 8, transition: transitions.fast },
  } satisfies Variants,

  /** 缩放进入 */
  scaleIn: {
    initial: { opacity: 0, scale: 0.92 },
    animate:  { opacity: 1, scale: 1, transition: transitions.spring },
    exit:     { opacity: 0, scale: 0.95, transition: transitions.fast },
  } satisfies Variants,

  /** 气泡弹出 - 弹性效果 */
  bubblePop: {
    initial:  { opacity: 0, scale: 0.85, y: 8 },
    animate:   { opacity: 1, scale: 1, y: 0, transition: transitions.bounce },
    exit:      { opacity: 0, scale: 0.92, y: -4, transition: transitions.fast },
  } satisfies Variants,

  /** 列表项交错进入 */
  staggerItem: {
    initial: { opacity: 0, x: -8 },
    animate:  { opacity: 1, x: 0, transition: transitions.normal },
    exit:     { opacity: 0, x: 8, transition: transitions.fast },
  } satisfies Variants,

  /** 脉冲（状态指示器） */
  pulse: {
    animate: {
      scale: [1, 1.15, 1],
      opacity: [1, 0.7, 1],
      transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
    },
  } satisfies Variants,

  /** 骨架屏闪烁 */
  skeleton: {
    animate: {
      opacity: [0.4, 0.8, 0.4],
      transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' },
    },
  } satisfies Variants,
};

/** 交错动画容器配置 */
export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05,       /* 子元素间隔 50ms */
      delayChildren: 0.05,
    },
  },
};

/** 页面切换 */
export const pageTransition = {
  initial: { opacity: 0, x: 8 },
  animate:  { opacity: 1, x: 0, transition: transitions.normal },
  exit:     { opacity: 0, x: -8, transition: transitions.fast },
};
```

---

## 3. 核心组件实现规范

### 3.1 Live2DViewer 组件

`Live2DViewer` 是整个 Extension 最核心的渲染组件，负责管理 PixiJS 应用生命周期、Live2D 模型加载与渲染、情绪参数映射及触摸交互。

```typescript
// components/Live2DViewer/Live2DViewer.tsx
import { useEffect, useRef, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';
import { useCharacterStore } from '@/stores/useCharacterStore';
import { EmotionEngine } from './EmotionEngine';
import { TouchHandler } from './TouchHandler';
import { ModelLoader } from './ModelLoader';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import styles from './Live2DViewer.module.css';

/** Live2D 渲染区域尺寸 */
const VIEW_WIDTH = 280;
const VIEW_HEIGHT = 240;

export function Live2DViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<Live2DModel | null>(null);
  const engineRef = useRef<EmotionEngine | null>(null);

  const { emotion, modelPath, scale, position } = useCharacterStore();

  // ==================== 初始化 PixiJS 应用 ====================
  useEffect(() => {
    if (!canvasRef.current) return;

    let cancelled = false;

    const init = async () => {
      // 创建 PixiJS 应用
      const app = new PIXI.Application({
        view: canvasRef.current!,
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        transparent: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2), // 限制最大 DPR=2
        autoDensity: true,
        backgroundAlpha: 0,
      });

      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

      appRef.current = app;

      // 加载 Live2D 模型
      try {
        const model = await ModelLoader.load(app.stage, modelPath);
        if (cancelled) {
          model.destroy();
          app.destroy(true, { children: true, texture: true });
          return;
        }

        modelRef.current = model;

        // 初始化情绪引擎
        const engine = new EmotionEngine(model);
        engine.setEmotion(emotion);
        engineRef.current = engine;

        // 初始化触摸处理
        const touch = new TouchHandler(canvasRef.current, model);

        // 性能监控
        usePerformanceMonitor.track(app);
      } catch (err) {
        console.error('[Live2DViewer] Model load failed:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      modelRef.current?.destroy();
      appRef.current?.destroy(true, { children: true, texture: true });
      appRef.current = null;
      modelRef.current = null;
      engineRef.current = null;
    };
  }, [modelPath]);

  // ==================== 情绪变化响应 ====================
  useEffect(() => {
    engineRef.current?.setEmotion(emotion);
  }, [emotion]);

  // ==================== 缩放变化响应 ====================
  useEffect(() => {
    if (modelRef.current) {
      modelRef.current.scale.set(scale);
      // 重新居中
      modelRef.current.x = VIEW_WIDTH / 2 + position.x;
      modelRef.current.y = VIEW_HEIGHT / 2 + position.y;
    }
  }, [scale, position]);

  // ==================== 窗口大小变化处理 ====================
  const handleResize = useCallback(() => {
    if (appRef.current && canvasRef.current) {
      const parent = canvasRef.current.parentElement;
      if (parent) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        appRef.current.renderer.resize(w, h);
        if (modelRef.current) {
          modelRef.current.x = w / 2 + position.x;
          modelRef.current.y = h / 2 + position.y;
        }
      }
    }
  }, [position]);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  return (
    <div className={styles.container}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label="Live2D 角色"
        role="img"
      />
      {/* 触摸热区覆盖层 */}
      <TouchOverlay canvasRef={canvasRef} />
    </div>
  );
}

/** 触摸覆盖层 - 处理点击区域的视觉反馈 */
function TouchOverlay({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();

    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);
  }, [canvasRef]);

  return (
    <div className={styles.touchOverlay} onClick={handleClick}>
      {ripples.map((ripple) => (
        <motion.div
          key={ripple.id}
          className={styles.ripple}
          initial={{ scale: 0, opacity: 0.6 }}
          animate={{ scale: 2.5, opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ left: ripple.x, top: ripple.y }}
        />
      ))}
    </div>
  );
}
```

**配套的 EmotionEngine 核心逻辑**：

```typescript
// components/Live2DViewer/EmotionEngine.ts
import type { Live2DModel } from 'pixi-live2d-display';

/** 情绪类型枚举 */
export type EmotionType =
  | 'neutral'      /* 平静 */
  | 'happy'        /* 开心 */
  | 'thinking'     /* 思考 */
  | 'confused'     /* 困惑 */
  | 'surprised'    /* 惊讶 */
  | 'sad'          /* 难过 */
  | 'excited';     /* 兴奋 */

/**
 * 情绪到 Live2D 模型参数的映射
 *
 * Live2D 模型通过修改特定参数（Param）来控制表情和姿态。
 * 不同模型的参数 ID 可能不同，此处为 Cubism 4 标准参数名。
 */
const EMOTION_PARAM_MAP: Record<EmotionType, Record<string, number>> = {
  neutral: {
    ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0,
    ParamEyeLOpen: 1, ParamEyeROpen: 1,
    ParamBrowLY: 0, ParamBrowRY: 0,
    ParamMouthForm: 0, ParamMouthOpenY: 0,
  },
  happy: {
    ParamAngleX: 0, ParamAngleY: -2, ParamAngleZ: 0,
    ParamEyeLOpen: 1, ParamEyeROpen: 1,
    ParamBrowLY: -0.5, ParamBrowRY: -0.5,
    ParamMouthForm: 1, ParamMouthOpenY: 0.3,
  },
  thinking: {
    ParamAngleX: 3, ParamAngleY: 2, ParamAngleZ: -2,
    ParamEyeLOpen: 0.6, ParamEyeROpen: 0.8,
    ParamBrowLY: 0.8, ParamBrowRY: 0.3,
    ParamMouthForm: -0.5, ParamMouthOpenY: 0,
  },
  confused: {
    ParamAngleX: -2, ParamAngleY: 0, ParamAngleZ: 3,
    ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7,
    ParamBrowLY: 0.5, ParamBrowRY: 0.5,
    ParamMouthForm: -0.8, ParamMouthOpenY: 0.1,
  },
  surprised: {
    ParamAngleX: 0, ParamAngleY: -5, ParamAngleZ: 0,
    ParamEyeLOpen: 1.3, ParamEyeROpen: 1.3,
    ParamBrowLY: -1, ParamBrowRY: -1,
    ParamMouthForm: 0, ParamMouthOpenY: 0.8,
  },
  sad: {
    ParamAngleX: 0, ParamAngleY: 3, ParamAngleZ: 0,
    ParamEyeLOpen: 0.5, ParamEyeROpen: 0.5,
    ParamBrowLY: 0.8, ParamBrowRY: 0.8,
    ParamMouthForm: -1, ParamMouthOpenY: 0,
  },
  excited: {
    ParamAngleX: 0, ParamAngleY: -3, ParamAngleZ: 2,
    ParamEyeLOpen: 1.1, ParamEyeROpen: 1.1,
    ParamBrowLY: -0.8, ParamBrowRY: -0.8,
    ParamMouthForm: 0.8, ParamMouthOpenY: 0.5,
  },
};

const TRANSITION_DURATION = 0.4; // 参数过渡时长（秒）

export class EmotionEngine {
  private model: Live2DModel;
  private currentEmotion: EmotionType = 'neutral';
  private transitionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(model: Live2DModel) {
    this.model = model;
  }

  /** 设置情绪，带平滑过渡 */
  setEmotion(emotion: EmotionType): void {
    if (this.currentEmotion === emotion) return;
    this.currentEmotion = emotion;

    const targetParams = EMOTION_PARAM_MAP[emotion];
    if (!targetParams) return;

    // 清除之前的过渡
    if (this.transitionTimer) {
      clearInterval(this.transitionTimer);
    }

    // 当前参数值
    const startParams: Record<string, number> = {};
    Object.keys(targetParams).forEach((key) => {
      startParams[key] = this.model.internalModel.coreModel.getParameterValueById(key) ?? 0;
    });

    // 渐进过渡动画
    const steps = 20;
    let currentStep = 0;
    this.transitionTimer = setInterval(() => {
      currentStep++;
      const t = currentStep / steps; // 线性插值
      // 应用缓动
      const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      Object.entries(targetParams).forEach(([key, targetValue]) => {
        const startValue = startParams[key] ?? 0;
        const currentValue = startValue + (targetValue - startValue) * easedT;
        this.model.internalModel.coreModel.setParameterValueById(key, currentValue);
      });

      if (currentStep >= steps) {
        if (this.transitionTimer) clearInterval(this.transitionTimer);
        this.transitionTimer = null;
      }
    }, (TRANSITION_DURATION * 1000) / steps);
  }

  /** 获取当前情绪 */
  getCurrentEmotion(): EmotionType {
    return this.currentEmotion;
  }

  /** 销毁引擎 */
  destroy(): void {
    if (this.transitionTimer) {
      clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
  }
}
```

---

### 3.2 BubbleSystem 组件

气泡系统是角色与用户的文本交互层，负责管理气泡队列、优先级排序、进出场动画及超时自动消失。

```typescript
// components/BubbleSystem/BubbleSystem.tsx
import { useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useBubbleStore } from '@/stores/useBubbleStore';
import { Badge } from '@/components/ui/Badge';
import { animations } from '@/lib/animations';
import styles from './BubbleSystem.module.css';

/** 单个气泡数据结构 */
export interface Bubble {
  id: string;                    /* 唯一标识 */
  text: string;                  /* 气泡文本 */
  agentName?: string;            /* Agent 名称 */
  emotion?: string;              /* 触发情绪 */
  priority: number;              /* 优先级（1-10，10 最高） */
  durationMs: number;            /* 显示时长（ms） */
  createdAt: number;             /* 创建时间戳 */
  showAgent?: boolean;           /* 是否显示 Agent 标签 */
  type?: 'normal' | 'thinking' | 'error' | 'success'; /* 气泡类型 */
}

export function BubbleSystem() {
  const { bubbles, removeBubble } = useBubbleStore();

  // 自动超时清除
  useEffect(() => {
    const timers = bubbles.map((bubble) =>
      setTimeout(() => {
        removeBubble(bubble.id);
      }, bubble.durationMs)
    );
    return () => timers.forEach(clearTimeout);
  }, [bubbles, removeBubble]);

  return (
    <div className={styles.container} aria-live="polite" aria-atomic="true">
      <AnimatePresence mode="popLayout">
        {bubbles.map((bubble) => (
          <motion.div
            key={bubble.id}
            layout
            variants={animations.bubblePop}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`${styles.bubble} ${styles[bubble.type ?? 'normal']}`}
            role="log"
            aria-label={`${bubble.agentName ?? 'Agent'}: ${bubble.text}`}
          >
            {/* 气泡主体 */}
            <div className={styles.content}>
              {bubble.agentName && bubble.showAgent && (
                <div className={styles.agentRow}>
                  <Badge variant="info" size="sm" dot>
                    {bubble.agentName}
                  </Badge>
                </div>
              )}
              <p className={styles.text}>{bubble.text}</p>
            </div>

            {/* 气泡尾部三角 */}
            <div className={styles.tail} />

            {/* 倒计时条 */}
            <motion.div
              className={styles.countdown}
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: bubble.durationMs / 1000, ease: 'linear' }}
              style={{ originX: 1 }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

**气泡队列管理器**：

```typescript
// components/BubbleSystem/BubbleQueue.ts

import type { Bubble } from './BubbleSystem';

/** 最大同时显示气泡数 */
const MAX_VISIBLE_BUBBLES = 3;

/** 默认气泡配置 */
const DEFAULT_DURATION = 5000;   // 5 秒

export class BubbleQueue {
  private queue: Bubble[] = [];
  private visible: Bubble[] = [];
  private onChange: (visible: Bubble[]) => void;

  constructor(onChange: (visible: Bubble[]) => void) {
    this.onChange = onChange;
  }

  /** 添加气泡到队列 */
  enqueue(partial: Omit<Bubble, 'id' | 'createdAt'>): void {
    const bubble: Bubble = {
      ...partial,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      durationMs: partial.durationMs ?? DEFAULT_DURATION,
      priority: partial.priority ?? 5,
    };

    // 高优先级气泡直接插入到队首
    if (bubble.priority >= 8) {
      this.queue.unshift(bubble);
    } else {
      this.queue.push(bubble);
    }

    this.flush();
  }

  /** 移除指定气泡 */
  remove(id: string): void {
    this.visible = this.visible.filter((b) => b.id !== id);
    this.queue = this.queue.filter((b) => b.id !== id);
    this.flush();
  }

  /** 将队列中的气泡推入可见区域 */
  private flush(): void {
    while (this.visible.length < MAX_VISIBLE_BUBBLES && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        this.visible.push(next);
      }
    }
    this.onChange([...this.visible]);
  }

  /** 清空所有气泡 */
  clear(): void {
    this.queue = [];
    this.visible = [];
    this.onChange([]);
  }

  /** 销毁 */
  destroy(): void {
    this.clear();
  }
}
```

**气泡系统 CSS**：

```css
/* BubbleSystem.module.css */
.container {
  display: flex;
  flex-direction: column;
  gap: var(--d-space-2);
  padding: var(--d-space-2);
  max-height: 200px;
  overflow: hidden;
  pointer-events: none; /* 让点击穿透到下方角色 */
}

.container > * {
  pointer-events: auto; /* 气泡本身可交互 */
}

.bubble {
  position: relative;
  max-width: var(--d-bubble-max-width);
  padding: var(--d-space-3) var(--d-space-4);
  border-radius: var(--d-radius-lg);
  background: var(--d-bg-secondary);
  border: 1px solid var(--d-border);
  box-shadow: var(--d-shadow-md);
  font-size: var(--d-font-size-sm);
  line-height: var(--d-line-height-normal);
  color: var(--d-text-primary);
}

/* 气泡类型变体 */
.bubble.normal   { border-left: 3px solid var(--d-primary-500); }
.bubble.thinking { border-left: 3px solid var(--d-info); }
.bubble.error    { border-left: 3px solid var(--d-error); }
.bubble.success  { border-left: 3px solid var(--d-success); }

.agentRow {
  margin-bottom: var(--d-space-1);
}

.text {
  margin: 0;
  word-break: break-word;
}

/* 气泡尾部 */
.tail {
  position: absolute;
  bottom: -6px;
  left: 24px;
  width: 12px;
  height: 12px;
  background: var(--d-bg-secondary);
  border-right: 1px solid var(--d-border);
  border-bottom: 1px solid var(--d-border);
  transform: rotate(45deg);
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

/* 倒计时条 */
.countdown {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--d-primary-500);
  border-radius: 0 0 var(--d-radius-lg) var(--d-radius-lg);
  opacity: 0.5;
}
```

---

### 3.3 StatusDashboard 组件

仪表盘组件实时展示 Agent 的执行状态、进度、文件变更及执行耗时。

```typescript
// components/StatusDashboard/StatusDashboard.tsx
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Timer } from './Timer';
import { ProgressRing } from './ProgressRing';
import { FileChangeList } from './FileChangeList';
import { useAgentStore } from '@/stores/useAgentStore';
import { animations, staggerContainer, staggerItem } from '@/lib/animations';
import { motion } from 'framer-motion';
import styles from './StatusDashboard.module.css';

/** Agent 执行状态枚举 */
export type AgentStatus =
  | 'idle'
  | 'connecting'
  | 'thinking'
  | 'executing'
  | 'long_running'
  | 'plan_mode'
  | 'success'
  | 'error'
  | 'user_input';

/** 状态配置映射 */
const STATUS_CONFIG: Record<AgentStatus, {
  label: string;
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  icon: string;
}> = {
  idle:         { label: '待机',     variant: 'neutral', icon: '⏸' },
  connecting:   { label: '连接中',   variant: 'info',    icon: '🔗' },
  thinking:     { label: '思考中',   variant: 'info',    icon: '💭' },
  executing:    { label: '执行中',   variant: 'warning', icon: '⚡' },
  long_running: { label: '长任务',   variant: 'warning', icon: '⏳' },
  plan_mode:    { label: '等待确认', variant: 'info',    icon: '❓' },
  success:      { label: '已完成',   variant: 'success', icon: '✅' },
  error:        { label: '执行出错', variant: 'error',   icon: '❌' },
  user_input:   { label: '需要输入', variant: 'info',    icon: '⌨' },
};

export function StatusDashboard() {
  const { status, metadata, duration } = useAgentStore();
  const config = STATUS_CONFIG[status];

  const isExecuting = status === 'executing' || status === 'long_running';
  const showProgress = isExecuting && metadata?.progress != null;
  const showFiles = metadata?.filesChanged != null && metadata.filesChanged.length > 0;

  return (
    <motion.div
      className={styles.container}
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* 状态卡片 */}
      <motion.div variants={staggerItem}>
        <Card variant="outlined" padding="md">
          <div className={styles.statusRow}>
            <div className={styles.statusLeft}>
              <span className={styles.statusIcon} role="img" aria-hidden="true">
                {config.icon}
              </span>
              <Badge
                variant={config.variant}
                pulse={isExecuting}
                dot={isExecuting}
              >
                {config.label}
              </Badge>
            </div>
            {duration > 0 && (
              <Timer seconds={duration} className={styles.timer} />
            )}
          </div>

          {/* 当前执行文件 */}
          {metadata?.currentFile && (
            <div className={styles.currentFile}>
              <span className={styles.fileIcon}>📄</span>
              <code className={styles.filePath}>{metadata.currentFile}</code>
            </div>
          )}
        </Card>
      </motion.div>

      {/* 进度环 */}
      <AnimatePresence>
        {showProgress && (
          <motion.div
            variants={staggerItem}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card variant="default" padding="md">
              <ProgressRing
                progress={metadata.progress!.percent}
                label={metadata.progress!.label}
              />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 文件变更列表 */}
      <AnimatePresence>
        {showFiles && (
          <motion.div
            variants={staggerItem}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card variant="default" padding="md">
              <FileChangeList files={metadata.filesChanged!} />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
```

**ProgressRing 环形进度条实现**：

```typescript
// components/StatusDashboard/ProgressRing.tsx
import { motion } from 'framer-motion';
import styles from './ProgressRing.module.css';

interface ProgressRingProps {
  progress: number;       /* 0-100 */
  label?: string;
  size?: number;          /* 环直径，默认 80 */
  strokeWidth?: number;   /* 环粗细，默认 6 */
}

export function ProgressRing({
  progress,
  label,
  size = 80,
  strokeWidth = 6,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className={styles.container}>
      <svg width={size} height={size} className={styles.svg}>
        {/* 背景环 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--d-border)"
          strokeWidth={strokeWidth}
        />
        {/* 进度环 */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--d-primary-500)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className={styles.text}>
        <span className={styles.percent}>{Math.round(progress)}%</span>
        {label && <span className={styles.label}>{label}</span>}
      </div>
    </div>
  );
}
```

**Timer 执行计时器**：

```typescript
// components/StatusDashboard/Timer.tsx
import { useEffect, useState } from 'react';
import styles from './Timer.module.css';

interface TimerProps {
  seconds: number;          /* 已执行秒数 */
  className?: string;
}

export function Timer({ seconds, className }: TimerProps) {
  const [display, setDisplay] = useState(formatTime(seconds));

  useEffect(() => {
    setDisplay(formatTime(seconds));
  }, [seconds]);

  return (
    <time className={`${styles.timer} ${className ?? ''}`} dateTime={`PT${seconds}S`}>
      {display}
    </time>
  );
}

/** 将秒数格式化为 mm:ss */
function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
```

**FileChangeList 文件变更列表**：

```typescript
// components/StatusDashboard/FileChangeList.tsx
import { motion } from 'framer-motion';
import { staggerItem } from '@/lib/animations';
import styles from './FileChangeList.module.css';

export interface FileChange {
  path: string;
  type: 'added' | 'modified' | 'deleted';
}

interface FileChangeListProps {
  files: FileChange[];
}

const TYPE_CONFIG: Record<FileChange['type'], { label: string; color: string }> = {
  added:    { label: '新增', color: 'var(--d-success)' },
  modified: { label: '修改', color: 'var(--d-warning)' },
  deleted:  { label: '删除', color: 'var(--d-error)' },
};

export function FileChangeList({ files }: FileChangeListProps) {
  return (
    <div className={styles.container}>
      <h4 className={styles.title}>文件变更 ({files.length})</h4>
      <ul className={styles.list}>
        {files.slice(0, 10).map((file, index) => {
          const config = TYPE_CONFIG[file.type];
          return (
            <motion.li
              key={`${file.path}-${index}`}
              variants={staggerItem}
              className={styles.item}
            >
              <span
                className={styles.dot}
                style={{ background: config.color }}
                aria-hidden="true"
              />
              <code className={styles.path}>{file.path}</code>
              <span className={styles.badge} style={{ color: config.color }}>
                {config.label}
              </span>
            </motion.li>
          );
        })}
        {files.length > 10 && (
          <li className={styles.more}>+{files.length - 10} 更多文件...</li>
        )}
      </ul>
    </div>
  );
}
```

---

> 以上规范覆盖了 Dionysus Agent Lens 前端部分的技术架构、设计 Token 体系、组件接口定义及三个核心组件的完整实现。所有代码示例均遵循 TypeScript 严格模式，可直接作为工程开发的参考实现。

---

## 3. 后端全链路技术架构

Dionysus Agent Lens 的后端采用 **"核心共享 + 双模式部署"** 的架构设计：所有业务逻辑封装在 `@dionysus/core` npm 包中，接口层通过适配器模式同时支持 Extension 内嵌模式（模式 A）与独立 Bridge 模式（模式 B）。这种设计确保了两种运行模式下业务逻辑 100% 复用，仅部署形态不同。

---

### 3.1 后端分层架构

```
后端架构（@dionysus/core npm 包）

┌─────────────────────────────────────────────┐
│              接口层 (API Layer)               │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │ WS Server    │  │ HTTP API (可选)      │ │
│  │ (ws@8.18.0)  │  │ (express@4.21.0)     │ │
│  └──────┬───────┘  └──────────┬───────────┘ │
└─────────┼─────────────────────┼─────────────┘
          │                     │
┌─────────▼─────────────────────▼─────────────┐
│           业务逻辑层 (Core Layer)             │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │ 状态管理器    │  │ 角色管家引擎         │ │
│  │ StateManager │  │ ButlerEngine         │ │
│  └──────┬───────┘  └──────────┬───────────┘ │
│         │                     │              │
│  ┌──────▼───────┐  ┌─────────▼──────────┐  │
│  │ CLI 进程管理  │  │ 情绪引擎            │  │
│  │ AgentPool    │  │ EmotionEngine      │  │
│  └──────┬───────┘  └─────────┬──────────┘  │
│         │                     │              │
│  ┌──────▼─────────┐ ┌────────▼─────────┐   │
│  │ 状态解析引擎    │ │ 自主决策引擎      │   │
│  │ ParserEngine   │ │ AutonomyEngine   │   │
│  └──────┬────────┘ └────────┬─────────┘   │
│         │                     │              │
│  ┌──────▼───────┐  ┌─────────▼──────────┐  │
│  │ 会话存储      │  │ 台词生成器          │  │
│  │ SessionStore │  │ BubbleGenerator    │  │
│  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────┐
│           适配器层 (Adapter Layer)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Claude   │ │ Kimi     │ │ Codex        │ │
│  │ Code     │ │ Code     │ │ CLI          │ │
│  │ Adapter  │ │ Adapter  │ │ Adapter      │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
└─────────────────────────────────────────────┘
```

**分层职责说明：**

- **接口层（API Layer）**：负责与前端（VS Code Extension UI / Web 面板 / Mobile）的通信。WebSocket 服务器基于 `ws@8.18.0` 实现全双工实时通信，HTTP API（可选）基于 `express@4.21.0` 提供 REST 端点用于设备配对和配置管理。
- **业务逻辑层（Core Layer）**：后端的核心，包含六大引擎：
  - `AgentPool` — CLI 进程生命周期管理，通过 `node-pty` 启动伪终端确保 ANSI 码完整保留
  - `ParserEngine` — 逐行解析 Agent CLI 的标准输出，提取执行状态（thinking / executing / error / success）
  - `ButlerEngine` — 角色管家总控，协调情绪、自主决策、台词生成三大子系统
  - `EmotionEngine` — 根据 Agent 状态和亲和度计算角色情绪值
  - `AutonomyEngine` — 定时 tick 触发巡视、闲聊、长任务播报等自主行为
  - `SessionStore` — 基于 `lowdb` 的 JSON 文件持久化，记录完整会话历史
- **适配器层（Adapter Layer）**：为每个支持的 Coding Agent 提供统一抽象。新增 Agent 支持只需实现 `BaseAdapter` 接口，无需修改上层逻辑。

---

### 3.2 技术栈选型（精确到包名+版本+选型理由+替代方案）

#### 3.2.1 核心运行时

| 组件 | 选型 | 版本 | 选型理由 | 替代方案及淘汰原因 |
|------|------|------|---------|------------------|
| 运行时 | Node.js | `^20.10.0` LTS | Extension 和 Bridge 均运行在同一 Node 环境，单技术栈降低维护成本；LTS 版本确保稳定性与长期支持 | **Deno**（Extension Host 不兼容，且 npm 生态不兼容）、**Bun**（Extension 环境不支持原生编译）、**Python**（v0.2.0 已证明双栈维护成本过高，类型系统薄弱） |
| 语言 | TypeScript | `^5.7.0` | 前后端统一语言、强类型安全、优秀的 IDE 支持、VS Code Extension 开发的事实标准 | **JavaScript**（缺少静态类型，大型项目维护困难）、**Bun**（运行时不够稳定，Extension 不支持） |
| 构建 | tsup | `^8.3.0` | 极速 TypeScript 打包（基于 esbuild）、零配置、原生支持 ESM/CJS 双输出、自动生成 `.d.ts` 声明文件、watch 模式开发体验好 | **tsc**（仅类型检查不打包）、**esbuild**（不生成类型声明文件）、**rollup**（配置复杂、插件生态碎片化）、**vite**（面向浏览器，Node 库打包不是强项） |
| 进程管理 | `child_process` + `tree-kill` | `^1.2.2` | `child_process` 为 Node 原生模块无依赖；`tree-kill@1.2.2` 确保 SIGTERM/SIGKILL 信号传播到整个进程树，防止 Agent CLI 的孙子进程泄漏 | **pspawn**（无额外价值，功能单一）、**pm2**（面向生产服务器进程守护，过重）、**terminate**（不支持 Windows 进程树） |

#### 3.2.2 WebSocket 通信

| 组件 | 选型 | 版本 | 选型理由 | 替代方案及淘汰原因 |
|------|------|------|---------|------------------|
| WS 服务器 | `ws` | `^8.18.0` | Node.js 生态中性能最优的 WebSocket 库，无原生 C++ 依赖（Extension 环境可安装），包体积小（~150KB），API 极简，支持 permessage-deflate 压缩，月下载量超 4000 万，经过生产验证 | **Socket.IO**（体积大 5 倍、内置不必要的 HTTP fallback 机制、命名空间/房间等功能对本项目过度设计）、**µWebSockets.js**（需要 C++ 原生编译，VS Code Extension 的 Node 环境不支持二进制模块加载）、**websocket**（性能差、API 老旧、社区活跃度低） |
| WS 客户端 | `ws`（同一包） | `^8.18.0` | 客户端与服务端共用同一包，API 完全一致，减少心智负担；内置自动重连逻辑可自行封装 | **原生 WebSocket**（Node 环境无原生实现，缺少重连、心跳等机制）、**isomorphic-ws**（本项目不需要浏览器+Node 同构，Extension 环境固定为 Node） |
| 消息序列化 | 原生 `JSON` + `msgpack-lite` | `^2.8.0` | JSON 作为默认格式（零依赖、人可读）；`msgpack-lite` 用于大体积 stdout 输出的二进制压缩，减少 WS 传输带宽 | **protobuf**（需要维护 `.proto` Schema，对动态解析 Agent 输出过度设计）、**avro**（需要 Schema 注册，不适用）、**原生 JSON -only**（大输出传输效率低） |
| 心跳检测 | 自研（基于 `ws` 原生 ping/pong） | — | `ws` 库原生支持 WebSocket 协议级 ping/pong 帧，零开销、零依赖，无需应用层实现 | **应用层心跳**（ unnecessary overhead，需要在消息体中额外封装字段）、**第三方心跳库**（无必要，ws 已原生支持） |

#### 3.2.3 进程与流处理

| 组件 | 选型 | 版本 | 选型理由 | 替代方案及淘汰原因 |
|------|------|------|---------|------------------|
| CLI 进程管理 | `node-pty` | `^1.0.0` | 基于原生 PTY（伪终端）实现，完整保留 ANSI 转义码（颜色、光标移动、清屏），支持 Shell 交互式命令（如需要 TTY 的 Agent CLI），跨平台支持（Windows ConPTY / Unix openpty） | **child_process.spawn**（丢失 ANSI 颜色和进度条等终端控制序列，无法运行需要 TTY 的程序）、**pseudo-terminal**（已废弃，不再维护）、**pty.js**（多年未更新，node-pty 的社区 fork 已取代之） |
| 流处理 | Node.js `readline` | 原生 | Node 内建模块，逐行解析 stdout 流、内置缓冲区管理、内存友好，无需额外依赖 | **split2**（功能与 readline 重复，不必要的外部依赖）、**event-stream**（已曝出安全漏洞，不再信任） |
| ANSI 解析 | `ansi-regex` + `strip-ansi` | `^6.1.0` / `^7.1.1` | `ansi-regex` 精确匹配所有 ANSI 转义序列（支持 ES2015 Unicode 特性），`strip-ansi` 轻量（~100 行代码）、零依赖、用于 ParserEngine 清洗原始输出 | **chalk**（本场景不需要输出着色，仅需解析/剥离 ANSI 码，chalk 体积过大）、**ansi-styles**（仅提供样式映射，不直接支持剥离）、**正则自研**（ANSI 序列规则复杂，容易遗漏 edge case） |
| 节流防抖 | `p-throttle` + `p-debounce` | `^2.2.0` | Promise 友好、支持 TypeScript 类型、单个函数分别导入体积可控、支持 leading/trailing 选项，用于 stdout 高频输出的节流处理 | **lodash.throttle / lodash.debounce**（需要单独安装子包但仍依赖 lodash 核心，类型声明不完整）、**throttle-debounce**（不支持 Promise）、**RxJS**（体积巨大，杀鸡用牛刀） |
| 并发控制 | `p-queue` | `^8.0.1` | 控制同时运行的 Agent 数量上限（默认 3 个），支持优先级队列（错误处理 > 新任务）、Promise 友好、TypeScript 原生支持，由 Sindre Sorhus 维护质量可靠 | **async**（已进入维护模式，社区活跃度下降）、**bluebird**（不需要其额外的 Promise 扩展功能）、**generic-pool**（面向资源池，不适合任务队列场景） |

#### 3.2.4 数据存储

| 组件 | 选型 | 版本 | 选型理由 | 替代方案及淘汰原因 |
|------|------|------|---------|------------------|
| 配置存储 | VS Code Memento API + `node-conf` | `^13.0.0` | Extension 模式下使用 VS Code 原生的 `ExtensionContext.globalState` / `workspaceState`（无需文件权限、自动迁移）；Bridge 独立模式下使用 `node-conf` 读取 JSON/YAML 配置文件，两套实现统一抽象为 `IConfigStore` 接口 | **localStorage**（Bridge 模式无浏览器环境，不存在 localStorage）、**configstore**（作者已归档，不再维护）、**electron-store**（Extension 非 Electron 环境） |
| 会话存储 | `lowdb` | `^7.0.0` | 纯 JSON 文件数据库、零配置、零原生依赖、数据文件人可读便于调试、支持 Lodash 链式查询语法、自动读写同步，非常适合 Extension 环境（无需安装 SQLite 等二进制模块） | **SQLite**（需要 `better-sqlite3` 等原生模块编译，VS Code Extension 的沙箱环境不允许编译 C++ 扩展）、**LevelDB**（API 不友好、需要原生依赖）、**LokiJS**（内存数据库，持久化需额外配置，不如 lowdb 简洁） |
| 缓存 | Node.js `Map` + `lru-cache` | `^11.0.0` | 内存缓存用原生 `Map`（会话级数据）；`lru-cache` 用于有大小限制的缓存（如最近 50 条解析结果），LRU 淘汰策略、零依赖、性能优秀 | **Redis**（需要额外安装和运行 Redis 服务，与轻量级设计目标冲突）、**node-cache**（功能与 lru-cache 重复，且 TTL 精度不如后者）、**quick-lru**（功能相似但社区维护不如 lru-cache 活跃） |
| 日志 | `winston` | `^3.17.0` | transports 体系丰富（文件/控制台/HTTP）、支持日志级别（error/warn/info/debug）、结构化 JSON 日志格式、可配置多目标输出（开发环境输出控制台，Bridge 模式输出日志文件），社区最成熟的 Node.js 日志库 | **pino**（性能更优但 Extension 日志量不大，pino 的 transport 需要额外配置 worker thread）、**consola**（功能较简单，缺少文件持久化 transport）、**log4js**（配置复杂、近期更新缓慢） |

#### 3.2.5 安全与认证

| 组件 | 选型 | 版本 | 选型理由 | 替代方案及淘汰原因 |
|------|------|------|---------|------------------|
| Token 生成 | `crypto.randomUUID` | Node 原生 | Node.js 14.17.0+ 内建支持，基于 RFC 4122 v4 的 UUID，无需引入外部依赖，用于生成 Agent 进程 ID 和配对 Token | **uuid**（npm 包，`crypto.randomUUID` 已完全替代其功能，不必要的外部依赖）、**nanoid**（虽然更短但非标准 UUID 格式，与外部系统集成时兼容性差） |
| 配置加密 | `node-cipher` | `^1.0.0` | 对称加密敏感配置（如 API keys、设备配对 token），基于 AES-256-GCM，支持密码派生密钥，防止配置文件被窃取后泄露凭证 | **无加密**（`device_token` 和 `api_key` 等敏感信息必须以密文存储）、**cryptr**（作者已归档不再维护）、**crypto-js**（体积大、纯 JS 实现性能差，不如 Node 原生 crypto 模块） |
| 输入校验 | `zod` | `^3.24.1` | TypeScript-first 的 Schema 校验库，前后端可共享 schema 定义（`@dionysus/shared` 包），编译时类型推断 + 运行时校验双保险，API 简洁（链式调用），零依赖，社区活跃 | **Joi**（体积大 3 倍、不支持 TS 类型推断、依赖 `@hapi` 生态）、**class-validator**（需要装饰器语法支持、依赖 `reflect-metadata`）、**yup**（功能类似但类型推断不如 zod 精准）、**io-ts**（函数式编程风格，学习曲线陡峭） |

#### 3.2.6 测试

| 组件 | 选型 | 版本 | 选型理由 | 替代方案及淘汰原因 |
|------|------|------|---------|------------------|
| 测试框架 | `vitest` | `^2.1.8` | 原生 TypeScript 支持（无需 ts-jest 配置）、极速执行（基于 Vite 的 esbuild 转换）、内置 VS Code Extension 测试支持（通过 `@vscode/test-cli` 集成）、HMR 模式开发体验好、Watch 模式极快 | **Jest**（配置复杂、ts-jest 版本兼容问题频发、执行速度慢 3-5 倍）、**Mocha**（太旧、需要额外配置 chai/sinon、缺少原生 TS 支持）、**node:test**（Node 18+ 原生，但生态不成熟、缺少 watch 模式） |
| 覆盖率 | `@vitest/coverage-v8` | `^2.1.8` | 与 vitest 原生集成、基于 V8 覆盖率引擎（比 Istanbul 更快）、支持 HTML/JSON/Text 多格式报告、无需额外配置 | **c8**（命令行工具，与测试框架集成不如 vitest 原生）、**nyc**（基于 Istanbul，速度慢、配置复杂）、**istanbul**（已停止独立维护） |
| Mock | `vitest`（内建） | — | `vi.fn()` / `vi.mock()` / `vi.spyOn()` 全部内建，支持模块级 mock、定时器 mock、Promise 微任务控制，与框架无缝集成 | **sinon**（外部依赖 unnecessary，vitest 内建已覆盖其 90% 功能）、**jest-mock**（仅 Jest 生态可用）、**testdouble**（API 设计不符合本项目习惯） |

---

### 3.3 CLI 进程管理（AgentPool）

`AgentPool` 是后端最核心的模块之一，负责所有 Coding Agent CLI 进程的生命周期管理。它通过 `node-pty` 启动伪终端进程，完整保留 ANSI 转义码，并通过 `tree-kill` 确保进程树被完全清理。

```typescript
// core/agent-pool.ts
import { spawn, IPty } from 'node-pty';
import { EventEmitter } from 'events';
import treeKill from 'tree-kill';
import { PQueue } from 'p-queue';

/** Agent 进程执行状态 */
type AgentExecutionState =
  | 'connecting'   // 正在启动
  | 'idle'         // 空闲等待
  | 'thinking'     // 分析/规划中
  | 'executing'    // 正在执行（编辑文件/运行命令）
  | 'plan_mode'    // Plan Mode 等待用户选择
  | 'user_input'   // 需要用户确认
  | 'long_running' // 长任务执行中
  | 'error'        // 发生错误
  | 'success';     // 成功完成

/** Agent 元数据 */
interface IAgentMetadata {
  commandCount?: number;
  filesEdited?: string[];
  currentStep?: string;
  [key: string]: unknown;
}

/** Agent 进程实例 */
interface IAgentProcess {
  id: string;
  adapterType: string;
  pty: IPty;
  workspacePath: string;
  status: AgentExecutionState;
  startTime: number;
  lastOutput: string;
  metadata: IAgentMetadata;
}

/** Agent 启动配置 */
interface IAgentSpawnConfig {
  adapterType: string;      // 'claude-code' | 'kimi-code' | 'codex' | ...
  workspacePath: string;    // 工作区绝对路径
  initialPrompt?: string;   // 可选的初始提示词
}

/** 适配器描述（由 Adapter Layer 提供） */
interface IAdapterDescriptor {
  shellCommand: string;
  args: string[];
  envVars?: Record<string, string>;
}

export class AgentPool extends EventEmitter {
  private processes: Map<string, IAgentProcess> = new Map();
  private queue = new PQueue({ concurrency: 3 }); // 最多 3 个并发 Agent
  private readonly MAX_AGENTS = 5;

  /** 启动一个新的 Agent CLI 进程 */
  async spawnAgent(config: IAgentSpawnConfig): Promise<string> {
    if (this.processes.size >= this.MAX_AGENTS) {
      throw new Error(`Max ${this.MAX_AGENTS} agents allowed. Kill an existing agent first.`);
    }

    // 通过适配器层获取启动参数
    const adapter = this.getAdapter(config.adapterType);
    const id = crypto.randomUUID();

    // 使用 node-pty 启动伪终端（保留完整的 ANSI 转义码）
    const pty = spawn(adapter.shellCommand, adapter.args, {
      cwd: config.workspacePath,
      env: { ...process.env, ...adapter.envVars } as { [key: string]: string },
      cols: 120,
      rows: 30,
    });

    const proc: IAgentProcess = {
      id,
      adapterType: config.adapterType,
      pty,
      workspacePath: config.workspacePath,
      status: 'connecting',
      startTime: Date.now(),
      lastOutput: '',
      metadata: {},
    };

    this.processes.set(id, proc);
    this.setupOutputHandling(id, pty);
    this.emit('agent:spawned', { id, adapterType: config.adapterType });

    // 如有初始提示词，写入伪终端
    if (config.initialPrompt) {
      pty.write(config.initialPrompt + '\r');
      proc.status = 'thinking';
    }

    return id;
  }

  /** 向指定 Agent 发送用户输入 */
  sendInput(agentId: string, input: string): void {
    const proc = this.processes.get(agentId);
    if (!proc) throw new Error(`Agent ${agentId} not found`);
    proc.pty.write(input + '\r');
    this.emit('agent:input', { id: agentId, input });
  }

  /** 发送 SIGINT (Ctrl+C) 到 Agent */
  sendInterrupt(agentId: string): void {
    const proc = this.processes.get(agentId);
    if (!proc) throw new Error(`Agent ${agentId} not found`);
    proc.pty.write('\x03'); // Ctrl+C 的 ASCII 码
    this.emit('agent:interrupt', { id: agentId });
  }

  /** 终止 Agent 进程（确保整个进程树被完全清理） */
  async killAgent(agentId: string): Promise<void> {
    const proc = this.processes.get(agentId);
    if (!proc) return;

    return new Promise((resolve) => {
      // 先发送 SIGTERM 优雅终止
      treeKill(proc.pty.pid, 'SIGTERM', (err) => {
        if (err) {
          // SIGTERM 失败，强制 SIGKILL
          treeKill(proc.pty.pid, 'SIGKILL', () => {
            this.cleanup(agentId);
            resolve();
          });
        } else {
          this.cleanup(agentId);
          resolve();
        }
      });

      // 5 秒超时保险：强制 SIGKILL
      setTimeout(() => {
        treeKill(proc.pty.pid, 'SIGKILL', () => {
          this.cleanup(agentId);
          resolve();
        });
      }, 5000);
    });
  }

  /** 获取所有运行中的 Agent */
  getActiveAgents(): IAgentProcess[] {
    return Array.from(this.processes.values()).filter(
      (p) => p.status !== 'idle' && p.status !== 'success'
    );
  }

  /** 获取指定 Agent */
  getAgent(agentId: string): IAgentProcess | undefined {
    return this.processes.get(agentId);
  }

  /** 更新 Agent 状态 */
  updateStatus(agentId: string, status: AgentExecutionState): void {
    const proc = this.processes.get(agentId);
    if (proc) {
      proc.status = status;
      this.emit('agent:status', { id: agentId, status });
    }
  }

  /** 清理进程记录 */
  private cleanup(agentId: string): void {
    this.processes.delete(agentId);
    this.emit('agent:killed', { id: agentId });
  }

  /** 设置 stdout 输出监听 */
  private setupOutputHandling(id: string, pty: IPty): void {
    let buffer = '';

    pty.onData((data: string) => {
      buffer += data;
      // 逐行解析：保留不完整的最后一行在缓冲区
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        this.emit('agent:output', { id, line });
      }
    });

    pty.onExit(({ exitCode, signal }) => {
      // 刷新缓冲区中的剩余内容
      if (buffer) {
        this.emit('agent:output', { id, line: buffer });
      }
      this.emit('agent:exit', { id, exitCode, signal });
      this.processes.delete(id);
    });
  }

  /** 从适配器层获取启动描述 */
  private getAdapter(adapterType: string): IAdapterDescriptor {
    // 实际实现通过 Adapter Layer 的动态加载
    const adapterMap: Record<string, IAdapterDescriptor> = {
      'claude-code': { shellCommand: 'claude', args: ['--verbose'] },
      'kimi-code': { shellCommand: 'kimi', args: [] },
      codex: { shellCommand: 'codex', args: [] },
    };
    const adapter = adapterMap[adapterType];
    if (!adapter) throw new Error(`Unknown adapter type: ${adapterType}`);
    return adapter;
  }
}
```

**关键设计决策：**

1. **`node-pty` 而非 `child_process.spawn`**：伪终端保留 ANSI 颜色码和进度条，Claude Code 等 Agent 的交互体验依赖完整的 TTY 环境。
2. **`tree-kill` 而非 `process.kill`**：Agent CLI 可能产生孙子进程（如编译器、测试进程），`tree-kill` 递归发送信号确保无孤儿进程残留。
3. **双阶段终止策略**：先 `SIGTERM`（优雅终止，允许清理），超时后 `SIGKILL`（强制终止），5 秒超时兜底。
4. **逐行缓冲策略**：`pty.onData` 回调不以换行符为边界（可能收到半个行），通过缓冲区保留不完整的最后一行，确保 `ParserEngine` 接收完整的行数据。
5. **`PQueue` 并发控制**：默认最多 3 个并发 Agent，防止资源耗尽；全局上限 5 个进程。

---

### 3.4 状态解析引擎（ParserEngine）

`ParserEngine` 通过正则模式匹配逐行解析 Agent CLI 的标准输出，提取当前执行状态、当前文件、错误信息等元数据。每个支持的 Agent 实现独立的 `IStatusParser` 接口。

```typescript
// core/parser-engine.ts
import stripAnsi from 'strip-ansi';

/** 解析出的状态事件 */
interface IStatusEvent {
  state: AgentExecutionState;
  metadata: {
    hint?: string;
    currentFile?: string | null;
    action?: 'edit' | 'command' | 'test';
    currentCommand?: string;
    errorMessage?: string;
    planOptions?: string[];
    prompt?: string;
  };
}

/** 状态解析器接口 */
interface IStatusParser {
  /** 解析单行输出，返回状态事件或 null */
  parseLine(line: string): IStatusEvent | null;
  /** 重置解析器状态（新会话开始时调用） */
  reset(): void;
}

// ─── Claude Code 解析器 ───

export class ClaudeCodeParser implements IStatusParser {
  private stepOptions: string[] = [];
  private currentFile: string | null = null;

  parseLine(line: string): IStatusEvent | null {
    const trimmed = stripAnsi(line).trim();
    if (!trimmed) return null;

    // ── 1. Plan Mode：检测到选项列表 ──
    const planMatch = trimmed.match(/^(\d+)\) (.+)$/);
    if (planMatch) {
      this.stepOptions.push(planMatch[2]);
      return {
        state: 'plan_mode',
        metadata: { planOptions: [...this.stepOptions] },
      };
    }

    // ── 2. 正在分析/思考 ──
    if (/^(Analyzing|Now I'll|Let me|I need to)/i.test(trimmed)) {
      return { state: 'thinking', metadata: { hint: trimmed } };
    }

    // ── 3. 正在修改文件 ──
    const fileMatch = trimmed.match(/^\s*[\u2713+]?\s*(\w+[/\w]*\.\w+)/);
    if (fileMatch || /^(Editing|Creating|Modifying|Writing)/i.test(trimmed)) {
      this.currentFile = fileMatch?.[1] || this.currentFile;
      return {
        state: 'executing',
        metadata: { currentFile: this.currentFile, action: 'edit' },
      };
    }

    // ── 4. 运行命令 ──
    if (/^\$\s+/.test(trimmed) || /^Running/.test(trimmed)) {
      return {
        state: 'executing',
        metadata: { currentCommand: trimmed, action: 'command' },
      };
    }

    // ── 5. 测试/验证 ──
    if (/^(Running tests|Test|PASS|FAIL|[✓✗])/i.test(trimmed)) {
      const isFail = /^(FAIL|✗)/i.test(trimmed);
      return {
        state: isFail ? 'error' : 'executing',
        metadata: { currentFile: this.currentFile, action: 'test' },
      };
    }

    // ── 6. 错误检测 ──
    if (/^(Error|ERROR|✗|✕|Failed|SyntaxError|TypeError)/i.test(trimmed)) {
      return {
        state: 'error',
        metadata: { errorMessage: trimmed, currentFile: this.currentFile },
      };
    }

    // ── 7. 成功完成 ──
    if (/^(Done|Finished|Completed|✓ Success)/i.test(trimmed)) {
      return { state: 'success', metadata: { currentFile: this.currentFile } };
    }

    // ── 8. 需要用户确认 ──
    if (/\?\s*$/.test(trimmed) || /(yes\/no|y\/n|confirm)/i.test(trimmed)) {
      return { state: 'user_input', metadata: { prompt: trimmed } };
    }

    // 无法解析，保持当前状态
    return null;
  }

  reset(): void {
    this.stepOptions = [];
    this.currentFile = null;
  }
}

// ─── Kimi Code 解析器 ───

export class KimiCodeParser implements IStatusParser {
  private currentFile: string | null = null;

  parseLine(line: string): IStatusEvent | null {
    const trimmed = stripAnsi(line).trim();
    if (!trimmed) return null;

    // Kimi Code 特有的模式匹配
    if (/^\[思考中\]/.test(trimmed)) {
      return { state: 'thinking', metadata: { hint: trimmed } };
    }

    const fileMatch = trimmed.match(/^\s*-\s*(\w+[/\w]*\.\w+)\s*$/);
    if (fileMatch) {
      this.currentFile = fileMatch[1];
      return {
        state: 'executing',
        metadata: { currentFile: this.currentFile, action: 'edit' },
      };
    }

    if (/^(错误|Error|失败)/i.test(trimmed)) {
      return {
        state: 'error',
        metadata: { errorMessage: trimmed, currentFile: this.currentFile },
      };
    }

    if (/^(完成|Done|成功)/i.test(trimmed)) {
      return { state: 'success', metadata: { currentFile: this.currentFile } };
    }

    return null;
  }

  reset(): void {
    this.currentFile = null;
  }
}

// ─── 解析器工厂 ───

export class ParserFactory {
  private parsers: Map<string, IStatusParser> = new Map();

  register(adapterType: string, parser: IStatusParser): void {
    this.parsers.set(adapterType, parser);
  }

  getParser(adapterType: string): IStatusParser {
    const parser = this.parsers.get(adapterType);
    if (!parser) throw new Error(`No parser registered for adapter: ${adapterType}`);
    return parser;
  }
}

// 默认注册
export const defaultParserFactory = new ParserFactory();
defaultParserFactory.register('claude-code', new ClaudeCodeParser());
defaultParserFactory.register('kimi-code', new KimiCodeParser());
```

**关键设计决策：**

1. **逐行解析而非正则全量匹配**：stdout 是流式数据，逐行解析保证实时性，延迟 < 50ms。
2. **`strip-ansi` 预处理**：所有 Agent CLI 输出包含 ANSI 颜色码，必须先剥离再匹配，避免正则失效。
3. **优先级排序**：按模式匹配的确定性从高到低排序（Plan Mode > 错误 > 成功 > 执行中），避免误判。
4. **状态保持**：`currentFile` 在解析器中持久保持，后续无文件名行可继承上下文。
5. **工厂模式注册**：新增 Agent 支持只需实现 `IStatusParser` 接口并注册，无需修改引擎逻辑。

---

### 3.5 角色管家引擎（ButlerEngine）

`ButlerEngine` 是角色行为的大脑，采用三层架构模型：

- **L1 反应层**：Agent 状态变化触发的即时角色反应（情绪变化 + 台词）
- **L2 自主层**：定时 tick 驱动的自主行为（巡视多 Agent、长任务播报、空闲闲聊）
- **L3 交互层**：用户与角色的直接互动反馈（点击、喂食、对话）

```typescript
// core/butler-engine.ts
import { EventEmitter } from 'events';

/** 角色情绪枚举 */
type CharacterEmotion =
  | 'neutral' | 'happy' | 'excited' | 'concerned'
  | 'surprised' | 'sad' | 'angry' | 'sleepy';

/** 行为优先级 */
type BehaviorPriority = 'critical' | 'high' | 'medium' | 'low';

/** 角色动作输出 */
interface ICharacterAction {
  emotion: CharacterEmotion;
  bubble: string | null;      // 台词气泡（null 表示无台词）
  priority: BehaviorPriority;
  animation: string;          // Live2D 动画触发名
  metadata?: Record<string, unknown>;
}

/** 角色配置 */
interface ICharacterConfig {
  name: string;
  emotionMap: Record<string, CharacterEmotion>;
  dialogueTemplates: IDialogueTemplate[];
}

/** Agent 状态事件输入 */
interface IAgentStatusEvent {
  agentId: string;
  currentState: AgentExecutionState;
  metadata: IStatusEvent['metadata'];
}

/** 用户交互输入 */
interface IUserInteraction {
  type: 'click' | 'feed' | 'chat' | 'pat' | 'poke';
  message?: string;
}

/** Agent 环境快照（用于自主决策） */
interface IAgentEnvironment {
  agents: Array<{
    id: string;
    adapterType: string;
    state: AgentExecutionState;
    currentFile?: string | null;
    elapsedTime?: number;
  }>;
}

/** 自主决策结果 */
interface IAutonomyDecision {
  type: 'roam' | 'chat' | 'long_task_update';
  targetAgent?: IAgentEnvironment['agents'][0];
  agent?: IAgentEnvironment['agents'][0];
}

/** 台词模板 */
interface IDialogueTemplate {
  state: AgentExecutionState;
  emotions: CharacterEmotion[];
  lines: string[];
}

// ─── 子引擎类定义 ───

class EmotionEngine {
  constructor(private emotionMap: ICharacterConfig['emotionMap']) {}

  calculate(event: IAgentStatusEvent): CharacterEmotion {
    const mapping = this.emotionMap[event.currentState];
    if (mapping) return mapping;
    // 默认映射规则
    switch (event.currentState) {
      case 'thinking': return 'neutral';
      case 'executing': return 'happy';
      case 'error': return 'concerned';
      case 'success': return 'excited';
      case 'plan_mode': return 'surprised';
      default: return 'neutral';
    }
  }

  getAnimation(emotion: CharacterEmotion): string {
    return `anim_${emotion}`;
  }

  getReactionEmotion(interaction: IUserInteraction): CharacterEmotion {
    switch (interaction.type) {
      case 'feed': return 'happy';
      case 'pat': return 'excited';
      case 'poke': return 'surprised';
      case 'chat': return 'happy';
      default: return 'neutral';
    }
  }
}

class BubbleGenerator {
  constructor(private templates: IDialogueTemplate[]) {}

  generate(context: {
    state: AgentExecutionState;
    emotion: CharacterEmotion;
    metadata: IStatusEvent['metadata'];
    affinity: number;
  }): string | null {
    const matches = this.templates.filter(
      (t) => t.state === context.state && t.emotions.includes(context.emotion)
    );
    if (matches.length === 0) return null;

    // 根据亲和度选择台词池（高亲和度解锁更多台词）
    const pool = matches.flatMap((m) => m.lines);
    const affinityTier = Math.min(Math.floor(context.affinity / 20), 4);
    const tierSize = Math.ceil(pool.length / 5);
    const available = pool.slice(0, (affinityTier + 1) * tierSize);

    return available[Math.floor(Math.random() * available.length)] || null;
  }

  getReactionDialogue(context: {
    interaction: IUserInteraction['type'];
    emotion: CharacterEmotion;
    affinity: number;
  }): string | null {
    const reactions: Record<string, string[]> = {
      click: ['嗯？有什么需要帮忙的吗？', '我在看着呢~'],
      feed: ['好吃！能量满满！', '谢谢投喂~'],
      pat: ['嘿嘿，好舒服~', '头发要乱啦~'],
      poke: ['哎呀！吓我一跳！', '干嘛戳我啦~'],
      chat: ['我在听哦~', '有什么想聊的吗？'],
    };
    const lines = reactions[context.interaction] || ['...'];
    return lines[Math.floor(Math.random() * lines.length)];
  }
}

class AffinitySystem {
  private interactions: Array<{ type: string; timestamp: number }> = [];

  recordInteraction(type: string): void {
    this.interactions.push({ type, timestamp: Date.now() });
  }

  getLevel(): number {
    // 亲和度 0-100，基于最近 24 小时的交互频次计算
    const recent = this.interactions.filter(
      (i) => Date.now() - i.timestamp < 24 * 60 * 60 * 1000
    );
    return Math.min(100, recent.length * 5);
  }
}

class BehaviorScheduler {
  private lastTick = 0;

  shouldTick(): boolean {
    const now = Date.now();
    if (now - this.lastTick > 1000) {
      this.lastTick = now;
      return true;
    }
    return false;
  }
}

// ─── 自主决策引擎 ───

class AutonomyEngine {
  private lastChatTime = 0;
  private lastRoamTime = 0;
  private chatCount = 0;
  private readonly MAX_CHATS = 5;

  decide(env: IAgentEnvironment): IAutonomyDecision | null {
    const now = Date.now();

    // 多 Agent 巡视（每 15 秒一次）
    if (env.agents.length >= 2 && now - this.lastRoamTime > 15000) {
      this.lastRoamTime = now;
      return { type: 'roam', targetAgent: this.selectNextAgent(env) };
    }

    // 长任务播报（每 45 秒一次，最多 5 次）
    const longRunningAgent = env.agents.find((a) => a.state === 'long_running');
    if (
      longRunningAgent &&
      now - this.lastChatTime > 45000 &&
      this.chatCount < this.MAX_CHATS
    ) {
      this.lastChatTime = now;
      this.chatCount++;
      return { type: 'long_task_update', agent: longRunningAgent };
    }

    // 空闲闲聊（每 60 秒，20% 概率）
    if (
      env.agents.every((a) => a.state === 'idle') &&
      now - this.lastChatTime > 60000
    ) {
      if (Math.random() < 0.2) {
        this.lastChatTime = now;
        return { type: 'chat' };
      }
    }

    return null;
  }

  private selectNextAgent(env: IAgentEnvironment): IAgentEnvironment['agents'][0] {
    const idx = Math.floor(Math.random() * env.agents.length);
    return env.agents[idx];
  }

  reset(): void {
    this.lastChatTime = 0;
    this.lastRoamTime = 0;
    this.chatCount = 0;
  }
}

// ─── ButlerEngine 主类 ───

export class ButlerEngine extends EventEmitter {
  private emotionEngine: EmotionEngine;
  private autonomyEngine: AutonomyEngine;
  private bubbleGenerator: BubbleGenerator;
  private affinitySystem: AffinitySystem;
  private scheduler: BehaviorScheduler;

  constructor(config: ICharacterConfig) {
    super();
    this.emotionEngine = new EmotionEngine(config.emotionMap);
    this.autonomyEngine = new AutonomyEngine();
    this.bubbleGenerator = new BubbleGenerator(config.dialogueTemplates);
    this.affinitySystem = new AffinitySystem();
    this.scheduler = new BehaviorScheduler();
  }

  // ═══════════════════════════════════════════
  // L1: 反应层 —— Agent 状态变化 → 角色反应
  // ═══════════════════════════════════════════
  onAgentStatusChange(event: IAgentStatusEvent): ICharacterAction {
    // 计算情绪
    const emotion = this.emotionEngine.calculate(event);

    // 生成台词
    const bubble = this.bubbleGenerator.generate({
      state: event.currentState,
      emotion,
      metadata: event.metadata,
      affinity: this.affinitySystem.getLevel(),
    });

    // 高优先级行为（错误/Plan Mode）立即执行
    const priority = this.calculatePriority(event.currentState);

    const action: ICharacterAction = {
      emotion,
      bubble,
      priority,
      animation: this.emotionEngine.getAnimation(emotion),
    };

    this.emit('character:action', action);
    return action;
  }

  // ═══════════════════════════════════════════
  // L2: 自主层 —— 定期 tick，触发巡视/闲聊
  // ═══════════════════════════════════════════
  tick(environment: IAgentEnvironment): ICharacterAction | null {
    if (!this.scheduler.shouldTick()) return null;

    const decision = this.autonomyEngine.decide(environment);
    if (!decision) return null;

    switch (decision.type) {
      case 'roam':
        return this.handleRoam(environment, decision);
      case 'chat':
        return this.handleIdleChat(environment);
      case 'long_task_update':
        return this.handleLongTaskUpdate(environment, decision);
      default:
        return null;
    }
  }

  // ═══════════════════════════════════════════
  // L3: 交互层 —— 用户与角色互动
  // ═══════════════════════════════════════════
  onUserInteract(interaction: IUserInteraction): ICharacterAction {
    this.affinitySystem.recordInteraction(interaction.type);

    const emotion = this.emotionEngine.getReactionEmotion(interaction);
    const bubble = this.bubbleGenerator.getReactionDialogue({
      interaction: interaction.type,
      emotion,
      affinity: this.affinitySystem.getLevel(),
    });

    return {
      emotion,
      bubble,
      priority: 'medium',
      animation: `react_${interaction.type}`,
    };
  }

  // ─── 私有方法 ───

  private calculatePriority(state: AgentExecutionState): BehaviorPriority {
    if (state === 'error') return 'critical';
    if (state === 'plan_mode' || state === 'user_input') return 'high';
    if (state === 'success') return 'medium';
    return 'low';
  }

  private handleRoam(
    _env: IAgentEnvironment,
    decision: IAutonomyDecision
  ): ICharacterAction {
    const agentName = decision.targetAgent?.adapterType || 'unknown';
    return {
      emotion: 'neutral',
      bubble: `去看看 ${agentName} 在做什么...`,
      priority: 'low',
      animation: 'anim_walk',
    };
  }

  private handleIdleChat(_env: IAgentEnvironment): ICharacterAction {
    const lines = [
      '有点无聊呢...',
      '要喝点什么吗？',
      '今天的代码写得怎么样？',
      '休息一下，看看窗外吧~',
    ];
    return {
      emotion: 'sleepy',
      bubble: lines[Math.floor(Math.random() * lines.length)],
      priority: 'low',
      animation: 'anim_idle_chat',
    };
  }

  private handleLongTaskUpdate(
    _env: IAgentEnvironment,
    decision: IAutonomyDecision
  ): ICharacterAction {
    const file = decision.agent?.currentFile || '文件';
    return {
      emotion: 'concerned',
      bubble: `${file} 还在处理中，耐心等待一下~`,
      priority: 'medium',
      animation: 'anim_concerned',
    };
  }
}
```

**三层架构设计说明：**

1. **L1 反应层（事件驱动）**：`onAgentStatusChange` 是热路径，由 `ParserEngine` 的输出触发，延迟要求 < 100ms。错误状态（critical）会打断当前动画立即执行。
2. **L2 自主层（定时驱动）**：`tick()` 每秒执行一次，但通过 `BehaviorScheduler` 的节流控制实际决策频率。自主行为不会打断用户交互，只在角色空闲时触发。
3. **L3 交互层（用户驱动）**：用户点击、投喂等操作直接触发，亲和度系统记录交互历史，影响台词池的解锁层级。
4. **优先级系统**：critical > high > medium > low，高优先级行为可打断低优先级正在播放的动画/台词。
5. **亲和度系统**：0-100 分，每 20 分解锁一档新台词，激励用户与角色互动。

---

### 3.6 会话存储（SessionStore）

`SessionStore` 基于 `lowdb` 实现轻量级 JSON 文件持久化，记录完整的 Agent 会话历史、文件变更统计和角色配对信息。

```typescript
// core/session-store.ts
import { Low } from 'lowdb';
import { JSONFilePreset } from 'lowdb/node';

/** 文件变更记录 */
interface IFileChange {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  linesAdded: number;
  linesRemoved: number;
  timestamp: number;
}

/** 会话数据 */
interface ISessionData {
  id: string;
  agentType: string;
  workspacePath: string;
  startTime: number;
  endTime?: number;
  status: AgentExecutionState;
  filesChanged: IFileChange[];
  totalLinesAdded: number;
  totalLinesRemoved: number;
  errorCount: number;
  transcript: string[]; // 完整 CLI 输出记录（按行）
}

/** 应用设置 */
interface IAppSettings {
  characterName?: string;
  autoLaunchBridge?: boolean;
  theme?: 'light' | 'dark';
  [key: string]: unknown;
}

/** 设备配对记录 */
interface IPairingRecord {
  deviceId: string;
  deviceName: string;
  pairedAt: number;
  lastConnectedAt: number;
}

/** 数据库 Schema */
interface IDatabase {
  sessions: ISessionData[];
  settings: IAppSettings;
  pairings: IPairingRecord[];
}

export class SessionStore {
  private db!: Low<IDatabase>;

  /** 初始化数据库连接 */
  async init(dbPath: string): Promise<void> {
    this.db = await JSONFilePreset<IDatabase>(dbPath, {
      sessions: [],
      settings: {},
      pairings: [],
    });
  }

  /** 创建新会话 */
  async createSession(data: Omit<ISessionData, 'id'>): Promise<string> {
    const id = crypto.randomUUID();
    this.db.data.sessions.push({ ...data, id });
    await this.db.write();
    return id;
  }

  /** 更新会话 */
  async updateSession(id: string, updates: Partial<ISessionData>): Promise<void> {
    const session = this.db.data.sessions.find((s) => s.id === id);
    if (session) {
      Object.assign(session, updates);
      await this.db.write();
    }
  }

  /** 追加会话输出 */
  async appendTranscript(id: string, lines: string[]): Promise<void> {
    const session = this.db.data.sessions.find((s) => s.id === id);
    if (session) {
      session.transcript.push(...lines);
      // 每 100 行写入一次，减少 I/O
      if (session.transcript.length % 100 === 0) {
        await this.db.write();
      }
    }
  }

  /** 记录文件变更 */
  async recordFileChange(sessionId: string, change: IFileChange): Promise<void> {
    const session = this.db.data.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.filesChanged.push(change);
      session.totalLinesAdded += change.linesAdded;
      session.totalLinesRemoved += change.linesRemoved;
      await this.db.write();
    }
  }

  /** 获取最近会话 */
  async getRecentSessions(limit = 10): Promise<ISessionData[]> {
    return this.db.data.sessions
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);
  }

  /** 获取会话统计 */
  async getStats(): Promise<{
    totalSessions: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    totalErrors: number;
    avgSessionDuration: number;
  }> {
    const sessions = this.db.data.sessions;
    const completed = sessions.filter((s) => s.endTime);
    const totalDuration = completed.reduce(
      (sum, s) => sum + (s.endTime! - s.startTime),
      0
    );
    return {
      totalSessions: sessions.length,
      totalLinesAdded: sessions.reduce((s, x) => s + x.totalLinesAdded, 0),
      totalLinesRemoved: sessions.reduce((s, x) => s + x.totalLinesRemoved, 0),
      totalErrors: sessions.reduce((s, x) => s + x.errorCount, 0),
      avgSessionDuration: completed.length > 0 ? totalDuration / completed.length : 0,
    };
  }

  /** 创建设备配对 */
  async recordPairing(pairing: IPairingRecord): Promise<void> {
    const existing = this.db.data.pairings.findIndex(
      (p) => p.deviceId === pairing.deviceId
    );
    if (existing >= 0) {
      this.db.data.pairings[existing] = pairing;
    } else {
      this.db.data.pairings.push(pairing);
    }
    await this.db.write();
  }

  /** 获取已配对设备 */
  async getPairedDevices(): Promise<IPairingRecord[]> {
    return this.db.data.pairings.sort(
      (a, b) => b.lastConnectedAt - a.lastConnectedAt
    );
  }
}
```

**关键设计决策：**

1. **`lowdb` 而非 SQLite**：Extension 环境无法编译 C++ 原生模块，`lowdb` 纯 JavaScript 实现零依赖。
2. **JSON 文件人可读**：便于调试和问题排查，用户可直接查看 `db.json` 了解会话历史。
3. **批量写入优化**：transcript 每 100 行批量写入一次，减少高频 I/O 对性能的影响。
4. **Lodash 链式查询**：`lowdb` 内建 Lodash 支持，复杂查询可直接使用链式 API。

---

### 3.7 Bridge 模式实现

Bridge 模式是 Extension 内嵌模式的独立部署形态，复用 `@dionysus/core` 的全部业务逻辑，仅接口层的启动方式不同。

```typescript
// bridge/index.ts
import { WebSocketServer, WebSocket } from 'ws';
import { AgentPool } from '@dionysus/core/agent-pool';
import { ButlerEngine } from '@dionysus/core/butler-engine';
import { SessionStore } from '@dionysus/core/session-store';
import { PairingManager } from '@dionysus/core/pairing-manager';
import { createLogger, transports } from 'winston';
import { z } from 'zod';

/** Bridge 配置 Schema */
const BridgeConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(8765),
  host: z.string().default('0.0.0.0'),
  dbPath: z.string().default('./.dionysus/db.json'),
  maxAgents: z.number().int().min(1).max(10).default(5),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

// ─── 日志 ───
const logger = createLogger({
  level: 'info',
  format: transports.format.combine(
    transports.format.timestamp(),
    transports.format.json()
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: '.dionysus/bridge.log' }),
  ],
});

// ─── 全局模块实例 ───
interface IModuleContext {
  pool: AgentPool;
  butler: ButlerEngine;
  store: SessionStore;
  pairing: PairingManager;
}

// ─── 消息协议 ───
interface IWSMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

// ─── 广播工具 ───
function broadcast(wss: WebSocketServer, type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload, timestamp: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ─── 连接处理器 ───
function handleConnection(
  ws: WebSocket,
  _req: import('http').IncomingMessage,
  modules: IModuleContext
): void {
  logger.info('New WebSocket connection established');

  // 发送当前状态快照
  ws.send(
    JSON.stringify({
      type: 'init',
      payload: { agents: modules.pool.getActiveAgents() },
      timestamp: Date.now(),
    })
  );

  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString()) as IWSMessage;

      switch (msg.type) {
        case 'agent:spawn': {
          const { adapterType, workspacePath, initialPrompt } = msg.payload;
          modules.pool
            .spawnAgent({ adapterType, workspacePath, initialPrompt })
            .then((id) => {
              ws.send(JSON.stringify({ type: 'agent:spawned', payload: { id } }));
            })
            .catch((err) => {
              ws.send(
                JSON.stringify({ type: 'error', payload: { message: err.message } })
              );
            });
          break;
        }

        case 'agent:input': {
          const { agentId, input } = msg.payload;
          modules.pool.sendInput(agentId as string, input as string);
          break;
        }

        case 'agent:kill': {
          const { agentId } = msg.payload;
          modules.pool.killAgent(agentId as string).then(() => {
            ws.send(JSON.stringify({ type: 'agent:killed', payload: { agentId } }));
          });
          break;
        }

        case 'user:interact': {
          const { interactionType } = msg.payload;
          const action = modules.butler.onUserInteract({
            type: interactionType as IUserInteraction['type'],
          });
          ws.send(JSON.stringify({ type: 'character:action', payload: action }));
          break;
        }

        default:
          logger.warn(`Unknown message type: ${msg.type}`);
      }
    } catch (err) {
      logger.error('Failed to process message', { error: (err as Error).message });
    }
  });

  ws.on('close', () => {
    logger.info('WebSocket connection closed');
  });
}

// ─── Bridge 入口 ───
async function main(): Promise<void> {
  console.log('🎭 Dionysus Bridge starting...');

  // 解析配置
  const config = BridgeConfigSchema.parse({
    port: process.env.DIONYSUS_PORT ? parseInt(process.env.DIONYSUS_PORT) : undefined,
    host: process.env.DIONYSUS_HOST,
    dbPath: process.env.DIONYSUS_DB_PATH,
  });

  logger.level = config.logLevel;

  // 初始化各模块
  const store = new SessionStore();
  await store.init(config.dbPath);

  const pool = new AgentPool();
  const butler = new ButlerEngine(loadCharacterConfig());
  const pairing = new PairingManager(store);

  const modules: IModuleContext = { pool, butler, store, pairing };

  // 启动 WebSocket 服务器
  const wss = new WebSocketServer({ port: config.port, host: config.host });

  wss.on('connection', (ws, req) => {
    handleConnection(ws, req, modules);
  });

  // Agent 事件转发 → 所有 WebSocket 客户端
  pool.on('agent:output', ({ id, line }) => {
    broadcast(wss, 'agent:output', { agentId: id, line });
  });

  pool.on('agent:status', ({ id, status }) => {
    const action = butler.onAgentStatusChange({
      agentId: id,
      currentState: status,
      metadata: {},
    });
    broadcast(wss, 'character:action', action);
    broadcast(wss, 'agent:status', { agentId: id, status });
  });

  pool.on('agent:exit', ({ id, exitCode }) => {
    broadcast(wss, 'agent:exit', { agentId: id, exitCode });
  });

  // 管家 tick（每秒一次）
  setInterval(() => {
    const env = { agents: pool.getActiveAgents() };
    const action = butler.tick(env);
    if (action) broadcast(wss, 'character:action', action);
  }, 1000);

  // 打印连接信息
  const ip = getLocalIP();
  console.log(`📡  WebSocket Server: ws://${ip}:${config.port}`);
  console.log(`📱  Pairing URL:      http://${ip}:${config.port}`);
  console.log(`🗄️   Database:         ${config.dbPath}`);
  console.log(`⏻   Press Ctrl+C to stop`);

  // 优雅退出
  process.on('SIGTERM', async () => {
    logger.info('Shutting down Bridge...');
    wss.close();
    for (const agent of pool.getActiveAgents()) {
      await pool.killAgent(agent.id);
    }
    process.exit(0);
  });
}

// ─── 工具函数 ───

function loadCharacterConfig() {
  // 从配置文件或环境变量加载角色配置
  return {
    name: process.env.DIONYSUS_CHARACTER_NAME || 'Dionysus',
    emotionMap: {
      connecting: 'neutral',
      thinking: 'neutral',
      executing: 'happy',
      plan_mode: 'surprised',
      user_input: 'surprised',
      long_running: 'concerned',
      error: 'sad',
      success: 'excited',
    } as Record<string, CharacterEmotion>,
    dialogueTemplates: [
      {
        state: 'thinking',
        emotions: ['neutral'],
        lines: ['让我想想...', '正在分析中...', '这个问题有点意思~'],
      },
      {
        state: 'executing',
        emotions: ['happy'],
        lines: ['正在努力干活！', '代码写起来~', '进度在推进~'],
      },
      {
        state: 'error',
        emotions: ['concerned', 'sad'],
        lines: ['出错了...', '需要检查一下', '没关系，再看看~'],
      },
      {
        state: 'success',
        emotions: ['excited', 'happy'],
        lines: ['完成啦！', '太棒了！', '任务成功~'],
      },
    ],
  };
}

function getLocalIP(): string {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

main().catch((err) => {
  logger.error('Bridge failed to start', { error: err.message });
  process.exit(1);
});
```

**Bridge 与 Extension 模式的区别：**

| 特性 | Extension 模式（A） | Bridge 模式（B） |
|------|-------------------|-----------------|
| WebSocket 服务器 | Extension 内嵌，随 VS Code 启动 | 独立进程，手动或后台启动 |
| 数据库路径 | VS Code 全局存储目录 | 用户指定（默认 `~/.dionysus/`） |
| 配置管理 | `ExtensionContext.globalState` | `node-conf` JSON 配置文件 |
| 日志输出 | VS Code OutputChannel | 文件 + 控制台 |
| 使用场景 | 单人开发、快速启动 | 多设备配对、团队协作 |

---

### 3.8 包结构（`@dionysus/core`）

```
packages/core/
├── src/
│   ├── index.ts                    # 公共 API 导出（Extension & Bridge 统一入口）
│   ├── agent-pool.ts              # CLI 进程管理（AgentPool 类）
│   ├── parser-engine.ts           # 状态解析引擎（ParserEngine 工厂 + 接口）
│   ├── parsers/                   # 各 Agent 专用解析器
│   │   ├── claude-code.parser.ts  # Claude Code 输出解析
│   │   ├── kimi-code.parser.ts   # Kimi Code 输出解析
│   │   ├── codex.parser.ts       # OpenAI Codex CLI 解析
│   │   └── opencode.parser.ts    # OpenCode CLI 解析
│   ├── adapters/                  # CLI 适配器层
│   │   ├── base.adapter.ts        # 适配器抽象接口
│   │   ├── claude-code.adapter.ts # Claude Code 启动参数
│   │   ├── kimi-code.adapter.ts   # Kimi Code 启动参数
│   │   ├── codex.adapter.ts       # Codex CLI 启动参数
│   │   └── opencode.adapter.ts    # OpenCode CLI 启动参数
│   ├── butler-engine.ts           # 角色管家引擎（ButlerEngine 主类）
│   ├── emotion-engine.ts          # 情绪计算引擎
│   ├── autonomy-engine.ts         # 自主决策引擎
│   ├── bubble-generator.ts        # 台词/气泡生成器
│   ├── affinity-system.ts         # 亲和度系统
│   ├── session-store.ts           # 会话存储（lowdb 封装）
│   ├── pairing-manager.ts         # 设备配对管理器
│   ├── websocket/
│   │   ├── server.ts              # WS 服务器封装
│   │   ├── client.ts              # WS 客户端封装
│   │   └── protocol.ts            # WS 消息协议定义（Zod Schema）
│   ├── types/
│   │   ├── agent.ts               # Agent 相关类型定义
│   │   ├── character.ts           # 角色相关类型定义
│   │   ├── websocket.ts           # WebSocket 消息类型
│   │   └── index.ts               # 类型统一导出
│   └── utils/
│       ├── logger.ts              # Winston 日志封装
│       ├── ansi.ts                # ANSI 处理工具
│       ├── throttle.ts            # 节流防抖封装
│       └── time.ts                # 时间格式化工具
├── package.json                   # npm 包配置
├── tsconfig.json                  # TypeScript 配置
├── tsup.config.ts                 # tsup 打包配置（ESM + CJS 双输出）
└── vitest.config.ts               # 测试配置
```

**`package.json` 关键配置：**

```json
{
  "name": "@dionysus/core",
  "version": "0.3.0",
  "description": "Dionysus Agent Lens - Core backend logic for agent process management, status parsing, and character butler engine",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./agent-pool": {
      "import": "./dist/agent-pool.js",
      "require": "./dist/agent-pool.cjs"
    },
    "./butler-engine": {
      "import": "./dist/butler-engine.js",
      "require": "./dist/butler-engine.cjs"
    },
    "./session-store": {
      "import": "./dist/session-store.js",
      "require": "./dist/session-store.cjs"
    }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "ansi-regex": "^6.1.0",
    "lowdb": "^7.0.1",
    "lru-cache": "^11.0.2",
    "msgpack-lite": "^2.8.0",
    "node-pty": "^1.0.0",
    "p-debounce": "^4.0.0",
    "p-queue": "^8.0.1",
    "p-throttle": "^6.2.0",
    "strip-ansi": "^7.1.0",
    "tree-kill": "^1.2.2",
    "winston": "^3.17.0",
    "ws": "^8.18.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.13",
    "@vitest/coverage-v8": "^2.1.8",
    "tsup": "^8.3.5",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  },
  "engines": {
    "node": ">=20.10.0"
  }
}
```

---

### 3.9 关键设计模式总结

| 设计模式 | 应用位置 | 解决的问题 |
|---------|---------|-----------|
| **适配器模式（Adapter）** | `adapters/` 目录 | 统一不同 Agent CLI（Claude Code / Kimi Code / Codex）的启动参数和交互方式 |
| **策略模式（Strategy）** | `parsers/` 目录 | 不同 Agent 的输出格式不同，各自实现 `IStatusParser` 接口 |
| **观察者模式（Observer）** | `EventEmitter` 贯穿全链路 | AgentPool 输出 → ParserEngine 解析 → ButlerEngine 反应，全异步事件驱动 |
| **工厂模式（Factory）** | `ParserFactory` | 根据 `adapterType` 动态创建对应解析器，解耦创建逻辑 |
| **单例模式（Singleton）** | `SessionStore`、`AgentPool` | 全局唯一实例，确保数据一致性 |
| **命令模式（Command）** | WS 消息协议 | 前端发送命令 → 后端执行 → 广播结果，统一消息格式 |

本章节完整定义了 Dionysus Agent Lens 后端的技术架构，从分层设计到具体 npm 包选型，从核心代码实现到包结构设计，形成了可执行、可测试、可扩展的技术蓝图。所有模块均遵循 **"适配器隔离差异、核心共享逻辑"** 的原则，确保新增 Agent 支持仅需添加适配器和解析器两个文件，无需修改任何上层代码。

---

## 4. WebSocket 通信协议设计

### 4.1 协议设计原则

Dionysus Agent Lens 的通信协议以"轻量、状态驱动、可扩展"为核心目标，具体遵循以下五条设计原则：

**1. 简单优先**

不引入 Socket.IO、`socket.io-client` 等重型库及其命名空间、房间等抽象概念。Extension 侧使用原生 `ws@8.18.0` 作为 WebSocket 服务端，手机 PWA 侧使用浏览器原生 `WebSocket` API。消息序列化以 JSON 为主，避免额外的编解码开销。这种选择基于一个核心判断：Dionysus 的通信拓扑是"1 对极少"（1 个 Extension 最多连接 2-3 个移动客户端），而非"1 对数千"的聊天室场景，原生 `ws` 在性能和功能上完全足够，且能显著降低依赖体积和心智负担。

**2. 状态驱动**

所有 WebSocket 消息围绕 **Agent 执行状态的变化** 发送，而非无差别地转发 Agent 的原始 stdout/stderr 字节流。客户端关心的是"Agent 现在在做什么"（思考中？执行中？出错了？），而不是"Agent 刚才输出了第 8473 个字符"。原始输出通过独立的 `AGENT_OUTPUT_CHUNK` 消息可选订阅，默认不推送。这种设计将高频的字符流转换为低频的状态事件，极大降低了手机端的电量和网络消耗。

**3. 按需订阅**

手机端 PWA 在默认模式下只接收 `AGENT_STATUS_CHANGED`（状态变化）和 `CHARACTER_ACTION`（角色行为指令）两类消息，不接收原始输出流。当用户需要深度排查问题、查看完整构建日志时，可通过发送 `SUBSCRIBE_OUTPUT` 消息按需开启原始输出推送，并支持 `all` / `errors-only` / `none` 三级过滤。这种拉模式的设计确保移动侧不会因大体积的输出日志而卡顿。

**4. 压缩传输**

当 `AGENT_OUTPUT_CHUNK` 消息的 payload 超过 1KB 时，Extension 侧自动启用 `@msgpack/msgpack@3.0.0-beta2` 进行二进制编码，替代 JSON 字符串。msgpack 在处理大段重复性较高的代码输出时，压缩率通常可达 30%-50%。对于小消息（如状态变化、心跳），保持 JSON 可读性便于调试。客户端通过消息首字节判断编码类型：`0x7b`（`{`）为 JSON，其他为 msgpack。

**5. 向后兼容**

每条消息均携带 `v: number` 版本字段，当前协议版本为 `1`。未来如果需要协议升级（如新增必填字段、改变消息结构），可通过版本号进行协商：新客户端连接时在 `SUBSCRIBE_OUTPUT` 或升级握手时声明支持的版本范围，Server 选择双方兼容的最高版本进行通信。版本不兼容时 Server 返回 `ERROR` 消息并优雅断开。

---

### 4.2 消息格式

#### 基础消息包装（所有消息共用）

```typescript
// shared/protocol.ts

/** 协议基础消息包装 —— 所有 WebSocket 消息均使用此结构 */
interface IMessage<T = unknown> {
  v: number;           // 协议版本，当前 = 1
  id: string;          // 消息唯一ID（UUID v4，用于 ACK 和排重）
  ts: number;          // 发送时间戳（Unix ms，客户端计算延迟用）
  type: MessageType;   // 消息类型（短代码，减少传输体积）
  payload: T;          // 消息体（具体类型由 MessageType 决定）
}

/** 消息类型枚举 —— 使用短代码降低传输开销 */
enum MessageType {
  // === Server → Client（状态广播）===
  AGENT_STATUS_CHANGED = 'a.sc',     // Agent 状态变化（最高频）
  AGENT_OUTPUT_CHUNK = 'a.oc',       // Agent stdout 原始输出块（可选订阅）
  AGENT_COMPLETED = 'a.cp',          // Agent 执行完成（成功/失败/中断）
  CHARACTER_ACTION = 'c.ac',         // 角色行为指令（情绪+台词+动画）
  DASHBOARD_UPDATE = 'd.up',         // 仪表盘数据更新（文件变更、代码统计）
  SYSTEM_SNAPSHOT = 's.ss',          // 全量状态快照（新连接时推送）
  SYSTEM_PING = 's.pi',              // 心跳 ping
  PUSH_NOTIFICATION = 'p.no',        // 推送通知（仅 mobile PWA）

  // === Client → Server（用户指令）===
  USER_SEND_MESSAGE = 'u.sm',        // 用户发送消息给 Agent
  USER_SELECT_PLAN_OPTION = 'u.po',  // Plan Mode 选项选择
  USER_INTERRUPT_AGENT = 'u.ia',     // 打断当前 Agent
  USER_SWITCH_AGENT = 'u.sa',        // 切换聚焦 Agent
  USER_CHARACTER_INTERACT = 'u.ci',  // 与角色互动（点击、投喂等）
  USER_UPDATE_SETTINGS = 'u.us',     // 更新设置
  SUBSCRIBE_OUTPUT = 'u.so',         // 订阅/取消订阅原始输出

  // === 双向（系统）===
  SYSTEM_PONG = 's.po',              // 心跳 pong
  ACK = 'ack',                       // 消息确认（可靠消息用）
  ERROR = 'err',                     // 错误响应
}
```

#### 消息类型命名规范

类型标识采用 **`{domain}.{action}`** 的短代码格式，总长度控制在 4-5 字符。`a` 表示 Agent 域，`c` 表示 Character 域，`d` 表示 Dashboard 域，`s` 表示 System 域，`u` 表示 User 域，`p` 表示 Push 域。`.` 前为域缩写，`.` 后为动作缩写。这种设计在保持可读性的同时，将每条消息的 type 字段控制在 5 字符以内，相比完整英文单词可节省 60% 以上的传输体积。

---

### 4.3 核心消息定义

#### AGENT_STATUS_CHANGED（a.sc）—— 最高频消息

这是整个协议中最核心的消息类型，承载着 Agent 执行状态机的全部变化信息。每当 Parser 识别出 Agent 输出中的状态转换点时，Extension 立即构造此消息推送给所有已连接的客户端。

```typescript
// shared/protocol.ts

/** Agent 执行状态枚举 —— 所有 Agent CLI 的统一状态抽象 */
enum AgentExecutionState {
  IDLE = 'idle',           // 空闲（未在执行任务）
  THINKING = 'thinking',   // 思考/分析中（读取文件、制定计划）
  EXECUTING = 'executing', // 执行中（编辑文件、运行命令）
  PLAN_MODE = 'plan_mode', // Plan Mode 等待用户确认选项
  USER_INPUT = 'user_input', // 等待用户输入（交互式提问）
  ERROR = 'error',         // 执行出错（测试失败、编译错误等）
  SUCCESS = 'success',     // 执行成功完成
  INTERRUPTED = 'interrupted', // 被用户中断
}

/** 文件变更记录 */
interface IFileChange {
  path: string;             // 相对路径
  added: number;            // 新增行数
  removed: number;          // 删除行数
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

/** AGENT_STATUS_CHANGED 消息体 */
interface IAgentStatusChangedPayload {
  agentId: string;                    // Agent 唯一ID（如 "agent-001"）
  previousState: AgentExecutionState; // 上一状态
  currentState: AgentExecutionState;  // 当前状态
  timestamp: number;                  // 状态变化时间（Unix ms）
  duration: number;                   // 上一状态持续时间（ms，用于统计）
  metadata: {
    currentFile?: string;             // 当前操作的文件路径
    filesChanged?: IFileChange[];     // 已变更文件列表（累积）
    errorInfo?: {                     // 错误信息（仅在 error 状态时填充）
      message: string;                // 错误摘要（前200字符）
      file?: string;                  // 关联文件
      line?: number;                  // 关联行号
      severity: 'fatal' | 'warning' | 'info';
    };
    planOptions?: string[];           // Plan Mode 选项列表
    progress?: {                      // 进度信息（部分 Agent 支持）
      current: number;                // 当前步骤
      total: number;                  // 总步骤
      percent: number;                // 百分比（0-100）
    };
    currentCommand?: string;          // 当前执行的命令
    hint?: string;                    // 状态描述文本（如 "Analyzing src/auth.js"）
  };
}
```

**示例消息**：

```json
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ts": 1705000000000,
  "type": "a.sc",
  "payload": {
    "agentId": "agent-001",
    "previousState": "thinking",
    "currentState": "executing",
    "timestamp": 1705000000000,
    "duration": 3200,
    "metadata": {
      "currentFile": "src/auth.js",
      "filesChanged": [
        { "path": "src/auth.js", "added": 45, "removed": 12, "status": "modified" }
      ],
      "progress": { "current": 2, "total": 8, "percent": 25 },
      "hint": "Editing src/auth.js"
    }
  }
}
```

#### CHARACTER_ACTION（c.ac）—— 角色行为指令

`CHARACTER_ACTION` 消息是 Dionysus 的核心差异化功能载体。Extension 的 Character Engine 根据 Agent 状态变化、执行结果、错误信息等因素，决策角色的情绪反应、台词气泡、动画动作和语音输出，通过此消息下发给手机端 Live2D 渲染器。

```typescript
// shared/protocol.ts

/** 角色行为指令消息体 */
interface ICharacterActionPayload {
  emotion: string;                    // 目标情绪（如 "happy" / "worried" / "excited"）
  bubble?: {                          // 台词气泡（可选）
    text: string;                     // 台词文本
    durationMs: number;               // 显示时长（ms，超时自动消失）
    position: 'top' | 'left' | 'right'; // 气泡位置
  };
  animation?: {                       // 动画指令（可选）
    type: string;                     // 动画名称（如 "nod" / "shake_head" / "jump"）
    durationMs: number;               // 动画时长
    loop: boolean;                    // 是否循环
  };
  sound?: {                           // 音频指令（可选）
    type: 'tts' | 'sfx';             // TTS 语音合成 或 音效
    content: string;                  // TTS文本 或 音效ID
  };
  priority: 'critical' | 'high' | 'medium' | 'low';
  agentId?: string;                   // 关联的 Agent（null = 通用/系统级）
}
```

**示例：Agent 出错时的角色反应**：

```json
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "ts": 1705000001000,
  "type": "c.ac",
  "payload": {
    "emotion": "worried",
    "bubble": {
      "text": "哎呀，测试在 auth.test.js 第45行失败了，让我帮你看看...",
      "durationMs": 5000,
      "position": "top"
    },
    "animation": {
      "type": "shake_head",
      "durationMs": 800,
      "loop": false
    },
    "sound": {
      "type": "tts",
      "content": "测试失败了，我正在分析错误原因"
    },
    "priority": "critical",
    "agentId": "agent-001"
  }
}
```

#### USER_SEND_MESSAGE（u.sm）—— 用户发送消息

手机端用户通过此消息向 Agent 发送指令，Extension 收到后通过 stdin 写入 Agent 进程。

```typescript
// shared/protocol.ts

interface IUserSendMessagePayload {
  agentId?: string;                   // 目标 Agent（空 = 默认 Agent）
  content: string;                    // 消息内容（用户输入的文本）
  context?: {                         // Extension 自动填充的上下文
    currentFile?: string;             // 当前焦点文件
    selection?: string;               // 当前选中的代码片段
    workspacePath?: string;           // 工作区根目录
  };
}
```

#### SYSTEM_SNAPSHOT（s.ss）—— 全量状态同步

新客户端（手机 PWA）首次连接 WebSocket 时，Extension Server 在 `open` 事件后立即推送一条全量状态快照，确保客户端无需等待下一次状态变化就能看到完整画面。

```typescript
// shared/protocol.ts

interface IAgentSnapshot {
  agentId: string;
  state: AgentExecutionState;
  metadata: IAgentStatusChangedPayload['metadata'];
  connectedAt: number;
  lastActivityAt: number;
}

interface IBubble {
  text: string;
  position: 'top' | 'left' | 'right';
  expiresAt: number;
}

interface IAppSettings {
  language: 'zh' | 'en';
  characterVoiceEnabled: boolean;
  ttsSpeed: number;
  outputSubscription: 'all' | 'errors-only' | 'none';
  autoHideBubble: boolean;
  theme: 'light' | 'dark' | 'system';
}

interface ISystemSnapshotPayload {
  version: string;                    // Dionysus Extension 版本号
  agents: IAgentSnapshot[];           // 所有 Agent 的当前状态
  character: {
    currentEmotion: string;
    currentBubble: IBubble | null;
    affinity: number;                 // 好感度（0-100）
  };
  settings: IAppSettings;
  timestamp: number;
}
```

---

### 4.4 订阅机制

手机端 PWA 默认采用 **轻量模式**：只接收 `AGENT_STATUS_CHANGED` 和 `CHARACTER_ACTION` 两类高频状态消息，以及 `SYSTEM_SNAPSHOT` 和心跳。`AGENT_OUTPUT_CHUNK`（原始 stdout 输出块）默认不推送。用户可通过发送 `SUBSCRIBE_OUTPUT` 消息动态调整订阅策略：

```typescript
// 客户端订阅原始输出
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "ts": 1705000002000,
  "type": "u.so",
  "payload": {
    "agentId": "agent-001",
    "subscribe": true,        // true = 订阅, false = 取消
    "filter": "errors-only"   // "all" | "errors-only" | "none"
  }
}

// Server 确认响应
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "ts": 1705000002001,
  "type": "ack",
  "payload": {
    "refId": "550e8400-e29b-41d4-a716-446655440002",
    "status": "subscribed",
    "filter": "errors-only"
  }
}
```

`filter` 字段的三级过滤语义：

| 过滤级别 | 含义 | 适用场景 |
|---------|------|---------|
| `all` | 推送所有 stdout/stderr 输出块 | 深度排查问题、查看完整构建日志 |
| `errors-only` | 仅推送包含错误关键词的输出块 | 只关心报错信息，不关心正常输出 |
| `none` | 不推送任何原始输出（默认） | 省电模式、只关注状态和角色 |

Extension 侧维护每个 WebSocket 连接的订阅表（`Map<ws, SubscriptionConfig>`），在 `AGENT_OUTPUT_CHUNK` 事件触发时根据订阅配置决定是否推送，避免不必要的序列化和网络传输。

---

### 4.5 心跳机制

```
心跳间隔:   30s（Server 发起 ping）
超时判定:   90s 未收到 pong → 标记连接为 dead → 断开
重连策略:   指数退避 (1s → 2s → 4s → 8s → ... → max 30s)
```

心跳消息格式极简，只携带时间戳用于计算往返延迟：

```typescript
// Server → Client（ping）
{ "v": 1, "id": "ping-001", "ts": 1705000000000, "type": "s.pi", "payload": {} }

// Client → Server（pong）
{ "v": 1, "id": "pong-001", "ts": 1705000000030, "type": "s.po", "payload": {} }
```

Extension 侧使用 `ws` 库的 `ping`/`pong` 帧作为传输层心跳检测，同时在应用层发送 `s.pi`/`s.po` JSON 消息，双重保障连接的活性。手机端 PWA 在 `visibilitychange` 事件（切后台）时主动发送 `u.so` 将订阅降级为 `none`，切回前台时恢复原订阅级别，进一步节省后台电量。

---

### 4.6 消息压缩

```typescript
// server/encoding.ts
import { encode } from '@msgpack/msgpack@3.0.0-beta2';

const COMPRESS_THRESHOLD = 1024;  // 1KB 压缩阈值

/** 消息编码 —— 小消息用 JSON，大输出块用 msgpack */
function encodeMessage(msg: IMessage): Buffer | string {
  const json = JSON.stringify(msg);

  // 仅对大体积的原始输出块启用 msgpack
  if (json.length > COMPRESS_THRESHOLD && msg.type === 'a.oc') {
    return Buffer.from(encode(msg));
  }

  return json;  // JSON 字符串（WebSocket 自动处理 UTF-8）
}

/** 消息解码 —— 根据首字节自动判断编码 */
function decodeMessage(data: Buffer | ArrayBuffer | string): IMessage {
  if (typeof data === 'string') {
    return JSON.parse(data);
  }

  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // 首字节 0x7b = '{' → JSON；其他 = msgpack
  if (buffer[0] === 0x7b) {
    return JSON.parse(buffer.toString('utf-8'));
  }

  return decode(buffer) as IMessage;  // msgpack 解码
}
```

压缩策略采用**条件压缩**：只有消息类型为 `a.oc`（原始输出块）且序列化后超过 1KB 时才启用 msgpack。这是因为：

1. `a.oc` 消息体通常是代码片段、日志行、终端输出，文本重复度高，msgpack 压缩收益显著；
2. `a.sc`、`c.ac` 等小消息本身不足 200 字节，msgpack 的二进制优势无法体现，JSON 的可读性反而更利于调试；
3. 首字节判断法（`0x7b` 检测）无需额外的类型标记字段，零开销实现编解码路由。

---

## 5. 多 Agent 适配架构

### 5.1 适配器模式设计

Dionysus Agent Lens 的核心挑战之一是：不同 Agent CLI（Claude Code、Kimi Code、Codex 等）的启动方式、参数格式、输出风格完全不同，但 Extension 需要将它们统一抽象为同一套状态机（`AgentExecutionState`）和 WebSocket 消息。为此，我们采用**双层适配器模式**（Adapter + Parser）来隔离差异。

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentPool (进程管理)                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                      │
│  │ Agent-1 │  │ Agent-2 │  │ Agent-3 │  ...                  │
│  │(进程-1)  │  │(进程-2)  │  │(进程-3)  │                      │
│  └────┬────┘  └────┬────┘  └────┬────┘                      │
└───────┼────────────┼────────────┼────────────────────────────┘
        │            │            │
        ▼            ▼            ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Adapter-A  │  │   Adapter-B  │  │   Adapter-C  │
│(进程启动/参数) │  │(进程启动/参数) │  │(进程启动/参数) │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Parser-A   │  │   Parser-B   │  │   Parser-C   │
│(输出→状态事件) │  │(输出→状态事件) │  │(输出→状态事件) │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Adapter** 负责 Agent 进程的**生命周期管理**（CLI 命令构建、环境变量配置、spawn 参数、进程监控）。**Parser** 负责 Agent **stdout/stderr 输出的实时解析**，将自由文本流转换为结构化的 `IStatusEvent` 状态事件。两者通过抽象基类解耦，新增 Agent CLI 只需实现一对 Adapter + Parser 类即可接入系统。

---

### 5.2 抽象接口定义

#### BaseAgentAdapter —— 进程启动适配抽象类

```typescript
// server/adapters/base.adapter.ts

/** Agent 进程启动配置 */
interface IAgentSpawnConfig {
  workspacePath: string;       // 工作区根目录
  agentId: string;             // Agent 唯一ID
  additionalArgs?: string[];   // 用户额外参数
  envOverrides?: NodeJS.ProcessEnv; // 环境变量覆盖
}

/** Agent 适配器抽象基类 */
export abstract class BaseAgentAdapter {
  /** 显示名称（如 "Claude Code"） */
  abstract readonly name: string;
  /** 类型标识（如 "claude-code"） */
  abstract readonly type: string;
  /** CLI 命令（如 "claude"） */
  abstract readonly cliCommand: string;
  /** 默认启动参数 */
  abstract readonly cliArgs: string[];
  /** 默认 shell */
  abstract readonly defaultShell: string;

  /** 获取该 Adapter 对应的 Parser 实例 */
  abstract getParser(): BaseStatusParser;

  /** 构建启动参数（可被子类覆盖） */
  buildArgs(config: IAgentSpawnConfig): string[] {
    return [...this.cliArgs, config.workspacePath, ...(config.additionalArgs || [])];
  }

  /** 构建环境变量（可被子类覆盖） */
  getEnv(): NodeJS.ProcessEnv {
    return { ...process.env } as NodeJS.ProcessEnv;
  }

  /** 构建 spawn 选项（可被子类覆盖，如 cwd、stdio 等） */
  getSpawnOptions(config: IAgentSpawnConfig): import('child_process').SpawnOptions {
    return {
      cwd: config.workspacePath,
      shell: this.defaultShell,
      env: this.getEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    };
  }
}
```

#### BaseStatusParser —— 状态解析抽象类

```typescript
// server/parsers/base.parser.ts

/** Parser 输出的状态事件 */
interface IStatusEvent {
  state: AgentExecutionState;   // 解析后的目标状态
  metadata: IAgentStatusChangedPayload['metadata']; // 附加元数据
}

/** 状态解析器抽象基类 */
export abstract class BaseStatusParser {
  /** 关联的 Adapter 类型 */
  abstract readonly adapterType: string;

  /** 解析单行输出 → 状态事件（核心方法） */
  abstract parseLine(line: string): IStatusEvent | null;

  /** 重置解析器状态（新 session / 进程重启时调用） */
  abstract reset(): void;

  /** 批量解析（用于日志回放或测试） */
  parseBatch(lines: string[]): IStatusEvent[] {
    return lines
      .map(l => this.parseLine(l))
      .filter((e): e is IStatusEvent => e !== null);
  }
}
```

---

### 5.3 Claude Code 适配（参考实现）

Claude Code 是 Anthropic 推出的官方 CLI Agent，输出以自然语言为主，配合 ANSI 颜色代码和特定的文本模式（如 `\u251c` 制表符树形结构）。以下是对其完整适配实现。

```typescript
// server/adapters/claude-code.adapter.ts
import { BaseAgentAdapter } from './base.adapter';
import { ClaudeCodeParser } from '../parsers/claude-code.parser';

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly name = 'Claude Code';
  readonly type = 'claude-code';
  readonly cliCommand = 'claude';
  readonly cliArgs = ['--verbose'];  // 启用详细输出便于解析状态
  readonly defaultShell = 'bash';

  getParser(): BaseStatusParser {
    return new ClaudeCodeParser();
  }

  // Claude Code 特殊环境变量配置
  getEnv(): NodeJS.ProcessEnv {
    return {
      ...super.getEnv(),
      CLAUDE_CODE_DEBUG: '1',        // 启用调试输出（更多状态信息）
      CLAUDE_CODE_COLOR: 'always',   // 强制 ANSI 颜色输出
    };
  }

  buildArgs(config: IAgentSpawnConfig): string[] {
    // Claude Code 支持 --output-format streaming 获取结构化输出
    return [...this.cliArgs, '--output-format', 'streaming', config.workspacePath];
  }
}
```

```typescript
// server/parsers/claude-code.parser.ts
import stripAnsi from 'strip-ansi@7.1.0';
import { BaseStatusParser } from './base.parser';

export class ClaudeCodeParser extends BaseStatusParser {
  readonly adapterType = 'claude-code';

  private buffer: string[] = [];
  private stepOptions: string[] = [];
  private currentFile: string | null = null;
  private inPlanMode = false;

  parseLine(line: string): IStatusEvent | null {
    const clean = stripAnsi(line).trim();
    if (!clean) return null;

    // ═══════════════════════════════════════════
    // Plan Mode 检测（最高优先级）
    // ═══════════════════════════════════════════
    if (clean.match(/^I'll help you/)) {
      this.inPlanMode = true;
      this.stepOptions = [];
    }

    const planMatch = clean.match(/^(\d+)[.)]\s+(.+)$/);
    if (planMatch && this.inPlanMode) {
      this.stepOptions.push(planMatch[2]);
      return {
        state: 'plan_mode',
        metadata: {
          planOptions: [...this.stepOptions],
          currentStep: this.stepOptions.length,
        },
      };
    }

    if (clean.match(/^Do you want me to proceed/)) {
      return {
        state: 'plan_mode',
        metadata: { planOptions: this.stepOptions, awaitingConfirmation: true },
      };
    }

    // ═══════════════════════════════════════════
    // 思考阶段检测
    // ═══════════════════════════════════════════
    if (/^(Analyzing|Looking at|Let me examine|I'll start by|Now let me)/i.test(clean)) {
      return { state: 'thinking', metadata: { hint: clean.substring(0, 100) } };
    }

    // ═══════════════════════════════════════════
    // 文件操作检测
    // ═══════════════════════════════════════════
    const editMatch = clean.match(/^(Editing|Creating|Deleting|Renaming)\s+(.+)/i);
    if (editMatch) {
      this.currentFile = editMatch[2].trim();
      return { state: 'executing', metadata: { currentFile: this.currentFile, action: 'edit' } };
    }

    const fileCheck = clean.match(/^\s*[\u2713\u2717+]\s*(\S+\.\S+)/);
    if (fileCheck) {
      this.currentFile = fileCheck[1];
      return { state: 'executing', metadata: { currentFile: this.currentFile } };
    }

    // ═══════════════════════════════════════════
    // 命令执行检测
    // ═══════════════════════════════════════════
    if (clean.startsWith('$ ') || /^Running\s/.test(clean)) {
      return { state: 'executing', metadata: { currentCommand: clean, action: 'command' } };
    }

    // ═══════════════════════════════════════════
    // 测试执行检测
    // ═══════════════════════════════════════════
    if (/^(Running tests?|Test Results)/i.test(clean)) {
      return { state: 'executing', metadata: { action: 'test' } };
    }

    const testFail = clean.match(/^(FAIL|\u2717)\s+(.+)/);
    if (testFail) {
      return {
        state: 'error',
        metadata: { errorMessage: testFail[2], severity: 'warning' },
      };
    }

    // ═══════════════════════════════════════════
    // 错误检测（多模式匹配）
    // ═══════════════════════════════════════════
    const errorPatterns = [
      /^Error:/i, /^ERROR:/, /^\[Error\]/,
      /^SyntaxError:/, /^TypeError:/, /^ReferenceError:/,
      /^\u2717\s+/, /^\u2715\s+/, /^\u00d7\s+/,
      /^Failed to/, /^Could not/, /^Cannot find/,
    ];
    if (errorPatterns.some(p => p.test(clean))) {
      return {
        state: 'error',
        metadata: {
          errorMessage: clean.substring(0, 200),
          currentFile: this.currentFile,
          severity: 'fatal',
        },
      };
    }

    // ═══════════════════════════════════════════
    // 成功完成检测
    // ═══════════════════════════════════════════
    const successPatterns = [
      /^Done!/, /^Finished/, /^Completed/, /^\u2713\s+Success/,
      /^All done/, /^I've completed/, /^The task is complete/,
    ];
    if (successPatterns.some(p => p.test(clean))) {
      this.inPlanMode = false;
      return { state: 'success', metadata: { currentFile: this.currentFile } };
    }

    // ═══════════════════════════════════════════
    // 用户输入请求检测
    // ═══════════════════════════════════════════
    if (/\?\s*$/.test(clean) || /\(y\/n\)/i.test(clean)) {
      return { state: 'user_input', metadata: { prompt: clean } };
    }

    // 未识别的行，不生成事件
    return null;
  }

  reset(): void {
    this.buffer = [];
    this.stepOptions = [];
    this.currentFile = null;
    this.inPlanMode = false;
  }
}
```

---

### 5.4 Kimi Code 适配

Kimi Code（Moonshot）的输出特征与 Claude Code 有显著差异：其 CLI 倾向于以 **JSON 事件流**格式输出结构化数据，同时混合中文文本提示。Parser 需要优先尝试 JSON 解析，失败时回退到文本正则匹配。

```typescript
// server/adapters/kimi-code.adapter.ts
import { BaseAgentAdapter } from './base.adapter';
import { KimiCodeParser } from '../parsers/kimi-code.parser';

export class KimiCodeAdapter extends BaseAgentAdapter {
  readonly name = 'Kimi Code';
  readonly type = 'kimi-code';
  readonly cliCommand = 'kimi';
  readonly cliArgs = ['--stream'];  // 启用流式输出
  readonly defaultShell = 'bash';

  getParser(): BaseStatusParser {
    return new KimiCodeParser();
  }
}
```

```typescript
// server/parsers/kimi-code.parser.ts
import stripAnsi from 'strip-ansi@7.1.0';
import { BaseStatusParser } from './base.parser';

export class KimiCodeParser extends BaseStatusParser {
  readonly adapterType = 'kimi-code';

  parseLine(line: string): IStatusEvent | null {
    const clean = stripAnsi(line).trim();
    if (!clean) return null;

    // ═══════════════════════════════════════════
    // 策略 1：JSON 事件流解析（优先）
    // Kimi Code 以 { "type": "...", "content": "..." } 格式输出
    // ═══════════════════════════════════════════
    if (clean.startsWith('{')) {
      try {
        const event = JSON.parse(clean);

        if (event.type === 'thinking') {
          return { state: 'thinking', metadata: { hint: event.content } };
        }
        if (event.type === 'tool_call') {
          return {
            state: 'executing',
            metadata: { currentFile: event.name || event.tool, action: event.name },
          };
        }
        if (event.type === 'tool_result') {
          return {
            state: 'executing',
            metadata: { currentFile: event.tool, action: `${event.tool}_result` },
          };
        }
        if (event.type === 'error') {
          return {
            state: 'error',
            metadata: { errorMessage: event.message, severity: 'fatal' },
          };
        }
        if (event.type === 'complete' || event.type === 'done') {
          return { state: 'success' };
        }
        if (event.type === 'plan' && event.options) {
          return {
            state: 'plan_mode',
            metadata: { planOptions: event.options, awaitingConfirmation: true },
          };
        }
      } catch {
        // JSON 解析失败 → 回退到文本解析
      }
    }

    // ═══════════════════════════════════════════
    // 策略 2：文本回退解析
    // ═══════════════════════════════════════════
    if (/^(思考中|分析中|让我看看)/.test(clean)) {
      return { state: 'thinking', metadata: { hint: clean } };
    }
    if (/^(正在修改|正在创建|正在删除)/.test(clean)) {
      const fileMatch = clean.match(/正在(?:修改|创建|删除)[:\s]+(.+)/);
      return { state: 'executing', metadata: { currentFile: fileMatch?.[1], action: 'edit' } };
    }
    if (/^(完成|已完成|任务已完成)/.test(clean)) {
      return { state: 'success' };
    }
    if (/^(错误|Error|出错)/.test(clean)) {
      return { state: 'error', metadata: { errorMessage: clean } };
    }

    return null;
  }

  reset(): void {
    // Kimi Code 解析器无持续状态，无需额外重置
  }
}
```

---

### 5.5 Codex CLI 适配

OpenAI Codex CLI 的输出风格偏向结构化进度指示：使用 Unicode 块字符（`█`）构建进度条，配合简洁的英文状态描述。

```typescript
// server/adapters/codex.adapter.ts
import { BaseAgentAdapter } from './base.adapter';
import { CodexParser } from '../parsers/codex.parser';

export class CodexAdapter extends BaseAgentAdapter {
  readonly name = 'Codex';
  readonly type = 'codex';
  readonly cliCommand = 'codex';
  readonly cliArgs = ['--full-auto'];  // 全自主模式
  readonly defaultShell = 'bash';

  getParser(): BaseStatusParser {
    return new CodexParser();
  }

  getEnv(): NodeJS.ProcessEnv {
    return {
      ...super.getEnv(),
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    };
  }
}
```

```typescript
// server/parsers/codex.parser.ts
import stripAnsi from 'strip-ansi@7.1.0';
import { BaseStatusParser } from './base.parser';

export class CodexParser extends BaseStatusParser {
  readonly adapterType = 'codex';

  private currentFile: string | null = null;

  parseLine(line: string): IStatusEvent | null {
    const clean = stripAnsi(line).trim();
    if (!clean) return null;

    // ═══════════════════════════════════════════
    // 进度条格式：███████ 75%
    // ═══════════════════════════════════════════
    if (clean.startsWith('\u2588')) {
      const progressMatch = clean.match(/\u2588+\s+(\d+)%/);
      if (progressMatch) {
        return {
          state: 'executing',
          metadata: { progress: { percent: parseInt(progressMatch[1]), current: 0, total: 100 } },
        };
      }
    }

    // ═══════════════════════════════════════════
    // 状态关键词检测
    // ═══════════════════════════════════════════
    if (/^(Working|Processing|Running|Executing)/i.test(clean)) {
      return { state: 'executing', metadata: { hint: clean } };
    }
    if (/^(Analyzing|Reviewing|Planning|Thinking)/i.test(clean)) {
      return { state: 'thinking', metadata: { hint: clean } };
    }
    if (/^(Done|Complete|Finished|Success)/i.test(clean)) {
      return { state: 'success' };
    }
    if (/^(Error|Failed|Abort|Cancelled)/i.test(clean)) {
      return { state: 'error', metadata: { errorMessage: clean, severity: 'fatal' } };
    }

    // ═══════════════════════════════════════════
    // 文件操作检测
    // ═══════════════════════════════════════════
    const fileMatch = clean.match(/(?:file|editing|creating)\s+[`\"']?(\S+\.\S+)[`\"']?/i);
    if (fileMatch) {
      this.currentFile = fileMatch[1];
      return { state: 'executing', metadata: { currentFile: this.currentFile, action: 'edit' } };
    }

    // ═══════════════════════════════════════════
    // Plan Mode 检测
    // ═══════════════════════════════════════════
    if (/^(Shall I|Would you like me to|Do you want me to)/i.test(clean)) {
      return { state: 'user_input', metadata: { prompt: clean } };
    }

    return null;
  }

  reset(): void {
    this.currentFile = null;
  }
}
```

---

### 5.6 适配器注册与发现

AdapterRegistry 负责统一管理所有 Agent 适配器的注册、实例化和自动发现。Extension 启动时会调用 `detectInstalled()` 扫描用户系统中已安装的 CLI 工具，只注册可用的 Agent。

```typescript
// server/core/adapter-registry.ts
import { BaseAgentAdapter } from '../adapters/base.adapter';
import { ClaudeCodeAdapter } from '../adapters/claude-code.adapter';
import { KimiCodeAdapter } from '../adapters/kimi-code.adapter';
import { CodexAdapter } from '../adapters/codex.adapter';
import { OpenCodeAdapter } from '../adapters/opencode.adapter';
import { CodeBuddyAdapter } from '../adapters/codebuddy.adapter';
import { execa } from 'execa@9.5.0';

export class AdapterRegistry {
  private adapters: Map<string, new () => BaseAgentAdapter> = new Map();

  constructor() {
    // 注册内置适配器
    this.register('claude-code', ClaudeCodeAdapter);
    this.register('kimi-code', KimiCodeAdapter);
    this.register('codex', CodexAdapter);
    this.register('opencode', OpenCodeAdapter);
    this.register('codebuddy', CodeBuddyAdapter);
  }

  /** 注册新的适配器类型 */
  register(type: string, adapterClass: new () => BaseAgentAdapter): void {
    this.adapters.set(type, adapterClass);
  }

  /** 创建 Adapter 实例 */
  create(type: string): BaseAgentAdapter {
    const AdapterClass = this.adapters.get(type);
    if (!AdapterClass) {
      throw new Error(
        `Unknown adapter type: "${type}". ` +
        `Available: ${Array.from(this.adapters.keys()).join(', ')}`
      );
    }
    return new AdapterClass();
  }

  /** 列出所有已注册的适配器类型 */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** 获取适配器信息 */
  getInfo(type: string): { name: string; type: string; cliCommand: string } | null {
    try {
      const adapter = this.create(type);
      return {
        name: adapter.name,
        type: adapter.type,
        cliCommand: adapter.cliCommand,
      };
    } catch {
      return null;
    }
  }

  /** 检测系统中已安装的 CLI 工具 */
  static async detectInstalled(): Promise<string[]> {
    const checks = [
      { type: 'claude-code', cmd: 'claude', arg: '--version' },
      { type: 'kimi-code', cmd: 'kimi', arg: '--version' },
      { type: 'codex', cmd: 'codex', arg: '--version' },
      { type: 'opencode', cmd: 'opencode', arg: '--version' },
      { type: 'codebuddy', cmd: 'codebuddy', arg: '--version' },
    ];

    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          await execa(check.cmd, [check.arg], { timeout: 5000, reject: false });
          return check.type;
        } catch {
          return null;
        }
      })
    );

    return results.filter((r): r is string => r !== null);
  }
}
```

**使用示例**：

```typescript
// Extension 激活时
const registry = new AdapterRegistry();
const installed = await AdapterRegistry.detectInstalled();
console.log('Detected agents:', installed);  // ["claude-code", "codex"]

// 启动 Agent
const adapter = registry.create('claude-code');
const parser = adapter.getParser();
// spawn(adapter.cliCommand, adapter.buildArgs(config), adapter.getSpawnOptions(config))
```

---

### 5.7 添加新 Agent CLI 的指南

当需要支持新的 Agent CLI 时，开发者需要完成以下 5 个步骤：

#### 步骤 1：创建 Adapter 类

```typescript
// server/adapters/{name}.adapter.ts
import { BaseAgentAdapter } from './base.adapter';
import { MyNewParser } from '../parsers/{name}.parser';

export class MyNewAdapter extends BaseAgentAdapter {
  readonly name = 'My New Agent';       // 显示名称
  readonly type = 'my-new-agent';       // 类型标识
  readonly cliCommand = 'my-agent';     // CLI 命令
  readonly cliArgs = ['--interactive']; // 默认参数
  readonly defaultShell = 'bash';

  getParser(): BaseStatusParser {
    return new MyNewParser();
  }
}
```

#### 步骤 2：创建 Parser 类

```typescript
// server/parsers/{name}.parser.ts
import { BaseStatusParser } from './base.parser';

export class MyNewParser extends BaseStatusParser {
  readonly adapterType = 'my-new-agent';

  parseLine(line: string): IStatusEvent | null {
    const clean = stripAnsi(line).trim();
    if (!clean) return null;

    // 核心：编写匹配规则将 CLI 输出映射到 AgentExecutionState
    // 建议先收集 20+ 条该 CLI 的真实输出样本，分析其输出模式

    // 示例模式（根据实际 CLI 输出调整）：
    if (/^(Thinking|Analyzing)/i.test(clean)) {
      return { state: 'thinking', metadata: { hint: clean } };
    }
    if (/^(Editing|Creating)/i.test(clean)) {
      return { state: 'executing', metadata: { currentFile: extractFile(clean) } };
    }
    if (/^(Done|Complete)/i.test(clean)) {
      return { state: 'success' };
    }
    if (/^(Error|Failed)/i.test(clean)) {
      return { state: 'error', metadata: { errorMessage: clean } };
    }

    return null;
  }

  reset(): void {
    // 清除解析器内部状态
  }
}
```

#### 步骤 3：注册到 AdapterRegistry

```typescript
// server/core/adapter-registry.ts
import { MyNewAdapter } from '../adapters/{name}.adapter';

constructor() {
  this.register('my-new-agent', MyNewAdapter);
  // ...
}
```

#### 步骤 4：编写测试

```typescript
// server/parsers/__tests__/{name}.parser.test.ts
import { MyNewParser } from '../{name}.parser';

describe('MyNewParser', () => {
  const parser = new MyNewParser();

  beforeEach(() => parser.reset());

  it('parses thinking state', () => {
    const event = parser.parseLine('Analyzing project structure...');
    expect(event?.state).toBe('thinking');
  });

  it('parses file edit', () => {
    const event = parser.parseLine('Editing src/app.ts');
    expect(event?.state).toBe('executing');
    expect(event?.metadata.currentFile).toBe('src/app.ts');
  });

  // 至少 10 条真实输出用例
});
```

#### 步骤 5：更新文档

- README.md 支持的 Agent 列表
- 添加该 Agent 的特殊配置说明（环境变量、参数等）

---

### 5.8 各 Agent CLI 输出特征对比

| 特性维度 | Claude Code | Kimi Code | Codex CLI | OpenCode | CodeBuddy |
|---------|-------------|-----------|-----------|----------|-----------|
| **输出格式** | 自然语言 + ANSI 颜色 + 树形 `\u251c` 结构 | JSON 事件流 + 中文文本 | Unicode 进度条 + 英文关键词 | 自然语言 + TUI 界面 | 自然语言 + 简单标记 |
| **状态指示** | 文本描述（"I'll analyze..."） | `type` 字段（JSON） | `█` 进度条百分比 | 文本描述 | 文本描述 |
| **文件操作标识** | "Editing src/..." | `tool_call` 事件 | 文件名嵌入描述 | 类似 Claude | 类似 Claude |
| **Plan Mode** | 数字列表选项 + 确认提问 | `plan` 类型 JSON | 自动执行（需确认时提示） | 确认对话框 | 较少使用 |
| **错误格式** | `Error: ...` / `✗ ...` | `type: "error"` JSON | `Failed: ...` | 红色 ANSI 文本 | 简单错误提示 |
| **语言** | 英文为主 | 中文 + 英文 | 英文 | 英文 | 英文 |
| **特殊依赖** | `strip-ansi` 强依赖 | JSON 解析器优先 | 进度条正则 | TUI 转义序列处理 | 简单文本处理 |
| **调试标志** | `--verbose` | `--stream` | `--full-auto` | `--debug` | `--verbose` |

---

### 5.9 关键依赖清单

| 包名 | 版本 | 用途 |
|------|------|------|
| `ws` | `^8.18.0` | WebSocket 服务端（Extension 侧） |
| `@msgpack/msgpack` | `^3.0.0-beta2` | 大消息二进制压缩（可选） |
| `strip-ansi` | `^7.1.0` | ANSI 转义序列清除（Parser 核心依赖） |
| `execa` | `^9.5.0` | 子进程管理（Agent spawn） |
| `uuid` | `^11.0.0` | 消息唯一 ID 生成 |