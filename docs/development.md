# Dionysus v3 开发文档

> 面向接手开发的工程师。本文描述的是**已实现并验证过的现状（as-built）**，所有命令、路径、接口名均与代码一一对应；目标架构与设计取舍见 `docs/v3/architecture.md`，演进过程见 `docs/v3/roadmap.md`（两者是规划文档，落地细节以本文与代码为准）。

## 1. 项目总览

**一句话**：Dionysus 是一个 VS Code 插件形态的 Coding Agent 统一客户端——在 VS Code 内并行管理多个 AI 助手 CLI 的会话，配 Live2D 角色陪伴与进度汇报，并可通过局域网让手机浏览器随时接入。

五条核心功能（验收基准，`docs/v3/architecture.md` §1）：

1. **仿 QQ 的 agent 对话与管理**：多会话并行，sidebar 会话列表一眼看出每个 agent 的状态（运行中/待决策/完成/出错/未读）；
2. **Live2D 陪伴与角色语气**：出厂角色凯尔希（kal'tsit）在场，角色通道文本经 rewriter 输出后处理携带 persona 语气（不改写 agent 输入与实质回复）；
3. **角色单向的多 agent 进度/调度汇报**：CompanionScheduler/Supervisor 以台词形式汇报 fleet 进展，单向输出、不进会话消息流；
4. **明显的 agent 操作显示**：读文件/改代码/跑命令以结构化 `tool_call`/`tool_result` 卡片呈现；
5. **移动端离席场景**：手机扫码配对后在浏览器收汇报、发短指令，断连重连后经 `sync_request` 补拉 + 归来摘要完整追赶。

当前版本状态（2026-07，v0.1.0）：

- **658 个单测全绿**（78 个测试文件，六个包）：protocol 63 / core 246 / client-core 65 / extension 99 / webview 122 / mobile 63；
- **e2e 宿主集成测试 5/5**（`@vscode/test-electron`，真实 VS Code 扩展宿主内跑）；
- vsix 已产出：`release/dionysus-vscode-0.1.0.vsix`（`vsce package` 经 CI 冒烟）；
- Phase 4 真机验证：kimi / claude / opencode CLI 各完成一轮真实对话（codex 因自身后端环境问题失败、codebuddy 本机未安装跳过，详见 `scripts/qa-phase4/REPORT.md`）。

## 2. 仓库结构

npm workspaces monorepo（根 `package.json` 的 `workspaces: ["packages/*"]`；Node ≥ 18.18、npm ≥ 10）：

```
ACP_AGENT2/
├── packages/
│   ├── protocol/      # @dionysus/protocol — 消息类型 + zod schema（零依赖方，只依赖 zod）
│   ├── core/          # @dionysus/core — 适配器/会话/persona（零 vscode、零 HTTP/WS 依赖）
│   ├── client-core/   # @dionysus/client-core — ClientTransport / messageRouter / dispatch / 按域 stores
│   ├── extension/     # dionysus-vscode — VS Code 插件宿主（esbuild 打单文件 dist/extension.js）
│   ├── webview/       # @dionysus/webview — 插件内 React 应用（Vite 单 bundle）
│   └── mobile/        # @dionysus/mobile — 手机端 web 应用（React + Vite）
├── assets/
│   ├── live2d/        # 出厂 Live2D 模型：kal'tsit（默认）、exusiai
│   └── personas/      # 出厂 persona YAML（kal'tsit.yaml / exusiai.yaml 等）+ 头像 + 立绘素材
├── legacy/            # v2 旧代码（backend/ frontend/ electron/ docs/ 等，只读参考）
├── scripts/           # QA 脚本（qa-phase3/4/5、qa-mobile-visual、qa-release，见 §5.3）
├── docs/              # 本文档与 docs/v3/（架构、roadmap、extract 提取文档、ux 规格）
├── release/           # vsix 产物输出目录
└── .github/workflows/ci.yml
```

依赖方向（单向，禁止反向）：

```
webview ──┐
          ├──► client-core ──► protocol ◄── core ◄── extension
mobile ───┘                    ▲                    （extension 运行时另加载 assets/）
                               └────────────────────┘
```

- `protocol` 不依赖任何内部包；`core`、`client-core` 只依赖 `protocol`；`webview`/`mobile` 依赖 `client-core` + `protocol`；`extension` 依赖 `core` + `client-core` + `protocol`。
- `client-core` 存在的理由（ADR-18）：决定两端行为一致性的 messageRouter/dispatch/stores 只允许一份实现；**禁止 mobile 以源码相对路径引用 webview 包内部目录**。
- `assets/`：出厂素材，vsix 打包时由 prepackage 脚本内嵌进扩展包（见 §6）；用户自建素材放插件 `globalStorageUri/character-library/`，同名覆盖出厂。
- `legacy/`：v2 提取行为规格的参考来源，v3 稳定两个迭代后可删除（git 历史仍在）。

## 3. 开发环境搭建

要求：Node 18（`engines: >=18.18.0`）、npm ≥ 10。注意仓库用的是 **npm workspaces**（`package-lock.json` 为锁文件），不要用 pnpm/yarn 安装。

```bash
npm install        # 仓库根，一次装齐全部 workspace 依赖
```

常用命令（均在仓库根执行）：

| 命令 | 作用 |
|---|---|
| `npm run build` | 构建全部六个包（protocol/core/client-core 用 tsc 产 ESM+d.ts，extension 用 esbuild，webview/mobile 用 Vite） |
| `npm test` | 跑全部包的 vitest 单测（658 个） |
| `npm run lint` | 全部包 eslint |
| `npm run typecheck` | 全部包 `tsc --noEmit` |
| `npm run demo:kimi -w @dionysus/core` | 对真实 kimi CLI 跑一轮最小对话并打印事件序列（需先 build，脚本 import `../dist/...`；会真实调用一次本机 kimi） |
| `npm run test:e2e --workspace=dionysus-vscode` | 扩展宿主集成测试（先 build + build:e2e，再经 `@vscode/test-electron` 下载 VS Code 跑 dist-e2e runner） |
| `npm run package:vsix --workspace=dionysus-vscode` | 打 vsix 到 `release/`（自动先跑 `vscode:prepublish`：esbuild bundle + prepackage 拷贝产物） |

单包操作：`npm run build -w @dionysus/core`、`npm test -w @dionysus/webview` 等（`-w` 后跟包名）。

F5 调试：直接用 VS Code 的「Run Extension」即可，extensionDevelopmentPath 指向 `packages/extension`；webview/mobile 需先 `npm run build -w @dionysus/webview -w @dionysus/mobile` 产出 `dist/`。

## 4. 架构即实现（as-built）

### 4.1 `@dionysus/protocol`（packages/protocol）

单真源定义客户端与服务端之间的全部消息，传输无关，webview / mobile / core 三方共享。

- **消息信封** `Envelope<T, P>`（`src/messages.ts`）：`v: 1`（协议版本，冻结）、`type`（全词命名）、`traceId?`（请求-响应关联）、`sessionId?`（会话归属；全局消息省略并以 `payload.scope: "global"` 表达）、`seq?`（per-session 单调递增，BroadcastHub 扇出前赋值，断连补拉游标）、`turnId?`（回合内全部下游消息共享，打断去重/幂等）、`ts`（Unix 毫秒整数）、`payload`。
- **消息规模**：C→S 18 种、S→C 26 种（`clientMessageSchema` / `serverMessageSchema` 两个 `z.discriminatedUnion('type', …)`）。相对 `architecture.md` §4.1 基线（约 28 种），实现期**只追加不修改**地扩展出了 `focus_session` / `session_switched`、`cli_session_list_request/response`、`working_dir_pick_request/response`、`persona_list_request/response`、`persona_update_request/response`、`voice_preview_request/response`、`character_list_request/response`、`settings_update_request/response` 等；追加的 payload 字段一律 optional 并在注释标注 additive（如 `session_digest_update.adapterId`、`SessionMeta.workingDir`）。
- **解析入口**（`src/index.ts`）：`parseClientMessage` / `parseServerMessage`，zod 校验失败抛 `ProtocolError`（携带 path 级 issues）；`PROTOCOL_VERSION = 1`。
- 关键消息：`hello`/`handshake`（握手携带全量会话 digest 快照 + 各会话 latestSeq）、`sync_request`/`sync_response`（`truncated=true` 表示缓冲溢出，events 以快照开头续播）、`session_digest_update`（QQ 式列表的唯一数据源，payload 自带 seq 自包含）、`tool_call`/`tool_result`（结构化工具调用，`kind: read|edit|bash|search|other`，`displayTarget` core 侧截断 120 字符，`summary` 截断 2000）、`companion_message`（`scope: session|global`，全部单向）、`user_message_echo` / `option_resolved`（多端一致性）。

### 4.2 `@dionysus/core`（packages/core）

宿主无关业务核心，纯 node 可测。模块与源码一一对应：

**adapters（`src/adapters/`）——五策略 + 一个通用进程适配器**

- `types.ts`：`IAgentAdapter`（`start/send/interrupt/shutdown` + 可选 `injectSystemPrompt`/`switchSession`）与 `AgentEvent` 判别联合（`stream/thinking/status/tool_call/tool_result/option_request/complete/session_id`，一轮 send 必然恰好产出一条 `complete`）。
- `generic-cli.ts` `GenericCliAdapter`：**每次 `send()` spawn 一个新子进程**（无常驻进程），stdout 经 readline 逐行交策略 `parseLine`，单行读取超时默认 120s（`requestTimeoutSeconds` 可配）；会话连续性靠记住 `cliSessionId` 下轮经 `buildArgs` resume。实例级单回合互斥：send 进行中再次调用立即产出 `complete{status:'error', errorMessage:'adapter busy'}`。`interrupt()` 先置标志再杀进程，收尾产出 `complete{status:'interrupted'}` 而非 v2 的伪错误。
- `strategy.ts`：`CliAdapterStrategy` 接口（`adapterId`、`supportsModel`、`supportsSystemPrompt: 'native'|'prompt-prefix'|'none'`、`supportedModes`、`buildArgs`、`parseLine`、可选 `wrapFirstTurnInput`/`beginTurn`/`listSessionIndex`）+ `JsonStreamStrategy` 基类。基类解析器本质就是 kimi 方言解析器（role=assistant/tool/meta 三分支 + 协议事件透传 + 未知形状原文流兜底），其余 4 个策略先匹配自己的形状、不匹配再 `super` 落回基类；工具配对用 FIFO（`beginTurn` 重置）。
- `strategies/`：`kimi.ts`、`claude.ts`、`codex.ts`、`opencode.ts`、`codebuddy.ts`。
- `registry.ts`：配置驱动注册表，**只暴露 `createAdapter(adapterId, config)` 工厂**（`structuredClone` 深拷贝配置新建独占实例，不暴露共享实例）；另有 `resolveStrategy`（只实例化策略取只读能力）、`registerStrategy` / `registerTypeAlias`（扩展点，见 §7.1）。type 别名映射：`kimi_code_cli→kimi` 等五组。
- `cli-session-index.ts`：kimi `~/.kimi-code/session_index.jsonl` 读取（`/sessions` 与「恢复历史会话」数据源）。

**session（`src/session/`）——并发模型与 JSONL 存储**

- `manager.ts` `SessionManager`：会话 CRUD + 适配器生命周期 + 单一回合管线 `runAgentTurn`（v2 双管线已合并，option_selected 只负责把选项转成 input）。并发模型：会话 ↔ 适配器一对一（懒创建于首个回合，测试可经 `deps.adapterFactory` 注入 FakeAdapter）；单会话 send 串行（回合中新输入排队 + system_notice 提示）；任意数量会话并行 `runAgentTurn`，事件按 sessionId 归属；`maxConcurrentAgents` 默认 3，超限回 system_notice。`turnId` 入口生成，已终态 turnId 的迟到 complete 幂等忽略。会话状态机 `idle|running|waiting_option|done|error`，每次跃迁发 `session_digest_update`；option 超时按 `optionTimeoutAction`（`deny|default|keep`，默认 keep）。陪伴层经 `deps.companion: CompanionHooks` 挂载（manager 不感知 persona 实现，唯一实现方是 `persona/companion.ts`）。首回合成功后以首条用户消息截断 20 字符自动命名，手动重命名（titleLocked）后不覆盖。可选注入增强 `injectIntoAgent`（默认关）：首轮按 `supportsSystemPrompt` 分流注入 persona system_prompt，成功置 `systemPromptInjected=true` 并持久化，失败按原始输入重发 + warning。
- `store.ts` `JsonlSessionStore`：每会话一个 `<storageDir>/sessions/<id>.jsonl`（首行 `{type:'meta'}`，其后 message 行或 event 行）。**无 index.json**——`list()` 扫目录读各文件首行 meta + mtime 排序；meta 变更以临时文件 + rename 原子重写；坏行容忍（跳过 + warning）；首行 meta 损坏的会话在 list 中标注 `corrupt`。写者不变量：同一 sessionId 的 appendMessage 只有该会话串行的 runAgentTurn 一个写者。
- `commands.ts`：斜杠命令分发表（`/new`、`/sessions`、`/resume` 等），独立于 manager。

**broadcast.ts `BroadcastHub`**：多客户端注册/注销 + 全局扇出（客户端按 `envelope.sessionId` 自行过滤）；扇出前赋 per-session `seq`；每会话内存环形事件缓冲（默认 500 条）支撑 `sync_request` 回放，溢出时先发 digest 快照再续播；断连超阈值（落后 >50 条或断连 >60s）向该客户端**单播**内置模板归来摘要（零 LLM 依赖，可经 `returnSummaryRewriter` 挂钩过 persona 口吻）。客户端断开只注销自己，绝不触碰适配器进程。

**persona（`src/persona/`）——loader / engine / scheduler / supervisor 四件套 + rewriter**

- `loader.ts` `PersonaLoader`：builtin 目录 + 可选 runtime 目录显式注入；`yaml` 库解析 + zod 校验，缺键逐键回退内置中立 default persona（核心代码零角色硬编码）；runtime 对 builtin 同名 persona **逐键深合并**（不整文件屏蔽）。
- `engine.ts` `CompanionEngine`（每会话一个：status→emotion、台词）；`scheduler.ts` `CompanionScheduler`（跨会话聚合 + 三声源统一出队口仲裁：最小间隔 3s、error 优先、同 tick 合并聚合句）；`supervisor.ts` `CompanionSupervisor`（周期轮询全 fleet，默认 15s 下限 5s，变动检测 + 安静期跳过，LLM/CLI 模式仅在至少一个客户端连接时运行）；`todo-tracker.ts`（从结构化 `tool_call`/`tool_result` 事件提取 todo，供给 digest.todoProgress）。
- `rewriter.ts`：**角色语气的默认通道（ADR-12）**。只改写角色通道文本（聚合句/播报/归来摘要/digest 摘要/触摸台词），不改写 agent 会话正文。`TemplateRewriter`（默认，零 LLM 依赖）：`tone_rules` 前后缀 + `keyword_replacements` + `random_insertions` + `voice.catchphrases` 句式拼装 + `voice.taboos` 输出校验；随机性经 `opts.random` 注入（快照测试确定性前提）；输出与输入完全相同时记 debug 日志防静默失效。LLM 模式经 `LlmRewriter`。

### 4.3 `@dionysus/client-core`（packages/client-core）

webview 与 mobile 共用的一份实现：

- `transport.ts` `ClientTransport`：`send(msg)` / `onMessage(cb)` / 可选 `onConnectionChange(cb)`。webview 内由 `vscodeApi.postMessage` 实现，mobile 由 WebSocket 实现。
- `messageRouter.ts` `routeServerMessage`：**纯函数**，输入一条 ServerMessage，输出 RouteAction 判别联合，不触碰任何 store；每种 S→C 消息有显式分支或带注释的显式 ignore，未识别类型容错为 ignore 不抛异常。
- `dispatch.ts` `dispatchRouteAction(s)`：唯一副作用汇聚点，把路由动作应用到各 store。两端接线都是一行：`transport.onMessage(msg => dispatchRouteActions(routeServerMessage(msg)))`。
- `stores/`（zustand）：`sessionStore`（会话+消息；**单真源约束**：当前会话消息一律经 `selectCurrentMessages` selector 从 `sessions[currentSessionId]` 派生，不做镜像字段）、`streamStore`（流式状态/工具调用，`finalizeTurn` 按 turnId 幂等）、`digestStore`（session_digest_update 驱动的列表数据源）、`companionStore`（情绪/台词/todo）、`settingsStore`。
- `character.ts`：角色素材/展示模式共享逻辑（含 `DEFAULT_EMOTION`）。

### 4.4 `extension`（packages/extension，包名 dionysus-vscode）

只做胶水：webview 容器、传输层、配对、配置、spawn 的实际执行。装配关系（`src/extension.ts` `activate`）：

```
activate
  └─ createCoreHost({ storageDir: globalStorageUri, assetsDir, … })   # core-host.ts
       ├─ JsonlSessionStore（会话落 <globalStorage>/sessions/*.jsonl）
       ├─ SessionManager（adapters = settings 的 dionysus.adapters ∪ CLI 探测合成条目）
       ├─ BroadcastHub（manager.onMessage → hub.broadcast；seq/缓冲/归来摘要在 hub 内）
       ├─ createCompanion（supervisor.mode !== 'disabled' 时；hooks 挂进 manager，
       │    audienceCount 取 hub.clientCount，归来摘要接 returnSummaryRewriter）
       ├─ PairingManager + WsTransport + lan-server（Phase 5 移动端链路；
       │    lan.enabled=false 时 lan-server 不启动）
       └─ handleClientMessage（协议消息 → core 调用的唯一分发口）
  ├─ WebviewProvider（webview-provider.ts：editor panel 聊天 + sidebar 会话列表 + 设置页，
  │    每个 webview 创建即 host.attachWebview 接入 BroadcastHub）
  ├─ StatusBarItem（status-bar.ts：聚合「⏳N 运行中 ❗M 待决策」）
  └─ registerCommands（commands.ts：openChat/newSession/interrupt/selectAdapter/
       selectPersona/showPairingQr/redetectAgents/openSettings）
```

关键实现点：

- **配置单引用**（ADR-6）：`config.ts` `createConfigService` 产出的配置对象 identity 稳定，变更时原地深替换内容，core 各消费方拿到的始终是同一引用——热更新天然生效。
- **零 vscode 依赖分层**：core-host / lan-server / pairing 均不 import vscode（宿主值以参数注入，webview 以结构类型接入），所以它们能在 vitest 纯 node 下测；`src/__mocks__/vscode.ts` 供单测 mock 宿主 API。
- **lan-server.ts**：Node 内置 `http` + `ws`。HTTP：`GET /` 托管 mobile 静态应用、`POST /api/pair`、`GET /api/health`（仅 `{"ok":true}`，兼作多窗口占用探测）、`GET /assets/*`（`?token=` 鉴权，`builtin/`→内嵌 assets、`user/`→character-library，path.normalize + 前缀校验防穿越，`Cache-Control: private, max-age=300`）。绑定 `0.0.0.0`；`EADDRINUSE` 自动递增端口重试（8765→8775，共 11 次）；多窗口先到先得（对端 `/api/health` 应答则进 disabled 态不抢占）。WS upgrade 不在此校验 token，转交 `onUpgrade` 钩子。
- **ws-transport.ts**：token 在 `handleUpgrade` **之前**校验，失败直接 401 + socket.destroy；客户端 30s ping，服务端 75s 无帧断开注销（`WS_FRAME_TIMEOUT_MS`）。
- **pairing.ts**：pair token 128-bit、TTL 300s、一次性、只存内存；device token 256-bit、长期有效、持久化 `<globalStorage>/paired-devices.json`（原子写），均 constant-time 比较；验票成功刷新 last_seen（写盘节流每分钟一次）；设备可撤销。
- **cli-detect.ts**：激活时对五个 CLI（kimi/claude/opencode/codex/codebuddy）`which`/`where` 探测 + `<cmd> --version`，一个都没找到时置 `needCliGuide=true`（webview 显示引导页）。
- **webview-provider.ts**：`resolveWebviewDist` / `resolveMobileDist` / `resolveAssetsRoot` 三个函数实现「打包态优先扩展内目录、回退 monorepo 兄弟包」的双态解析；`localResourceRoots = [webviewDist, assetsRoot, characterLibrary]`；两个视图共用同一份 webview 产物，角色经内联 init 脚本 `window.__DIONYSUS_INIT__` 下发；`findBundleAssets` 只认单入口 JS（见 §7.4 常见坑）。

### 4.5 `webview` 与 `mobile`

- **webview**（React 18 + Vite + Tailwind + pixi-live2d-display，pixi v7 锁定）：editor panel 聊天流（`components/chat/`：MessageList/StreamingView/ToolCallList/OptionGroup/ChatInput…）+ Live2D 陪伴区（`components/companion/`：Live2DViewer/CompanionBubbles/touch 纯前端触摸）+ sidebar 会话列表（`components/sidebar/SidebarApp`）+ 设置页/素材库/voice 试听表单（`components/settings/`）+ CLI 引导页（`components/guide/`）。`live2d-viewer.ts` 是 pixi 加载器（三个踩坑解法见 §7.4）；加载失败统一降级 `StaticPortrait` 静态立绘。
- **mobile**（React 18 + Vite + Tailwind + zustand，从零构建、仿手机 QQ）：首屏会话状态列表（SessionListScreen）↔ 聊天（ChatScreen）+ 角色唤起抽屉（CharacterDrawer，静态立绘形态）+ 工作状态全屏页（StatusScreen，左滑/右滑手势 `gestures.ts`）+ 配对页（PairScreen/`pairing.ts`）。`transport/wsTransport.ts`：30s ping、指数退避 1s→30s 上限 10 次、主动断开不重连、`visibilitychange` 回前台立即重连；`sync.ts` 重连后按本地已见 seq 发 `sync_request` 补拉；401 → 清本地 token 跳配对页。
- 两端地位平等：同一份 protocol 消息、同一份 client-core 路由与 stores，只是 transport 实现不同（postMessage vs WS）。

## 5. 测试体系

### 5.1 vitest 分层（658 用例，78 文件）

| 包 | 用例数 | 重点 |
|---|---|---|
| protocol（63） | `src/index.test.ts` | schema 往返（合法/非法消息）、信封字段、additive 追加字段兼容 |
| core（246） | `src/__tests__/`、`adapters/__tests__/`、`persona/__tests__/`、`session/__tests__/` | 五策略用录制 fixture 的行解析（`adapters/__tests__/strategies/*.test.ts`）；GenericCliAdapter 假 spawn（超时/interrupt/非零退出）；具名回归：`session/__tests__/parallel-sessions.test.ts`（两会话并行互不污染）、`session/__tests__/interrupt-semantics.test.ts`（打断后恰好一条 interrupted complete）、`session/__tests__/jsonl-store.test.ts`（坏行容忍/meta 原子重写/corrupt 标注）；rewriter 快照防线（`persona/__tests__/rewriter.test.ts`，固定 random 注入，输出含 voice 特征、不含 taboos、与输入不同） |
| client-core（65） | `src/*.test.ts`、`stores/*.test.ts` | messageRouter 全分支（含 `scope:"global"` 路由与未知类型容错）、dispatch、store 行为 |
| extension（99） | `src/*.test.ts` | 纯 node 可测的全部模块：core-host 装配、lan-server（含 `/assets/*` 路径穿越）、pairing（含过期 token 被拒）、ws-transport、cli-detect、config、status-bar；vscode API 经 `src/__mocks__/vscode.ts` mock |
| webview（122） | `src/**/*.test.ts(x)` | jsdom：store 接线、组件渲染（聊天流/工具卡片/选项组/陪伴区/sidebar 列表/设置页）、personaSync、touch |
| mobile（63） | `src/**/*.test.ts(x)` | jsdom：wsTransport 重连策略、sync 补拉、pairing、手势、主题、组件（会话列表/选项确认条/工作状态页） |

### 5.2 e2e（@vscode/test-electron，5/5）

- 入口：`npm run test:e2e --workspace=dionysus-vscode` = build + build:e2e（esbuild 打 `src/__tests__/e2e/runner.e2e.ts` → `dist-e2e/index.js`）+ `node .vscode-test.mjs`。
- 套件 `src/__tests__/e2e/suite.e2e.ts` 在**真实 VS Code 扩展宿主**内跑：a) 插件激活 + 七个命令注册；b) openChat 创建聊天 webview；c) sidebar 视图 `dionysus.sessionList` 已注册；d) redetectAgents 可执行；e) 经 core-host 注入 FakeAdapter 跑一轮 user_input→agent_complete 通路。
- 注意：`*.e2e.ts` 命名不匹配 `*.test.ts`，不进 vitest；VS Code 下载缓存在 `packages/extension/.vscode-test/`；CI 里用 `xvfb-run -a` 且 `continue-on-error: true`（GUI 受限不阻塞合入）；本地首次跑要下载 VS Code（几百 MB），缓存损坏删 `.vscode-test/` 重跑。

### 5.3 QA 脚本目录指南（scripts/，人工/真机验收，不进 CI）

| 目录 | 用途 | 复跑方法 |
|---|---|---|
| `qa-phase3/` | Phase 3 真机门禁：干净环境真实 VS Code 宿主 GUI 自动化（macOS screencapture + 自研 qaclick 点击工具 + driver 扩展信号文件驱动） | 机器解锁后按序 `scripts/qa-phase3/01-launch.sh` → `02-session-a.sh` → `03-session-b.sh` → `04-monitor.sh`；产物在 `out/`、`signals/` |
| `qa-phase4/` | Phase 4 门禁：5 个 CLI 各跑一轮真实对话（core 层，不依赖 VS Code），事件序列过 protocol schema 校验 | `node_modules/.bin/tsx scripts/qa-phase4/demo-cli.ts --adapter <id>`（如 `kimi_cli`/`claude_cli`；判定口径与结果见该目录 `REPORT.md`） |
| `qa-phase5/` | Phase 5 集成 E2E：真 extension host + Playwright 移动客户端，含锁屏模拟（routeWebSocket 掐断）、sync 补拉、归来摘要 | `node scripts/qa-phase5/run-e2e.mjs`（需 `code` CLI 与本机 kimi；装置说明见 `REPORT.md`）；`ws-offline-test.mjs` 为前置实验脚本 |
| `qa-mobile-visual/` | 移动端视觉验收（A-2 流程）：mock server + Playwright 按 iPhone 13 尺寸截图 | `node scripts/qa-mobile-visual/mock-server.mjs`（后台）+ `node scripts/qa-mobile-visual/shoot.mjs`，截图在 `out/` |
| `qa-release/` | Phase 6 发布前自测：全量重建 + vsix + 真实安装 + dev host 四景视觉抽查 | `scripts/qa-release/run-visual.sh`（macOS GUI；结论见 `REPORT.md`） |

这些目录自带 `REPORT.md` 记录当次结论与装置细节，复跑前先读对应 REPORT。

## 6. 打包与发布

**vsix 打包链**（`packages/extension/package.json`）：

1. `npm run package:vsix --workspace=dionysus-vscode` 触发 `vscode:prepublish`（`npm run build && node scripts/prepackage.mjs`）；
2. `scripts/prepackage.mjs` 把三份运行时资产拷进扩展目录，使 vsix 自包含（产物目录已入 `.gitignore`，每次全量重建）：
   - `packages/webview/dist` → `packages/extension/webview-dist/`
   - `packages/mobile/dist` → `packages/extension/mobile-dist/`
   - 仓库根 `assets/{live2d,personas}` → `packages/extension/assets/`
3. `vsce package --no-dependencies --out ../../release/`。注意命令里带 `NODE_OPTIONS="--require ./scripts/polyfill-file.cjs"`——`@vscode/vsce` 依赖链（cheerio→undici）在 Node 18 下引用全局 `File` 会 ReferenceError，该 cjs 桩注入空类兜底（Node 20+ 不需要）。

**CI**（`.github/workflows/ci.yml`，push/PR 到 main）：

- `typescript` job：`npm ci` → typecheck → lint → test → build（Node 18）；
- `vsix` job（needs typescript）：build + `package:vsix` + 上传 `release/*.vsix` artifact（`if-no-files-found: error`）；
- `e2e` job（needs typescript，`continue-on-error: true`）：`xvfb-run -a npm run test:e2e --workspace=dionysus-vscode`。

**版本与发布待办**：

- 版本号三处同步：根 `package.json`（0.1.0）、`packages/extension/package.json`（0.1.0，marketplace 以此为准）、各包 `version` 字段；发版时一并更新 `CHANGELOG.md`。
- **LICENSE 待办**：仓库尚无 LICENSE 文件，`packages/extension/package.json` 标 `"license": "UNLICENSED"`；出厂 kal'tsit 素材随包分发已经项目所有者确认，LICENSE 文本需在公开发布前补备（roadmap Phase 6 登记项）。
- marketplace 元数据（icon、categories、`engines.vscode: ^1.85.0`）已在 extension package.json 就位；publisher 当前为占位 `dionysus`。

## 7. 开发者指南

### 7.1 如何新增一个 CLI 适配器

以新增 `mycli` 为例：

1. **写策略**：新建 `packages/core/src/adapters/strategies/mycli.ts`，实现 `CliAdapterStrategy`——通常继承 `JsonStreamStrategy` 基类（stdout 为 NDJSON 时），覆写 `adapterId`（如 `'mycli'`）、`buildArgs`，必要时覆写 `normalizeObject`/`extractSessionId`；结论性赋值 `supportsModel` 与 `supportsSystemPrompt`（无法核实的保守标 `'prompt-prefix'`）、`supportedModes`。
2. **注册**：`packages/core/src/adapters/registry.ts` 的 `STRATEGIES` 加 `mycli: MycliStrategy`，`TYPE_TO_STRATEGY` 加 `mycli_cli: 'mycli'`（type 别名供 settings 的 `dionysus.adapters` 使用）。也可用公开扩展点 `registerStrategy` / `registerTypeAlias`。
3. **测试（硬性要求）**：用真实 CLI 录制 stream-json 输出为 fixture，新建 `packages/core/src/adapters/__tests__/strategies/mycli.test.ts`，断言 `buildArgs` 参数与行→事件映射（**必须含 tool_call/tool_result 结构化事件用例**——若该 CLI 没有工具结果行，UI 降级为只显示调用并在测试/文档中明示）。
4. **宿主探测**：`packages/extension/src/cli-detect.ts` 的探测表加 `{ id: 'mycli_cli', command: 'mycli' }`；`packages/extension/package.json` 的 `dionysus.adapters` description 枚举说明同步补一句。
5. 用户侧配置（settings.json）：`"dionysus.adapters": { "mycli_cli": { "type": "mycli_cli", "command": "mycli", "model": null } }`。
6. 验证：`npm test -w @dionysus/core`，再用 `scripts/qa-phase4/demo-cli.ts --adapter mycli_cli` 对真实 CLI 跑一轮（参考 `qa-phase4/REPORT.md` 的判定口径）。

### 7.2 如何追加协议消息（additive 规则）

协议已冻结（`v: 1`），演进规则是**只追加、不修改、不删除**：

1. 在 `packages/protocol/src/messages.ts` 新增 payload schema + `messageSchema('new_type', payloadSchema)`，加入对应方向的 `clientMessageSchema` / `serverMessageSchema` discriminatedUnion，并导出类型。给既有消息加字段只能是 **optional** 并在注释标注 additive（参考 `sessionDigestUpdatePayloadSchema.adapterId` 的写法）。
2. 两端接线：S→C 消息在 `packages/client-core/src/messageRouter.ts` 加显式分支（未知类型虽容错为 ignore，但新消息必须显式路由），`dispatch.ts` 应用动作；C→S 消息在 extension `core-host.ts` 的 `handleClientMessage` 分发口加处理。
3. 测试：protocol 加 schema 往返用例；client-core 加路由用例；core/extension 加行为用例。
4. 禁止：改既有字段语义/类型、复用旧 type 名、升 `v`（升版本是显式决策，不在 additive 范畴）。

### 7.3 如何加一个 persona

在 `assets/personas/` 新建 `<id>.yaml`（蛇形键；loader zod 校验，缺键逐键回退中立默认，核心代码零角色硬编码）：

| 字段 | 说明 |
|---|---|
| `id` / `name` | 必填；`name_en` 可选 |
| `description` | 角色简介 |
| `system_prompt` | 支持 `{session_id}`/`{working_dir}` 占位符；仅在可选增强 `dionysus.persona.injectIntoAgent` 开启时使用 |
| `companion.status_to_emotion` | agent 状态 → 情绪名映射 |
| `companion.live2d` | 表情/动作映射（`expressions`/`motions`/`default_expression`/`scale`…），宽松透传给前端 |
| `companion.touch_zones` | 触摸区域 `{ expression?, lines[] }`（前端本地选句，不经 core） |
| `tone_rules` | `prefix_templates` / `suffix_templates` / `keyword_replacements` / `random_insertions`（rewriter template 引擎消费） |
| `voice` | **rewriter 客制化核心，自建角色主要填这里**（见下表） |
| `scheduler_templates` | 跨会话聚合文案 7 键：`no_session/any_working/all_success/all_error/partial_error_single/partial_error_multi/all_idle`（占位符 `{working}/{total}/{error}`） |
| `supervisor_templates` | 周期播报文案 4 键：`working/error/changed/idle` |
| `companion_templates` / `status_phrases` | CompanionEngine 台词模板与状态短语 |
| ~~`emotion_mapping` / `corpus_file` / `preferred_theme` / `theme_override`~~ | **v3 已删除**，写了会被 zod 剥离、不生效 |

`voice` 段五字段（逐键回退中立默认；协议侧 camelCase 为 `rewriterPrompt`）：

| 字段 | 说明 |
|---|---|
| `tone` | 语气自然语言描述，如「冷静克制、偶尔毒舌」 |
| `catchphrases` | 口头禅/句尾口癖 list（template 模式句式拼装） |
| `taboos` | 角色绝不会说的词句 list（rewriter 输出校验） |
| `examples` | 3-5 对 `{ plain, styled }` 改写样例（LLM few-shot / template 风格基准） |
| `rewriter_prompt` | LLM 模式指令模板，支持 `{tone}` `{examples}` 占位符 |

参考现成样例：`assets/personas/kal'tsit.yaml`、`assets/personas/exusiai.yaml`。配套素材：Live2D 模型放 `assets/live2d/<name>/`，头像/立绘放 `assets/personas/` 对应子目录；用户级素材放 `globalStorageUri/character-library/`（结构同出厂，同名逐键深合并覆盖）。设置页有 voice 表单 + 「试听」按钮（走 `voice_preview_request/response`）可实时验证口吻。验证：`npm test -w @dionysus/core`（loader/rewriter 用例）+ 设置页试听。

### 7.4 常见坑清单

**Live2D / pixi 三坑**（解法都在 `packages/webview/src/live2d-viewer.ts` 头注释，改 Live2D 代码前必读）：

1. `@pixi/unsafe-eval` 必须 side-effect import——webview CSP 禁 `unsafe-eval`，pixi v7 的 ShaderSystem 默认用 `new Function` 生成 uniform 同步代码，不打补丁直接抛错；
2. 必须自构造 `Cubism4ModelSettings` 并覆写 `resolveURL`——pixi-live2d-display 走 `@pixi/utils` 的 `url.resolve`，无法解析 VS Code webview 资源 URL（authority 带 `%2B` 被错误切成 `host=file`），解法是字符串目录拼接 + 分段 `encodeURIComponent`；
3. `live2dcubismcore.min.js` 由 extension webview-provider 以经典 script（带 nonce）先于 ESM bundle 注入 `window.Live2DCubismCore`，`pixi-live2d-display/cubism4` 在模块加载时就要求该全局存在，所以 cubism4 模块只能在确认 runtime 就绪后**动态 import**（`loadCubism4Module`）。

**动态 import 与单 bundle**：extension 的 `findBundleAssets` 只认单入口 JS，webview 的 Vite 配置 `inlineDynamicImports: true` 保证动态 import 不分包——**禁止对 live2d-viewer 等模块做会产生额外 chunk 的动态 import 拆分**。

**CJS/ESM 双形态**：protocol/core/client-core 是 ESM（`"type": "module"`，tsc NodeNext，源码内相对 import 必须带 `.js` 后缀）；extension 用 esbuild 打成 **CJS** 单文件（`--format=cjs --external:vscode`）；webview/mobile 是 Vite ESM。给库包写代码时相对导入漏 `.js` 后缀会在 NodeNext 下炸。

**bundler resolution / demo 脚本**：`packages/core/scripts/demo-kimi.ts` import 的是 `../dist/...`（构建产物），改了 core 源码要先 `npm run build -w @dionysus/core` 再跑 demo，否则跑的是旧产物。

**e2e 缓存**：`@vscode/test-electron` 把下载的 VS Code 缓存在 `packages/extension/.vscode-test/`，缓存损坏或版本错乱时整个删掉重跑；CI 必须 `xvfb-run -a`（无显示环境）。

**webview-dist 陈旧遮蔽**：`resolveWebviewDist`/`resolveMobileDist`/`resolveAssetsRoot` 都是「扩展内目录优先」——`packages/extension/` 下一旦存在 prepackage 拷出的 `webview-dist/`、`mobile-dist/`、`assets/`，开发态 F5 也会优先吃这些**打包态副本**，你在 `packages/webview/` 的改动会「不生效」。开发调试如遇此现象，删掉这三个目录（它们已入 `.gitignore`，重新打包时由 prepackage 全量重建）。
