# Dionysus v3 总体架构

> 版本：v3.0-draft · 状态：待审阅
> 本文档定义 Dionysus 从「Electron 独立应用 + Python FastAPI 后端」向「VS Code 插件 + 手机浏览器移动端」重写的目标架构。
> 前置阅读：`docs/v3/extract/` 下的八份提取文档（旧实现的行为规格）。历史参考：`dionysus_fullstack.agent.final.md`（v2.0 设计稿，已被本文档取代，仅概念继承）。

## 1. 背景与目标

Dionysus 是带 Live2D 角色陪伴的 Coding Agent 客户端，桥接 Kimi Code CLI / Claude Code CLI / OpenCode CLI / Codex CLI / CodeBuddy CLI。v2 形态为 Electron 桌面应用 + Python FastAPI 后端 + React 前端。v3 重写的动因：

- 独立前端交互界面（窗口、布局、会话管理 chrome）的构建与维护成本过高，而 VS Code 天然提供这些容器能力；
- Python + TypeScript 双栈维护成本高、类型系统割裂（v2 设计稿当初的结论，被 v2 实现推翻，v3 回归）；
- 用户主要工作场景本就在 VS Code 内。

**核心产品功能定义（验收基准）**——v3 的一切设计取舍以以下五条是否可用为最高优先级：

1. **仿 QQ 的 agent 对话与管理**：多会话并行，会话列表一眼看出每个 agent 的状态（运行中/待决策/完成/出错/未读），切换查看互不干扰；
2. **Live2D 陪伴与角色语气**：角色形象在场，角色通道文本（汇报、摘要、台词）携带 persona 语气——走 **rewriter 输出后处理路线**（不改写 agent 输入与实质回复；prompt-prefix 注入为可选增强，默认关闭）；
3. **角色单向的多 agent 进度/调度汇报**：角色以台词形式汇报各会话进展与 fleet 级调度情况；汇报是单向输出，不进入会话消息流、不需要用户通过角色输入；
4. **明显的 agent 操作显示**：读文件/改代码/跑命令以结构化、显著的 UI 呈现（非文本流淹没）；
5. **移动端离席场景**：用户离开电脑时能在手机上收汇报、发短指令、随时看清进展；断连重连后可完整追赶离开期间发生的一切。

v3 目标形态：

- **VS Code 插件**：editor panel 承载聊天 + Live2D 陪伴 UI，sidebar webview 会话列表 + 活动栏 badge + StatusBar 承载全局会话状态面；
- **手机浏览器移动端**：经二维码配对通过局域网连接（移动端前端 UI 从零构建）；
- **无独立后端进程**：核心逻辑为宿主无关的纯 TS 包 `@dionysus/core`，内嵌于插件进程；插件进程内同时运行一个 Node HTTP/WebSocket 服务，向移动端暴露同一个 core。

非目标（v3.0 范围外）：壁纸、TTS、Electron 打包、独立 Bridge CLI（后置候选，见 §10）、旧会话数据迁移、PWA / Web Push 通知（原因见 §8）。

## 2. 总体架构

```
┌──────────────────────────── VS Code 进程 ────────────────────────────┐
│                                                                      │
│  ┌─────────────┐   postMessage   ┌──────────────────────────────┐   │
│  │  webview     │ ◄────────────► │                              │   │
│  │  (React UI)  │                │      extension host          │   │
│  └─────────────┘                │  ┌────────────────────────┐  │   │
│                                 │  │ MessageBridge          │  │   │
│  ┌─────────────┐   WebSocket    │  │ (传输层抽象, 双实现)     │  │   │
│  │  mobile      │ ◄────────────► │  └──────────┬─────────────┘  │   │
│  │  (手机浏览器) │   + HTTP 静态   │             │                │   │
│  └─────────────┘   + /assets/*   │  ┌───────────▼─────────────┐  │   │
│        ▲                        │  │   @dionysus/core        │  │   │
│        │  二维码配对 + token      │  │  adapters / session /   │  │   │
│        │  (HTTP API)            │  │  persona                │  │   │
│  ┌─────┴───────────┐            │  └───────────┬─────────────┘  │   │
│  │ PairingManager  │ ◄───────── │              │ spawn           │   │
│  │ (插件内)         │            └──────────────┼────────────────┘   │
│  └─────────────────┘                           │                    │
└────────────────────────────────────────────────┼────────────────────┘
                                                 ▼
                                    Kimi / Claude / OpenCode /
                                    Codex / CodeBuddy CLI 子进程
                                    (stream-json over stdout)
```

要点：

- `@dionysus/core` 是唯一的业务逻辑所在，**零 vscode 依赖、零 HTTP/WS 依赖**，可在纯 node 环境用 vitest 完整测试；
- extension host 只做胶水：webview 容器、传输层、配对、配置、进程 spawn 的实际执行；
- webview 与 mobile 是地位平等的两类客户端，共用 `@dionysus/protocol` 消息定义与 `@dionysus/client-core` 的消息路由/状态逻辑，分别通过 postMessage 与 WebSocket 收发同构消息；
- CLI 子进程由 core 的适配器层管理，stdout 按行解析 stream-json（不需要 node-pty，详见 ADR-1）。

## 3. Monorepo 布局

```
ACP_AGENT2/
├── packages/
│   ├── protocol/          # @dionysus/protocol — 消息类型 + zod schema
│   ├── core/              # @dionysus/core — 适配器/会话/persona（零宿主依赖）
│   ├── client-core/       # @dionysus/client-core — ClientTransport / messageRouter / 按域 stores / 共享 UI 基础组件
│   ├── extension/         # dionysus-vscode — VS Code 插件宿主
│   ├── webview/           # @dionysus/webview — 插件内 React 应用
│   └── mobile/            # @dionysus/mobile — 手机端 web 应用（从零构建）
├── assets/
│   ├── live2d/            # 出厂 Live2D 模型（默认 kal'tsit，见 §7 角色素材库）
│   └── personas/          # 内置 persona YAML + 头像 + 语料 + 静态立绘素材
├── legacy/                # v2 旧代码（backend/ frontend/ electron/，只读参考，v3 稳定后删除）
├── docs/v3/               # 本文档与提取文档
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .github/workflows/ci.yml
```

包管理：pnpm workspaces（pnpm 不可用时 npm workspaces 兜底，结构不变）。

依赖方向（单向，禁止反向）：

```
webview ──┐
          ├──► client-core ──► protocol ◄── core ◄── extension
mobile ───┘                                        （extension 运行时加载 assets/）
```

- `protocol` 不依赖任何包；`core` 只依赖 `protocol`；`client-core` 只依赖 `protocol`；`extension` 依赖 `core` + `protocol` + `vscode` API；`webview`/`mobile` 依赖 `client-core` + `protocol`。
- `client-core` 存在的理由：决定两端行为一致性的 `messageRouter`（消息分发）与按域 stores 只允许有一份实现；纯 UI 基础组件（气泡、markdown 渲染）同置此包。禁止 mobile 以源码相对路径引用 webview 包内部目录。
- 构建链：`protocol`、`core`、`client-core` 用 tsc 产出 ESM + d.ts；`extension` 用 esbuild 打单文件 `dist/extension.js`；`webview`、`mobile` 用 Vite；vsix 打包时把 `webview/dist`、`mobile/dist` 与 `assets/` 内嵌进插件包。**出厂默认角色为 kal'tsit（Live2D 素材随包分发，版权已经用户确认无问题，2026-07 决策）**；早前审阅曾标注「仓库无 LICENSE、模型疑似同人衍生资产不可分发」，此处按用户决策覆盖，LICENSE 文本由用户在发布前补备；`assets/personas` 为自有 YAML，正常内嵌。

## 4. `@dionysus/protocol` 包

单一职责：定义客户端与服务端之间的全部消息，供 webview、mobile、core 三方共享。传输无关。

### 4.1 消息信封

```ts
interface Envelope<T extends string, P> {
  v: 1                      // 协议版本（v2 缺失，v3 新增）
  type: T                   // 消息类型，全词命名（沿用 v2，不采用 v2 设计稿的短代码）
  traceId?: string          // 请求-响应关联
  sessionId?: string        // 会话相关消息携带；全局消息省略并以 payload.scope 表达（见下）
  seq?: number              // per-session 单调递增序号，由 BroadcastHub 在扇出前赋值（断连补拉游标）
  turnId?: string           // 回合内全部下游消息共享，runAgentTurn 入口生成（打断去重/幂等）
  ts: number                // Unix 毫秒（v2 的秒/毫秒二义性在 v3 统一为毫秒）
  payload: P
}
```

每个消息类型一个 zod schema，按方向各有一个解析入口（`parseClientMessage` / `parseServerMessage`，见 §4.2；传输层已知消息方向，无需统一入口）。

**连接-会话绑定模型**：v3 的 WS 连接**不绑定单个会话**（v2 用 `?session_id=` 绑定单会话，v3 废除）；所有会话相关消息以 `envelope.sessionId` 路由，一个客户端可自由切换/同时关注多个会话，客户端按当前视图自行过滤。全局消息（fleet 级调度汇报）不再使用 v2 的 `session_id="global"` 魔法字符串，改为 `sessionId` 省略 + `payload.scope: "global"`，客户端不得按会话过滤丢弃。

**完整消息清单**（以 `extract/protocol.md` 为基线）：

- 连接与会话管理（C→S）：`hello`（声明支持的协议版本范围，服务端以 `handshake` 回选定版本）、`ping`、`new_session`、`client_command`（斜杠命令）、`user_input`、`option_selected`、`interrupt`、`sync_request`、`session_list_request`、`history_request`；
- 连接与会话管理（S→C）：`handshake`、`pong`、`sync_response`、`session_list_response`、`history_response`、`session_digest_update`；
- 会话事件（S→C）：`agent_stream`（thinking 复用其 `is_thinking` 标志，无独立 `thinking_stream` 类型）、`agent_complete`（错误经 `status="error"` 与 `system_notice` 表达）、`status_update`、`tool_call`、`tool_result`、`option_request`、`option_resolved`、`user_message_echo`、`todo_update`、`system_notice`；
- 陪伴（S→C，全部单向）：`companion_message`、`emotion_update`；
- 附件：attachments/artifacts（image/mermaid/latex）扩展，详见 `extract/protocol.md`；
- **删除**：`interrupt_before_send`（v2 声明但后端从未消费）、`live2d_action`（v2 全仓库无生产者，Live2D 驱动统一走 `emotion_update` 的 expression/motion 字段；注视跟随/唇形同步为客户端本地能力，不占协议类型）、`sticker_send`（v2 前端从未消费且贴纸资源不存在）。

**关键新增消息的 payload**：

```ts
// handshake（S→C，hello 的响应；重连时同样下发）
{ v: 1, clientId: string,
  sessions: { sessionId: string, title: string, status: SessionStatus, latestSeq: number }[] }

// sync_request（C→S，断连补拉）/ sync_response（S→C）
{ sessionId: string, afterSeq: number }
{ sessionId: string, events: ServerMessage[], latestSeq: number, truncated: boolean }
// truncated=true 表示 afterSeq 已溢出环形缓冲，events 以一条 session 快照（当前 status、
// 进行中回合流式文本前缀、未闭合 tool_call 列表、todo_update 全量）开头，其后从缓冲头部续播。

// session_list_request / session_list_response（会话枚举）
{}  // 可带 traceId 关联
{ sessions: SessionMeta[] }   // id/title/personaId/status/lastMessagePreview/updatedAt/unreadCount

// history_request / history_response（历史分页，含 message 行与 event 行）
{ sessionId: string, beforeTs?: number, limit: number }
{ sessionId: string, entries: (Message | TransientEvent)[], hasMore: boolean }

// session_digest_update（S→C，广播；会话状态每次跃迁时由 core 发出，QQ 式列表的数据源）
{ sessionId: string, title: string,
  status: 'idle' | 'running' | 'waiting_option' | 'done' | 'error',
  currentAction?: string,          // 一行当前动作摘要，如「正在读 auth.ts」
  todoProgress?: { done: number, total: number },  // 按该会话 todo 的进度（调度汇报口径：「7 步做到第 3 步」）
  pendingOptionRequest: boolean,
  lastActivityAt: number, seq: number }

// user_message_echo（S→C，多端回显；向除来源 clientId 外的所有客户端广播）
{ text: string, attachments?: Attachment[], origin: string }  // origin 供 UI 标注「来自手机」

// option_resolved（S→C，选项竞态解决；各端收到后将对应选项组置为已决态）
{ requestTraceId: string, selectedId: string, origin: string }
```

**`tool_call` / `tool_result` 字段级 schema**（新增结构化消息，取代 v2 前端用 emoji 正则从文本流解析工具调用的做法，v2: `frontend/src/lib/tools.ts`；适配器策略在解析 CLI stream-json 时直接产出结构化事件）：

```ts
// tool_call（S→C）
{ toolCallId: string,      // 优先取 CLI 原生 id；无则由策略合成 `${turnId}-${n}`
  name: string,            // 原始工具名，如 read_file / Bash / edit
  kind: 'read' | 'edit' | 'bash' | 'search' | 'other',  // 策略按工具名映射表归类
  args: Record<string, unknown>,  // 结构化参数（kimi 的 arguments JSON 字符串须先 JSON.parse）
  displayTarget: string }  // 文件路径或命令行摘要，core 侧截断至 120 字符

// tool_result（S→C）
{ toolCallId: string,      // 有原生 id 直接配对；无则策略按 FIFO 配对最近一个未闭合 tool_call
  ok: boolean,             // codex exit_code==0 / codebuddy is_error 取反；无信息默认 true
  summary: string,         // 结果摘要，core 侧统一截断 2000 字符，超出标注 truncated
  durationMs?: number }
```

**5 个 CLI 的解析可行性矩阵**（行形状出处见 `extract/adapters.md` §4/§5）：

| CLI | tool_call 来源 | 原生 id | tool_result 来源 | 备注 |
|---|---|---|---|---|
| kimi | `tool_calls[]`（OpenAI 风格，基类分支） | 样例未含，需合成 | `role=tool` 消息 | content 可能是整个文件全文，必须经 core 截断 |
| claude | `tool_use` 块（Anthropic 格式） | ✅ 原生 `id` | `tool_result` 块 | 直接配对 |
| codex | `command_execution` / `tool_call` 项 | 部分 | `item.completed` | 靠事件序配对 |
| opencode | `tool_call` 行 | 待验证 | **缺口**：`--format json` 是否有工具结果行未经证实 | 若无则 UI 对该 CLI 降级为「只显示调用、不显示结果」（风险 R-7） |
| codebuddy | `tool_use` 块 | ✅ 原生 `id` | 结果块（`is_error` 取反） | 直接配对 |

**瞬态汇报事件落盘策略**：`companion_message`（含 Supervisor 播报）与每回合末的 `todo_update` 终态快照，除在线广播外，追加写入会话 JSONL 作为 `type: "event"` 行（与 message 行区分）。这既是 `sync_request` 缓冲溢出后的补拉数据源，也支撑移动端「汇报历史」回看。汇报**不**持久化为 Message、不进会话消息流（角色单向输出的定位）。

**心跳与死连接清理**：客户端 30s `ping` 心跳；服务端 75s 未收到任何帧即主动断开并注销 clientId；`send` 失败立即注销该 clientId 并从广播表移除，记 warning 不影响其他连接（沿用 v2 单点失败隔离语义，`extract/session.md` §5.2）。

### 4.2 公开接口

```ts
export const PROTOCOL_VERSION = 1
export type ClientMessage = /* union */
export type ServerMessage = /* union */
export function parseClientMessage(raw: unknown): ClientMessage   // zod 校验，失败抛 ProtocolError
export function parseServerMessage(raw: unknown): ServerMessage
export * from './messages'   // 各消息类型与 payload 类型
```

## 5. `@dionysus/core` 包

宿主无关的业务核心。设计基线：`extract/adapters.md`、`extract/session.md`、`extract/persona.md`，并修复其中记录的全部结构性缺陷。

### 5.1 模块划分

```
packages/core/src/
├── adapters/
│   ├── types.ts            # IAgentAdapter, AgentInput, AgentEvent（含 tool_call / tool_result 事件类型）
│   ├── generic-cli.ts      # GenericCliAdapter：进程生命周期
│   ├── strategy.ts         # CliAdapterStrategy / JsonStreamStrategy 基类
│   ├── strategies/         # kimi.ts claude.ts codex.ts opencode.ts codebuddy.ts
│   └── registry.ts         # 配置驱动注册表（仅暴露 createAdapter 工厂，不暴露共享实例）
├── session/
│   ├── manager.ts          # SessionManager：回合编排
│   ├── store.ts            # JsonlSessionStore：会话持久化
│   ├── commands.ts         # 斜杠命令子系统（独立于 manager）
│   └── types.ts
├── persona/
│   ├── loader.ts           # persona YAML 加载（显式注入配置目录）
│   ├── engine.ts           # CompanionEngine：status→emotion、台词
│   ├── scheduler.ts        # CompanionScheduler：跨会话聚合 + 汇报仲裁统一出队口
│   ├── supervisor.ts       # CompanionSupervisor：周期轮询全 fleet 的后台播报员
│   ├── rewriter.ts         # 输出后处理改写（角色语气的默认通道，§5.4）
│   └── todo-tracker.ts     # 从结构化 tool_call/tool_result 事件提取 todo（不再扫文本）
├── config/
│   └── types.ts            # 配置类型（由宿主注入，core 不读文件）
└── broadcast.ts            # BroadcastHub：多客户端广播 + per-session seq + 环形事件缓冲
```

### 5.2 适配器层

```ts
interface IAgentAdapter {
  readonly agentId: string
  start(): Promise<void>
  send(input: AgentInput): AsyncIterable<AgentEvent>   // 流式事件；实例级单回合互斥（见下）
  interrupt(): Promise<void>
  shutdown(): Promise<void>
  injectSystemPrompt?(prompt: string, vars?: Record<string, unknown>): Promise<void>  // 仅 'native' 策略实现
  switchSession?(cliSessionId: string): Promise<void>  // v3 提升为正式可选方法（v2 靠 hasattr 探测）
}

interface CliAdapterStrategy {
  readonly supportsModel: boolean            // 类级元数据（v2 需实例化读取，v3 改静态）
  readonly supportsSystemPrompt: 'native' | 'prompt-prefix' | 'none'  // 类级元数据，逐 CLI 结论性赋值
  buildArgs(input: AgentInput, ctx: AdapterContext): string[]
  parseLine(line: string): { events: AgentEvent[]; cliSessionId?: string }  // 返回值携带 session id（v2 用 session_holder 可变 dict 带外通道，v3 废除）
  wrapFirstTurnInput?(systemPrompt: string, input: AgentInput): AgentInput
  // 默认实现（JsonStreamStrategy 基类）：text = systemPrompt + "\n\n" + input.text，其余字段原样；
  // 各 CLI 通常无需覆写（plan-mode 前缀注入已证明「拼进 prompt 文本」对 5 个 CLI 全部成立）
}
```

- `GenericCliAdapter` 管进程：每次 `send()` spawn 新进程（与 v2 语义一致）、stdout readline 逐行交策略解析、interrupt 杀进程、超时与非零退出统一错误事件。**删除 v2 的假 `_handle_crash_restart` 与死配置 `restart_on_crash`**；崩溃即报错事件，由上层决定是否重试。
- **实例级单回合互斥**：`send()` 进行中再次调用立即产出 `agent_complete{status:'error', error_message:'adapter busy'}`；同一会话的串行保证在 SessionManager 层（见 §5.3）。
- **interrupt 语义**：`interrupt()` 先置内部 `_interrupted=true` 再杀进程；读循环因非零退出收尾时若 `_interrupted` 为真则产出 `agent_complete{status:'interrupted'}` 而非伪 error，并复位标志（修复 v2「打断后收到 exited with code -9 伪错误」，`extract/adapters.md` §2.5）。
- 五个策略的行为规格（参数构建、行→事件映射、resume 语义、plan-mode 前缀）完全按 `extract/adapters.md` 实现；策略单测使用录制的 stream-json fixture，v2 的 pytest 用例（如 `test_codebuddy_strategy.py`）逐条翻译为 vitest。
- 策略间重复的「文本块→status_update + agent_stream 双事件」模式提取为共享 helper（v2 在 4 个策略中重复约 10 处）；plan-mode 前缀注入统一为常量 + 按 CLI 覆盖。
- `supportsSystemPrompt` 逐 CLI 赋值需实现前核实各 CLI 现行参数，无法核实的保守标 `'prompt-prefix'`；`opencode` 的 tool_result 行是否存在同样在实现期用真实 CLI 录制验证（R-7）。

### 5.3 会话层

```ts
interface SessionStore {
  create(meta: SessionMeta): Promise<Session>
  get(id: string): Promise<Session | null>
  list(): Promise<SessionMeta[]>            // 扫目录读各 jsonl 首行 meta，只读元数据（修复 v2 list_sessions 的 N+1）
  appendMessage(sessionId: string, msg: Message | TransientEvent): Promise<void>
  loadMessages(sessionId: string): Promise<Message[]>
  updateTitle(sessionId: string, title: string): Promise<void>
  delete(id: string): Promise<void>
}
```

- **多会话并发模型**：
  - **会话 ↔ 适配器一对一**：每个会话绑定一个独占的 adapter 实例；registry 只提供 `createAdapter(adapterId)` 工厂（深拷贝配置新建实例，语义同 v2 `create_adapter`），不向上层暴露共享实例（v2 `get_adapter` 返回共享单例的语义废除——共享实例并发两个 `send()` 会互相杀进程、串 session_id）。
  - **单会话 send 串行**：`SessionManager` 保证同一会话同一时刻至多一个进行中的回合；回合进行中收到新 `user_input` 时排队为下一回合（UI 提示「已排队，当前回合结束后发送」）；`interrupt` 只作用于指定 sessionId 的当前回合。
  - **任意数量会话并发执行 `runAgentTurn`**：回合状态、CompanionEngine/TodoTracker 实例、adapter 进程均以 sessionId 为键隔离；全部下游事件经 envelope 的 `sessionId` 归属分发。
  - **并发上限**：`dionysus.maxConcurrentAgents`（默认 3），超限创建会话/发起回合时回 `system_notice`；N 个并行会话 = N 个 CLI 子进程，资源风险见 R-9。
- **存储格式 JSONL**：每会话一个 `<storageDir>/sessions/<id>.jsonl`（首行 meta，其后每行一条 message 或 event）。**删除 `index.json`**：`list()` 改为扫描 `sessions/*.jsonl`，读每个文件首行 meta + `fs.stat` mtime 排序；首行 meta 仅在 create 及 title/persona/adapter 变更（低频、用户驱动、天然串行）时重写（写临时文件 + `rename` 原子替换）。由此消灭唯一的共享可变状态——原 index.json 在多会话并行写下存在 await 点交错的读-改-写 lost-update 竞争，ADR-2「单进程无并发」的论证对 async 读-改-写不成立（修正记录见 §10 ADR-2 附注）。无原生依赖（弃 SQLite/better-sqlite3 的原生模块打包风险，与 v2 设计稿 lowdb 决策一致）。不迁移 v2 SQLite 数据。
- **JSONL 健壮性**：`loadMessages` 对解析失败的行跳过并记 warning（容忍进程被杀留下的末行截断半行）；存储时间戳与线路一致用 Unix 毫秒整数；启动时校验首行 meta 完整性，损坏的会话文件在 list 中标注 `corrupt` 而非静默消失。**写者不变量**：同一 sessionId 的 `appendMessage` 调用方只有该会话的 `runAgentTurn`（串行保证见上），单会话 jsonl 文件不存在多写者。
- `SessionManager` 只保留：会话 CRUD、适配器生命周期、回合编排。**v2 的两条重复回合管线（`handle_user_input` / `handle_option_selected`）合并为单一 `runAgentTurn(session, input)`**，option_selected 仅负责把选项转成 input。
- **turnId 与幂等**：`runAgentTurn` 入口生成 `turnId`，本回合全部下游消息携带；`SessionManager` 对已收过终态 `agent_complete` 的 turnId，忽略其后续迟到的 complete（修复 v2「打断后双 agent_complete」，`extract/protocol.md` §9.7）；同一回合重复的 `option_selected` 幂等忽略并回 `system_notice(level='info')`。
- **会话状态机**：`idle | running | waiting_option | done | error`。收到 adapter 的 `option_request` 事件时置 `waiting_option`（正式启用该枚举，v2 为死枚举），收到 `option_selected` 或回合结束清除；每次状态跃迁发出 `session_digest_update` 广播。**option 超时**：服务端强制 `timeout_seconds` 计时，超时行为为会话级配置 `optionTimeoutAction: 'deny' | 'default' | 'keep'`（默认 `keep`，即维持现状但状态可查），超时后广播 `system_notice` 说明结果。
- **会话标题**：首个回合完成后，以首条用户消息截断 20 字符自动更新 `Session.title`（修复 v2「新会话」永不更新）；用户手动重命名后不再自动覆盖。
- 斜杠命令独立为 `session/commands.ts`： `{ command: { description, cliSpecific?, handler } }` 分发表替代 v2 的 if 链；Kimi 专有命令（列 kimi 会话）标注 `cliSpecific: 'kimi'` 并委托策略侧能力接口。
- **角色语气路线：rewriter 为默认，注入为可选增强**（用户决策，2026-07）：默认**不改动 agent 输入**，agent 实质回复保持原样（保护代码/命令内容），角色语气全部由 `persona/rewriter.ts` 在角色通道文本上产出（见 §5.4）。可选增强 `dionysus.persona.injectIntoAgent`（默认 `false`）：开启后按策略元数据 `supportsSystemPrompt` 分流——`'native'` 调 `adapter.injectSystemPrompt`；`'prompt-prefix'` 经 `wrapFirstTurnInput` 拼进首轮 `AgentInput.text`；`'none'` 忽略该开关。注入成功（adapter.send 产生首个事件）后置 `systemPromptInjected=true` 并持久化；包装/发送失败按原始输入重发（不阻断回合）+ `system_notice(level='warning')`。**标志生命周期**：持久化到 JSONL 会话 meta 行；`switch_adapter` / `switch_session` 后重置为 false；`switch_persona` 后不重置、不补注（避免中途改变 agent 行为）。
- `BroadcastHub`：会话事件向全部已连接客户端广播，带客户端注册/注销；**广播为全局扇出，客户端按 `envelope.sessionId` 自行过滤**（移动端带宽放大在 Phase 5 实测后再评估 per-client 订阅过滤，现不预留接口）；**客户端断开只注销自己，绝不触碰适配器进程**（修复 v2 多标签断连误杀共享 CLI 进程的问题）；适配器进程的生命周期只跟随会话显式关闭或插件 deactivate。**seq 与补拉缓冲**：BroadcastHub 在扇出前为每条消息赋 per-session `seq`，并为每个活跃会话维护内存环形事件缓冲（默认容量 500 条，覆盖一顿饭时长的离席）；`sync_request` 按 `afterSeq` 回放，溢出时先回快照再续播（协议见 §4.1）。缓冲只服务补拉，不改变在线扇出路径。**归来摘要**：某客户端重连且 `afterSeq` 落后 `latestSeq` 超过阈值（或断连 >60 秒）时，由 Supervisor 用内置模板向该客户端**单播**一条摘要（「你离开期间：会话 A 完成 1 回合（成功）、调用工具 14 次；会话 B 在等待你确认选项」），零 LLM 依赖。

### 5.4 Persona 层

- 行为规格按 `extract/persona.md`：status→emotion 映射、台词模板、调度时机、TodoTracker，全部 YAML 驱动。`TodoTracker` 的输入改为结构化 `tool_call`/`tool_result` 事件（不再用 emoji 正则扫流式文本，`extract/persona.md` §7.12）。
- **消灭角色硬编码**：v2 中能天使台词默认值、凯尔希特判、表情名硬编码全部下沉到 persona YAML；core 内置一个中立 default persona（含全套中性文案），角色专属内容只存在于 `assets/personas/`；loader zod 校验缺键时回退 default persona 而非代码字面量。
- **CompanionSupervisor 完整语义**（恢复 `extract/persona.md` §4 的后台播报员定位，v3 不得缩减为「回合后回放」）：周期轮询（默认 15s、最小 5s）**全部**会话，fleet 聚合（N 个工作/M 个出错）+ 变动检测（会话创建/关闭/状态跃迁）+ 安静期跳过（快照无变动且无 working 会话则本轮静默）；回合结束另触发一次即时播报。播报的 emotion/expression/motion 按播报语义（working/success/error/changed）经 persona 的 status→emotion 链解析，**不再恒用 working**（修复 `extract/persona.md` §7 缺陷 7）。播报目标选择规则：聚合全部活跃会话，persona 取「最近活跃会话」的 persona_id（与客户端可见性无关，多端广播模型下「当前可见」无意义）。**成本约束**：`agent_session`/`deepseek_api` 模式仅在至少一个客户端连接时才运行 LLM/CLI 生成（纯模板模式不受限）；无人观看时不烧额度。adapter 获取改为构造函数显式注入 `adapterFactory: (personaId?: string) => Promise<IAgentAdapter>`，废除 v2 的 `provider.__self__` 反射。
- **汇报仲裁（多声源统一出队口）**：回合内 CompanionEngine（每会话一个）、跨会话 Scheduler、周期 Supervisor 三个声源的台词统一进 `CompanionScheduler` 的单一出队口，规则：
  1. 每客户端可见台词最小间隔 3 秒；
  2. 优先级：error/打断插播 > 回合完成 > Supervisor 周期播报 > 状态短语；
  3. 同 tick 多条候选合并为一条聚合句（走 persona YAML 的 `scheduler_templates`）；
  4. Supervisor 播报若与近 N 秒内的会话级台词语义重复则跳过本轮（以 v2 已有的 idle 去抖为基线扩展，不引入新机制）。
- **persona YAML v3 schema 变更**：
  - 新增 `scheduler_templates` 段（键：`no_session / any_working / all_success / all_error / partial_error_single / partial_error_multi / all_idle`，对应 v2 硬编码的 7 条聚合文案）与 `supervisor_templates` 段（键：`working / error / changed / idle`），每键 list[str]，逐键回退中立默认；
  - **新增 `voice` 段（rewriter 路线的客制化核心，用户自创角色主要填这里）**：`tone`（语气自然语言描述，如「冷静克制、偶尔毒舌」）、`catchphrases`（口头禅/句尾口癖 list[str]）、`taboos`（角色绝不会说的词句 list[str]，rewriter 输出校验用）、`examples`（3-5 对「平淡汇报 → 角色口吻」改写样例，LLM 模式的 few-shot 与 template 模式的风格基准）、`rewriter_prompt`（LLM 模式的指令模板，支持 `{tone}` `{examples}` 占位符）。逐字段回退中立默认；
  - v2 死字段裁决：`tone_rules.keyword_replacements` / `random_insertions` **复活**，由 `rewriter.ts` 读取（template 模式的改写规则载体）；`emotion_mapping` **删除**（与 `companion.live2d.expressions` 语义重叠，表情映射只留 live2d 一处）；`corpus_file` / `preferred_theme` / `theme_override` **v3.0 删除**（登记范围外清单）；
  - **runtime/builtin 合并规则**：runtime persona 对 builtin 同名 persona 做**逐键深合并**（`companion` 段按叶子键合并），废除 v2 整文件覆盖（v2 runtime kal'tsit.yaml 屏蔽 builtin 完整版导致凯尔希说能天使台词的缺陷不重现）；迁移旧 personas 目录时把 builtin 版独有段合并进 runtime 版；
  - **`system_prompt` 模板语义**：支持 `{session_id}` / `{working_dir}` 占位符，loader zod 校验时检查占位符合法性；仅在可选注入增强开启时使用（§5.3）。
- **`persona/rewriter.ts`（输出后处理改写，角色语气的默认通道）**：
  - **改写范围**：只处理角色通道文本——Scheduler 聚合句、Supervisor 播报、归来摘要、digest 一行摘要的展示文案、触摸台词；**不改写 agent 会话正文**（`agent_stream`/`agent_complete` 内容原样呈现，保护代码/命令/路径不被润色破坏）；
  - **引擎分级**：template 模式（默认，零 LLM 依赖）：`tone_rules` 前后缀 + `keyword_replacements` + `voice.catchphrases` 句式拼装 + `voice.taboos` 输出校验；LLM 模式（`agent_session`/`deepseek_api`，与 Supervisor 共用模式配置）：以 `voice.rewriter_prompt` + `examples` few-shot 整句润色；
  - **防静默失效**：template 模式输出与输入完全相同时记 debug 日志（辅助发现 persona 配置问题）；快照测试为强制验收（见 §12）。
- `persona/loader.ts` 显式接收配置目录参数（v2 模块导入时固化路径的缺陷不重现）。

### 5.5 展示主题

- **桌面端：不做调色/壁纸主题系统**（用户决策，2026-07）——webview 全面跟随 VS Code 皮肤（`var(--vscode-*)` 映射到设计 token，见 §7），v2 的 ThemeManager/ThemeStudio/`assets/themes` 整体移出 v3 范围（登记 roadmap 附录 B）；
- **移动端：三态主题**（mobile 包内实现，不经 core）：浅色（柔和白，非纯白，建议基底 `#F7F7F5`）/ 深色（柔和黑，非纯黑，建议基底 `#17171A`）/ 跟随系统（`prefers-color-scheme`），切换入口在移动端设置页；
- 保留教训：所有 YAML 解析一律用 `yaml` 库（v2 手写真则解析的 `\s` 烹饪 bug，ADR-5）。

## 6. `extension` 包（VS Code 插件宿主）

### 6.1 职责与结构

```
packages/extension/src/
├── extension.ts          # activate/deactivate
├── cli-detect.ts         # 激活时 CLI 安装检测（which/where 探测五个 CLI）
├── webview-provider.ts   # editor panel 与 sidebar webview 容器
├── status-bar.ts         # StatusBarItem 全局聚合状态
├── bridge.ts             # MessageBridge：webview postMessage 传输
├── lan-server.ts         # 内嵌 HTTP/WS 服务（移动端链路 + 资产路由）
├── pairing.ts            # PairingManager：token 生成/校验/持久化 + 二维码
├── core-host.ts          # core 的装配：SessionManager + BroadcastHub + 配置注入
├── commands.ts           # VS Code 命令注册
└── config.ts             # settings.json 读取 → core 配置
```

### 6.1.1 激活时环境检测与首次引导

- `activate` 时对五个 CLI 执行 `which`/`where` 探测，结果写入 core 装配配置；
- **版本探测与适配展示**（承接「尽力配对」决策，2026-07）：探测到 CLI 后继续执行 `<cmd> --version` 获取本机版本；registry 为每个 CLI 记录 `testedVersions`（策略 fixture 录制时验证过的版本范围）；适配器选择器与设置页展示「已适配 1.2.x / 本机 1.4.0」，本机版本超出已适配范围时显示警告角标（不阻断使用——尽力配对原则，解析失败才报错）。**边界明示：只能检测与警告，不能自动修复解析**——解析规则是代码不是数据，CLI 输出格式变更必须改策略代码（ADR-19）；
- **诊断命令** `dionysus.redetectAgents`（显示名「重新检测 AI 助手」，P1）：重扫安装与版本；附带可选的格式探针——向 CLI 发一个最小探针 prompt，校验 stream-json 行类型能否被当前策略完整解析，输出「适配健康报告」。探针会真实调用一次 CLI（有 token 成本），仅手动触发且触发前明示；
- 未找到任何 CLI 时，webview 显示引导页（各 CLI 一句话简介 + 一键复制的安装命令 + 官方安装文档链接），而不是等用户发消息才报 `spawn ENOENT`；
- `dionysus.adapter.default` 语义：未设置时使用首个检测到的可用 CLI；检测到多个时首次启动弹一个简单选择器；
- 贡献 VS Code walkthrough（`contributes.walkthroughs`）：安装 agent CLI → 打开 Dionysus 聊天 → 完成第一轮对话 → 扫码配对手机（任务落 roadmap Phase 3）。

### 6.2 传输层抽象

```ts
interface Transport {
  send(clientId: string, msg: ServerMessage): void
  broadcast(msg: ServerMessage): void       // 经 BroadcastHub 扇出
  onMessage(cb: (clientId: string, msg: ClientMessage) => void): void
  onDisconnect(cb: (clientId: string) => void): void
}
```

两个实现：`WebviewTransport`（`webview.postMessage` / `onDidReceiveMessage`，clientId 固定）与 `WsTransport`（`ws` 库，每连接一个 clientId）。core 只面向 Transport 接口，不感知宿主。

### 6.3 内嵌 HTTP/WS 服务（移动端链路）

- 使用 Node 内置 `http` + `ws`（不引 Express/Fastify，控制依赖）；
- HTTP 端点：`GET /`（mobile 静态应用，`mobile/dist` 内嵌于 vsix）、`POST /api/pair`（配对）、`GET /api/health`（仅返回 `{"ok":true}`，不带版本/配置信息）、**`GET /assets/*`**（资产路由：将路径安全映射到内嵌 `assets/` 与 `globalStorageUri/character-library/`，`path.normalize` + 前缀校验防穿越，与 §11 的 `..` 归一化校验同款；响应 `Cache-Control: private, max-age=300`；供移动端加载 Live2D 模型/静态立绘/persona 头像）；
- **资产与 API 鉴权**：资产 URL 携带 `?token=<device_token>`（与 WS 的 query 方案统一——`<img>`/`<script>`/pixi XHR 无法带 `Authorization` header，此为唯一可行通道；token 出现在 URL 的局域网风险接受并记录于 §11）；HTTP API 校验失败统一返回 `401 {"error":"invalid_device_token"}` JSON，mobile 端收到 401 清本地 token 跳配对页；
- WS 端点：`/ws?token=...`。**token 在 Node `http` server 的 `upgrade` 回调内、调用 `ws.handleUpgrade` 之前校验**，失败直接 `socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')` + `socket.destroy()`，不产生 WS 连接（修复 v2 `is_device_valid` 形同虚设的安全漏洞——v2 局域网内任何人可连 WS 执行任意 CLI；先 accept 再校验会给未授权方一个已建立的 WS 通道窗口）；
- 绑定与生命周期：`dionysus.lan.enabled: false` 时 **lan-server 不启动**（减少攻击面与常驻资源）；`true` 时绑定 `0.0.0.0` 并显示二维码；`lan.enabled`/`lan.port` 变更触发 lan-server 重启监听，复用现有配置热更新通道；
- **端口冲突**：listen 失败（`EADDRINUSE`）时自动递增端口重试（8765→8775 上限），二维码始终使用**实际绑定端口**并在 webview 弹层显示当前地址；**多窗口**：先到先得——后启动的 VS Code 窗口检测到端口已被本插件占用时，lan-server 进入 disabled 态并 `system_notice` 提示，不抢占；
- 服务随插件 deactivate 关闭；VS Code 退出则移动端不可用（明示于 README，Bridge CLI 为后续解法）；
- **Remote-SSH / WSL / Dev Container 场景**：声明 `extensionKind: ["workspace"]`（适配器/CLI 必须在远端跑），remote 下内嵌服务在远端。移动端连接官方路径：优先用 `vscode.env.asExternalUri(localPort)` 获得经 VS Code 端口转发回桌面的地址生成二维码（桌面转发默认绑 localhost，需提示用户将转发端口改为公开或配合防火墙放行）；不可用时的降级：配对页检测到 remote 环境直接显示「Remote-SSH 下移动端需自行 SSH 隧道/暂不支持」指引，而非展示一个必失败的二维码。

### 6.4 配对管理器

- 行为基线：`extract/pairing-mobile.md`；token 持久化于 `context.globalStorageUri/paired-devices.json`；
- 二维码展示：VS Code 命令「Dionysus: 显示配对二维码」，webview 弹层渲染。**二维码内容为 `http://<LAN-IP>:<port>/#/pair/<token>`**——pair token 放 URL fragment，不进浏览器历史/Referer/服务器日志（承接 `extract/pairing-mobile.md` §5.3）；mobile 应用读 `location.hash` 完成配对后立即 `history.replaceState` 抹掉；
- **TTL 倒计时与刷新**：弹层显示 pair token 剩余有效秒数倒计时；剩余 <30s 或已过期时自动调用 `PairingManager.issueToken()` 换发新 token 并重渲染二维码（旧 token 立即失效），同时提供手动刷新按钮（承接 `extract/pairing-mobile.md` §5.4）；
- **开启引导**：执行「显示配对二维码」命令时若 `lan.enabled` 为 `false`，弹确认框「需要开启局域网连接才能让手机访问，是否开启？」，确认后自动写回配置并生效，无需手动编辑 settings.json；弹层文案固定包含「手机需与电脑连接同一个 Wi-Fi」及排障入口（防火墙/AP 隔离，与 R-3 对策呼应）；
- v3 强化：token 一次性 + 设备白名单 + 可撤销；未配对设备仅能访问配对端点；验票成功时刷新设备 `last_seen` 并落盘（节流到每分钟最多一次写），设备列表 UI 展示「最近活跃」；device token 长期有效、不轮换，撤销为唯一回收手段（显式决策记录于 §11）。

### 6.5 命令与配置贡献点

命令：`dionysus.openChat`、`dionysus.newSession`、`dionysus.interrupt`、`dionysus.selectAdapter`（显示名「Dionysus: 选择 AI 助手」）、`dionysus.selectPersona`（显示名「选择角色」）、`dionysus.showPairingQr`、`dionysus.redetectAgents`（显示名「重新检测 AI 助手」）。配置贡献点的 `description` 一律用中文白话书写（Adapter→「AI 助手」、persona→「角色」、supervisor→「播报」）。

`settings.json`（替代 v2 的 `server.yaml`）：

```jsonc
{
  "dionysus.adapter.default": "",            // 空 = 使用首个检测到的可用 CLI（见 §6.1.1）
  "dionysus.adapters": {
    "kimi_cli": { "type": "kimi_code_cli", "command": "kimi", "model": null }
  },
  "dionysus.maxConcurrentAgents": 3,         // 并行 CLI 子进程上限（§5.3）
  "dionysus.workingDir": "${workspaceFolder}",   // 默认跟随当前工作区（v2 需手配）
  "dionysus.persona.default": "",            // 空 = core 按资产探测结果决定：已安装模型对应的 persona 优先，否则中立 default persona（不写死角色名）
  "dionysus.session.optionTimeoutAction": "keep",  // option 超时默认动作：deny | default | keep
  "dionysus.lan.enabled": false,
  "dionysus.lan.port": 8765,
  "dionysus.supervisor.mode": "template",    // disabled | template | agent_session | deepseek_api
  "dionysus.supervisor.intervalSeconds": 15, // 下限 5
  "dionysus.supervisor.adapterId": "",       // agent_session 模式复用的 CLI adapter；空 = 跟随 default
  "dionysus.supervisor.llm.baseUrl": "",     // deepseek_api 模式
  "dionysus.supervisor.llm.model": "",
  "dionysus.persona.injectIntoAgent": false, // 可选增强：把 persona 语气拼进 agent 首轮输入（§5.3）；rewriter 为默认语气通道
  "dionysus.character.display.desktop": "live2d",  // 角色展示模式：live2d | static（素材库，§7）
  "dionysus.character.display.mobile": "live2d"    // 移动端默认 Live2D（与桌面端一致），用户可改 static 省流量
}
```

- **Supervisor 配置**：`template` 为默认（不依赖任何外部服务的内置模板，离线可用，与 MVP 定位一致）；`agent_session` 复用已配置 CLI、零额外配置，为推荐进阶值；`deepseek_api` 模式的 API key **走 VS Code `SecretStorage`**（`context.secrets.store('dionysus.supervisor.apiKey')`），禁止落 settings.json；无可用 key 时静默降级 template 模式、不产生错误消息，设置界面显式提示。
- 适配器配置改动通过「配置注入」生效：core 在装配时拿到配置对象的唯一引用，设置变更走同一引用热更新（修复 v2 配置双副本导致热更新失效的 bug）；`lan.*` 变更复用同一通道触发 lan-server 重启监听（§6.3）。

### 6.6 全局会话状态面（sidebar 会话列表 + 活动栏 badge + StatusBar）

- **sidebar webview 会话列表**（QQ 式会话列表的桌面主载体，决策见 ADR-14）：由 webview 包实现富列表（persona 头像、状态点、未读角标、一行进展摘要），extension 仅注册 sidebar 容器；数据源为 `session_digest_update` 广播（§4.1），列表项渲染规格与 §7 的列表项规格同源；
- **活动栏 badge**：待处理会话（waiting_option/error/未读）在活动栏图标上累计计数——sidebar 收起或面板被盖住时仍有感知；
- **`status-bar.ts`**：StatusBarItem 常驻聚合显示「⏳2 运行中 ❗1 待决策」，点击聚焦会话列表。与 sidebar 列表、活动栏 badge 共用同一 digest 数据源。

## 7. `webview` 包（插件内 React 应用）

- 技术栈沿用 v2：React 18 + TypeScript + Vite + Tailwind + Zustand + Framer Motion + pixi-live2d-display（PixiJS v7 锁定）。
- 视觉规范沿用 `extract/design-style.md`，叠加 VS Code 主题变量适配层（`var(--vscode-*)` 映射到主题 token，插件主题与 VS Code 主题协调）。
- 组件迁移分类按 `extract/webview-inventory.md` 执行。**桌面端布局分工**：sidebar webview = 会话列表（§6.6）；editor panel = 当前会话的聊天流 + Live2D 陪伴区（webview-inventory 中「TreeView 或 webview 列表」的悬置表述以此裁决为准）。
- **状态管理重设计**（规避 v2 chatStore 的结构性缺陷）：
  - 按域拆 store（实现于 `client-core`，两端共用）：`sessionStore`（会话+消息）、`streamStore`（流式状态/工具调用）、`companionStore`（情绪/台词/todo）、`live2dStore`、`settingsStore`；
  - 会话数据单真源：`messages` 一律经 selector 从 `sessions[currentId]` 派生，不做镜像字段；
  - 消息路由为纯函数模块 `messageRouter.ts`（v2 中 App.tsx 的 12 分支 switch 抽出），可单测；`scope: "global"` 的陪伴消息是其显式路由分支（进 companionStore，不进任何 sessionStore）；
  - transport 抽象 `interface ClientTransport { send(msg: ClientMessage): void; onMessage(cb): void }`（定义于 `client-core`），webview 内由 `vscodeApi.postMessage` 实现，mobile 由 WS 实现。
- **会话列表项规格**（sidebar 列表项与 mobile 列表行共用同一状态机，数据源为 `session_digest_update`）：条目 = persona 头像 + 会话名 + 状态点（idle/working/waiting_option/done/error 五色）+ 一行摘要（working 时优先显示 todo 进度 + 当前动作，格式 `3/7 · 正在改 auth.ts`，无 todo 时退化为 `currentAction`）+ 未读角标（按 `seq` 与客户端已读游标计算）+ 待决策标记（`pendingOptionRequest`，类似 QQ 的「@我」提醒，视觉上最高优先）。验收基准：两个会话并行工作时，列表各自实时显示当前动作。
- **tool_call 操作卡片**（功能④的 UI 契约）：聊天流内联渲染，主文案使用自然语言模板（按 `kind` + `displayTarget`：「正在读取文件 `xxx.ts`」「正在修改 `xxx.ts`」「正在运行命令 `npm test`」），原始 `args` 默认折叠；图标与配色按 `kind` 区分（📖 read / ✏️ edit / ⚡ bash / 🔍 search）；`tool_result` 到达后与对应 `tool_call` 卡片配对折叠为「调用 → 结果」单卡（按 `toolCallId`），显示耗时与失败标红；视觉显著性沿用 v2 ToolHUD 的浮卡动效（`extract/design-style.md` §4.6 清单直接迁移）。
- **汇报旁白通道**（功能③的呈现约束）：`companion_message`（含 Scheduler 聚合句与 Supervisor 播报）**一律不进会话消息流**、不持久化为 Message，只进 `companionStore`；桌面端呈现为 Live2D 陪伴区的常驻台词气泡（CharacterDialogBox 迁移路径不变，跨会话、不随会话切换消失），`scope: "global"` 或跨会话汇报同时在对应会话的列表项上落完成/未读标记（与会话列表项规格联动）。`companion_message` payload 携带可选 `sourceSessionId` / `sourceTitle`，UI 在气泡角落小字标注来源会话（如「来自：重构 auth」），点击可跳转该会话。
- **陪伴归属规则**：Live2D 模型/台词/情绪映射跟随当前聚焦会话的 `persona_id`，切换会话时切换 persona（模型切换带加载态与静态立绘兜底）；无聚焦会话或 fleet 级播报（`scope: "global"`）使用 `dionysus.persona.default`。移动端陪伴视图同样遵守。
- **角色素材库系统**（与 persona 体系平行的客制化系统，用户决策 2026-07；客制化范围只保留「角色展示 + 角色语气」，不含调色/背景）：
  - 素材组织：出厂素材内嵌 `assets/`（kal'tsit Live2D 为默认角色、静态立绘集、persona YAML），用户素材放 `globalStorageUri/character-library/`（目录结构同出厂：`<name>/model3.json…` 或 `<name>/portrait/*.png` + `<name>.yaml`）；loader 合并两处来源，用户目录同名覆盖出厂；
  - 展示模式 per-device 可配：`dionysus.character.display.desktop` / `.mobile`（`live2d | static`，桌面默认 live2d、移动默认 static 省流量，用户可自由改——移动端想要 Live2D 同样是合法默认）；
  - **静态立绘形态**（桌面/移动同级能力）：Live2D 区域渲染静态立绘 + 台词气泡，`emotion_update` 仅驱动气泡文案与表情贴图切换；同时是模型加载失败/spike 失败（R-1）的保底；
  - pixi 资产经 `webview.asWebviewUri` 加载；`webview-provider.ts` 的 `localResourceRoots` 设为 `[extensionUri/webview-dist, extensionUri/assets, globalStorageUri/character-library]`；
  - CSP 完整模板（spike 验收基线，R-1）：
    ```
    default-src 'none';
    script-src ${webview.cspSource} 'nonce-<boot>';
    style-src ${webview.cspSource} 'unsafe-inline';
    connect-src ${webview.cspSource};
    img-src ${webview.cspSource} data: blob:;
    media-src ${webview.cspSource};
    font-src ${webview.cspSource};
    worker-src blob:;
    ```
    （`connect-src` 是 `model3.json`/`.moc3`/`motion3.json` XHR 加载的必需项，缺则模型 JSON 都取不到）；
  - **首次启动**：出厂 kal'tsit 开箱可见，无强制引导；设置页提供「角色素材库」管理入口（查看已安装素材、导入本地模型目录/URL 下载、切换默认角色与展示模式），替代原「三步放置引导」（出厂已内置可用角色，引导降级为可选管理）；
  - **触摸交互**：纯前端实现（决策，ADR-16）——`personas.get` 消息 payload 已含 `touch_zones`，webview 本地随机选句、播表情，不经 core；core 侧不实现 `get_touch_reaction` 等价物，协议不新增触摸消息。

## 8. `mobile` 包（手机端应用，从零构建）

- 功能基线（`extract/pairing-mobile.md` §4.3）：会话列表 ↔ 聊天两视图、会话聊天（流式渲染、选项交互、打断）、陪伴视图（角色台词/情绪）、状态展示；
- **界面风格：仿手机 QQ**（用户决策 2026-07）：经典列表↔对话结构；**三态主题**：浅色（柔和白，非纯白）/ 深色（柔和黑，非纯黑）/ 跟随系统（§5.5）；
- **信息架构：首屏 = 会话状态列表**（digest 驱动）：QQ 式条目 = 角色头像 + 标题 + 状态徽标 + 最后一条汇报预览 + 未读角标 + 待决策标记（与 §7 列表项规格同源，数据源 `session_digest_update` + handshake 的全量 digest 快照）；点进才是单会话详情。离开电脑场景下用户打开手机看到的第一屏必须是「哪些 agent 在跑、哪个要我决策」；
- **角色唤起抽屉**：对话界面**右上角放唤起角色按钮**；点击（或上滑）从屏幕底部向上扫出角色抽屉（Apple 风格 sheet），抽屉非全屏——顶部露出一小指宽的内容区，透出底下对话流的实时动态（滚动/新消息可见）；抽屉内为角色（Live2D 或静态立绘，按 `dionysus.character.display.mobile`）+ 汇报气泡 + 情绪状态；下拉或点遮罩收起；
- **会话工作状态全屏页**：对话界面**左滑**进入该会话的工作状态全屏页（todo 进度、操作时间线明细、汇报流），**右滑**返回对话界面——手机上「这个 agent 具体干到哪了」的查看路径固定为一次横滑；
- **断连重连与追赶**（功能⑤的核心链路）：
  - WS `ClientTransport` 沿用 v2 已验证策略：30s 心跳、指数退避 1s→30s、上限 10 次、主动断开（`intentionalClose`）不重连；
  - 监听 `visibilitychange`：回到前台立即主动重连；重连握手后发 `sync_request { sessionId, afterSeq }` 补拉错过的全部事件（§4.1），各会话视图按序回放；
  - core 侧判定断连超阈值时向该客户端**单播「归来摘要」**（§5.3），首屏顶部呈现「离开期间发生了什么」；
  - 重连失败超过 3 次显示明确横幅「无法连接电脑，可能已休眠或 VS Code 已退出」，而非无限转圈；
- **平台限制的明示取舍**：局域网 `http://<IP>:8765` 不是 secure context，Service Worker / Web Push / 系统级通知在手机浏览器上**不可用**；锁屏期间主动推送无解（除非未来 Bridge CLI 上 HTTPS 或做原生壳）。因此移动端体验目标正确定义为：**「锁屏期间零打扰，解锁打开 3 秒内呈现离开期间发生了什么」**，而非「实时推送」。PWA / Web Push 通知列入范围外清单（roadmap 附录 B）；
- **无人值守交互闭环**：会话处于 `waiting_option` 时，列表行与聊天页顶部常驻醒目确认条（高对比色 + 选项按钮直接内联），重连后自动滚动/定位到该条（「回来 3 秒看懂」的 P0 交互）；option 超时按 `optionTimeoutAction` 执行并广播结果（§5.3）；输入区提供「离开模式」快捷开关（yolo 模式 + 抑制非必要 option 的提示语），发送时走既有 `user_input.mode` 字段，无协议改动；
- **操作时间线**（功能④在小屏的形态）：每次 `tool_call` 渲染为一行 chip（图标 + 动词 + 目标，如「📝 改 auth.ts」「⚡ 跑 pytest」），默认折叠为计数条（「本回合已执行 14 项操作」），点开展开明细；操作计数同时进入归来摘要；
- 401 处理：任何 HTTP/WS 鉴权失败 → 清本地 token → 跳配对页（「401 → 重新配对」闭环，`extract/pairing-mobile.md` §5.5）；
- 技术栈与 webview 对齐（React + Vite + Tailwind + Zustand），共享 `@dionysus/protocol` 与 `@dionysus/client-core`（messageRouter/stores/UI 基础组件单份实现，禁止跨包源码相对路径引用）；
- **MVP 分级**（Phase 5 任务与验收按此取舍）：
  - **P0（门禁项）**：配对页（含 TTL 倒计时刷新）、会话状态列表首屏、汇报/消息流（companion + supervisor + tool_call 摘要，纯文本）、选项确认条、打断按钮、短指令输入（含 IME composition 保护，沿用 `extract/pairing-mobile.md` §4.3）、断线重连与 sync 补拉、归来摘要、三态主题、角色唤起抽屉（静态立绘形态）、工作状态全屏页（左滑/右滑手势）；
  - **P1（可砍，不影响验收）**：移动端 Live2D 渲染（经 `/assets/*` 加载；展示模式已是合法配置，此处指完整 pixi 渲染管线的落地优先级）、点触互动、sticker、会话设置修改（改标题/切 adapter/改工作目录——手机误触风险大于价值，P0 只读展示）。

## 9. 关键数据流

### 9.1 一轮对话（webview 链路）

```
webview ChatInput
  → ClientTransport.send(user_input)
  → WebviewTransport → core.SessionManager.runAgentTurn        # 入口生成 turnId
      → SessionStore.appendMessage(用户消息)
      → broadcast(user_message_echo)                            # 除来源 clientId 外的多端回显
      → 首轮且 injectIntoAgent 开启且 !systemPromptInjected → 按策略 supportsSystemPrompt 分流注入（§5.3，默认关闭跳过）
      → CompanionScheduler.onTurnStart → 仲裁出队 → rewriter 改写 → broadcast(companion_message / emotion_update)
      → adapter.send → CLI 子进程 stream-json 逐行
          → 策略 parseLine → AgentEvent[]
          → 事件转换 → broadcast(agent_stream / status_update / tool_call / tool_result)
          → option_request → 会话置 waiting_option → broadcast(session_digest_update)
      → 完成 → broadcast(agent_complete)                        # 携带 turnId，客户端幂等 finalize
      → CompanionSupervisor 即时播报 → 仲裁出队 → broadcast(companion_message / emotion_update)
      → SessionStore 落盘：message 行 + companion_message/todo_update 终态 event 行
  → webview messageRouter → 各 store → UI 渲染 + Live2D 表情/动作
  （移动端客户端经 WsTransport 收到同一份 broadcast，两端天然一致）

# Supervisor 周期链路（独立于回合）：
Supervisor._tick（默认 15s）→ 全 fleet 快照对比
  → 有变动或有 working 会话 → 生成台词草稿（mode 分流：template / agent_session / deepseek_api）
  → 仲裁出队（§5.4）→ rewriter 改写为角色口吻 → broadcast(companion_message[scope=global] + emotion_update)
  → 安静期（无变动且无 working）→ 本轮跳过
```

### 9.2 移动端配对链路

```
VS Code 命令「显示配对二维码」（lan.enabled=false 时先弹确认自动开启）
  → PairingManager.issueToken() → 二维码(http://LAN-IP:8765/#/pair/T) + TTL 倒计时（到期自动换发刷新）
  → 手机扫码 → mobile 应用 GET / → 读 location.hash 携带 T 请求 POST /api/pair（随后 replaceState 抹掉 hash）
  → 校验通过，持久化设备 token D
  → mobile 以 /ws?token=D 建立 WS → upgrade 前校验 D → hello/handshake（含全量会话 digest 快照）
  → 进入正常消息流；资产经 /assets/*?token=D 加载
  → 设备可在 VS Code 设置中撤销（撤销后连接被断开）
```

> 注意：二维码内容为可扫码直达的 URL，这是相对 v2 的修复——v2 二维码内容是 JSON `{"pair_token","host"}`（手机相机扫码不跳转）且前端从不消费 device_token，配对链路实际断裂（详见 `extract/pairing-mobile.md`）。

### 9.3 断连追赶时序（移动端离席场景）

```
手机锁屏/切后台 → WS 被系统挂起 → 服务端 75s 无帧判定断开，注销 clientId
  （期间 agent 继续运行：事件正常扇出给其他在线客户端，
    并写入该会话的 BroadcastHub 环形缓冲；companion_message/todo 终态落 JSONL event 行）
手机解锁回到前台 → visibilitychange → 立即重连（指数退避）
  → hello/handshake（sessions 全量 digest + 各会话 latestSeq）
  → 每关注会话发 sync_request{ afterSeq = 本地已见 seq }
      → 缓冲覆盖 → sync_response 按序回放缺失事件
      → 缓冲溢出 → sync_response.truncated=true：先快照（status/流式前缀/未闭合 tool_call/todo 全量），
        再从缓冲头部续播；更早历史可经 history_request 翻页（含 JSONL event 行）
  → 断连 >60s 或落后超阈值 → Supervisor 单播「归来摘要」
  → UI：首屏 digest 列表刷新 + 归来摘要横幅 + waiting_option 会话自动定位确认条
```

## 10. 架构决策记录（ADR）

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| ADR-1 | CLI 进程用 `child_process.spawn` + readline 按行解析 | node-pty | 五个 CLI 均以 stream-json 行协议交互，无 ANSI 交互需求；node-pty 是原生模块，引入打包/平台风险（v2 设计稿选 node-pty 的前提不成立） |
| ADR-2 | 会话存储 JSONL 文件，**无 index.json** | SQLite / better-sqlite3 / 保留 index 缓存 | 避免原生模块；会话为追加写场景，JSONL 天然契合；与 v2 设计稿 lowdb 决策同源。**附注（论证修正）**：原「单进程无并发写竞争」不成立——单线程只保证无并行指令交错，共享单文件 index.json 的 async 读-改-写在 await 点交错下产生 lost-update；故删除 index，`list()` 扫目录读首行 meta（O(N) 单行读取对百级会话无性能问题），从根上消灭共享可变状态 |
| ADR-3 | core 宿主无关，插件内嵌 HTTP/WS 服务 | 独立后端进程 / sidecar | 无 Python 依赖、单进程部署、VS Code 即开即用；代价是移动端依赖 VS Code 在线，可接受 |
| ADR-4 | 传输层抽象（postMessage + WS 双实现，同一 protocol） | webview 与移动端各定义协议 | 消息定义单真源，两类客户端行为一致；BroadcastHub 使多端同步免费获得 |
| ADR-5 | 全部 YAML 用 `yaml` 库解析 | 手写真则解析 | v2 ThemeStudio 的 `\s` 烹饪 bug 实证手写解析不可靠（主题系统本身已随 ADR-20 移出范围，教训保留给 persona YAML） |
| ADR-6 | 配置用 `settings.json` 贡献点，注入 core 唯一引用 | 沿用 server.yaml | VS Code 原生配置体验（UI、作用域、校验）；单引用修复 v2 热更新失效 |
| ADR-7 | 配对 token 强制校验 + 设备白名单 | 沿用 v2 无鉴权 | v2 局域网裸奔可远程执行 CLI，是不可接受的安全漏洞 |
| ADR-8 | 移动端 UI 从零构建，共享 protocol 与 client-core | 迁移 v2 移动端代码 | v2 移动端与桌面布局耦合深；从零构建可按移动优先设计 |
| ADR-9 | pnpm workspaces，不引 Turborepo | Turborepo / nx | 四个包构建依赖简单（protocol→core→extension），pnpm 拓扑构建已够，KISS |
| ADR-10 | 不迁移 v2 会话数据 | 写 SQLite→JSONL 迁移器 | 本地开发工具无生产数据，迁移成本大于价值 |
| ADR-11 | 断连追赶：per-session `seq` + BroadcastHub 环形缓冲 + sync 请求-响应 | 全量事件日志 / 不补拉 | 手机锁屏断连是常态；环形缓冲（500 条/会话）覆盖离席时长且内存可控，溢出时快照 + JSONL event 行兜底；不改动在线扇出路径 |
| ADR-12 | 角色语气 = **rewriter 输出后处理为默认通道**（只改写角色通道文本，不碰 agent 输入与实质回复）；prompt-prefix 注入为可选增强（`injectIntoAgent`，默认关） | prompt-prefix 注入为默认 / 沿用 v2 `injectSystemPrompt` 空钩子 | 用户决策（2026-07）：rewriter 不污染 agent 输入、不改变 agent 行为，且对 5 个 CLI 无条件成立；注入路线经 plan-mode 前缀验证可行但会占 prompt 长度并轻微改变 agent 行为，故降级为可选。v2 的 `injectSystemPrompt` 空钩子已证实为死代码，不重演 |
| ADR-13 | Supervisor 默认 `template` 模式；`agent_session`/`deepseek_api` 为进阶可选，key 走 SecretStorage | 沿用 v2 默认 deepseek_api | 默认零外部依赖、离线可用，与 MVP 定位一致；LLM 模式有成本（R-8）且需凭据管理，不应成为开箱默认 |
| ADR-14 | 桌面会话列表载体 = sidebar webview 富列表 + 活动栏 badge + StatusBar | VS Code TreeView | QQ 式列表需要 persona 头像、状态点、未读角标、一行汇报摘要等富渲染，TreeView 表达能力不足；「面板被盖住仍可见」的需求由活动栏 badge + StatusBar 承接（与列表共用 digest 数据源），webview-inventory 的悬置表述以此裁决 |
| ADR-15 | pair token 放 URL fragment；资产/API 鉴权用 `?token=` query | query 配对码 / cookie / Authorization header | fragment 不进浏览器历史与日志；`<img>`/XHR 无法带 header，query 是资产加载唯一可行通道；cookie 方案引入第二套凭证，KISS |
| ADR-16 | Live2D 触摸反应纯前端（`touch_zones` 随 persona 配置下发，本地选句） | 新增 C→S `touch_trigger` 消息经 core 路由 | Live2DViewer 本就持有 companion 配置，本地实现零协议成本；core 不实现 `get_touch_reaction` 等价物（`extract/persona.md` §7 缺陷 10 的「补全或删除」以此裁决为「前端补全」） |
| ADR-17 | 协议删除 `live2d_action` / `sticker_send`；全局消息用 `payload.scope="global"` 替代 `session_id="global"` 魔法字符串 | 保留双通道 / 保留魔法字符串 | 两者 v2 均无生产者/消费者；scope 字段免除前端特判重映射；协议 v1 冻结前清理无人消费的类型 |
| ADR-18 | 共享逻辑收敛到 `@dionysus/client-core` 包 | mobile 源码相对路径引用 webview 内部目录 | messageRouter/stores 决定两端行为一致性，只允许单份实现；跨包源码引用绕过包边界，构建拓扑与 import-boundary 均需开特例 |
| ADR-19 | CLI 版本适配 = 检测 + 展示 + 警告，**不做自动修复**（附 P1 手动格式探针诊断） | 扫描 CLI 输出自动更新解析配对 | 用户决策（2026-07）：解析规则是代码不是数据，格式变更只能改策略代码；「自动配对更新」无法可靠实现，诚实的边界是尽早发现不一致并显式警告 |
| ADR-20 | 桌面端移除调色/壁纸主题系统，跟随 VS Code 皮肤；移动端三态主题（柔和白/柔和黑/跟随系统） | 迁移 v2 ThemeManager + ThemeStudio | 用户决策（2026-07）：插件形态下客制化只保留角色展示与角色语气；VS Code 本身已有成熟的皮肤体系，自建调色是重复建设 |

## 11. 安全模型

- 默认不启动 lan-server；开启局域网必须显式 `dionysus.lan.enabled`（含配对命令的确认弹窗路径）；
- 移动端一切 HTTP/WS（配对端点除外）需有效设备 token；token 一次性、可撤销、持久化于插件 globalStorage；WS token 在 `upgrade` 前校验（§6.3）；
- **已知限制（威胁模型明示）**：LAN 模式为明文 HTTP，全部流量（含 device token、对话内容、代码片段）同网段可嗅探/重放——仅在可信网络开启，公共网络（公司/咖啡厅）建议关闭 `lan.enabled` 或走隧道；资产 URL 的 `?token=` 会出现在 URL 中，属已接受的局域网取舍（ADR-15）；device token 长期有效、不轮换，撤销为唯一回收手段；HTTPS/mTLS 列入后置候选（与 Bridge CLI 同列 backlog）；
- webview CSP：default-src 'none'，按需白名单（完整模板见 §7）；
- CLI 子进程 working_dir 限定为 workspace 内路径，设置项拒绝绝对路径外逃（`..` 归一化校验）；`/assets/*` 路径同款式校验防穿越；
- pairing 码与设备 token 均为 128-bit 随机，constant-time 比较；
- Supervisor 的 LLM API key 走 VS Code `SecretStorage`，禁止落 settings.json。

## 12. 测试策略

- `protocol`：schema 往返测试（合法/非法消息）；
- `core`：vitest；策略测试用录制的 stream-json fixture（v2 pytest 37 用例逐条翻译，清单见 `roadmap.md`；kimi fixture 须含 `tool_calls` 与 `role=tool` 行并断言产出结构化 `tool_call`/`tool_result` 事件）；FakeAdapter 测回合管线；进程生命周期用假 spawn。关键回归用例：
  - `session/parallel-sessions.test.ts`：两 FakeAdapter 会话并行 `runAgentTurn`，断言事件按 sessionId 归属、持久化互不污染、回合状态机隔离；
  - `adapters/interrupt-semantics.test.ts`：interrupt 后客户端恰好收到一条 `agent_complete(status='interrupted')`，无 error 级 complete（v2 双 complete + 伪错误回归）；
  - `session/jsonl-store.test.ts`：坏行容忍（末行截断跳过 + warning）、meta 原子重写、list 扫目录正确性；
  - **角色语气双防线**（rewriter 路线，ADR-12）：①rewriter 快照测试——固定 persona YAML + 固定输入文本，断言输出含 `voice.catchphrases`/`tone_rules` 特征且不含 `voice.taboos` 词句，输出与输入完全相同时测试失败（防「rewriter 静默原样返回」）；②可选注入增强开启时，FakeAdapter + 假 spawn 断言首轮 argv 的 prompt 文本确实包含 persona `system_prompt` 内容（防 v2「调用了但没生效」重演）；
- `client-core`：vitest + jsdom（messageRouter 全分支含 `scope:"global"` 路由、store、多端 FakeClient 的 `user_message_echo`/`option_resolved` 断言）；
- `extension`：@vscode/test-electron 跑宿主集成（激活、CLI 检测、webview 创建、命令、配对流程含过期 token 扫码被拒、`/assets/*` 路径穿越单测）；
- `webview`/`mobile`：vitest + jsdom（store、解析工具）；集成测试模拟「锁屏 60 秒 → 重连 → sync 补拉完整」；
- CI：typecheck + eslint + 单测 + `vsce package` 产物校验。

## 13. 风险登记册

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R-1 | Live2D（pixi v7）在 VS Code webview 的 CSP/worker/资产加载受限 | 高 | Phase 1 即做 spike：最小 webview 按 §7 CSP 模板加载模型 JSON/moc3/纹理/motion 渲染一帧成功后再继续 |
| R-2 | 五个 CLI 的 stream-json 格式随版本漂移 | 中 | 策略测试 fixture 录制自真实 CLI 版本；每个策略标注已验证的 CLI 版本 |
| R-3 | 移动端局域网可达性（防火墙、AP 隔离） | 中 | 配对弹层与移动端配对页给出故障排查指引；`lan.enabled` 默认关 |
| R-4 | 重写范围膨胀 | 中 | roadmap 阶段门禁：垂直切片先行，陪伴层/移动端按 Phase 解耦交付；移动端 P0/P1 分级（§8） |
| R-5 | extract 文档遗漏旧实现细节 | 中 | 提取文档以「能否据此独立实现」自评；实现阶段发现出入时回写修订 extract 文档 |
| R-6 | 宿主休眠导致移动端不可用（笔记本合盖/系统休眠挂起 VS Code 进程） | 低（预设场景外） | 用户已确认使用场景为「电脑保持唤醒、agent 持续工作，仅手机锁屏」（2026-07 决策）；仍保留防线：配对页与 README FAQ 提示「离开期间请保持电脑唤醒」，移动端重连失败 >3 次显示「电脑可能已休眠」横幅（§8） |
| R-7 | opencode 的 `--format json` 是否有 tool_result 行未经证实 | 中 | Phase 4 实现 opencode 策略时用真实 CLI 录制验证；若无工具结果行，UI 对该 CLI 降级为「只显示调用、不显示结果」（§4.1 矩阵） |
| R-8 | Supervisor LLM/CLI 模式成本（15s 轮询 × 每次变动一次调用；`agent_session` 烧 CLI 额度、`deepseek_api` 烧 API 额度） | 中 | 默认 `template` 零成本（ADR-13）；无客户端连接时不运行 LLM/CLI 生成（§5.4）；intervalSeconds 下限 5s 防误配 |
| R-9 | 多 CLI 子进程资源占用（N 会话并行 = N 进程；同一 CLI 多进程并发写 resume 存储的副作用未评估） | 中 | `dionysus.maxConcurrentAgents` 默认 3（§5.3）；Supervisor `agent_session` 模式的专用进程计入同一上限；整轮超时兜底在实现期按 CLI 实测补 |

## 14. 与 v2 设计稿（agent.final.md）的继承与推翻

继承：核心共享 + 双模式部署（§3）、适配器+策略分离（§5）、状态驱动协议（§4 原则）、ButlerEngine 分层思想（→ persona 层）、配置驱动注册表。

推翻：node-pty（→ADR-1）、lowdb（→ADR-2 JSONL，精神一致实现不同）、短代码消息类型 + msgpack（v2 实现已证全词 JSON 可读性价值，体积问题在局域网/进程内不成立）、「Extension 非 Electron」前提下的全部 Electron 淘汰论述（v2 实现走了 Electron，v3 又离开 Electron，殊途同归于插件形态）。
