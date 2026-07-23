# Dionysus v3 设计审阅 — Live2D 陪伴与角色语气注入专项

> 审阅范围：`docs/v3/architecture.md`、`docs/v3/roadmap.md`、`docs/v3/README.md`，对照 `docs/v3/extract/`（重点：persona.md、session.md、adapters.md、protocol.md、webview-inventory.md）。
> 审阅视角：角色语气注入完整链路、多 agent 场景的角色汇报策略、汇报单向通道的 UI 呈现、persona YAML 字段对语气模板的驱动。
> 核心功能编号：①QQ 式 agent 对话管理 ②Live2D 陪伴与角色语气注入 ③多 agent 进度/调度汇报（角色单向输出）④agent 操作显著可见 ⑤移动端离席汇报。

---

## 发现清单（按严重度排序）

### F-1【阻断 · 功能②】角色语气注入链路只有接口签名、没有实现语义，`injectSystemPrompt?` 原样继承了 v2 的空钩子形态

- **出处**：`architecture.md` §5.2（`IAgentAdapter.injectSystemPrompt?`）、§5.3（`session.systemPromptInjected` 显式标志）；对照 `extract/adapters.md` §1.1 与 §7.7（v2 中该方法基类为空实现、`GenericCLIAdapter` 未覆写，persona system prompt 从未到达任何 CLI）、`extract/session.md` §4（首轮判断 bug 导致几乎从不触发）。
- **问题**：v3 修复了"触发时机"（显式标志位替代 messages 判空），但没有修复"注入动作本身"——五个 CLI 策略各自如何实现 `injectSystemPrompt`？kimi/claude/codex/opencode/codebuddy 的命令行里哪一个支持系统提示参数？extract 文档给出的事实是：v2 里该调用对全部 5 个 CLI 都是 no-op。v3 架构文档既未指定注入点归属（adapter 层还是 session 层），也未给出任何一条可落地的注入机制（如 session 层把 persona prompt 拼进首条用户输入——plan-mode 前缀注入已被证实是可行通道，见 `extract/adapters.md` §5），更未设计"CLI 不支持系统提示时降级为输出后处理（台词改写）"的路径。照此实现，最可能的结局是 TS 版再次写出五个空方法，语气注入第二次沦为死代码，而验收时无从察觉（接口存在、标志位置位、无任何可见效果）。
- **修改建议**（可直接执行）：
  1. 在 `architecture.md` §5.2 的 `CliAdapterStrategy` 类级元数据上增加 `readonly supportsSystemPrompt: 'native' | 'prompt-prefix' | 'none'`（与 `supportsModel` 并列的静态声明），逐 CLI 给出结论性赋值——需要实现前核实各 CLI 现行参数，无法核实的保守标 `'prompt-prefix'`。
  2. 明确注入点**默认在 session 层**：`SessionManager.runAgentTurn` 在 `systemPromptInjected === false` 时，按策略元数据执行——`'native'` 调 `adapter.injectSystemPrompt`；`'prompt-prefix'` 把 `persona.system_prompt` 以与 plan-mode 前缀相同的方式拼进首轮 `AgentInput.text`；`'none'` 走 F-2 的输出后处理。adapter 层的 `injectSystemPrompt?` 仅保留给真正有原生通道的策略。
  3. 在 §12 测试策略中增加一条强制验收：FakeAdapter + 真实 persona YAML 跑首轮，断言发给 adapter 的文本/注入调用中确实包含 persona 语气内容（防止再次出现"调用了但没生效"）。
  4. 在 roadmap Phase 4 验收标准中补一条：「切换 persona 后首轮 agent 回复可观测到语气差异，或日志可证注入文本已送达 CLI」。

### F-2【阻断 · 功能②③】`supportsSystemPrompt: 'none'` 时的降级路径（输出后处理/台词改写）完全未设计，Supervisor 的 v3 形态也未定义——而这两者正是"角色语气汇报"的主力通道

- **出处**：`architecture.md` §5.4（persona 层仅一句"行为规格按 extract/persona.md"）、§6.5（settings 里只有 `dionysus.supervisor.enabled: true` 一个布尔）；对照 `extract/persona.md` §4（Supervisor 三模式：`disabled | agent_session | deepseek_api`，LLM 模式以 persona `system_prompt` 为基底生成播报）与 §7 缺陷 5、7。
- **问题**：两层缺失叠加。
  1. **输出后处理降级**：审阅基准要求"对不支持系统提示的 CLI 降级为输出后处理（台词改写）"，architecture 全文没有"改写/后处理"任何字样。若 F-1 的注入对某些 CLI 不可行，角色的"语气"在这些 CLI 上就只剩模板台词（`companion_templates`/`status_phrases` 的固定句池），agent 正文输出与角色完全无关——差异化体验腰斩。
  2. **Supervisor 形态**：v2 的 Supervisor 是周期播报员，有三种 mode；LLM 模式（deepseek_api）需要 `api_url/api_model/api_key` 配置与出网 HTTP。v3 的 settings 只有一个 `enabled` 布尔——那么开启后跑的到底是哪个 mode？`agent_session` 模式的专用 adapter（v3 已正确改为 `adapterFactory` 注入，§5.4）用哪个 CLI、成本谁承担？`deepseek_api` 模式的 key 存哪里（settings.json 明文？VS Code SecretStorage？）？这些全无着落。而 Supervisor 恰恰是功能③（多 agent 调度汇报）和功能⑤（用户离开电脑后手机收到干活汇报）的核心机制——没有周期播报，移动端只能看到用户自己发起的会话流，"随时得知进展"要靠手动刷新。
- **修改建议**：
  1. 在 `architecture.md` §5.4 增加 `persona/rewriter.ts`（输出后处理模块）的设计：输入为回合结束后的 agent 正文（或 Supervisor 播报草稿），输出为角色口吻改写文本；明确其触发点为「`supportsSystemPrompt === 'none'` 的策略」与「Supervisor 播报生成」两处。首版可用模板拼装（persona YAML 的 `tone_rules` 前缀/后缀 + 关键词替换）实现零 LLM 依赖的降级，LLM 改写列为可选增强。
  2. 在 §6.5 settings 中把 supervisor 配置展开为完整 schema：`dionysus.supervisor.mode`（`disabled | agent_session | llm_api`）、`dionysus.supervisor.intervalSeconds`（默认 15、下限 5）、`dionysus.supervisor.adapterId`、`dionysus.supervisor.llm.{baseUrl,model}`；API key 明确走 VS Code `SecretStorage`（`context.secrets.store('dionysus.supervisor.apiKey')`），不进 settings.json。
  3. 明确 v3.0 默认 mode 为 `agent_session` 或纯模板内置模式（二选一写明），LLM API 模式允许首版不实现但 schema 预留；把该决策记入 ADR 表。
  4. 修复 extract 缺陷 #7 要在 §5.4 点名：Supervisor 播报的情绪 cue 按播报语义（working/success/error）映射，不再恒用 `"working"`。

### F-3【高 · 功能③】多 agent 同时有进展时，角色汇报的聚合/排队/插播策略没有设计；聚合文案要"下沉 YAML"但 YAML schema 里根本没有这些字段的位置

- **出处**：`architecture.md` §5.4（"消灭角色硬编码：v2 中能天使台词默认值……全部下沉到 persona YAML"）；对照 `extract/persona.md` §3（Scheduler 聚合逻辑：4 桶归一化、优先级文案、idle 去抖、文案与 cue 全硬编码）与 §7 缺陷 3。
- **问题**：
  1. **schema 缺口**：extract 缺陷 #3 要求"聚合文案进配置，cue 走 persona 的表情映射"，但 `extract/persona.md` §1.2 的 persona YAML 全字段表中没有 scheduler/supervisor 相关段。v3 文档只说"下沉"，没说下沉成什么结构——实现者届时只能自行发明字段，两份文档对不上，R-5/R-6 的文档回写机制也救不了"从一开始就无据可依"。
  2. **并发汇报策略空白**：多个会话同时工作时，回合内 CompanionEngine（每会话一个）、跨会话 Scheduler、周期 Supervisor 三个声源会同时向 BroadcastHub 发 `companion_message`。v2 的事实是：Scheduler 每回合开始/结束各触发一次（`extract/persona.md` §3.2）、Supervisor 每 15 秒最多一条、engine 有 5 秒冷却——三条通道各自为政，无统一队列、无优先级、无插播规则。v3 架构对"多 agent 并行时角色按什么策略聚合/排队/插播"零着墨。直接后果：N 个 agent 并行时角色台词刷屏（每个会话的 work_start/success/error 各来一条），或全局聚合句与会话级台词互相矛盾（全局说"全部完成"时某会话刚报错）。
- **修改建议**：
  1. 在 `extract/persona.md` §1.2 schema 表中增补 `scheduler_templates`（键：`no_session / any_working / all_success / all_error / partial_error_single / partial_error_multi / all_idle`，对应 v2 硬编码的 7 条聚合文案）与 `supervisor_templates`（键：`working / error / changed / idle`）两段，逐键回退中立默认；同步在 `architecture.md` §5.4 引用该结构。
  2. 在 `architecture.md` §5.4 增加一段"汇报仲裁"设计：三声源统一进 `CompanionScheduler` 的一个出队口，规则写明——(a) 每客户端可见台词最小间隔（如 3 秒）；(b) 优先级：error/打断插播 > 回合完成 > Supervisor 周期播报 > 状态短语；(c) 同 tick 多条候选合并为一条聚合句（走 `scheduler_templates`）；(d) Supervisor 播报若与近 N 秒内的会话级台词语义重复则跳过本轮。以 v2 已有的去抖（`previous == aggregate == IDLE` 跳过）为基线扩展即可，不需要新机制。
  3. roadmap Phase 4 验收补一条：「两个会话并行跑 agent，观察 60 秒内角色台词：无同义重复、error 优先插播、全局聚合句与各会话状态一致」。

### F-4【高 · 功能②】persona YAML schema 的修订决策整体缺席：v2 死字段去留、runtime/builtin 合并语义、语气模板由哪些字段驱动——v3 文档均未裁决

- **出处**：`architecture.md` §5.4（仅列 loader/引擎/硬编码下沉/adapterFactory 四点）；对照 `extract/persona.md` §1.2（`keyword_replacements`、`random_insertions`、整个 `emotion_mapping`、`corpus_file` 值、`preferred_theme`、`theme_override` 六个字段"声明了但无人读取"）、§1.3（runtime kal'tsit.yaml 整文件屏蔽 builtin 完整版，导致凯尔希说能天使台词）、§7 缺陷 8、9。
- **问题**：审阅基准④问"语气注入 prompt 模板该由 persona YAML 的哪些字段驱动"，而 v3 文档的答案目前不存在：
  - `system_prompt` 是唯一明确的注入源（v2 用于 adapter 注入和 Supervisor LLM 基底），但 v3 未写明它是否仍是唯一来源、是否支持模板变量（v2 注入了 `context_vars={"session_id": ...}` 但 persona YAML 里没有占位符约定）；
  - `tone_rules` 下两个死字段（`keyword_replacements`/`random_insertions`）恰是输出后处理改写（F-2）最自然的配置载体——若 F-2 的改写器被采纳，这两个字段应"复活"并被读取；若不采纳则应从 schema 删除。当前两头都没定；
  - runtime/builtin 整文件覆盖的缺陷（extract #9）v3 未提对策，Phase 1 还要把旧 personas 目录平移到 `assets/personas/`——有把整个降级 bug 原样搬进 v3 的风险。
- **修改建议**：
  1. 在 `architecture.md` §5.4 增加"persona YAML v3 schema 变更表"，逐字段给出去留：`keyword_replacements`/`random_insertions` → 由 `rewriter` 实现读取（配合 F-2）或删除；`emotion_mapping` → 与 `companion.live2d.expressions` 语义重叠，删除，表情映射只留 live2d 一处；`corpus_file`/`preferred_theme`/`theme_override` → v3.0 删除（范围外清单登记）。
  2. 明确 `system_prompt` 的模板语义：支持 `{session_id}` / `{working_dir}` 占位符，loader 层 zod 校验时检查占位符合法性；语气风格描述统一收敛到 `system_prompt`，`tone_rules` 只保留运行时台词加工（prefix/suffix/替换）。
  3. 明确合并语义：runtime 对 builtin 做**逐键深合并**（`companion` 段按叶子键合并），或保留整文件覆盖但在 loader 对 runtime 文件做 schema 完整性强校验、缺键即启动期报错。二选一写进文档，别留给实现。
  4. 迁移任务（roadmap Phase 1）补一句：迁移 `kal'tsit.yaml` 时把 builtin 版独有的 `tone_rules/companion_templates/status_phrases` 段合并进 runtime 版，消除既成降级。

### F-5【高 · 功能②】触摸交互链路在协议层缺失：Phase 4 验收要求点触台词，但 v3 协议消息清单里没有 C→S 的触摸消息

- **出处**：`roadmap.md` Phase 4 验收（"点击头部/身体触发对应台词"）；`architecture.md` §4.1（消息类型清单，无任何触摸类 client 消息）；对照 `extract/persona.md` §2.5（`get_touch_reaction` 语义完整但无调用方）与 §7 缺陷 10（"补全触摸消息类型与路由，或删除"）。
- **问题**：webview 与 core 之间只走 protocol 消息，点触 Live2D 后前端拿不到 `CompanionEngine.get_touch_reaction`——除非触摸反应完全在前端本地生成（台词池要经消息桥下发，Live2DViewer 已持有 companion 配置，技术上可行），或者新增一条 C→S 消息。v3 两处都没选，extract 缺陷 #10 要求的"补全或删除"决策被绕过了。验收门禁（点触出台词）到时必然卡住。
- **修改建议**（二选一，写明）：
  - 方案 A（推荐，更简）：触摸反应**纯前端**。`personas.get` 消息的 payload 已含 `touch_zones`（Live2DViewer 本来就要拉 companion 配置），webview 本地随机选句、播表情，不经 core。在 `architecture.md` §7 的 Live2D 段落写明此决策，core 侧不实现 `get_touch_reaction` 等价物。
  - 方案 B：protocol 增加 `touch_trigger`（C→S，`{ zone: string }`），core 路由到 CompanionEngine 并广播 `companion_message` + `emotion_update`。选 B 则需在 §4.1 消息清单、§5.1 模块图、messageRouter 三处同步登记。
  - 无论选哪个，把决策补进 roadmap Phase 4 任务列表（当前只有"touch_zones 交互"五个字）。

### F-6【中 · 功能③】全局汇报（`session_id="global"`）在 v3 多客户端/多会话形态下的路由与 UI 呈现未定义，"单向汇报不干扰主对话"没有设计约束

- **出处**：`architecture.md` §9.1（数据流只画单 webview 链路）、§7（webview 组件迁移提到"台词气泡"）、§8（移动端"陪伴视图"）；对照 `extract/protocol.md` §2（`session_id="global"` 特殊值，v2 前端重映射到当前会话，`App.tsx:100-101`）、`webview-inventory.md` §2.4（CharacterDialogBox：Live2D 旁的台词气泡 + 历史展开，可迁移）。
- **问题**：v2 是单会话单客户端，"global 重映射到当前会话"够用。v3 是两类客户端 × 多会话并行：webview 端用户在会话 A 的聊天页，会话 B 的 agent 完工触发全局聚合句——这句台词该出现在哪？webView 的台词气泡挂在 Live2D 旁（单实例），那它报的是哪个会话的事？移动端陪伴视图同样只有一个角色。若全局句直接进当前会话的消息流，会污染会话历史、干扰主对话（违背功能③"不需要通过角色那边输入"的单向定位）；若只挂气泡，多 agent 场景下用户无法区分汇报对象。文档对"气泡 vs 旁白条 vs 消息流"的呈现位置、以及台词与来源会话的关联展示，均无规定。
- **修改建议**：
  1. 明确呈现规则写进 `architecture.md` §7/§8：**汇报一律不进会话消息流**（不持久化为 Message，JSONL 只存 user/agent/system），只进 `companionStore`；桌面端呈现为 Live2D 旁台词气泡（CharacterDialogBox 迁移路径不变），移动端呈现为陪伴视图顶部的旁白条。
  2. `companion_message` 的 payload 在 v3 协议中增加可选 `source_session_id` 与 `source_title` 字段（全局消息由 Scheduler/Supervisor 填），UI 在气泡角落小字标注来源会话（如「来自：重构 auth」），点击可跳转该会话——这是多 agent 汇报可辨认性的最小成本方案。
  3. 协议文档（§4.1）相应去掉对 `"global"` 字面量的依赖：全局消息改为 `sessionId` 省略 + `payload.scope: "global"`，避免 v2 的魔法字符串重映射前端逻辑。

### F-7【中 · 功能②】`session.systemPromptInjected` 标志的生命周期未定义：持久化与否、切换 adapter/persona/CLI 会话后是否重置

- **出处**：`architecture.md` §5.3（仅一句"改为显式状态字段"）；对照 `extract/session.md` §3.4（`switch_adapter` 关旧 adapter 懒重建）、§6（`switch_persona` 命令）、`extract/adapters.md` §2.5（`switch_session` 换 CLI 会话 id）。
- **问题**：标志位修好了"首轮不触发"的 bug，但引入了新问题：会话中途 `switch_persona`（架构里有 `dionysus.selectPersona` 命令）后，新角色的 system prompt 要不要注入？`switch_adapter` 后新 CLI 会话没有旧注入上下文，是否重置标志？`/resume` 恢复一个 CLI 侧旧会话时，注入过没有无从得知。标志存内存还是写进 JSONL meta 行也没说——重启插件后恢复会话，标志丢失会导致重复注入（若 CLI 会话是 resume 的，重复注入语气 prompt 会让 agent 行为突变）。
- **修改建议**：在 §5.3 补三条规则：(1) `systemPromptInjected` 持久化到 JSONL 会话 meta 行；(2) `switch_adapter` / `switch_session` 后重置为 false（新上下文需要重新注入）；(3) `switch_persona` 后不重置、不补注（避免中途改变 agent 行为），新 persona 只影响后续陪伴台词与下一新会话——并在 `switch_persona` 的 system_notice 文案中向用户说明该语义。

### F-8【中 · 功能③】`live2d_action` 与 `emotion_update` 双通道并存的裁决被搁置

- **出处**：`architecture.md` §4.1（保留清单中两者均在列）；对照 `extract/persona.md` §0 与 §7 缺陷 11（协议定义了 `live2d_action`、manager 有映射，但全仓库无生产者；Live2D 驱动实际全走 `emotion_update` 的 `live2d_expression/motion` 字段）。
- **问题**：extract 缺陷 #11 明确要求"要么让引擎直接发 `live2d_action`，要么删掉该类型，避免双通道"，v3 的"保留"清单把它和 `emotion_update` 并列抄了过来，没有裁决。实现期两个通道都会被写进 messageRouter 和 Live2DViewer，维护成本翻倍且语义重叠。
- **修改建议**：在 §4.1 明确：v3.0 删除 `live2d_action`，Live2D 驱动统一走 `emotion_update` 的 expression/motion 字段；`look_at`/`lip_sync` 若有真实需求（注视跟随在 v2 Live2DViewer 是本地行为）列为客户端本地能力，不占协议类型。若选择保留，则需写明生产者是谁（CompanionEngine 还是 Supervisor）。

### F-9【低 · 功能③⑤】Supervisor 在移动端离席场景的频率/成本约束未提

- **出处**：`architecture.md` §6.5（`supervisor.enabled`）、§8（移动端）；对照 `extract/persona.md` §4.1（默认 15s 轮询、LLM 模式每次 tick 一次 LLM 调用）。
- **问题**：功能⑤的主场景是用户离开电脑几十分钟。此间 Supervisor 按 15s 间隔 tick，若 mode 是 `agent_session`/`llm_api`，每次有变动就烧一次 CLI/API 调用；无人观看时也照常生成（broadcast 无客户端时是空扇出，但生成成本已花）。另外移动端浏览器锁屏后 WS 可能挂起，期间的汇报消息没有任何补发/摘要机制（broadcast 是即发即弃）。
- **修改建议**：(1) §5.4 注明 Supervisor 仅在至少一个客户端连接时才运行 LLM/CLI 生成（纯模板模式不受限）；(2) mobile 端 WS 重连后由 core 补发一条当前 fleet 状态摘要（复用 Supervisor 的快照能力，成本一次模板拼装）；(3) 这两条规定写进 Phase 5 验收。

---

## 无欠缺确认（审过且认为设计成立的部分）

- **回合内陪伴反应引擎（CompanionEngine）**：状态键全集、5 秒冷却、每回合一次性的 work_start/long_workflow/success/error、`status→emotion→expression/motion` 三级映射、YAML→中立默认的回退链——`architecture.md` §5.4 明确"行为规格按 extract/persona.md 且全部 YAML 驱动、代码侧不持有角色字面量"，extract §7 缺陷 1、2 均被正面覆盖。无欠缺。
- **情绪/Live2D 联动的协议载体**：`emotion_update`（带 expression/motion 字段）+ `companion_message` + `todo_update` 三件套在 §4.1 完整保留，时序（陪伴消息先于事件消息）在 §9.1 数据流中正确。无欠缺。
- **汇报的单向性（协议面）**：protocol 中没有任何 C→S 的"对角色说话"消息类型，角色输出只有 S→C 三件套——"用户不需要通过角色输入"在协议层天然成立。无欠缺（呈现面的问题已单列为 F-6）。
- **Supervisor 的工程化修复**：`adapterFactory` 显式注入替代 `provider.__self__` 反射（§5.4）、loader 显式目录注入替代模块导入期固化（§5.4），分别对应 extract 缺陷 5、6，方向正确。无欠缺。
- **台词气泡组件迁移**：CharacterDialogBox 被判"可直接迁移"（webview-inventory §2.4），roadmap Phase 4 有对应任务与验收。组件层面无欠缺（缺的是 F-6 的路由规则，不是组件）。
- **TodoTracker 结构化改造**：§5.1 保留 todo-tracker 模块，§4.1 新增结构化 `tool_call`/`tool_result` 消息，extract 缺陷 12（emoji 文本协议）的修复路径（从结构化工具事件提取 todo）隐含成立。无欠缺，但建议在 §5.4 或 Phase 4 任务里点一句"todo 改从结构化 tool_call 事件提取"以免实现者照抄 v2 的正则路径（不另列发现）。

## 总评

**设计整体能否撑住核心功能**：陪伴层的"骨架"撑得住——回合内反应引擎、情绪联动、协议三件套、组件迁移路径都完整继承了 v2 已验证的行为，且工程化缺陷（反射、路径固化、硬编码）均被正面修复。但"角色语气"这条差异化主线撑不住：v2 语气注入是死代码这一最关键的教训，v3 只修了"何时触发"没修"如何生效"，注入链路仍然没有一个能落到任何真实 CLI 上的机制；多 agent 汇报的仲裁策略和 Supervisor 的 v3 形态则根本没写。功能②的"注入"一半和功能③的"多 agent"一半，按当前文档进入实现会立即卡住或重蹈死代码。

**最大的三个缺口**：

1. **语气注入无实现语义、无降级路径**（F-1/F-2）：`injectSystemPrompt?` 照抄 v2 空钩子形态，没有逐 CLI 的能力声明、没有 session 层 prompt 拼接兜底、没有"不支持注入则输出后处理改写"的降级设计——语气注入有第二次沦为死代码的确切风险。
2. **多 agent 汇报无仲裁、Supervisor 形态未定义**（F-3/F-2）：三声源（engine/scheduler/supervisor）并发时无聚合/排队/插播规则；聚合文案要下沉 YAML 但 schema 里没有这些字段；Supervisor 的三模式与 LLM 凭据配置被一个 `enabled` 布尔掩盖，而它同时承载功能③和功能⑤。
3. **persona YAML schema 修订决策缺席**（F-4）：六个 v2 死字段的去留、runtime/builtin 合并语义、`system_prompt` 的模板变量约定均未裁决——这决定了语气模板"由哪些字段驱动"这一基准问题，且 Phase 1 的资产平移可能把 kal'tsit 台词降级 bug 原样搬进 v3。
