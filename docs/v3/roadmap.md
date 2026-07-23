# Dionysus v3 开发计划（Roadmap）

> 版本：v3.0-draft · 状态：已按六视角审阅意见修订（`docs/v3/review/`，54 条发现），并按 2026-07 用户决策二次修订（rewriter 语气路线 / 角色素材库客制化 / CLI 版本适配展示 / 移动端仿 QQ IA / 桌面主题移除）
> 配套文档：`docs/v3/architecture.md`（目标架构）、`docs/v3/extract/`（旧实现规格，重实现的行为基线）。
> 总原则：**垂直切片先行**——先让单个 CLI 端到端跑通，再横向扩展（多 CLI、陪伴层、移动端）。每个 Phase 有门禁（验收标准），不过门禁不进下一 Phase。
> 验收口径总则：**所有 Phase 的验收一律以多会话并行为准**（至少两个会话同时跑回合，切换查看互不干扰、打断互不影响），单会话跑通不构成门禁通过。

## 工作量总览

| Phase | 内容 | 预估 |
|---|---|---|
| 1 | monorepo 骨架 + legacy 迁移 + Live2D spike + 首次体验（CLI 检测/walkthrough/角色素材库） | 1.5 天 |
| 2 | core 垂直切片（协议冻结 + kimi_cli 端到端 + rewriter 语气链路 + 并发模型 + 测试基座） | 3-4 天 |
| 3 | extension + webview 最小可用（含 sidebar 会话列表 / StatusBar / onboarding） | 2.5-3 天 |
| 4 | 陪伴层（persona/rewriter/Live2D/Supervisor 完整语义）+ 其余 4 策略 | 3-4 天 |
| 5 | 移动端（内嵌服务/配对/sync 补拉/mobile 应用仿 QQ IA，P0/P1 分级） | 3-4 天 |
| 6 | 发布准备（vsix/CI/文档） | 0.5-1 天 |

---

## Phase 1：monorepo 骨架与风险排除

**目标**：工程地基就位；最高风险项（Live2D in webview）最早验证；首次安装体验的三块积木（CLI 检测、walkthrough、模型引导）同步落地。

任务：

- [ ] 迁移旧代码：`backend/`、`frontend/`、`electron/`、根目录 `electron/`、`scripts/` 移入 `legacy/`（保留原样、只读）；Live2D 模型（`kal'tsit_live2d/` 为出厂默认，版权已经用户确认；`exusiai_live2d/` 备选）与 `backend/config/personas` 移入 `assets/`（注意修正 assets 内部引用路径；`backend/config/themes` 不迁移——桌面主题系统已移除，ADR-20）；`docs/` 旧文档移入 `legacy/docs/`（`docs/v3/` 保留原位）
- [ ] **persona YAML 迁移时修复，不平移缺陷**：kal'tsit 的 runtime 残缺版（缺 `tone_rules`/`companion_templates`/`status_phrases` 段，整文件屏蔽 builtin 完整版，致凯尔希说能天使台词，见 `extract/persona.md` §1.3）与 builtin 版逐键合并补齐；exusiai 同步核对；不搬运 v2 的残缺 runtime 版
- [ ] pnpm workspace：`pnpm-workspace.yaml`、根 `package.json`（统一 scripts：build/test/lint/typecheck）、`tsconfig.base.json`（strict、ESM、NodeNext）、eslint + prettier 共享配置
- [ ] 五个 packages 空壳：`protocol`/`core`/`client-core`（tsc 库）、`extension`（esbuild）、`webview`（Vite React），各自能 build + 一个占位测试通过（`mobile` 包到 Phase 5 再建，见 architecture.md §3）
- [ ] **R-1 spike**：最小 extension + webview，在 VS Code 调试宿主中用 pixi-live2d-display 加载 `assets/live2d/kal'tsit` 模型并渲染一帧（验证完整 CSP——含 `script-src`/`connect-src`/`worker-src`，`localResourceRoots` 覆盖内嵌 `assets/` 与 `globalStorageUri/character-library/`，`asWebviewUri`、worker）。**spike 失败则停下来评估替代方案（pixi 升级路径等），不进入 Phase 2**
- [ ] **静态立绘形态落地（不依赖 spike 结果）**：Live2D 区域渲染静态立绘 + 台词气泡，`emotion_update` 仅驱动气泡文案与表情贴图切换；同时是 spike 失败的保底与「展示模式 = static」的用户可选形态（桌面/移动共用能力，architecture.md §7 角色素材库）
- [ ] **角色素材库基础**：出厂素材内嵌 `assets/`（kal'tsit 默认），用户素材目录 `globalStorageUri/character-library/`（结构同出厂、同名覆盖）；loader 合并两处来源；`dionysus.character.display.{desktop,mobile}` 展示模式配置生效
- [ ] **CLI 安装检测与版本探测**：extension `activate` 时对五个 CLI 执行 `which`/`where` 探测，命中后续跑 `<cmd> --version`；registry 记录每个 CLI 的 `testedVersions`（fixture 验证过的版本范围），本机版本超范围时记录警告状态（展示在 Phase 3 落地）；`dionysus.adapter.default` 语义为「未设置时使用首个检测到的可用 CLI」；一个都未找到时 webview 显示引导页（各 CLI 一句话简介 + 一键复制安装命令 + 官方文档链接），而非等用户发消息才报 ENOENT
- [ ] **首次 walkthrough**：`package.json` 声明 `contributes.walkthroughs`（安装 agent CLI → 打开 Dionysus 聊天 → 完成第一轮对话 → 扫码配对手机）
- [ ] 新 CI：typecheck + eslint + vitest + `vsce package` 冒烟；删除旧 Python/前端 CI

验收：`pnpm install && pnpm -r build && pnpm -r test` 全绿；F5 调试宿主里 kal'tsit Live2D 模型可见（spike 成功）或静态立绘形态可见（降级路径）；干净环境安装插件后：未装任何 CLI 时看到安装引导而非报错，开箱即见出厂角色 kal'tsit，walkthrough 在欢迎页出现。

## Phase 2：core 垂直切片（kimi_cli 端到端）

**目标**：不依赖 VS Code，纯 node 环境完成「输入 → kimi CLI → 流式事件 → 会话持久化」全链路；**冻结 v3 协议与 core 接口**——冻结前必须落实协议增补、语气注入链路与并发模型（接口冻结后再改代价最大，见 review-eng-core F1/F3/F5）。

任务：

- [ ] `@dionysus/protocol`：全部消息类型 + zod schema（以 `extract/protocol.md` 为基线，含 v3 改动：v 字段、统一毫秒时间戳、删除 `interrupt_before_send`）；schema 往返测试。**本 Phase 冻结的协议增补**（详细定义见 architecture.md §4.1）：
  - 信封增加 `seq`（per-session 单调递增，core 在 broadcast 前赋值）与 `turnId`（回路口径生成，本回合全部下游消息携带；`agent_complete` 按 turnId 幂等去重，修复 v2 打断双 complete 缺陷）
  - `tool_call`/`tool_result` 完整 schema：`toolCallId`（原生 id 优先，无则策略合成并按 FIFO 配对）、`name`、`kind`（read/edit/bash/search/other）、`args`、`displayArgs`（截断摘要）、`ok`、`content`（截断 2000 字符）；附 5 CLI × tool_call/tool_result 解析矩阵，opencode 的 tool_result 缺口按 R-2 同类风险登记
  - `session_digest_update`（S→C 广播：会话状态跃迁时发出，承载 idle/running/waiting_option/error、未读 seq、待决策标记）
  - sync 补拉消息族：`sync_request { sessionId, afterSeq }` / `sync_response { events, latestSeq }`；handshake payload 增加全量会话 digest 快照
  - `user_message_echo` / `option_resolved`（多端一致性，含重复 `option_selected` 幂等）
- [ ] `core/adapters`：`IAgentAdapter`/`AgentInput`/`AgentEvent` 类型（`AgentEvent.type` 显式含 `tool_call`/`tool_result`）、`GenericCliAdapter`（spawn/readline/interrupt/超时/非零退出统一错误事件；`interrupt()` 置内部标志，被杀进程收尾时产出 `agent_complete{status:'interrupted'}` 而非伪 error）、`JsonStreamStrategy` 基类、`KimiStrategy`（按 `extract/adapters.md` 实现 build_args 与行映射）
- [ ] **角色语气链路：rewriter 路线（接口冻结前落地，ADR-12）**：`persona/rewriter.ts` template 引擎（`tone_rules` 前后缀 + `keyword_replacements` + `voice.catchphrases` 句式拼装 + `voice.taboos` 输出校验）；persona YAML schema 落地 `voice` 段五字段（tone/catchphrases/taboos/examples/rewriter_prompt，逐键回退中立默认）；**改写范围只限角色通道文本**（汇报/摘要/台词），不改写 agent 会话正文。**可选注入增强**：`dionysus.persona.injectIntoAgent`（默认 false）开启时经策略侧 `wrapFirstTurnInput`（persona system prompt 拼进首轮输入文本，复用 plan-mode 前缀机制）+ 策略元数据 `supportsSystemPrompt` 分流，失败按原始输入重发 + `system_notice(warning)`（时序见 architecture.md §5.3）
- [ ] `core/session`：`Session`/`Message` 类型、`JsonlSessionStore`、**并发模型**（见下）、`SessionManager.runAgentTurn` 单一管线、BroadcastHub（含每会话环形事件缓冲，供 sync 补拉）、`commands.ts` 分发表（先实现 `/new`、`/sessions`、`/resume`）
- [ ] **多会话并发模型**：每个会话绑定独占 adapter 实例（registry 只暴露 `createAdapter` 工厂，不暴露共享实例）；单实例 send 互斥（进行中再次 send 立即回 `agent_complete{status:'error', error_message:'adapter busy'}`；同会话新输入排队或提示先打断，二选一写明）；`dionysus.maxConcurrentAgents` 并发上限（默认 3），超限回 system_notice；任意数量会话可并行 `runAgentTurn`，回合状态/CompanionEngine/adapter 进程均以 sessionId 为键隔离，`interrupt` 只作用于指定 sessionId
- [ ] **JSONL 存储（删除 index.json）**：`list()` 改为扫描 `sessions/*.jsonl` 首行 meta + `fs.stat` mtime 排序；首行 meta 仅在 create 及 title/persona/adapter 变更时以「临时文件 + rename」原子重写；不变量「同一 sessionId 的 appendMessage 只有该会话串行的 runAgentTurn 一个写者」写入注释与测试；`loadMessages` 容忍末行截断（坏行跳过 + warning）；存储时间戳统一 Unix 毫秒；首行 meta 损坏的会话在 list 中标注 corrupt 而非静默消失（依据：index.json 的共享读-改-写在多会话并行下存在 lost update，ADR-2「单进程无并发」论证不成立，见 review-eng-core F4）
- [ ] 测试基座：
  - 策略 fixture：录制 kimi 真实 stream-json 输出为 fixture 文件（**须含 tool_calls 与 role=tool 行，断言产出结构化 tool_call/tool_result 事件**）；翻译 `legacy/backend/tests/test_codebuddy_strategy.py` 等策略用例为 vitest（翻译清单见附录 A）
  - FakeAdapter 测 `runAgentTurn` 全管线（persist→stream→finalize 事件序列断言）
  - 假 spawn 测 GenericCliAdapter（超时/interrupt/非零退出）
  - `session/parallel-sessions.test.ts`：两 FakeAdapter 会话并行回合，断言事件按 sessionId 归属、持久化互不污染（多会话隔离的唯一回归防线）
  - `adapters/interrupt-semantics.test.ts`：interrupt 后客户端恰好收到一条 `agent_complete(status='interrupted')`，无 error 级 complete（v2 缺陷回归）
  - **角色语气双防线**（替代原「注入断言」）：①rewriter 快照测试——固定 persona YAML + 固定输入，断言输出含 `voice.catchphrases`/`tone_rules` 特征、不含 `voice.taboos` 词句，输出与输入完全相同则测试失败（防「rewriter 静默原样返回」）；②`injectIntoAgent` 开启时假 spawn 录 argv，断言首轮 prompt 文本包含注入前缀（防 v2 死代码重演）
  - `jsonl-store.test.ts` 追加坏行容忍与 meta 原子重写用例
- [ ] 演示脚本 `packages/core/scripts/demo-kimi.ts`：node 直跑一轮真实 kimi 对话，事件序列打印

验收（门禁）：`pnpm -F @dionysus/core test` 全绿（含翻译后的策略用例与上述具名用例）；demo 脚本对真实 kimi CLI 完成一轮对话且事件序列符合 `@dionysus/protocol` 的 v3 schema（含 v=1、毫秒 ts、seq/turnId、tool_call/tool_result）——**不是**符合 v2 的 `extract/protocol.md`；两个会话并行跑回合互不干扰；rewriter 快照测试可证角色口吻真实产出。**协议与 core 接口过此门禁后冻结**。

## Phase 3：extension + webview 最小可用

**目标**：VS Code 内完成真实对话（无陪伴层）；「一眼知进展」的常驻状态面（sidebar 会话列表 + 活动栏 badge + StatusBar）与新手引导到位。

任务：

- [ ] extension：`activate`、`WebviewProvider`（editor panel + sidebar 容器）、`WebviewTransport`、`core-host` 装配（配置注入单引用）、命令（openChat/newSession/interrupt/selectAdapter）、`settings.json` 贡献点（按 architecture.md §6.5，description 用中文白话写清）
- [ ] **sidebar webview 会话列表**（QQ 式富列表，决策见 architecture.md ADR-14）：联系人式条目——persona 头像 + 会话名 + 状态点（running=转圈 / waiting_option=❗待决策 / error=❌ / idle=💤）+ 一行摘要（working 时优先 `3/7 · 正在改 auth.ts` 的 todo 进度格式）+ 未读角标（由 `session_digest_update` 的 seq 驱动）；待决策会话在活动栏图标累计 badge 计数；数据源为 `session_digest_update` 广播，客户端不自行推断状态
- [ ] **StatusBar 常驻状态面**：聚合显示「⏳N 运行中 ❗M 待决策」，点击聚焦会话列表
- [ ] **onboarding 引导流程**：承接 Phase 1 的 walkthrough——未检测到 CLI 时的安装引导页、首次启动多 CLI 选择器；出厂角色 kal'tsit 开箱可见，`dionysus.persona.default` 按素材库探测结果决定（不写死字符串）
- [ ] **版本适配展示**：适配器选择器与设置页展示「已适配版本 / 本机版本」（数据源 Phase 1 的 `testedVersions` + `--version` 探测），超范围显示警告角标不阻断（ADR-19：只能警告不能自愈）
- [ ] webview：`ClientTransport`（vscodeApi.postMessage 实现）、`messageRouter.ts` 纯函数（含 `session_digest_update`/sync/`global` 陪伴消息路由分支的显式用例）、按域拆分的 stores（sessionStore/streamStore/settingsStore，selector 派生 messages）、最小聊天 UI（消息列表 + markdown 渲染 + 流式追加 + 工具卡片自然语言文案「正在读取文件 `x.ts`」、原始参数默认折叠 + option 按钮 + 打断按钮 + 输入框 + 斜杠命令候选列表附一句话说明）
- [ ] 主题：VS Code 主题变量适配层（`--vscode-*` → token 映射），先单主题
- [ ] 宿主集成测试（@vscode/test-electron）：激活、webview 创建、user_input→agent_stream 通路（FakeAdapter 注入）
- [ ] `vsce package` 出首个内部 vsix

验收（门禁）：先过附录 A-2 视觉验收循环（sidebar 列表各状态、聊天 UI 截图经产品专家 agent 对比 `ux-core-flows.md` 收敛）；F5 调试宿主中**两个会话各自发起回合并行执行**，sidebar 会话列表实时显示两边状态点与动作摘要、StatusBar 聚合计数正确，切换查看互不干扰、打断互不影响；会话进入 waiting_option 时列表 ❗与活动栏 badge 出现；vsix 安装到新窗口可用。

## Phase 4：陪伴层 + 多 CLI

**目标**：Dionysus 的差异化体验完整回归（角色在场、语气注入、多 agent 调度汇报）。

任务：

- [ ] `core/persona`：loader（显式目录注入，zod 校验缺键回退 default persona 而非代码字面量）、CompanionEngine、Scheduler、TodoTracker（**改从结构化 tool_call/tool_result 事件提取 todo，不再扫文本**；todo 进度写入 `session_digest_update.todoProgress`）、Supervisor（adapterFactory 注入）、**rewriter.ts（template 引擎，ADR-12）**；内置中立 default persona + `assets/personas/` 的 exusiai/kal'tsit YAML（角色硬编码全部下沉）
- [ ] **Supervisor 完整语义（对齐 `extract/persona.md` §4，非「回合后回放」）**：周期轮询（默认 15s、下限 5s，可配）全部会话，fleet 聚合（N 工作/M 出错，**按各会话 todo 进度汇报**）+ 变动检测（会话创建/关闭/状态跃迁）+ 安静期跳过；回合结束另触发一次即时播报；播报 emotion 按语义（working/success/error/changed）经 status_to_emotion 链解析（修复 v2「恒 working」缺陷，extract/persona.md §7-7）；播报目标 persona 取最近活跃会话的 persona_id，与客户端可见性无关；**仅在至少一个客户端连接时才运行 LLM/CLI 生成**（纯模板模式不受限）；播报草稿经 rewriter 改写为角色口吻后下发
- [ ] **多声源汇报仲裁**：CompanionEngine（每会话）/Scheduler/Supervisor 三声源统一进一个出队口——每客户端可见台词最小间隔 3s；优先级 error/打断插播 > 回合完成 > Supervisor 周期播报 > 状态短语；同 tick 多候选合并为一条聚合句；Supervisor 播报与近 N 秒会话级台词语义重复则跳过（以 v2 去抖基线扩展，规则见 architecture.md §5.4）
- [ ] **persona YAML schema 增补与死字段裁决**：新增 `voice` 段五字段（tone/catchphrases/taboos/examples/rewriter_prompt，rewriter 客制化核心）、`scheduler_templates`（no_session/any_working/all_success/all_error/partial_error_single/partial_error_multi/all_idle）与 `supervisor_templates`（working/error/changed/idle）两段，逐键回退中立默认；死字段逐字段裁决（`keyword_replacements`/`random_insertions` → 由 rewriter template 引擎读取；`emotion_mapping` → 删除，表情映射只留 live2d 一处；`corpus_file`/`preferred_theme`/`theme_override` → 删除并入附录 B）；`system_prompt` 模板变量（`{session_id}`/`{working_dir}`）由 loader 校验，仅在 injectIntoAgent 增强开启时使用；runtime 对 builtin 逐键深合并（替代 v2 整文件屏蔽）；exusiai/kal'tsit YAML 补全套键（凯尔希克制口吻、能天使活泼口吻，取代 v2 kal'tsit 特判）
- [ ] **supervisor 配置 schema**（architecture.md §6.5）：`dionysus.supervisor.mode`（`disabled | template | agent_session | deepseek_api`，默认 `template`——零外部依赖、离线可用）、`dionysus.supervisor.intervalSeconds`、`dionysus.supervisor.adapterId`、`dionysus.supervisor.llm.{baseUrl,model}`；API key 走 VS Code SecretStorage，禁止落 settings.json；无可用 key 时静默降级模板模式、不产生错误消息
- [ ] **角色素材库管理页**（webview）：查看已安装素材、导入本地模型目录 / URL 下载、切换默认角色与 per-device 展示模式（`dionysus.character.display.{desktop,mobile}`）；**persona `voice` 客制化表单 + 「试听」按钮**（输入平淡汇报实时显示改写后口吻，ux-core-flows.md §5.5）
- [ ] webview：companionStore/live2dStore、Live2DViewer 迁移（基于 Phase 1 spike 成果，失败则启用静态立绘形态）、台词气泡（全局陪伴消息挂 Live2D 旁常驻气泡，跨会话不消失；气泡标注来源会话、点击跳转；汇报一律不进会话消息流）、情绪联动、touch_zones 交互（**决策：纯前端本地选句播表情，不经 core**）、sidebar 会话列表增强（对齐 ux-core-flows.md §2 的完整列表项规格与排序规则）
- [ ] 其余 4 策略：claude/codex/opencode/codebuddy（各自 fixture + 用例翻译；opencode 用真实 CLI 录制验证有无 tool_result 行，无则 UI 对该 CLI 降级为只显示调用）；策略共享 helper（文本块双事件、plan-mode 前缀常量）
- [ ] 斜杠命令补全（含 kimi 专有命令的 cliSpecific 委托）

验收（门禁）：先过附录 A-2 视觉验收循环（Live2D 陪伴区、旁白气泡、素材库管理页、voice 试听表单截图经产品专家 agent 对比收敛）；**两个会话并行跑 agent 观察 60 秒**：角色台词无同义重复、error 优先插播、全局聚合句与各会话状态一致、Supervisor 周期播报与回合内台词不刷屏；执行状态驱动 Live2D 表情/动作与台词（对齐 `extract/persona.md`）；点击头部/身体触发对应台词；5 个 CLI 各完成一轮真实对话（**两个不同 CLI 的会话并行**）；切换 persona 后汇报旁白的口吻差异可观测，rewriter 快照测试可证口吻真实产出。

## Phase 5：移动端

**目标**：手机扫码配对，浏览器完成对话与陪伴查看；主场景为「电脑发起长任务 → 锁屏离开 → 解锁秒懂进展 → 手机确认/打断」。**移动端按 P0/P1 分级，P1 可砍不影响门禁**（最重项 Live2D 对核心场景零贡献，后置，见 review-pm-mobile F-5）。

任务：

- [ ] extension：`lan-server`（Node http + ws，静态托管 + WS 端点；`EADDRINUSE` 自动递增端口重试，二维码始终用实际绑定端口；多窗口先到先得，后到窗口 disabled + system_notice；`lan.enabled: false` 时不启动服务；WS 在 `upgrade` 回调内先校验 token 再 `handleUpgrade`，失败直接 401 + destroy；30s 心跳、75s 无帧断开注销）、`PairingManager`（一次性 token、设备白名单、撤销、持久化 globalStorage、验票刷新 `last_seen`）、`WsTransport`、`dionysus.lan.*` 配置
- [ ] **配对弹层**：显示 token 剩余 TTL 倒计时，剩余 <30s 或过期自动换新 token 并重渲染二维码（附手动刷新按钮）；二维码内容改为 `http://<IP>:<port>/#pair=<token>`（hash 不进浏览器历史，前端读取后立即 `history.replaceState`）；文案固定含「手机需与电脑连接同一个 Wi-Fi」及排障入口；`lan.enabled` 为 false 时执行命令先弹确认框自动写回配置
- [ ] **sync 补拉与归来摘要**：mobile WS 断线重连（沿用 v2 策略：30s 心跳、指数退避 1s→30s、主动断开不重连；`visibilitychange` 回前台立即重连）后发 `sync_request { afterSeq }`，core 从环形缓冲回放；缓冲溢出时先发快照再续播；重连落后超阈值（或断连 >60s）时 Supervisor 单播一条内置模板归来摘要（「你离开期间：会话 A 完成 1 回合、调用工具 14 次；会话 B 在等待你确认选项」，零 LLM 依赖）；瞬态事件（companion_message、回合末 todo_update 终态）追加写入会话 JSONL 作为补拉数据源与汇报历史
- [ ] **资产 HTTP 路由与鉴权**：`GET /assets/*`（路径 normalize + 前缀校验防穿越，映射到内嵌 `assets/` 与 `globalStorageUri/character-library/`，`Cache-Control: private, max-age=300`）；鉴权采用 `?token=<device_token>` query（与 WS 统一，局域网 URL 携 token 的取舍记入 architecture.md §11）；HTTP API 统一 401 JSON，mobile 收到 401 清本地 token 跳配对页；路径穿越单测
- [ ] **option 超时与 waiting_option**：core 收到 `option_request` 置会话 `waiting_option`（正式启用该枚举，纳入 digest 与归来摘要），收到 `option_selected` 或回合结束清除；服务端强制 `timeout_seconds` 计时，超时动作做成会话级配置 `optionTimeoutAction: "deny" | "default" | "keep"`（默认 `keep`），超时广播 system_notice 说明结果
- [ ] **Remote-SSH 边界**：声明 `extensionKind: ["workspace"]`；配对页检测到 remote 环境时优先用 `vscode.env.asExternalUri` 生成二维码，不可用则直接显示「需 SSH 隧道/暂不支持」指引而非必失败的死码
- [ ] `packages/mobile`：从零构建（React + Vite + Tailwind + Zustand）；WS 版 `ClientTransport`；与 webview 共享 protocol 与基础组件；**界面仿手机 QQ**（ux-core-flows.md §6.2）：
  - **P0（门禁项）**：配对页（含 TTL 倒计时刷新）、**会话状态列表首页**（QQ 式：角色头像 + 标题 + 状态徽标 + 最后一条汇报预览 + 未读角标，点进才是单会话详情）、汇报/消息流（companion + supervisor 播报 + tool_call 操作时间线——单行 chip 默认折叠为计数条，点开展开）、选项确认条（waiting_option 时常驻醒目内联按钮，重连自动定位）、打断按钮、短指令输入（IME composition 保护 + 「离开模式」快捷开关走既有 `user_input.mode`）、断线重连与 sync 补拉、重连失败超 3 次显示「无法连接电脑，可能已休眠或 VS Code 已退出」横幅而非无限转圈、**三态主题**（柔和白/柔和黑/跟随系统）、**角色唤起抽屉**（对话页右上角按钮/上滑扫出底部 sheet，顶部露出内容区透出底部动态，静态立绘形态）、**工作状态全屏页**（对话页左滑进入 todo 进度+操作明细+汇报流，右滑返回）
  - **P1（可砍）**：移动端 Live2D 完整渲染管线（展示模式配置本身 P0 已生效，静态立绘为 P0 形态）、点触互动、sticker、会话设置修改（P0 只读展示）
- [ ] 多端一致性：webview 与 mobile 同会话并行连接，broadcast 两端同步（含 `user_message_echo` 回显与 `option_resolved` 竞态解决）；单端断开不影响适配器进程
- [ ] 配对流程集成测试（含过期 token 扫码被拒）；局域网真机手动验证（防火墙/AP 隔离/休眠排查指引写进 README）

验收（门禁，以「离开电脑场景全流程」为主线而非「手机能聊天」）：先过附录 A-2 视觉验收循环（移动端三屏 + 角色抽屉 + 工作状态页 + 浅/深色双态截图经产品专家 agent 对比收敛）；手机扫码→配对→**两台设备（桌面 webview + 手机）并行在线**发起两个会话的回合，两端列表实时同步、一端发消息另一端可见回显、任一端选选项另一端选项置已决；**真机锁屏 5 分钟后重连，断线期间的回合结果、工具操作计数、待确认选项与归来摘要全部可见**（不过此门禁 Phase 5 不算完成）；手机端无需翻屏即可说出 agent 正在/刚做了什么；未配对设备无法建立 WS；撤销设备后连接被断开；二维码过期自动刷新；Remote-SSH 窗口行为符合承诺（可用即通、不可用即有明确提示）。

## Phase 6：发布准备

- [ ] README（新形态：安装、配置、配对、FAQ——明示「手机端需保持浏览器页面打开才能实时收到汇报」「离开期间请保持电脑唤醒」）、CHANGELOG、LICENSE 文本补备（kal'tsit 素材随包分发已经用户确认无版权问题，LICENSE 由用户在发布前落实）
- [ ] CI 出 vsix 产物；`legacy/` 保留或删除的最终决策（建议 v3 稳定两个迭代后删除，git 历史仍在）
- [ ] marketplace 元数据（icon、categories、engines.vscode 下限）
- [ ] **发布前 agent 自测（执行 agent 自行启动 VS Code 验证，替代部分人工验收）**：
  1. 自动化：`@vscode/test-electron` 宿主集成测试全绿；`vsce package` 后 `code --install-extension` 装入真实 VS Code，命令行启动验证激活、walkthrough 出现、命令可执行；
  2. 视觉：macOS `screencapture` 截 VS Code 窗口（sidebar 列表/聊天/Live2D/配对弹层），Playwright 无头浏览器截移动端三屏 + 角色抽屉 + 工作状态页（v2 已有 `legacy/scripts/qa_mobile_chat.js` 先例可复用），截图经 ReadMediaFile 逐张核查；
  3. 诚实边界写入发布说明：截图级验证覆盖布局/内容/状态正确性；动画手感、抽屉跟手性、真实 CLI 长任务稳定性建议用户做一轮人工验收

验收：vsix 在干净环境安装即用（首次体验：CLI 检测 → walkthrough → 出厂角色 kal'tsit 开箱可见 → 第一轮对话全通）；文档与实现一致抽查通过；发布前自测三项完成且截图核查无阻断级视觉缺陷。

---

## 附录 A-2：UI 视觉验收流程（Phase 3/4/5 每个 UI 密集 Phase 的门禁前置步骤）

每个涉及 UI 的 Phase 完成后、门禁验收前，执行「截图 → 对比 → 修复 → 复拍」循环直至对齐：

1. **取景**：桌面端用 macOS `screencapture` 截 VS Code 窗口（覆盖 sidebar 会话列表各状态、tool_call 卡片、旁白气泡、配对弹层、素材库管理页）；移动端用 Playwright 无头浏览器按真机尺寸截三屏 + 角色抽屉 + 工作状态全屏页 + 浅/深色双态；
2. **自查**：执行 agent 用 ReadMediaFile 逐张查看，对照 `ux-core-flows.md` 的列表项八字段规格、tool_call 卡片三级层级、抽屉/手势呈现规范先行修复明显偏差；
3. **产品专家对比**：派产品专家视角的 subagent，输入截图 + `ux-core-flows.md` + `extract/design-style.md`（设计 token/组件视觉规范），以「新手用户会不会困惑、规格是否逐项落实」为标准产出差异清单（按严重度排序）；
4. **修复复拍**：按差异清单修复后重新截图复核，产品专家 agent 确认收敛后方准进入该 Phase 的门禁验收。

---

## 附录 A：pytest → vitest 翻译清单

基线：`legacy/backend/tests/` 37 用例全过。逐文件对应（翻译 = 同语义 vitest 用例，放对应包的 `__tests__/`）：

| 旧测试文件 | 用例内容 | v3 落点 |
|---|---|---|
| test_codebuddy_strategy.py | codebuddy 参数构建/事件解析 | core `__tests__/strategies/codebuddy.test.ts`（Phase 4，Phase 2 先建 kimi 等价物） |
| test_supervisor.py | supervisor 3 个 async 行为 + fleet + settings 往返 | core `__tests__/persona/supervisor.test.ts`（Phase 4，按 15s 轮询 fleet 完整语义改写） |
| test_session_store.py | SQLite CRUD | core `__tests__/session/jsonl-store.test.ts`（改写为无 index 的 JSONL 语义 + 坏行容忍，Phase 2） |
| test_pairing.py | 配对含端点校验 | extension 配对集成测试（Phase 5） |
| test_broadcast_callbacks.py | 多连接广播 | core `__tests__/broadcast.test.ts`（Phase 2，含环形缓冲与 sync 回放） |
| test_persona_avatar.py | persona 头像端点 | 语义并入 persona loader 测试（Phase 4）；移动端头像走 `/assets/*` 路由（Phase 5） |
| test_adapter_registry.py | 配置驱动注册 | core `__tests__/adapters/registry.test.ts`（Phase 2；注意旧测试依赖真实 server.yaml，新版用注入配置隔离；registry 只暴露 createAdapter 工厂） |
| test_session_isolation.py | 手写脚本非 pytest | 语义由 Phase 2 具名用例 `session/parallel-sessions.test.ts`（两会话并行互不污染）承接 |

前端旧测试（chatStore.thinking、ThinkingSection）随 store 重设计重写，不逐条翻译。

## 附录 B：范围外清单（变更需显式决策）

壁纸、TTS/语音、Electron 打包、独立 Bridge CLI（移动端脱离 VS Code 的解法，Phase 6 后评估，评估时把「休眠场景」列为首要动机）、旧 SQLite 会话迁移、msgpack/短代码协议、亲和度系统（v2 设计稿有、实现无）、多 workspace 会话隔离增强、断线期间完整事件回放（v3.0 只做环形缓冲补拉 + 归来摘要）、persona 死字段 `corpus_file`/`preferred_theme`/`theme_override`（已裁决删除，若复活需显式决策）、**桌面端调色/壁纸主题系统（ThemeManager/ThemeStudio/`assets/themes`，ADR-20——跟随 VS Code 皮肤，若复活需显式决策）**、CLI 解析的自动修复（ADR-19：版本适配只检测/展示/警告；格式探针诊断为 P1 手动命令 `dionysus.redetectAgents`）。

**Web Push / PWA 系统级通知：明示放弃。** 原因：局域网 `http://<IP>:<port>` 非 secure context，Service Worker 与 Web Push 在手机浏览器上不可用，锁屏期间主动推送在当前形态下无解（除非未来 Bridge CLI 上 HTTPS 或做原生壳，见上条）。体验目标因此正确定义为「锁屏期间零打扰，解锁打开 3 秒内呈现离开期间发生了什么」（sync 补拉 + 归来摘要），而非实时推送（依据：review-pm-mobile F-1 平台约束）。

## 附录 C：风险登记册

沿用 `architecture.md` §13（R-1 Live2D spike 已前置到 Phase 1 门禁，且静态立绘降级形态已在 Phase 1 落地、不依赖 spike 结果）。新增过程风险：

- **R-6 提取文档与实现出入**：实现中发现 extract 文档错误时，先修订文档再改实现，保持文档为可信基线；
- **R-7 pnpm 不可用**：兜底 npm workspaces，结构不变；
- **R-8 笔记本合盖/休眠致移动端静默失效（预设场景外，降级）**：用户已确认使用场景为「电脑保持唤醒、agent 持续工作，仅手机锁屏」（2026-07）。保留防线：配对页与 README FAQ 提示「离开期间请保持电脑唤醒」；移动端重连失败超 3 次显示明确休眠/退出横幅而非无限转圈（Phase 5 已落地）；
- **R-9 Supervisor LLM 成本**：`agent_session`/`deepseek_api` 模式下 15s 轮询每次有变动即烧一次 CLI/API 调用，无人观看时照烧。对策：v3.0 默认 `template` 纯模板模式（零外部依赖）；Supervisor 仅在至少一个客户端连接时才运行 LLM/CLI 生成（Phase 4 已落地）；安静期跳过机制保留；
- **R-10 角色语气二次沦为死代码（v2 已发生一次的失败方式）**：rewriter 路线下失败形态变为「rewriter 静默原样返回、台词毫无角色味，测试照绿」。对策：rewriter 快照测试前置到 Phase 2 接口冻结门禁（固定输入断言输出含 voice 特征、与输入不完全相同）；可选注入增强（injectIntoAgent）保留假 spawn 录 argv 断言（Phase 2 已落地双重防线）。
