# Dionysus v3 设计审阅报告 —— 新手用户视角

> 审阅人视角：不了解任何技术概念、第一次打开这个 VS Code 插件的用户。
> 审阅范围：`docs/v3/architecture.md`、`docs/v3/roadmap.md`、`docs/v3/README.md`，及 `docs/v3/extract/` 下 config-and-assets / pairing-mobile / persona / design-style / webview-inventory。
> 验收基准：核心功能 ①仿 QQ 的 agent 对话与管理；②Live2D 陪伴与角色语气注入；③有角色陪伴的多 agent 进度/调度汇报；④明显的 agent 操作显示；⑤移动端离开电脑时收汇报、发短指令、看进展。

---

## 发现清单（按严重度排序）

### 1.【阻断 · 功能②】Live2D 模型不随插件分发，新手装完插件看不到角色，且无引导、无桌面端降级方案

- **出处**：`architecture.md` §3 monorepo 布局（第 90 行：「`assets/live2d/` 不随 vsix 分发……改为插件首次启动时提示用户自行放置模型目录（`globalStorageUri/live2d/`）或从用户提供的 URL 下载」）；§6.5 默认配置 `"dionysus.persona.default": "exusiai"`；`extract/config-and-assets.md` §5.5（版权原因不可分发的决策依据）。
- **问题**：默认 persona 写死为 `exusiai`，但 exusiai 的模型文件不在插件包里。新手安装插件后：没有角色形象、不知道什么是 Live2D 模型、不知道去哪找模型文件、更没有"用户提供的 URL"。§3 只写了"首次启动时提示"，但提示长什么样、有没有步骤引导、用户跳过之后界面显示什么，全部没有规格。更矛盾的是：移动端 §8 明确允许"降级为静态立绘 + 台词气泡"，**桌面端却没有定义任何无模型时的降级形态**——功能②（Live2D 陪伴"一进来就能感知到"）在新手第一台机器上实际为零。另外 `exusiai`（能天使）这个角色名本身对新用户也是黑话，角色不存在时语气台词里的人设会悬空。
- **修改建议**：
  1. 在 `architecture.md` §7（webview 包）增加"首次启动与模型引导"小节，规格化三步引导：检测 `globalStorageUri/live2d/` 有无可用模型 → 无则展示引导页（a. 拖入/选择本地模型目录；b. 粘贴 URL 下载；c. 跳过，使用静态立绘模式），并给出"什么样的文件算一个模型"的图文说明。
  2. 补一个**无版权风险的自带示例角色**（自制静态立绘 + 中立 default persona 台词），保证任何安装开箱即有"角色在场"；§5.4 已要求 core 内置中立 default persona，将其提升为首次安装的可见默认，而不是写死 `exusiai`。
  3. 桌面端补齐与移动端 §8 同级的降级规格：无模型时 Live2D 区域渲染静态立绘 + 台词气泡，`emotion_update` 仅驱动气泡文案与表情贴图切换。
  4. `dionysus.persona.default` 的默认值改为：已安装模型对应的 persona 优先，否则落到中立 default persona（core 启动时按资产探测结果决定，不写死字符串）。

### 2.【高 · 功能①】首次使用路径断裂：无 CLI 安装检测、无新手引导（walkthrough），默认 adapter 写死 `kimi_cli`

- **出处**：`architecture.md` §5.2（spawn 失败只产生错误事件）、§6.5（`"dionysus.adapter.default": "kimi_cli"`）；`roadmap.md` Phase 1–6（全文无 onboarding/walkthrough 任务）。
- **问题**：这个插件本身不含 agent，agent 是用户机器上另行安装的 kimi/claude/codex 等 CLI。新手装完插件、打开聊天、发出第一句话，最可能得到的是 `spawn kimi ENOENT` 之类的错误事件——文档只说"崩溃即报错事件"，没有任何"插件激活时检测 CLI 是否存在"的设计，也没有检测到缺失时的引导（装哪个、怎么装、去哪装）。即使用户装的是 Claude Code 而非 Kimi，也得自己去 settings.json 里改 `dionysus.adapter.default` 才能用上——这对"不了解任何技术概念"的用户是第一道流失点。roadmap 六个 Phase 均未包含 VS Code 原生的 `contributes.walkthroughs` 或任何首次启动引导。
- **修改建议**：
  1. `architecture.md` §6 增加"激活时环境检测"：extension `activate` 时对五个 CLI 执行 `which`/`where` 探测，结果写入 core 装配配置；未找到任何 CLI 时，webview 显示引导页（各 CLI 的一句话简介 + 一键复制的安装命令 + 官方安装文档链接），而不是等用户发消息才报错。
  2. `dionysus.adapter.default` 语义改为"未设置时使用首个检测到的可用 CLI"，检测到多个时首次启动弹一个简单选择器。
  3. `roadmap.md` Phase 3 增加任务：贡献 VS Code walkthrough（安装 agent CLI → 打开 Dionysus 聊天 → 完成第一轮对话 → 扫码配对手机），并在 package.json 声明 `contributes.walkthroughs`。

### 3.【高 · 功能①】「仿 QQ 的会话列表 + 一眼看出每个 agent 在干嘛」在 v3 没有落地规格

- **出处**：`architecture.md` §6.1（`webview-provider.ts # editor panel + sidebar webview 容器`——只定义了容器，未定义 sidebar 里放什么）；`roadmap.md` Phase 4（仅一句"SessionList（VS Code 风格）"）；`extract/webview-inventory.md` §2（Layout/NavSidebar 标注"丢弃（VS Code 活动栏取代之）"、"v3 桌面是 webview 单栏"；SessionList 标注"需改造迁移（改 VS Code TreeView 或 webview 列表）"——二选一未定）。
- **问题**：功能①要求的"左侧会话列表、每个会话像一个联系人/群聊、一眼看出每个 agent 在干嘛"是产品定义的第一条，但 v3 文档里：a) sidebar webview 的内容没有任何定义——会话列表到底在 VS Code TreeView 还是在 webview 里，两处文档说法不一致；b) 会话列表项长什么样（头像？状态点？当前动作摘要？未读角标？）零描述；c) v2 的三栏 QQ 式布局被明确丢弃后，没有任何新布局图/规格接住"QQ 感"这个体验目标。多 agent 并行时"每个 agent 在干嘛"的实时状态在列表层的展示完全缺席（数据基础 BroadcastHub 已具备，缺的是 UI 规格）。
- **修改建议**：
  1. 在 `architecture.md` §7 增加"桌面端布局"小节，明确分工：**sidebar webview = 会话列表**（联系人式条目：persona 头像 + 会话名 + 在线/工作中状态点 + 一行当前动作摘要如"正在读 auth.ts" + 完成/未读角标），**editor panel = 当前会话的聊天流 + Live2D 陪伴区**；并删除或调和 webview-inventory 中"TreeView 或 webview 列表"的悬置表述。
  2. 规格化会话列表项的状态机：idle / working（附当前 tool_call 摘要）/ waiting_input（选项待选，类似 QQ 的"@我"提醒）/ done（未读角标）/ error，数据源为已有的 `status_update`/`tool_call`/`option_request` 广播。
  3. `roadmap.md` Phase 4 的"SessionList（VS Code 风格）"改写为指向上述规格的具体任务，验收标准补"两个会话并行工作时，列表各自实时显示当前动作"。

### 4.【中 · 功能③】全局调度汇报（`session_id="global"` 的陪伴消息）在 v3 UI 里没有归属位置

- **出处**：`architecture.md` §7（按域拆 store：sessionStore/streamStore/companionStore……消息路由 `messageRouter.ts`）；`extract/persona.md` §3.4（scheduler 聚合反应以 `session_id="global"` 发出，与单会话消息区分）。
- **问题**：功能③要求"有角色陪伴的多 agent 进度汇报和调度汇报"。v3 保留了 CompanionScheduler，但文档没有说明 `global` 陪伴消息在 UI 上渲染在哪：它不属于任何会话（sessionStore 按会话组织），新手在 A 会话里聊天时，B 会话干完活的汇报显示在哪里、会不会被看见、错过之后去哪找，均无规格。风险是实现时被塞进当前会话消息流（张冠李戴）或被静默丢弃。
- **修改建议**：
  1. `architecture.md` §7 的 companionStore 条目补一句：全局陪伴消息（`session_id="global"`）渲染在 Live2D 陪伴区的常驻气泡（跨会话、不随会话切换消失），同时在对应会话的列表项上落完成/未读标记（与发现 3 的列表状态机联动）。
  2. `messageRouter.ts` 的纯函数设计中加入 `global` 路由分支的显式用例（roadmap Phase 3/4 测试清单同步补）。

### 5.【中 · 功能⑤】移动端配对的前置步骤对新手是隐藏关卡；二维码 TTL 倒计时/刷新未写入 v3 规格

- **出处**：`architecture.md` §6.3（`dionysus.lan.enabled` 默认 `false`，需手动改 settings.json 才绑定 `0.0.0.0`）、§6.4（配对管理器）、§9.2（配对链路）；`extract/pairing-mobile.md` §5 缺陷 4（v2 二维码 300 秒过期无倒计时无刷新，"v3 应显示 TTL 倒计时并自动刷新"）。
- **问题**：a) 新手要用手机端，需要先把一个名为 `dionysus.lan.enabled` 的 JSON 配置改成 `true`，再找到命令面板里的"显示配对二维码"——两步都无任何引导，且"lan"这个词对新手无意义。b) extract 文档明确把"QR 倒计时 + 自动刷新"列为 v3 必修项，但 `architecture.md` §6.4/§9.2 只写了 token 一次性 + 白名单，**倒计时与刷新没有被承接进 v3 规格**，有遗失风险。c) 二维码弹层是否提示"手机需与电脑连接同一 Wi-Fi"未规定（R-3 只说了配对页给排障指引，桌面侧弹层没提）。
- **修改建议**：
  1. §6.4 补：执行「显示配对二维码」命令时若 `lan.enabled` 为 `false`，弹确认框"需要开启局域网连接才能让手机访问，是否开启？"，确认后自动写回配置并生效，无需手动编辑 settings.json。
  2. §6.4 配对弹层规格补：显示 pair token 剩余有效秒数倒计时，到期自动换新 token 并重渲染二维码（承接 extract/pairing-mobile.md §5.4）。
  3. 弹层文案固定包含"手机需与电脑连接同一个 Wi-Fi"及排障入口（防火墙/AP 隔离），与 R-3 对策呼应。

### 6.【中 · 功能⑤】移动端没有通知机制，"离开电脑时收到汇报"在锁屏/切后台后不成立

- **出处**：`architecture.md` §8（mobile 包：WS 连接、配对页、聊天页——无通知能力描述）、§2/§6.3（传输即 WebSocket）；`roadmap.md` 附录 B（范围外清单未提及推送）。
- **问题**：功能⑤的场景是"用户短暂离开电脑（如吃饭）"。此时手机大概率锁屏或浏览器在后台，WS 会断或被系统挂起，agent 干完活的汇报**不会触达**用户——用户要主动想起并重新打开页面才能看到。这对新手是"说好的汇报怎么没来"的直接落差。文档既未声明这一限制，也未给任何缓解设计。
- **修改建议**：
  1. §8 mobile 包补三条最小缓解：页面可见性恢复时自动带 token 重连并拉取 missed 消息；会话完成/出错时页面内未读角标 + 可选提示音（前台时）；标题栏闪烁/数字角标。
  2. Phase 6 的 README 任务中明示限制："手机端需保持浏览器页面打开才能实时收到汇报"。
  3. 附录 B 范围外清单增加"PWA / Web Push 通知"条目，标注为后续候选，避免评审时被认为遗漏。

### 7.【中 · 功能②/配置】Supervisor（播报员）在 v3 只有一个布尔开关，模式与密钥配置缺失

- **出处**：`architecture.md` §6.5（仅 `"dionysus.supervisor.enabled": true`）；`extract/persona.md` §4.1（v2 `SupervisorConfig` 有 `mode: disabled | agent_session | deepseek_api`、`api_key` 等 6 个键，缺省回退环境变量 `DEEPSEEK_API_KEY`）。
- **问题**：v3 把 supervisor 浓缩成一个 `enabled` 布尔，但 v2 规格里它有三种模式且默认 `deepseek_api` 需要 API key。v3 未定义：默认走哪种模式？密钥放哪里（settings.json 明文存密钥不合适）？无密钥时是静默降级内置模板还是报错？新手默认 `enabled: true` 装上后，这条链路的行为完全未定义——运气好是模板播报（可用），运气差是每 15 秒一条错误。
- **修改建议**：§6.5 配置清单补 `dionysus.supervisor.mode`（默认 `template`，即不依赖任何外部服务的内置模板；`agent_session` 复用已配置 CLI、零额外成本，可作推荐进阶值）；如需第三方 LLM key，走 VS Code `SecretStorage` + 设置界面引导输入，禁止落 settings.json；并写明"无可用 key 时静默降级模板模式、不产生错误消息"。

### 8.【低 · 功能①/③】用户可见文案中的技术黑话：Adapter、persona、supervisor、/yolo

- **出处**：`architecture.md` §6.5（命令 `dionysus.selectAdapter`、设置键 `dionysus.adapter.default`、`dionysus.persona.default`、`dionysus.supervisor.enabled`）；`roadmap.md` Phase 2/4（斜杠命令 `/plan` `/yolo` 等沿用自 v2，`extract/pairing-mobile.md` §4.3 输入框基线）。
- **问题**：命令面板里的 "Select Adapter"、设置里的 "persona"、"supervisor"，以及斜杠命令 `/yolo`（YOLO 模式 = 自动批准所有操作，新手看到这个词完全无法联想其含义）都是工程师黑话。新手在命令面板搜"角色""助手"会搜不到任何东西。
- **修改建议**：
  1. 用户可见命名改为：Adapter → "AI 助手/Agent"（`dionysus.selectAdapter` 显示名 "Dionysus: 选择 AI 助手"）；persona → "角色"；supervisor → "播报"。配置键名可保留英文，但 `description` 用中文白话写清（settings 贡献点自带 description 字段，§6.5 示例应补上）。
  2. 斜杠命令在输入框提供候选列表 + 一句话说明（如 `/yolo — 让 agent 自动执行所有操作，不再逐条确认`），该交互补进 §7 或 roadmap Phase 4 斜杠命令任务。

### 9.【低 · 功能④】工具操作显示的协议设计无欠缺，仅缺新手友好的文案规格

- **出处**：`architecture.md` §4.1（结构化 `tool_call`/`tool_result` 取代 v2 emoji 正则解析）；`extract/persona.md` §1.2（`status_phrases` 7 键：thinking/reading_file/executing/outputting 等）。
- **问题说明**：功能④（明显的 agent 操作显示）在协议层设计是**无欠缺**的——结构化 tool_call 直接解决了 v2 的解析脆弱问题，角色的 status_phrases（如"正在读文件"）也提供了自然语言层。唯一的缺口是：v3 文档没有规定 UI 上工具调用卡片的展示文案。若直接渲染工具名（如 `read_file`、`execute_command`）和原始参数 JSON，新手看不懂。
- **修改建议**：在 §7 或 `extract/design-style.md` 的 v3 承接部分补一条规格：工具卡片主文案使用自然语言模板（"正在读取文件 `xxx.ts`"、"正在运行命令 `npm test`"，由 tool_call 类型 + 关键参数渲染），原始参数默认折叠；视觉显著性沿用 v2 ToolHUD 的浮卡动效（design-style.md §4.6 已有清单，可直接迁移）。

---

## 明确"无欠缺"的方面

- **配对安全模型**（功能⑤）：token 一次性 + 设备白名单 + WS 握手强制校验 + 二维码内容为可扫码直达的 URL（§6.4、§9.2、ADR-7），完整修复了 v2 的裸奔漏洞和扫码不跳转缺陷，对新手也意味着"扫码即用"的顺畅路径。无欠缺（除发现 5 的两处承接遗漏）。
- **工作目录默认值**（配置环节）：`dionysus.workingDir` 默认 `${workspaceFolder}` 跟随当前工作区（§6.5），新手无需理解 working_dir 概念即可开箱正确。无欠缺。
- **多端一致性**（功能⑤）：webview 与 mobile 共用 protocol + BroadcastHub 广播（ADR-4），两端消息天然同步；客户端断开不误杀 CLI 进程（§5.3），手机关掉页面再打开不会把电脑上跑着的 agent 弄死。无欠缺。
- **主题与 VS Code 协调**（功能①观感）：`--vscode-*` 变量适配层（§7）保证插件界面不突兀；内置暗/亮主题直接可用，新手无需配置。无欠缺。
- **错误表达**（通用）：`agent_complete` 的 `status="error"` + `system_notice` 统一错误通道（§4.1），比 v2 的隐式失败对新手更友好。无欠缺。

---

## 总评

v3 架构在**工程层面**是扎实的：协议单真源、core 宿主无关、配对安全闭环、v2 缺陷逐条有对策，这些地基撑得住五个核心功能的"运行"。但从新手视角看，**"装完之后的前 10 分钟"几乎没有被设计**——文档的默认读者显然是有 CLI 和模型资产的老用户。整体判断：骨架撑得住核心功能，但功能①②⑤的新手体验存在实质缺口，不补会导致"装得上、看不见角色、发不出第一条消息、手机连不上"的四连流失。

最大的三个缺口：

1. **Live2D 陪伴开箱不可见**（发现 1）：资产不分发是版权约束下的正确决策，但没有用"自带示例角色 + 三步引导 + 桌面端降级"接住，功能②对新手等于不存在，且默认 persona 写死 `exusiai` 与之直接矛盾。
2. **首次使用路径断裂**（发现 2、3）：无 CLI 检测、无 walkthrough、默认 adapter 写死，新手从"安装插件"到"第一轮对话成功"之间没有任何扶手；同时"仿 QQ 的会话列表"这一头号功能连 UI 载体（TreeView 还是 webview、列表项显示什么状态）都没有定稿。
3. **移动端的"收到汇报"闭环不完整**（发现 5、6）：配对要过隐藏的配置关卡，且锁屏/后台后没有任何通知机制——功能⑤的核心场景（离开电脑吃饭时被触达）在当前设计下不成立，至少需要重连 + 未读 + 明示限制的缓解组合。
