# Dionysus v3 设计审阅报告 — 产品经理视角（移动端场景）

> 审阅人立场：产品经理 · 移动端场景
> 审阅对象：`docs/v3/architecture.md`、`docs/v3/roadmap.md`、`docs/v3/README.md`，及 `docs/v3/extract/`（protocol / session / persona / pairing-mobile / webview-inventory）
> 验收基准：核心功能 1（QQ 式 agent 对话与管理）、2（Live2D 陪伴与语气注入）、3（角色单向多 agent 进度/调度汇报）、4（agent 操作显著可见）、5（移动端：短暂离机时收汇报、发短指令、随时掌握进展）
> 核心场景设定：用户把任务丢给 agent 后去吃饭（20–40 分钟），手机与电脑同处一个局域网；手机浏览器大概率被切后台或锁屏若干次。

---

## 发现清单（按严重度排序）

### F-1【阻断 · 功能 5③】WS 断开=汇报全丢：无序号、无补拉、瞬态事件不落库，"随时得知进展"不成立

- **出处**：`architecture.md` §4.1（Envelope 无序号字段）、§9.1（事件仅经 BroadcastHub 在线扇出）、§5.3/§6.2（BroadcastHub 职责不含缓存）；`extract/session.md` §3.1（持久化只落 USER/AGENT 完整消息）；`extract/persona.md` §4（Supervisor 播报仅经广播回调瞬时下发）。
- **问题描述**：这是移动端核心场景的死穴。手机浏览器切后台/锁屏后 WS 必然断开（iOS Safari 数秒到数十秒内挂起），断开期间产生的 `agent_stream`、`status_update`、`tool_call`、`companion_message`、`todo_update`、Supervisor 调度播报**全部丢失且无处补拉**，因为：
  1. Envelope 没有 per-session 序号，客户端无法表达"我从哪条开始漏了"；
  2. BroadcastHub 只扇出在线消息，无缓冲；
  3. 持久化层（JSONL）只落回合首尾的用户/ agent 完整消息，陪伴台词、todo 快照、Supervisor 播报是瞬态事件，服务端自己也没有副本。
  重连后 handshake 只给 `session_id`，用户解锁手机看到的是一个状态不明、断线期间一片空白界面——正好发生在"吃完饭回来看结果"这个最高价值时刻。
- **平台约束（必须在文档中写明并接受）**：局域网 `http://<IP>:8765` 不是 secure context，Service Worker / Web Push / 系统级通知在手机浏览器上**不可用**；锁屏期间主动推送无解，除非未来 Bridge CLI 上 HTTPS 或做原生壳。因此体验目标应正确定义为：**"锁屏期间零打扰，解锁打开 3 秒内呈现离开期间发生了什么"**，而不是"实时推送"。
- **修改建议**（可直接执行）：
  1. `protocol` 包：Envelope 增加 `seq: number`（per-session 单调递增，由 core 在 broadcast 前赋值）；新增客户端消息 `sync_request { sessionId, afterSeq }` 与服务端消息 `sync_response { sessionId, events: ServerMessage[], latestSeq: number }`；handshake payload 增加 `sessions: { sessionId, latestSeq, status }[]`。
  2. `core/broadcast.ts`：BroadcastHub 内建每会话环形缓冲（容量 200 条事件足够覆盖一顿饭），`sync` 时按 `afterSeq` 回放；缓冲只服务补拉，不改变在线扇出路径。
  3. 瞬态事件落库：`companion_message`（含 Supervisor 播报）与每回合末的 `todo_update` 终态快照追加写入会话 JSONL（作为 `type: "event"` 行，与 message 行区分），既是补拉数据源，也顺带支撑手机端"汇报历史"回看。
  4. Supervisor 增加"归来摘要"钩子：某客户端重连且其 `afterSeq` 落后于 latestSeq 超过阈值（或断连 >60 秒）时，立即向该客户端单播一条内置模板摘要："你离开期间：会话 A 完成 1 回合（成功）、调用工具 14 次；会话 B 在等待你确认选项"。零 LLM 依赖即可实现。
  5. `roadmap.md` Phase 5 增加验收门禁：**真机锁屏 5 分钟后重连，断线期间的回合结果、工具操作计数与待确认选项全部可见**；不过此门禁 Phase 5 不算完成。

### F-2【阻断 · 功能 1/3/5③】协议没有会话枚举与历史拉取通道，"QQ 式多会话总览"在手机上无数据可依

- **出处**：`architecture.md` §4.1 消息类型清单（无 session list/history 类消息）、§6.3（HTTP 端点仅 `/`、`/api/pair`、`/api/health`）；`roadmap.md` Phase 5 任务（mobile 只有配对页/聊天页/陪伴视图/状态展示，无会话列表页）；`extract/session.md` §6（v2 的会话枚举靠斜杠命令回 `system_notice` 纯文本）。
- **问题描述**：handshake 只返回单个 `session_id`；`/sessions` 斜杠命令的结果是给人读的 `system_notice` 文本，撑不起结构化列表 UI。核心功能 3 的前提是用户一眼看到**多个会话各自的状态与最新汇报**（QQ 会话列表形态），但当前协议层根本拿不到"有哪些会话、各自什么状态、最后一条汇报是什么"。webview 端 Phase 4 要做 SessionList 同样会撞上这个问题，只是桌面端可以靠插件宿主内部调用绕过，移动端隔着 WS 无路可走。
- **修改建议**：
  1. `protocol` 新增两对请求/响应消息：`session_list_request/response`（`SessionMeta[]`：`id/title/personaId/status/lastMessagePreview/updatedAt/unreadCount`，直接复用 §5.3 已修复的"list 只读元数据"能力，status 为服务端权威值）与 `history_request/response`（按 `sessionId + beforeTs/limit` 分页拉取消息与事件行）。
  2. 会话级 `status_update` 广播改为携带 `sessionId` 的列表级事件（如 `session_status { sessionId, status }`），让列表页不进入会话也能实时刷新徽标。
  3. 移动端信息架构（`architecture.md` §8）首屏改为**会话状态列表**（QQ 式：角色头像 + 标题 + 状态徽标 + 最后一条汇报预览 + 未读角标），点进才是单会话详情；`roadmap.md` Phase 5 任务清单相应补"会话列表页"。

### F-3【高 · 功能 5②】无人值守交互闭环缺失：option 超时语义是死字段，`waiting_option` 状态未启用，回来时"该确认什么"不显眼

- **出处**：`extract/protocol.md` §5.4（`timeout_seconds` 默认 60 但"后端未强制实施"）、§9-7；`extract/session.md` §1.3（`WAITING_OPTION` 后端从未赋值，死枚举）；`architecture.md` §4.1（保留 option_request/option_selected，未提超时与状态机修正）。
- **问题描述**：吃饭场景的关键链路是"agent 中途要确认 → 用户回来一眼看到 → 手机上点一下"。现状：a) agent 弹选项后无限干等，超时字段是 v2 遗留死字段，v3 文档未修正其语义；b) 会话不进入 `waiting_option` 状态，列表徽标、断线摘要、重连首屏都没有"有待确认"这个数据源；c) 用户离开时无法一键告诉 agent"别等我，继续干"（yolo 模式开关在移动端基线里有，但与本场景没有设计联动）。
- **修改建议**：
  1. `core/session/manager.ts`：收到 `option_request` 事件时将会话状态置为 `waiting_option`（正式启用该枚举），收到 `option_selected` 或回合结束清除；状态纳入 F-2 的 `session_status` 广播与 F-1 的归来摘要。
  2. 服务端强制 `timeout_seconds` 计时，超时行为做成会话级配置 `optionTimeoutAction: "deny" | "default" | "keep"`（默认 `keep`，即维持现状但状态可查）；超时后广播 `system_notice` 说明结果。
  3. 移动端 UI：会话存在 `waiting_option` 时，列表行与聊天页顶部常驻醒目确认条（高对比色 + 选项按钮直接内联），重连后自动滚动/定位到该条——这是"回来 3 秒看懂"的 P0 交互。
  4. 移动端输入区加"离开模式"快捷开关（即 yolo 模式 + 抑制非必要 option 的提示语），一键降低无人值守时的阻塞点；发送时走既有 `user_input.mode` 字段，无协议改动。

### F-4【高 · 功能 3】Supervisor 调度汇报的模式与默认值未定义，播报历史不可回看

- **出处**：`architecture.md` §5.4（仅说按 `extract/persona.md` 实现）、§6.5（settings 只有 `dionysus.supervisor.enabled: true`）；`extract/persona.md` §4.1（v2 默认 `deepseek_api`，需外部 API key；`agent_session` 模式要额外 spawn 一个 CLI 烧额度）、§7-7（播报恒用 working 情绪）。
- **问题描述**："多 agent 调度汇报"是核心功能 3 的另一半（回合内台词之外的全局播报），但 v3 配置层只有一个 enabled 开关：模式选哪种、默认什么、LLM 模式的 key 从哪来，全部未写。若惯性沿用 v2 默认 `deepseek_api`，未配 key 的用户静默落到内置模板，功能看似存在实则降级，PM 层面无法验收。另外播报纯瞬态（同 F-1），手机上"汇报流"无从回看。
- **修改建议**：
  1. `settings.json` 增加 `dionysus.supervisor.mode: "builtin" | "agent" | "llm_api"` 与 `dionysus.supervisor.intervalSeconds`，**默认 `builtin`**（零外部依赖、离线可用，与 MVP 定位一致）；`llm_api` 模式的 endpoint/model/key 显式成组配置，缺 key 时在设置界面显式提示而非静默回退。
  2. 修复 v2 遗留的"播报恒用 working 情绪"（按播报语义映射 emotion），写入 Phase 4 验收。
  3. 播报消息按 F-1 建议落库；移动端"汇报流"页 P0 用纯文本时间线呈现（角色头像 + 播报文本 + 时间戳），不需要 Live2D。

### F-5【高 · 功能 5/2】移动端 MVP 无 P0/P1 分级，Phase 5 一锅烩，最重项（Live2D）对核心场景零贡献

- **出处**：`roadmap.md` Phase 5 任务清单；`architecture.md` §8（"Live2D 首版允许降级为静态立绘"已是正确方向，但未落到任务粒度）。
- **问题描述**：配对、聊天、陪伴视图、状态展示、多端一致性全堆在一个 2–3 天的 Phase，没有取舍标准。移动端跑 pixi-live2d（v7 锁定 + 模型资产几十 MB 走局域网 HTTP + 手机 GPU 渲染）是移动端工作量与风险最大的一项，而"吃饭看进展"场景要的是**文字进展与确认按钮**，角色在场感由头像 + 台词气泡即可承担。MVP 不做分级，最可能的结果是 Live2D 拖垮 Phase 5，反而牺牲 F-1/F-2 这些真正决定场景成败的项。
- **修改建议**（在 `roadmap.md` Phase 5 内显式分级）：
  - **P0（门禁项）**：配对页（含 TTL 倒计时刷新）、会话状态列表（F-2）、汇报/消息流（companion + supervisor + tool_call 摘要，纯文本）、选项确认条（F-3）、打断按钮、短指令输入（含 IME composition 保护，沿用 `extract/pairing-mobile.md` §4.3-3）、断线重连与补拉（F-1）。
  - **P1（可砍，不影响验收）**：Live2D 渲染（首版静态立绘/情绪图 + 台词气泡，完整 Live2D 后置）、点触互动、sticker、ThemeStudio、会话设置修改（改标题/切 adapter/改工作目录——手机上误触改工作目录的风险大于价值，P0 只读展示）。
  - Phase 5 验收改为以"离开电脑场景全流程"（电脑发起长任务 → 锁屏 → 解锁看摘要 → 手机确认选项/打断 → 任务继续）为主线，而非"手机能聊天"。

### F-6【中 · 功能 4/5③】tool_call/tool_result 在移动端的呈现与统计未定义

- **出处**：`architecture.md` §4.1（新增结构化 `tool_call`/`tool_result`，方向正确）；`roadmap.md` Phase 5（mobile 聊天页未提工具操作展示）；`extract/protocol.md` §9-4。
- **问题描述**：结构化工具消息解决了 v2 emoji 正则的老问题，但"agent 操作显著可见"在手机小屏上怎么做没有着落：全量渲染工具块会淹没汇报，不渲染则功能 4 在移动端缺失。
- **修改建议**：移动端 P0 做"操作时间线"折叠组件：每次 tool_call 渲染为一行 chip（图标 + 动词 + 目标，如"📝 改 auth.ts"、"⚡ 跑 pytest"），默认折叠为计数条（"本回合已执行 14 项操作"），点开展开明细；操作计数同时进 F-1 的归来摘要。Phase 5 验收补一条"手机端无需翻屏即可说出 agent 正在/刚做了什么"。

### F-7【中 · 功能 5】笔记本合盖/休眠导致服务静默失效，风险登记册漏项

- **出处**：`architecture.md` §6.3（"VS Code 退出则移动端不可用"）、§13 风险登记册（无此项）；`roadmap.md` 附录 C。
- **问题描述**："去吃饭"高频伴随合盖或系统自动休眠——VS Code 进程被挂起，手机端 WS 断开且重连无望，用户对着转圈界面无从判断是断网还是电脑睡了。R-3 只覆盖了防火墙/AP 隔离，没覆盖这个更常见的失效模式。
- **修改建议**：风险登记册新增 R-8："宿主休眠导致移动端不可用（高概率）"。对策：a) 配对页与 README FAQ 明示"离开期间请保持电脑唤醒（合盖不休眠/接电源）"；b) 移动端 WS 重连失败超过 3 次时显示明确横幅"无法连接电脑，可能已休眠或 VS Code 已退出"，而非无限转圈；c) 在 Bridge CLI（附录 B 已列为后置候选）的评估标准中明确把"休眠场景"列为首要动机。

### F-8【中 · 功能 5（配对安全/体验）】配对 token 走 URL query，且二维码 TTL 倒计时要求未落入 roadmap

- **出处**：`architecture.md` §9.2（二维码内容 `http://<LAN-IP>:<port>/?pair=<token>`）；`extract/pairing-mobile.md` §5-3（建议 `#pair_token=` 形式）、§5-4（要求 TTL 倒计时 + 自动刷新）；`roadmap.md` Phase 5 PairingManager 任务（未提倒计时）。
- **问题描述**：query 里的 pair token 会进浏览器历史和任何中间日志；extract 文档已给出的两条改进（hash 形式、倒计时刷新）在 v3 文档中一条被改回 query 形式、一条没接住。
- **修改建议**：二维码内容改为 `http://<IP>:8765/#/pair/<token>`（hash 不进历史与日志，前端读取后立即 `history.replaceState` 清除）；配对弹层显示 300 秒倒计时，到期自动换发新 token 并刷新二维码（extract §5-4 原样继承）；两项写入 Phase 5 任务与验收（"二维码过期自动刷新"）。

### F-9【低 · 功能 5】移动端断线重连策略未写明

- **出处**：`extract/protocol.md` §1（v2 前端：30s ping、指数退避 1s→30s、上限 10 次、`intentionalClose` 不重连）；`architecture.md` §8（未提重连）。
- **问题描述**：v2 已验证的重连策略没有被 v3 文档继承，实现时容易漏掉或被随意重写。
- **修改建议**：`architecture.md` §8 补一句：mobile 的 WS `ClientTransport` 实现沿用 v2 策略（30s 心跳、指数退避 1s→30s、主动断开不重连），重连成功后立即发 `sync_request`（F-1）；写入 Phase 5 测试项。

---

## 确认无欠缺的方面

- **短指令通道（功能 5② 的传输层）**：`user_input`（含 `mode`）/ `interrupt` / `option_selected` 三类消息足以承载"继续/打断/确认选项"，协议无欠缺；`runAgentTurn` 单管线合并（§5.3）还顺带修了 v2 option 路径错误处理不一致的问题，对手机发确认是有益的。
- **配对安全闭环（功能 5 的前置）**：WS 握手强制 token、一次性 pair token、设备白名单可撤销、默认绑 127.0.0.1（§6.3/§11/ADR-7），完整修复了 v2 的裸奔漏洞，无欠缺。
- **角色单向输出模型（功能 3 的语义层）**：companion/supervisor 消息天然单向（S→C），"用户不需要通过角色输入"与协议一致，无欠缺。
- **局域网可达性风险**：R-3 已有对策（排查指引 + 默认关），对本场景足够。
- **多端一致性**：BroadcastHub + "断开只注销自己"（§5.3）修复了 v2 多标签误杀进程问题，手机与桌面并行在线的根基正确。

## 总评

架构主线（core 宿主无关、双 Transport 同构消息、BroadcastHub 多端扇出）对"桌面 webview + 手机浏览器平权"是成立的，陪伴层与配对安全的 v2 缺陷也都有明确修复方案——**设计的骨架撑得住核心功能 1–4**。但移动端核心场景（功能 5）目前建立在一个隐含假设上："手机像桌面 webview 一样常连"。这个假设在真实使用（锁屏、切后台、合盖）下必然破裂，而文档对此零着墨。最大的三个缺口：

1. **实时广播模型 vs 手机必然断连**：无消息序号、无补拉协议、瞬态事件（汇报/todo/播报）不落库——断线期间发生的一切对手机不可恢复，"随时清晰得知进展"在解锁那一刻恰好失效（F-1、F-9）。
2. **协议缺会话枚举与历史通道**：多 agent 进度总览（QQ 式列表）在手机端没有数据通道，handshake 只给单会话 ID（F-2，顺带波及 webview 的 SessionList）。
3. **无人值守交互闭环没设计**：option 超时语义是死字段、`waiting_option` 状态未启用、锁屏无推送的取舍未写明、Supervisor 模式默认值不明——"离开→中途要确认→回来秒懂秒点"这条主链路没有端到端跑通（F-3、F-4）。

三个缺口都不需要推翻架构：补 `seq` + sync 消息族 + 瞬态事件落库 + `waiting_option` 启用 + MVP 分级，即可在现有骨架内闭环。建议将 F-1、F-2 列为 Phase 2/5 的门禁级变更（协议先行，越晚补代价越大），F-5 的分级直接改写 Phase 5 验收标准。
