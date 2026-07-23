# Dionysus v3 设计审阅报告 — 工程师·core 与协议

> 审阅范围：`docs/v3/architecture.md` §4（protocol）、§5（core）、`docs/v3/roadmap.md` Phase 2。
> 对照基线：`docs/v3/extract/protocol.md`、`extract/adapters.md`、`extract/session.md`、`extract/persona.md` 中记录的 v2 已证实缺陷。
> 审阅视角：以实现这套系统的工程师身份，回答五个问题——①多 agent 并行下进程模型是否成立；②tool_call schema 与 5 个 CLI 的解析可行性；③JSONL 并行写正确性；④角色语气注入的落地路径与降级；⑤测试策略覆盖。
> 严重度分级：阻断 > 高 > 中 > 低。

---

## 发现清单

### F1【阻断 · 核心功能 2】角色语气注入在 v3 架构中仍无可行实现路径，必然重演 v2 死代码

**文档出处**：`architecture.md` §5.2（`IAgentAdapter.injectSystemPrompt?`）、§5.3（`session.systemPromptInjected`）；对照 `extract/adapters.md` §7.7、`extract/session.md` §4。

**问题描述**：v2 已证实 `inject_system_prompt` 是死代码——基类默认空实现、`GenericCLIAdapter` 未覆写，首轮调用落入空操作且异常被静默吞掉（`base.py:55-64`、`manager.py:282-298`），persona 的 system prompt 从未到达任何 CLI。v3 架构把这个接口**原样照搬**为可选方法 `injectSystemPrompt?(prompt, vars?)`，§5.3 只修了"触发判断"（messages 为空 → 显式 `systemPromptInjected` 标志），但**没有回答最关键的问题：5 个 CLI 都是 `cli -p <text> --output-format stream-json` 的一次性命令行调用，根本不存在"注入 system prompt"的通道**。extract/adapters.md §7.7 已明确警告"若 v3 产品语义依赖 system prompt，需要新设计（如拼进首条 prompt）"，architecture.md 未采纳。若按现文档实现，工程师照接口写一个空的可选方法即"完成"，核心功能 2（角色语气注入）静默缺失——与 v2 一模一样的失败方式。另：注入失败如何降级（跳过？报错？置不置 `systemPromptInjected`？）全文未提。

**修改建议**（可直接执行）：

1. §5.2 删除 `IAgentAdapter.injectSystemPrompt`，改为策略侧方法：
   ```ts
   interface CliAdapterStrategy {
     // 首轮调用：把 persona system prompt 合并进用户输入，返回新的 AgentInput。
     // 默认实现（JsonStreamStrategy 基类）：text = systemPrompt + "\n\n" + input.text，其余字段原样。
     wrapFirstTurnInput?(systemPrompt: string, input: AgentInput): AgentInput
   }
   ```
   各 CLI 无需逐个覆写——plan-mode 前缀注入已证明"拼进 prompt 文本"对 5 个 CLI 全部成立（extract/adapters.md §5 共性），复用 §5.2 已规划的"plan-mode 前缀统一为常量 + 按 CLI 覆盖"同一机制。
2. §5.3 回合管线明确时序与降级：`runAgentTurn` 中若 `!session.systemPromptInjected`，取 persona.system_prompt → 非空则经 `wrapFirstTurnInput` 包装后发送，**adapter.send 成功产生首个事件后**置 `systemPromptInjected=true` 并持久化；persona 无 system_prompt 字段 → 直接置标志跳过；包装/发送失败 → 按原始输入重发（不阻断回合）+ `system_notice(level="warning", "角色语气注入失败，本轮以原始输入继续")`，标志保持 false 下轮重试。
3. 该机制属 adapter/session 接口设计，**决策与实现应前置到 Phase 2**（现 roadmap 把 persona 全部放在 Phase 4，Phase 2 冻结 adapter 接口时此问题不会暴露）。

---

### F2【高 · 核心功能 4】结构化 `tool_call`/`tool_result` 无 schema、AgentEvent 类型未扩展，且 5 个 CLI 的解析矩阵有缺口

**文档出处**：`architecture.md` §4.1（仅一句"新增结构化 tool_call / tool_result 消息"）、§5.1-5.2；对照 `extract/protocol.md` §9.4、`extract/adapters.md` §4.3/§5。

**问题描述**：核心功能 4（读文件/改代码/跑命令显著可见）的全部依赖就是这两条消息，但架构文档没有给出任何字段定义。以工程师视角落地时至少四个问题无答案：

- **配对 ID 缺失**：UI 要折叠渲染"调用 → 结果"，需要 `toolCallId` 配对。claude/codebuddy 的 `tool_use` 块原生有 `id`（Anthropic 格式）；kimi 的 OpenAI 风格 `tool_calls[]` 样例（extract/adapters.md §4.3）未含 `id`；codex 靠 `command_execution` → `item.completed` 配对。各家 ID 可用性不一致，schema 必须规定无原生 ID 时的合成与配对策略，文档完全未提。
- **解析矩阵缺口**：`tool_call` 五家都能解析（kimi 基类 tool_calls 分支、claude `tool_use`、codex `command_execution`/`tool_call`、opencode `tool_call`、codebuddy `tool_use`）；但 `tool_result` 侧，**opencode 的行映射里没有 tool_result 分支**（extract/adapters.md §5.4，只有 message/text/tool_call/result 四类），其 `--format json` 输出是否有工具结果行未经证实；kimi 的 `role=tool` content 可能是整个文件全文（extract/adapters.md §4.3 样例 `"file contents..."`），直接进 protocol 消息需要截断策略。
- **无操作分类**：核心功能 4 要求"显著可见"，UI 需要区分读文件/改代码/跑命令以决定图标与显著度，schema 应有 `kind` 分类字段（策略按工具名映射），文档未提。
- **core 侧类型未同步**：§5.1 `adapters/types.ts` 的 `AgentEvent` 未声明新增 `tool_call`/`tool_result` 事件类型——extract/adapters.md §1.3 的 7 种事件枚举里没有它们，策略产出结构化事件后走哪条通道未定义。

**修改建议**（可直接执行）：

1. §4.1 增加完整 schema：
   ```ts
   // tool_call
   payload: {
     toolCallId: string      // 优先取 CLI 原生 id；无则由策略合成 `${turnId}-${seq}`
     name: string            // 原始工具名，如 read_file / Bash / edit
     kind: 'read' | 'edit' | 'bash' | 'search' | 'other'  // 策略按 name 映射表归类
     args: Record<string, unknown>  // 结构化参数（kimi 的 arguments JSON 字符串须 json.loads）
     displayArgs?: string    // 一行摘要（path / command），core 侧截断至 ~120 字符
   }
   // tool_result
   payload: {
     toolCallId: string      // 有原生 id 直接配对；无则策略按 FIFO 配对最近一个未闭合 tool_call
     ok: boolean             // codex exit_code==0 / codebuddy is_error 取反；无信息默认 true
     content?: string        // 结果摘要，core 侧统一截断（建议 2000 字符，超出标注 truncated）
   }
   ```
2. §5.1 `AgentEvent.type` 枚举显式加入 `tool_call` / `tool_result`；`TodoTracker` 改为消费结构化 tool_call 事件（呼应 extract/persona.md §7.12 的 v3 改进，现架构 §5.4 只写"行为规格按 extract/persona.md"而未点明此条必改）。
3. §5.2 补一张「5 CLI × tool_call/tool_result 解析矩阵」表，逐格标注行形状出处与缺口；opencode 的 tool_result 缺口列为 R-2 同类风险，Phase 4 实现 opencode 策略时用真实 CLI 录制验证，若无工具结果行则 UI 对该 CLI 降级为"只显示调用、不显示结果"。
4. roadmap Phase 2 任务补一条："kimi fixture 中须含 tool_calls 与 role=tool 行，断言产出结构化 tool_call/tool_result 事件"。

---

### F3【高 · 核心功能 1、3】多 agent 并行的进程模型未定义：会话↔适配器基数、send 互斥、并发上限全部缺位

**文档出处**：`architecture.md` §5.2（`GenericCliAdapter` 语义）、§5.3（SessionManager 职责）；对照 `extract/session.md` §3.4、`extract/adapters.md` §3.3。

**问题描述**：核心功能 3（多 agent 并行干活 + 调度汇报）要求多个会话同时各跑一个 CLI 进程。但架构文档从未说明：

- **会话与适配器实例的基数关系**。v2 实际是"每会话懒建独立 adapter 实例"（`get_or_create_adapter` → registry `create_adapter` deepcopy 新建，extract/session.md §3.4、extract/adapters.md §3.3），而 registry 的 `get_adapter` 返回共享单例——v3 的 registry.ts（§5.1）继承哪个语义没写。`GenericCliAdapter` 持有单一 `_process` 句柄与单一 `_sessionId`（extract/adapters.md §2），**同一实例并发两个 send() 会互相杀进程、串 session_id**。若实现者合理误读为"每 adapter_id 一个共享实例"，多会话并行即崩。
- **单实例并发约束未声明**：即便确定 per-session 实例，文档也应写明"一个 adapter 实例同一时刻至多一个进行中的 send()，第二个并发 send 的行为 = 拒绝 / 排队 / 先打断"，三者语义完全不同。
- **资源竞争无约束**：N 个会话并行 = N 个 CLI 子进程，无并发上限、无每 CLI 二进制的互斥（同一 CLI 的多个进程同时写同一 resume 会话存储是否有副作用未评估）；`request_timeout_seconds` 是单行超时（extract/adapters.md §2.3），整轮无上限，N 个失控进程叠加无兜底。Supervisor 的 agent_session 模式还会额外 spawn 一个专用 adapter 进程参与竞争（extract/persona.md §4.3）。

**修改建议**（可直接执行）：

1. §5.3 明确写入："**每个会话绑定一个独占的 adapter 实例**（registry 提供 `createAdapter(adapterId)` 工厂，深拷贝配置新建实例，语义同 v2 `create_adapter`）；registry 不向上层暴露共享实例"。
2. §5.2 `GenericCliAdapter` 契约补一条："实例级单回合互斥——`send()` 进行中再次调用立即产出 `agent_complete{status:'error', error_message:'adapter busy'}`；`SessionManager` 层保证同一会话串行（回合进行中收到新 user_input 时排队或提示先打断，二者选一并在 §5.3 写明）"。
3. §5.3 增加并发上限配置 `dionysus.maxConcurrentAgents`（默认建议 3），超限创建会话/发起回合时回 system_notice；R 登记册增加"多 CLI 进程资源占用"条目。

---

### F4【高 · 核心功能 1】JSONL 存储的 `index.json` 在多会话并行写下存在读-改-写竞争，ADR-2 的"单进程无并发"论证不成立

**文档出处**：`architecture.md` §5.3（JsonlSessionStore、index.json）、ADR-2；`roadmap.md` Phase 2。

**问题描述**：ADR-2 的理由是"无并发写竞争（单进程）"。这是对 Node 并发模型的误解：单线程只保证没有并行指令交错，但 `appendMessage`/`create` 都是 async（`Promise<void>`），多个会话并行跑回合时，对**共享单文件 `index.json`** 的操作是典型的 await 点交错的读-改-写——会话 A 读到 index 后被 await 挂起，会话 B 读-改-写完成，A 醒来用旧快照写回，**B 的更新丢失**（lost update）。`appendMessage` 还要 bump 会话 `updated_at`（v2 语义，extract/session.md §2.2），意味着每条消息追加都可能触发 index 写——这正是多会话并行时最频繁的路径。会话 jsonl 文件本身按"一会话一文件 + 同会话串行回合"是安全的，但文档没写这个不变量（见 F3），且 meta 在 jsonl 首行与 index.json **两处冗余**，先写哪个、崩溃后如何对账完全未定义。

**修改建议**（可直接执行）：

1. **首选：删除 index.json**。`list()` 改为扫描 `<storageDir>/sessions/*.jsonl`，读每个文件首行 meta + `fs.stat` 的 mtime 作 updated_at 排序。首行 meta 只在 create 及 title/persona/adapter 变更（低频、用户驱动、天然串行）时重写（写临时文件 + `rename` 原子替换）。这样消灭了唯一的共享可变状态，竞争问题从根上消失；O(N) 次单行读取对百级会话规模无性能问题，也天然满足"list 只读元数据"的 N+1 修复目标。
2. 若坚持保留 index 作缓存：必须写明"index 仅为可丢弃的派生缓存，任何写操作串行化（模块级 promise 链 mutex），启动时以 sessions/ 目录扫描结果为准重建 index"。
3. §5.3 补充不变量："同一 sessionId 的 `appendMessage` 调用方只有该会话的 `runAgentTurn`（串行保证见 F3），jsonl 文件不存在多写者"。

---

### F5【中 · 核心功能 1】无 `turnId`：v2 的"打断后双 agent_complete"与"interrupt 伪错误"两个已证实缺陷在 v3 协议层未解决

**文档出处**：`architecture.md` §4.1（Envelope 无 turnId）、§5.2（interrupt 语义未细化）；对照 `extract/protocol.md` §8.3/§9.7、`extract/adapters.md` §2.5/§7.7。

**问题描述**：extract 已记录两个缺陷：(a) 打断后客户端可能收到**两条** agent_complete（handle_interrupt 主动发一条 + 流循环 break 再发一条），extract/protocol.md §9.7 明确建议"一回合共享一个 turn_id"；(b) interrupt 杀进程后 CLI 非零退出，send() 循环会再产出 `agent_complete{status:"error", error_message:"... exited with code -9"}` 的伪错误（extract/adapters.md §2.5）。v3 Envelope（§4.1）只有 `traceId`，没有采纳 turn_id 建议；§5.2 只说"interrupt 杀进程"，没说 GenericCliAdapter 如何区分"被 interrupt 杀掉"与"真实崩溃"——没有 `this.interrupted` 标志之类的机制，伪错误会原样复现。

**修改建议**（可直接执行）：

1. Envelope 增加 `turnId?: string`；`runAgentTurn` 入口生成 turnId，本回合全部下游消息（agent_stream/tool_call/status_update/agent_complete/companion 消息）携带。
2. §5.2 写明：`GenericCliAdapter.interrupt()` 置内部 `_interrupted=true` 再杀进程；读循环因非零退出收尾时若 `_interrupted` 为真则产出 `agent_complete{status:'interrupted'}` 而非 error，并复位标志。
3. §5.3 写明去重规则："SessionManager 对已收过终态 agent_complete 的 turnId，忽略其后续迟到的 agent_complete（幂等）"。
4. 测试基座补协议级断言用例："interrupt 后客户端恰好收到一条 `agent_complete(status='interrupted')`，无 error 级 complete"（v2 缺陷回归测试）。

---

### F6【中 · 核心功能 5】连接-会话绑定模型、handshake 协商方向、`"global"` sessionId 去留均未定义

**文档出处**：`architecture.md` §4.1（Envelope/handshake）、§6.2（Transport）、§9.2；对照 `extract/protocol.md` §1/§2/§5.9。

**问题描述**：三处缺口：

- v2 的 WS 连接用 `?session_id=` **绑定单会话**（extract/protocol.md §1）；v3 改为 Envelope 携带 `sessionId`、Transport 按 clientId 寻址（§6.2），意味着连接不再绑定会话、一个客户端可多会话切换——这是协议级语义变化，全文未写明。移动端断线重连后如何重新同步进行中会话的状态（补发当前流式状态？握手携带活跃会话列表？）也无规定，直接影响核心功能 5（随时清晰得知进展）。
- handshake 的 v 协商（§4.1："客户端声明支持的版本范围，服务端选定"）方向不闭合：handshake 是 S→C 消息，客户端的"声明"经哪条 C→S 消息/通道（新增 hello 消息？WS query 参数？）未定义。
- v2 用 `session_id="global"` 特殊值承载 Scheduler 的全局陪伴消息（extract/protocol.md §2、extract/session.md §5.3），前端要特判重映射。v3 §4.1 未提该特殊值去留；移动端若按 sessionId 过滤消息，全局调度汇报（核心功能 3 的载体）会被丢弃。

**修改建议**（可直接执行）：

1. §4.1 明确"v3 连接不绑定会话；所有会话相关消息以 envelope.sessionId 路由；客户端按当前视图过滤"；handshake payload 增加 `activeSessions: SessionMeta[]`，供重连客户端恢复视图。
2. 新增 C→S `hello` 消息（或规定 WS query `?v=`）承载客户端版本范围声明，handshake 回选定版本；写入 §4.1 类型清单。
3. `sessionId="global"` 二选一写明：保留（并在 §4.1 定义为保留字面量，客户端不得按会话过滤丢弃）或废除（全局消息改为复制到每个活跃会话流）。建议保留并显式定义，改动最小。

---

### F7【中 · 核心功能 1】JSONL 存储健壮性细节缺失：崩溃半行、时间表示、meta 一致性

**文档出处**：`architecture.md` §5.3（存储格式）；对照 `extract/session.md` §7.8。

**问题描述**：除 F4 的竞争问题外，落地 `JsonlSessionStore` 还缺三条规格：(a) 进程在 append 中途被杀会留下**半行坏 JSON**，`loadMessages` 行为未定义（解析抛错则整个会话历史不可读）；(b) extract/session.md §7.8 建议"统一存储与传输表示（Unix 毫秒整数）"，§4.1 统一了线路毫秒，但 JSONL 落盘的时间格式未写；(c) jsonl 首行 meta 与（若保留的）index 的一致性修复策略未定义。

**修改建议**（可直接执行）：§5.3 补三条——`loadMessages` 对解析失败的行跳过并记 warning（容忍末行截断）；存储时间戳与线路一致用 Unix 毫秒整数；启动时校验首行 meta 完整性，损坏的会话文件在 list 中标注 corrupt 而非静默消失。

---

### F8【中 · 核心功能 3】Supervisor 运行模式与配置在 v3 的去留未写，多端下播报目标语义不明

**文档出处**：`architecture.md` §5.4（Supervisor 仅提 adapterFactory 注入）、§6.5（配置仅 `dionysus.supervisor.enabled`）；对照 `extract/persona.md` §4。

**问题描述**：核心功能 3 的"调度汇报"主要载体是 Supervisor。v2 有三种 mode（disabled/agent_session/deepseek_api）+ interval + api_key 等 6 键配置（extract/persona.md §4.1），v3 §6.5 只剩一个布尔 `enabled`——deepseek_api 模式（HTTP 直连 LLM）是保留还是砍掉？adapterFactory 注入只覆盖了 agent_session 模式。另外 v2 Supervisor"替当前可见会话对应的角色播报"（extract/persona.md §4 引言），v3 是 webview + mobile 多端广播模型，"当前可见"不再有意义，播报目标会话的选择规则与 persona 归属未重述。

**修改建议**（可直接执行）：§5.4 明确 v3 Supervisor 支持的模式集合（建议只保留 disabled/agent_session，砍掉 deepseek_api 以消除第二个 LLM 通道与 api_key 管理；若保留则需列出全部配置键进 §6.5）；写明播报目标选择规则（聚合全部活跃会话，persona 取"最近活跃会话"的 persona_id，与可见性无关）。

---

### F9【中 · 核心功能 1、2、4】测试策略四处关键缺口

**文档出处**：`architecture.md` §12、`roadmap.md` Phase 2 及附录 A。

**问题描述**：已有的测试基座（协议 schema 往返、策略 fixture、FakeAdapter 全管线、假 spawn、broadcast 测试）本身是**无欠缺**的，值得肯定。但对照本报告的高危风险，四处缺口：

- **多会话并行隔离**：roadmap 附录 A 把 `test_session_isolation.py` 标为"不翻译；其语义以 FakeAdapter 用例覆盖"，但没有任何任务/用例名落实"两会话并行 `runAgentTurn` 互不干扰（进程各自独立、事件按 sessionId 归属、index/存储不串）"——恰是 F3/F4 风险的唯一回归防线。
- **interrupt 回归**：假 spawn 测 interrupt 有列，但缺 F5 的协议级断言（恰好一条 interrupted complete、无伪 error）。
- **JSONL 健壮性**：`jsonl-store.test.ts` 只说"改写为 JSONL 语义"，无坏行容忍、无（若保留 index 的）并发用例。
- **语气注入端到端**：Phase 4 验收只有 Live2D 表情/台词/触摸，**没有任何环节验证 system prompt 真的到达 CLI**——F1 死代码若重演，全部测试照样绿。

**修改建议**（可直接执行）：

1. Phase 2 测试基座补三个具名用例：`session/parallel-sessions.test.ts`（两 FakeAdapter 会话并行回合，断言事件序列与持久化互不污染）、`adapters/interrupt-semantics.test.ts`（F5 断言）、`session/jsonl-store.test.ts` 追加坏行容忍用例。
2. Phase 2 假 spawn 测试补一条："首轮 send 的 argv 中 prompt 文本包含注入的 persona system_prompt 前缀"（配合 F1 的 wrapFirstTurnInput，fake command 录 argv 断言）。
3. Phase 4 验收补一条："真实 CLI 一轮对话中，首轮 prompt 携带 persona system_prompt（日志/fixture 可证）"。

---

### F10【中 · 核心功能 4】Phase 2 验收基线错配，tool_call 验证任务缺失

**文档出处**：`roadmap.md` Phase 2（验收"事件序列符合 extract/protocol.md"）。

**问题描述**：extract/protocol.md 是 **v2 协议**——没有 `v` 字段、没有结构化 tool_call、时间戳有秒/毫秒启发式。Phase 2 的验收基线引用它，与 Phase 2 自己的任务（"含 v3 改动：v 字段、结构化 tool_call……"）自相矛盾；且 Phase 2 任务清单中没有任何一条落实 tool_call 的 fixture 断言（见 F2-4）。

**修改建议**（可直接执行）：验收改为"事件序列符合 `@dionysus/protocol` 的 v3 schema（含 v=1、毫秒 ts、tool_call/tool_result）"；任务清单加"kimi fixture 覆盖 tool_calls/role=tool 行并断言结构化事件"。

---

### F11【低 · 协议一致性】`parseMessage` 与 §4.2 公开接口表述不一致；`sticker_send` 决策悬置

**文档出处**：`architecture.md` §4.1（"`parseMessage(raw)` 为唯一入口"）vs §4.2（公开接口只有 `parseClientMessage`/`parseServerMessage`，无 `parseMessage`）；§4.1（`sticker_send`"决定实现或删除"）。

**问题描述**：前者是文档内部矛盾，工程师不知以哪个为准；后者是协议 v1 冻结前的悬置决策——协议加了 `v` 字段做版本演进，就更应在 v1 定稿前决断，避免 v1 里留一个无人消费的类型。

**修改建议**：§4.1 的 `parseMessage` 表述改为与 §4.2 一致（两个方向各一个入口；传输层已知消息方向，无需统一入口）；`sticker_send` 建议直接删除（v2 前端从未消费，extract/protocol.md §9.9；贴纸资源本身也不存在，extract/persona.md §1.2 `sticker_pool` 无资源），决策写入 §4.1。

---

### F12【低 · 核心功能 5】BroadcastHub 全局广播未声明客户端过滤责任

**文档出处**：`architecture.md` §5.3（"会话事件向全部已连接客户端广播"）、§9.1。

**问题描述**：所有会话的事件广播给所有客户端，移动端（单会话视图 + 蜂窝/局域网带宽）会收到全部会话的流式 chunk。功能上可行（客户端按 sessionId 过滤即可），但文档未写明该过滤责任在客户端，也未评估移动端带宽放大。属设计可接受但需写明。

**修改建议**：§5.3 补一句"广播为全局扇出，客户端按 envelope.sessionId 自行过滤"；若移动端实测带宽敏感，Phase 5 再评估 per-client 订阅过滤，现不预留接口。

---

## 明确"无欠缺"的方面

以下方面经核对设计是扎实的，不硬凑问题：

- **信封设计**：`v` 版本字段、`ts` 统一毫秒、全词类型名、删除 `interrupt_before_send` 死字段——逐项回应了 extract/protocol.md §9.1/9.3/9.6 的 v2 缺陷，无欠缺。
- **策略层 v3 改动**：`session_holder` 可变 dict 带外通道改为 `parseLine` 显式返回值（§5.2）、`supportsModel` 改静态元数据、删除假 `_handle_crash_restart` 与死配置、`switchSession` 提升为正式可选方法、文本块双事件与 plan-mode 前缀提取共享 helper——精确命中 extract/adapters.md §7.1-7.5 的每一项，无欠缺。
- **SessionManager 简化**：双回合管线合并为单一 `runAgentTurn`、`systemPromptInjected` 显式标志（触发判断部分）、list 只读元数据修 N+1、斜杠命令分发表 + cliSpecific 委托、BroadcastHub 断连不杀共享进程——对应 extract/session.md §7.1-7.4 与 v2 多标签误杀问题，无欠缺。
- **测试基座已有部分**：协议 schema 往返、录制 fixture + v2 pytest 逐条翻译、FakeAdapter 全管线事件序列断言、假 spawn 覆盖超时/interrupt/非零退出、附录 A 的翻译落点表——覆盖面与可执行性良好，无欠缺（缺口仅在 F9 所列的新风险回归用例）。

---

## 总评

**整体判断**：架构的分层骨架（protocol/core/extension 单向依赖、适配器+策略双层、传输抽象 + BroadcastHub）是撑得住五个核心功能的，§5 对 v2 结构性缺陷的修复清单执行得很准——但**文档停在了"接口签名级"，而本视角的四个高危问题恰好全部藏在签名之下的语义层**。

最大的三个缺口：

1. **角色语气注入（F1，阻断）**：v3 照搬了 v2 已被证实是空操作的 `injectSystemPrompt` 接口，却没有回答"5 个一次性 CLI 进程没有 system prompt 通道"这个根本问题。这是唯一可能导致核心功能静默缺失、且现有全部测试都无法暴露的缺口。修法成本低（拼进首轮 prompt，复用 plan-mode 前缀机制），但必须现在就写进架构并前置到 Phase 2，否则 Phase 4 才发现时 adapter 接口已冻结。
2. **tool_call 结构化消息的 schema 与多 CLI 解析矩阵（F2，高）**：核心功能 4 的全部依赖只有一句话描述。配对 ID、opencode 的 tool_result 缺口、kimi 全文结果截断、kind 分类，每一个都是实现时必然撞上的决策点，且 `AgentEvent` 类型清单忘了同步扩展。
3. **多会话并行模型（F3+F4+F5，高/中）**：核心功能 1 和 3 都建立在"多 agent 并行"上，但适配器实例的归属基数、单实例互斥、并发上限、index.json 的 lost-update 竞争、打断的 turnId 去重，这一整组并发语义全部空白——ADR-2"单进程无并发"的论证还是错的。这组问题不阻断单会话垂直切片（Phase 2 能过门禁），但会在 Phase 4-5 多会话/移动端场景集中爆发，建议在 Phase 2 冻结 core 接口前补齐。

**给 roadmap 的一句话建议**：Phase 2 开门禁前，先补一轮"并发与注入语义"的架构修订（F1/F3/F5 的接口决策 + F2 的 schema），这几条都是冻结接口后改起来最贵的东西。
