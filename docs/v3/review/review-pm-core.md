# Dionysus v3 设计审阅报告 — 产品经理视角：核心功能闭环

> 审阅人立场：产品经理，只看「核心功能是否闭环」。
> 审阅对象：`docs/v3/architecture.md`、`docs/v3/roadmap.md`、`docs/v3/README.md`，以及 `docs/v3/extract/` 下 protocol / persona / session / pairing-mobile / webview-inventory / design-style 六份规格。
> 验收基准（核心功能定义）：
> ① 仿 QQ 的 agent 对话与管理；② Live2D 陪伴与角色语气注入；③ 有角色陪伴的多 agent 进度汇报与调度汇报（角色单向输出）；④ 明显的 agent 操作显示（读文件/改代码/跑命令显著可见）；⑤ 移动端离开电脑时收汇报、发短指令、随时看清进展。

---

## 发现清单（按严重度排序）

### F-01【阻断｜功能①】多会话并行运行与「全局会话状态」模型整体缺失

- **出处**：`architecture.md` §4.1（消息信封）、§5.3（会话层）、§9.1（数据流）；`roadmap.md` Phase 2–5 验收标准。
- **问题描述**：
  现有设计在机制上「碰巧可能并行」（信封有 `sessionId`、每会话独立 adapter、`BroadcastHub` 全量广播），但**产品层面没有任何一处把「多个 agent 同时干活、用户像刷 QQ 一样切换查看」当作设计目标写出来**：
  1. `SessionManager` 的职责清单（§5.3）只有 CRUD、适配器生命周期、回合编排，**没有声明并发语义**——两个会话同时 `runAgentTurn` 是否允许、是否互相阻塞、回合状态机是否会话级隔离，均无定义；
  2. 协议消息清单（§4.1）没有任何「会话摘要/会话列表状态」类消息。客户端想渲染 QQ 式会话列表（每个会话显示：运行中⏳ / 待用户选择❗ / 完成✅ / 出错❌ / 有未读），只能自己订阅全部会话的原始事件流逐条推断——这个推断逻辑（`option_request` 挂起算「待处理」、收到 `agent_stream` 算「有未读」等）没有任何文档定义，webview 与 mobile 两端必然各写各的、行为漂移；
  3. roadmap 六个 Phase 的验收全部是单会话口径（「完成一轮真实 kimi 对话」「5 个 CLI 各完成一轮真实对话」），**没有任何「两个会话并行跑 turn、切换查看互不干扰」的验收门禁**——意味着按当前计划开发完，功能①可以合法地不存在。
- **修改建议**（可直接执行）：
  1. `architecture.md` §5.3 增加一段并发语义：「SessionManager 支持任意数量会话并发执行 `runAgentTurn`；回合状态、CompanionEngine/TodoTracker 实例、adapter 进程均以 sessionId 为键隔离；`interrupt` 只作用于指定 sessionId 的当前回合」；
  2. `architecture.md` §4.1 消息清单新增 `session_digest_update`（S→C，广播）：payload `{ sessionId, title, status: idle|running|waiting_option|error, pendingOptionRequest: boolean, lastActivityAt: number, seq: number }`，由 core 在会话状态每次跃迁时发出，`seq` 为单调递增序号供客户端算未读；
  3. `roadmap.md` Phase 3 验收追加：「两个会话各自发起 turn 并行执行，webview 会话列表实时显示两边状态，切换查看互不干扰、打断互不影响」；Phase 5 验收追加移动端同场景。

### F-02【高｜功能③】CompanionSupervisor 规格回退：「回合后回放」丢掉了周期轮询、fleet 聚合与变动检测，多 agent 调度汇报失去载体

- **出处**：`architecture.md` §5.1（`supervisor.ts # CompanionSupervisor：回合后回放`）、§9.1（`CompanionSupervisor.onTurnEnd`）；对照 `extract/persona.md` §4（Supervisor 是 15 秒周期轮询全部会话的后台播报员，含 `_compute_fleet_state` fleet 统计、`_detect_changes` 变动检测、「安静期不刷屏」跳过机制）。
- **问题描述**：
  v2 的 Supervisor 恰恰是功能③「调度汇报」的核心载体——它周期扫描**全部**会话，聚合 fleet 状态（N 个工作/M 个出错），检测会话创建/关闭/状态跃迁，用角色语气播报。而 v3 文档把它的职责压缩成「回合后回放」，数据流里只剩 `onTurnEnd` 一个钩子。后果：
  1. **长回合中途的进度汇报消失**——agent 干活 10 分钟，角色只在结束时说一句话，用户吃饭回来前手机上没有任何「还在干/干到哪了」的播报；
  2. **跨会话调度汇报消失**——「会话 A 已完成、会话 B 还在跑」这类 fleet 级汇报没有触发点；
  3. 配置面也随之塌陷：`settings.json`（§6.5）只有 `dionysus.supervisor.enabled` 一个布尔，轮询间隔、播报模式均无落点。
  另注：若「回合后回放」是有意的重设计而非笔误，则更需要文档说明多会话进度汇报由什么机制替代——目前没有任何替代者。
- **修改建议**：
  1. `architecture.md` §5.1 将该行改回按 `extract/persona.md` §4 的完整语义：「`supervisor.ts` # CompanionSupervisor：周期轮询（默认 15s、最小 5s）全部会话，fleet 聚合 + 变动检测 + 安静期跳过，用目标会话 persona 的语气播报；回合结束另触发一次即时播报」；
  2. §9.1 数据流补一条 Supervisor tick 链路：`_tick → 快照对比 → 有变动或有 working 会话 → 生成台词 → broadcast(companion_message + emotion_update)`；
  3. §6.5 配置补 `dionysus.supervisor.intervalSeconds: 15`、`dionysus.supervisor.mode: "builtin" | "agent_session"`。

### F-03【高｜功能①④⑤】「一眼得知电脑干活如何」的全局信息架构缺层：桌面端无常驻状态面，移动端首页不是会话状态列表

- **出处**：`architecture.md` §6.5（命令与配置贡献点）、§7（webview 包）、§8（mobile 包）；`extract/pairing-mobile.md` §4.3（v3 移动端基线含「会话列表↔聊天两视图」）。
- **问题描述**：
  功能①③④⑤汇合为一个 IA 问题：**用户不打开聊天面板时，靠什么一眼看到全局进展？** 当前设计里：
  1. 桌面端：VS Code 插件天然提供的状态面（活动栏 badge、TreeView 节点图标、StatusBarItem）一个都没用。§6.5 只注册了 7 个命令，没有 TreeDataProvider、没有 StatusBar 贡献。webview 面板一旦被编辑器盖住，所有「显著可见」的 tool_call 卡片都不可见；
  2. 移动端：§8 的功能基线只列了「会话聊天、陪伴视图、状态展示」，**漏掉了会话列表**——而 `extract/pairing-mobile.md` §4.3 明确把「会话列表↔聊天两视图切换」列为 v3 基线第一条。离开电脑场景下，用户打开手机要看的第一屏就应该是「哪些 agent 在跑、哪个要我决策」，而不是某个单一聊天页。两份文档互相矛盾。
- **修改建议**：
  1. §6 增加 `sessions-tree.ts`：VS Code TreeView 会话列表，节点图标映射会话状态（running=转圈 / waiting_option=❗ / error=❌ / idle=💤），节点 description 显示最新一行进展（最近 `status_update.detail` 或角色最新播报），待处理会话在活动栏图标上累计 badge 计数；
  2. §6 增加 StatusBarItem：聚合显示「⏳2 运行中 ❗1 待决策」，点击打开会话树；
  3. §8 mobile 功能基线第一条改为「会话列表首页（实时状态 + 未读 + 待决策标记）↔ 会话详情两视图」，与 `extract/pairing-mobile.md` §4.3 对齐。

### F-04【高｜功能④】`tool_call` / `tool_result` 只有消息名，没有字段级 schema，「操作显著可见」无法实现到可验收

- **出处**：`architecture.md` §4.1（仅一句「新增结构化 `tool_call` / `tool_result` 消息」）；`extract/protocol.md` §9.4（同样只提方向）；`extract/webview-inventory.md` §2.7（ToolPanel/ToolHUD「可直接迁移」）。
- **问题描述**：
  方向完全正确（取代 v2 的 emoji 正则刮文本），但 protocol 文档对其他所有消息都做到了逐字段定义，唯独这两个 v3 新增消息没有任何 payload 字段。功能④要求「读文件/改代码/跑命令**显著可见**」，这要求 payload 至少承载：工具名、操作类别（read/edit/bash…）、操作对象（文件路径/命令行）、执行状态与耗时——这些字段不定，适配器策略（5 个 CLI 的 stream-json 行映射）就没有产出目标，UI 卡片也没有渲染契约，Phase 2/4 的验收无法判断「操作显示」达标与否。这是协议层唯一的新增承诺，却恰好是唯一没写规格的部分。
- **修改建议**（在 `architecture.md` §4.1 或 `extract/protocol.md` 增补）：

  ```ts
  tool_call:  { callId: string, toolName: string,
                kind: "read" | "edit" | "write" | "bash" | "search" | "other",
                target: string,          // 文件路径或命令行摘要，截断 200 字符
                argsDigest?: string }
  tool_result:{ callId: string, status: "success" | "error",
                summary: string,         // 一行结果摘要
                durationMs?: number }
  ```

  并规定：UI 按 `kind` 渲染图标与配色（📖 read / ✏️ edit / ⚡ bash），移动端聊天流内联同样的工具卡；`extract/adapters.md` 各策略的行映射表补「哪些行产出 tool_call/tool_result」一列。

### F-05【中｜功能③】persona YAML schema 没有 fleet 聚合/调度汇报台词字段，「全部 YAML 驱动」的承诺在 Scheduler/Supervisor 上无法兑现

- **出处**：`architecture.md` §5.4（「台词模板…全部 YAML 驱动」「消灭角色硬编码」）；`extract/persona.md` §1.2（YAML schema 无聚合台词键）、§3.3（Scheduler 聚合文案硬编码）、§7.3（v3 应「聚合文案进配置」）。
- **问题描述**：
  v2 的 Scheduler 聚合文案（「还有任务在进行中」「所有任务都完成啦」）和 Supervisor 内置播报模板都是硬编码中文，`extract/persona.md` §7.3/§7.4 明确要求下沉配置。但现有 persona YAML schema（§1.2 全字段表）里**没有对应的键**——`companion_templates` 只有 4 个回合级键、`status_phrases` 只有 7 个状态键。v3 文档说「全部 YAML 驱动」却没有定义新 schema，实现者要么自己发明键名（每个 persona 文件各写各的），要么静默回退到硬编码——缺陷原样复活。
- **修改建议**：
  1. 在 persona YAML schema 增加 `fleet_lines: { working, all_success, all_error, partial_error, idle }`（每键 list[str]）与 `supervisor_lines: { working, error, changed, idle }`；
  2. `architecture.md` §5.4 补一句：「fleet 聚合文案与 supervisor 播报模板读取上述键，内置 default persona 提供与角色无关的中性文案，loader zod 校验缺键时回退 default persona 而非代码字面量」；
  3. `assets/personas/exusiai.yaml`、`kal'tsit.yaml` 各补全套键（凯尔希克制口吻、能天使活泼口吻），取代 v2 `_with_persona` 的 kal'tsit 特判。

### F-06【中｜功能②③】Supervisor 的两个 v2 已证实缺陷在 v3 文档中没有被点名修复，LLM 播报模式无配置落点

- **出处**：`extract/persona.md` §7.7（播报恒用 working 情绪——报错/完成播报也挂「工作中」表情）、§4.1/§4.3（deepseek_api 模式需 api_url/api_model/api_key 配置）；`architecture.md` §6.5（settings 中只有 `supervisor.enabled`）、`roadmap.md` 附录 B（范围外清单未列 LLM 播报）。
- **问题描述**：
  1. 「播报情绪恒为 working」是 extract 明确记录的缺陷，v3 只有 §5 一句「修复其中记录的全部结构性缺陷」总括，而 persona 层条目（§5.4）逐条点了其他缺陷（反射注入、路径固化、角色硬编码）却漏了这条——按文档自评标准（「能否据此独立实现」），实现者没有依据知道要按播报语义映射情绪；
  2. v2 Supervisor 三级台词生成里的 `deepseek_api` 模式（角色语气质量最高的路径）在 v3 没有任何配置项承载，范围外清单也没把它列出去——处于「既没做也没说不做」的悬空态。
- **修改建议**：
  1. §5.4 增补：「Supervisor 播报的 emotion/expression/motion 按播报语义（working/error/success/changed）经 persona 的 status_to_emotion 链解析，不再固定 working」；
  2. 显式决策 LLM 播报：要么 §6.5 增加 `dionysus.supervisor.llm.*` 配置组（apiUrl/model/key 经 SecretStorage），要么在 `roadmap.md` 附录 B 写明「LLM 播报模式（v2 deepseek_api）v3.0 范围外，仅保留 builtin 模板 + agent_session 两档」。

### F-07【中｜功能②】多会话各自绑定 persona 时，「当前角色是谁」没有定义

- **出处**：`extract/session.md` §1.1（Session.persona_id 每会话独立）；`architecture.md` §7（Live2DViewer 单实例）、§6.5（`dionysus.persona.default`）；`extract/protocol.md` §2（`session_id="global"` 全局消息的 persona 归属）。
- **问题描述**：
  功能①（多会话）×功能②（角色陪伴）叠加出的新问题：会话 A 绑能天使、会话 B 绑凯尔希，屏幕上只有一个 Live2D。切换会话时模型/台词/情绪映射是否整体切换？Supervisor 的 fleet 播报用谁的形象和口吻？`session_id="global"` 的消息（v3 沿用此机制，§4.1 保留了 global 语义没有显式说明）归属哪个 persona？全部未定义。v2 靠「 Supervisor 选目标会话的 persona」隐含处理，v3 重设计后这个规则没有被继承写下来。
- **修改建议**：
  1. `architecture.md` §7 补一条陪伴归属规则：「Live2D/台词/情绪映射跟随当前聚焦会话的 persona_id，切换会话时切换 persona（模型切换带加载态与静态立绘兜底）；无聚焦会话或 fleet 级播报（sessionId=global）使用 `dionysus.persona.default`」；
  2. §4.1 保留 `sessionId: "global"` 约定并写明其 persona 解析规则，移动端陪伴视图同样遵守。

### F-08【中｜功能⑤】移动端「离开期间」的进展没有补发机制：WS 断开/浏览器后台挂起后，回来只能看到「现在」，看不到「期间」

- **出处**：`architecture.md` §8（mobile 包）、§9.2（配对链路）；`extract/pairing-mobile.md` §4.3（基线第 5 条仅「断线重连自动带 token」）。
- **问题描述**：
  功能⑤的典型时序是：用户离开电脑 30 分钟（手机锁屏或切走浏览器）→ 回来想知道「这 30 分钟干成什么了」。手机浏览器在后台/锁屏时 WS 会被挂起或断开，重连后当前设计只有实时广播，**没有任何 catch-up**：错过的 `companion_message` 播报、`agent_complete`、`option_request`（agent 在等用户决策！）全部丢失。尤其是「待决策」状态——用户在手机上最该被拦住的就是这个，而目前连协议层都无法表达「这个会话有一个还没答的 option_request」（见 F-01 的 digest 消息）。
- **修改建议**：
  1. 依赖 F-01 的 `session_digest_update`：WS 重连握手后由 core 主动推送**全量会话 digest 快照**（`handshake` 后紧跟 N 条），移动端据此渲染首页；
  2. `handshake` payload 或独立 `catch_up` 消息携带每会话「最近一条 companion_message 与最近一次 agent_complete 的摘要」，供移动端展示「离开期间」时间线（完整事件回放 v3.0 可不做，写进范围外）；
  3. `architecture.md` §8 明示限制：「手机浏览器需页面存活才能收到实时播报；OS 级推送（Web Push / 通知）列入范围外清单」，避免验收时按「锁屏也能收到」判定。

### F-09【低｜功能④】TodoTracker 的数据源是否切换为结构化 tool_call 事件，文档未交代

- **出处**：`extract/persona.md` §7.12（「v3：从结构化的工具调用事件提取 todo」）；`architecture.md` §5.1（`todo-tracker.ts` 仅列文件名）。
- **问题描述**：v2 TodoTracker 靠 emoji 正则扫流式文本（与 tool_call 同源的脆弱点），extract 已要求 v3 改从结构化事件提取，但 v3 文档只列了文件名，没说输入从「流式 chunk」换成「tool_call/tool_result 事件」。实现者可能照 `extract/persona.md` §5 的 v2 行为原样重写，把缺陷带回来。
- **修改建议**：`architecture.md` §5.1 该行改为「`todo-tracker.ts` # 从结构化 tool_call/tool_result 事件提取 todo（不再扫文本）」。

### F-10【低｜功能①】会话标题「新会话」永不更新的 v2 缺陷未被 v3 认领

- **出处**：`extract/session.md` §7.9（title 创建后固定「新会话」）；`architecture.md` §5.3（SessionStore 无 updateTitle 或标题生成策略）；`roadmap.md`（无相关任务）。
- **问题描述**：QQ 式会话列表里，无法区分的标题直接破坏功能①的可用性（5 个「新会话」并排）。extract 记录了这个缺陷，v3 修复清单（§5.3 列了 N+1、双管线等）没有包含它。
- **修改建议**：§5.3 补一条：「首个回合完成后，以首条用户消息截断 20 字符自动更新 `Session.title`（用户手动重命名后不再自动覆盖）」；`SessionStore` 接口相应确认 `updateTitle` 或并入通用 update。

---

## 无欠缺项（明确确认，不凑数）

- **角色单向输出（功能③的交互方向）**：协议中 companion_message / emotion_update / live2d_action 均为 S→C，无任何 C→S 的角色输入通道；用户向角色输入的入口不存在，与「角色单向输出」的产品定义一致。**无欠缺。**
- **多端一致的广播底座**：`BroadcastHub` 全量广播 + 「客户端断开只注销自己、绝不触碰适配器进程」（§5.3，修复 v2 多标签误杀共享进程）为「电脑干着活、手机随时接入看」提供了正确的机制基础。**无欠缺。**
- **tool_call 结构化的方向**：用结构化消息取代 v2 前端 emoji 正则刮文本，是正确的修复方向；ToolPanel/ToolHUD 组件被盘点为「可直接迁移」，UI 载体存在。缺的只是字段级定义（见 F-04），方向本身**无欠缺。**
- **移动端发短指令的通道**：mobile 与 webview 共用 protocol，`user_input` / `interrupt` / `option_selected` 天然可用，配对链路相对 v2 的断裂有完整修复（§9.2）。「传递短指令」本身**无欠缺**，缺口只在「离开期间的进展补发」（F-08）。

---

## 总评

**结论：这套设计是一份优秀的「单会话工程重写方案」，但还不是一个「多 agent 陪伴产品方案」。** 架构层（宿主无关 core、传输抽象、协议版本化、配对安全闭环）质量很高，v2 的结构性缺陷几乎都被准确识别并给出修复路径；但按核心功能验收基准衡量，设计重心明显偏向「把一个 CLI 会话端到端做对」，而产品的差异化所在——多 agent 并行、角色调度汇报、全局进度感知——在协议、配置、数据流、验收门禁四个层面同时缺位。

最大的三个缺口：

1. **多会话一等公民地位的缺失（F-01、F-03、F-10）**：没有会话级并发语义声明、没有 `session_digest_update` 这类全局状态消息、没有 QQ 式列表所需的未读/待决策模型，roadmap 验收也全是单会话口径。功能①按当前文档开发完可以合法地不存在，这是阻断级缺口。
2. **调度汇报机制的规格回退（F-02、F-05、F-06）**：Supervisor 从「周期轮询全 fleet 的播报员」被缩写成「回合后回放」，长任务中途汇报与跨会话调度汇报失去载体；即便恢复该机制，persona YAML 也没有 fleet 台词的 schema 落点。功能③是产品差异化核心，目前只活在 extract 文档里，没活进 v3 设计。
3. **「一眼知进展」的全局信息架构缺层（F-03、F-04、F-08）**：桌面端没有用 VS Code 的 TreeView/StatusBar/badge 做任何常驻状态面，移动端首页基线漏掉会话列表，重连后无 catch-up。功能④的 tool_call 方向正确但无字段契约。三块拼起来——功能①③④⑤共同承诺的「随时一眼得知电脑干活如何」——目前没有完整的信息通路。

好消息是三者都不动摇架构底座：补一类 digest 消息、恢复 Supervisor 完整语义、加两个 VS Code 贡献点，均可在现有 monorepo 与协议框架内增量完成。建议在进入 Phase 1 前先补 `architecture.md` §4/§5/§6/§8 与 `roadmap.md` 验收门禁的上述修订。
