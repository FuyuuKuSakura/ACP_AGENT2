# Dionysus v3 UX 核心流程与信息架构

> 版本：v3.0-draft · 状态：随 architecture.md 一同审阅
> 本文档定义 v3 的交互与信息架构规格：桌面端 QQ 式会话管理、agent 操作显示、角色汇报通道、新手引导、移动端 MVP 分级。
> 技术底座以 `architecture.md` 为准（协议消息 §4.1、core 模块 §5、webview §7、mobile §8）；本文只做 UX 层决策，不重复接口定义。视觉 token 沿用 `extract/design-style.md`，移动端功能基线沿用 `extract/pairing-mobile.md` §4.3。

## 1. 产品核心功能定义

v3 一切 UX 决策按以下五条验收（顺序即优先级）：

1. **仿 QQ 的 agent 对话与管理**：左侧会话列表像联系人列表，一眼看出每个 agent 在干嘛、哪个需要我处理；
2. **Live2D 陪伴与角色语气注入**：装完插件角色即在场，agent 输出带角色语气；
3. **有角色陪伴的多 agent 进度/调度汇报**：角色单向输出（用户不能、也不需要对角色说话），多会话进展由角色聚合播报；
4. **明显的 agent 操作显示**：读文件/改代码/跑命令在界面上显著可见，不靠翻日志；
5. **移动端离机场景**：离开电脑时能在手机上收汇报、发短指令、随时看清进展。

「核心功能是否可用」是全部 UX 取舍的最高判断标准；与工程简洁冲突时，先保功能可用，再求实现简单。

## 2. QQ 式信息架构（桌面端）

### 2.1 布局分工

```
┌─ VS Code 窗口 ────────────────────────────────────────────┐
│ 活动栏        sidebar webview          editor panel        │
│ ┌────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│ │ Dionysus│  │ 全部会话 聚合条 │  │ 聊天流（消息 + 操作卡片）  │ │
│ │ 图标    │  │ ────────────  │  │ ──────────────────── │ │
│ │ (badge) │  │ 会话列表项 × N │  │ Live2D 陪伴区         │ │
│ └────────┘  │              │  │ （角色 + 旁白气泡）      │ │
│             └──────────────┘  └────────────────────────┘ │
│ StatusBar：⏳2 运行中 ❗1 待决策（点击聚焦会话列表）           │
└──────────────────────────────────────────────────────────┘
```

- **sidebar webview = 会话列表**（联系人式，主载体）。会话列表放 webview 而非 TreeView：列表项需要 persona 头像、状态点、未读角标、一行汇报摘要等富渲染，TreeView 表达能力不足（`extract/webview-inventory.md` §2 中「TreeView 或 webview 列表」的悬置项，此处裁决为 webview 列表）。
- **editor panel = 当前会话**：聊天流 + Live2D 陪伴区。Live2D 单实例，跟随当前聚焦会话的 persona 切换（模型切换带加载态与静态立绘兜底）。
- **面板被盖住时的常驻状态面**：活动栏图标 badge（累计待处理计数 = waiting_option + error + 未读会话数）与 StatusBarItem 聚合文案（`⏳N 运行中 ❗M 待决策`，点击聚焦列表）。用户不打开面板也能一眼得知全局进展。

### 2.2 会话列表项完整规格

每个列表项 = 一行联系人卡片，字段自上而下：

| 字段 | 规格 | 数据源 |
|---|---|---|
| 会话名 | 单行截断；首个回合完成后自动以首条用户消息截断 20 字符生成，用户手动重命名后不再自动覆盖（修复 v2「新会话」永不更新缺陷，`extract/session.md` §7.9） | SessionMeta.title |
| persona 标识 | 左侧圆形头像（`extract/design-style.md` §4.1 `.cel-avatar`）；无模型的 persona 用静态立绘头像 | session.personaId |
| adapter 标识 | 头像右下角小圆标（CLI 图标/首字母），区分「同角色不同 agent」 | session.adapterId |
| 状态点 | 头像左侧 8px 圆点，五态：**idle**（灰）· **thinking**（金色呼吸动画）· **executing**（金色常亮，`--dionysus-status-busy`）· **waiting_option**（橙红，attention 色）· **error**（`--dionysus-status-danger`）。色值见 `extract/design-style.md` §1.2/§1.4 | `session_digest_update.status` |
| 一行摘要 | 灰色小字单行：进行中优先显示 **todo 进度 + 当前动作**（`3/7 · 正在改 auth.ts`，调度汇报口径「7 步做到第 3 步」；无 todo 时退化显示当前动作「正在读取 auth.ts」），空闲显示最后一条角色汇报摘要 | `session_digest_update.todoProgress` / `currentAction` / companion_message |
| 未读角标 | 右侧数字角标（完成后新增的回合数），进入会话即清零；依据 digest `seq` 单调序号本地差值计算 | `session_digest_update.seq` |
| 待决策标记 | `waiting_option` 时角标替换为 ❗，与未读数字互斥（待决策优先级更高） | `pendingOptionRequest` |
| 最后活动时间 | 摘要行右端相对时间（「3 分钟前」） | `lastActivityAt` |

状态数据一律来自 core 广播的 `session_digest_update`（S→C，架构 §4.1 修订新增），客户端**不**自行从原始事件流推断状态——两端（webview/mobile）渲染同一权威值，避免行为漂移。

### 2.3 「全部会话」聚合视图

列表顶部常驻一条**聚合条**（非会话、不可删除）：`⏳2 运行中 · ❗1 待决策 · ✅3 已完成`，点击聚焦 Live2D 陪伴区并展开最近的角色全局汇报（fleet 级 `companion_message`，`scope: "global"`）。它是调度汇报（功能③）的列表层入口：用户不进任何会话也能确认「整体干到哪了」。聚合条与 StatusBarItem 文案同源，口径一致。

### 2.4 列表排序规则

按状态优先级分组排序，组内按 `lastActivityAt` 倒序：

1. **waiting_option**（需要我决策，置顶——类比 QQ 的「@我」）
2. **error**（需要我处理）
3. **thinking / executing**（进行中）
4. **idle**（空闲，含已完成未读）

v3.0 不做手动置顶/分组折叠（KISS）；排序完全由状态驱动，保证「最该看的会话永远在最上面」。新建会话瞬间置顶于 idle 组首位。

## 3. agent 操作显示规范（tool_call 卡片）

功能④依赖结构化 `tool_call` / `tool_result` 消息（架构 §4.1 修订新增，schema 含 `toolCallId/name/kind/displayArgs` 与 `ok/content/durationMs`），取代 v2 前端 emoji 正则刮文本（`extract/protocol.md` §9.4）。UI 契约如下。

### 3.1 卡片信息层级

一张 tool 卡片分三层，默认只露出 L1+L2：

- **L1 自然语言动作描述**：「正在读取文件 `auth.ts`」「正在修改 `login.tsx`」「正在运行 `pnpm test`」——由 `kind` + `displayArgs` 经模板渲染，措辞可复用 persona `status_phrases` 的状态文案（`extract/persona.md` §1.2），**不直接渲染工具原名**（`read_file`、`execute_command` 对新手是黑话）。
- **L2 状态与耗时**：行内状态动画——进行中旋转 Loader（复用 `extract/design-style.md` §4.3 StreamingStatusBox 模式）、成功 ✓、失败 ✗（danger 色），完成后右侧显示耗时（`1.2s`）。
- **L3 可展开详情**：默认折叠，点击展开原始参数 JSON 与结果摘要（截断内容标注 truncated）。ChevronDown 旋转过渡沿用 ThinkingSection 模式（`extract/design-style.md` §4.3）。

### 3.2 kind 分类的视觉区分

| kind | 图标 | 视觉 |
|---|---|---|
| `read` | 📖 | 中性灰边框，显著度最低 |
| `edit` / `write` | ✏️ | 主色描边（`--dionysus-primary` 金系，`extract/design-style.md` §1.2），显著度最高——改代码是用户最关心的事件 |
| `bash` | ⚡ | accent 色描边 + 等宽字体命令行 |
| `search` / `other` | 🔍 / 🔧 | 中性色，弱化 |

卡片基底样式沿用 v2 ToolPanel 工具卡（`rounded-xl border-2 border-dionysus-glass-border bg-dionysus-glass-highlight`，`extract/design-style.md` §4.4），入场弹入动效沿用 ToolHUD 浮卡参数（spring damping 22 stiffness 260，§4.6）。

### 3.3 操作流与会话气泡的关系

- 工具卡片**不是聊天气泡**：不进入 agent 消息正文，渲染为相邻气泡之间的「操作条带」（左对齐、宽度窄于气泡、无头像），与气泡在时序上穿插排列——用户读到的是「agent 说 → 做了什么 → 又说」的自然顺序。
- **回合内聚合**：同一回合连续工具调用默认折叠为计数条（「本回合已执行 14 项操作 · 正在：读取 auth.ts」），点击展开明细时间线；当前正在执行的一张卡片始终展开。回合结束后整体折叠为一行摘要，明细仍可展开。
- **瞬态与回放**：卡片不写入会话 Message（JSONL 消息行只存 user/agent/system），但以 event 行落盘（架构 §5.3 修订），重开会话/移动端重连后恢复为静态摘要条，无动画。
- 移动端呈现相同卡片，默认形态为 chip 折叠（见 §6.2）。

## 4. 角色汇报通道（旁白气泡）

功能③的核心约束：**汇报是单向旁白，不是对话**。

### 4.1 呈现规范

- **渲染位置**：桌面端为 Live2D 角色上方的台词气泡（CharacterDialogBox，`extract/design-style.md` §4.5；组件迁移路径见 `extract/webview-inventory.md` §2.4），常驻于陪伴区、**跨会话切换不消失**；移动端为陪伴视图顶部的旁白条。
- **不进会话消息流**：汇报消息（`companion_message`）不持久化为 Message、不出现在聊天气泡序列里，只进 `companionStore`——张冠李戴地把 B 会话的汇报塞进 A 会话的消息流是禁止项。全局汇报用 `payload.scope: "global"` 标识，废弃 v2 的 `session_id="global"` 魔法字符串（v2 前端需特判重映射的缺陷，`extract/protocol.md` §2）。
- **不遮挡输入区**：气泡定位于角色上方区域，输入框常驻底部不被覆盖；气泡多条时旧句下沉、新句浮入（`popLayout` 换位动画，`extract/design-style.md` §4.6），最多同屏 3 条，超出进历史展开。
- **来源标注**：多会话场景的汇报气泡右下角小字标注来源（`source_session_id` + 会话名，如「来自：重构 auth」），点击跳转对应会话——这是多 agent 汇报可辨认性的最小成本方案。
- **角色口吻的来源**：全部汇报文本经 `persona/rewriter.ts` 改写为角色口吻后呈现（rewriter 路线，ADR-12——agent 的实质回复不被改写，角色语气只活在角色通道）；口吻风格由 persona YAML 的 `voice` 段驱动（见 §5.5）。
- **聚合文案示例**（YAML 驱动，`scheduler_templates` / `supervisor_templates`，缺键回退中立 default persona）：
  - 单会话完成：「auth 重构搞定啦~ 要看看结果吗？」
  - 多会话聚合：「2 个任务还在跑，auth 重构已经完工咯」
  - 异常优先：「mobile 适配报错了！其他 2 个任务还在继续」
  - 全部空闲：「所有任务都完成啦，老板辛苦了」

### 4.2 汇报频率与打扰度控制

三个声源（每会话 CompanionEngine、跨会话 Scheduler、周期 Supervisor）统一经一个出队口仲裁，规则：

1. **最小间隔**：同一客户端可见台词间隔 ≥ 3 秒；
2. **优先级**：error / 打断插播 > 回合完成 > Supervisor 周期播报 > 状态短语；高优先级可打断低优先级队列；
3. **同 tick 合并**：同一仲裁周期内的多条候选合并为一条聚合句（走 `scheduler_templates`），N 个会话并行完工不产生 N 条台词；
4. **安静期跳过**：聚合状态无变化时不重复播报（沿用 v2 的 idle 去抖基线，`extract/persona.md` §3.3）；
5. **无观众不生成**：Supervisor 的 LLM/CLI 生成模式仅在至少一个客户端连接时运行，纯模板模式不受限；
6. **情绪一致**：播报的 emotion/expression 按播报语义（working/success/error）经 persona 映射解析，不再恒用 working（修复 `extract/persona.md` §7 缺陷 7）。

## 5. 新手引导流程

目标：不了解任何技术概念的用户，装完插件 10 分钟内完成第一轮对话。全流程文案基调：**白话、动词开头、不出现黑话**——Adapter 称「AI 助手」、persona 称「角色」、supervisor 称「播报」；斜杠命令在输入框给候选列表 + 一句话说明（如 `/yolo — 让 agent 自动执行所有操作，不再逐条确认`）。

引导通过 VS Code `contributes.walkthroughs` 承载四步，插件激活时自动弹出（仅首次）：

### 步骤 1：安装与激活检测

- 界面状态：插件 activate 时对五个 CLI 执行 `which`/`where` 探测，结果注入 core 配置。
- **全部缺失**：walkthrough 第一步标红，webview 显示引导页——每个 CLI 一句话简介 + 一键复制的安装命令 + 官方文档链接；**不**等用户发出第一条消息才报 `spawn ENOENT`。
- **检测到 ≥1 个**：步骤自动打勾；多个可用时弹一个简单选择器（「你想用哪个 AI 助手？」），选择结果写入 `dionysus.adapter.default`；该设置语义为「未设置时使用首个检测到的可用 CLI」。

### 步骤 2：角色确认（出厂内置，无强制引导）

- 出厂默认角色为 **kal'tsit（Live2D 素材随包分发，版权已经确认，架构 §3）**，开箱即「角色在场」，无需任何放置操作；
- walkthrough 此步展示角色并一句话说明「角色可以在设置里更换或添加」，自动打勾；
- **静态立绘降级**（保底形态，桌面/移动同级）：模型加载失败或 R-1 spike 失败时，Live2D 区域渲染静态立绘 + 台词气泡，`emotion_update` 仅驱动气泡文案与立绘表情贴图切换；全部陪伴功能照常可用。

### 步骤 3：第一轮对话

- walkthrough 引导新建会话并发送第一句话；角色语气默认走 rewriter 路线（不改 agent 输入，ADR-12），无注入失败风险；可选增强 `dionysus.persona.injectIntoAgent`（把 persona 语气拼进 agent 首轮输入）默认关闭，开启后注入失败以 `system_notice` 温和提示且**不阻断回合**。
- 界面状态：首个回合进行中突出展示操作条带与旁白气泡（功能③④的「啊哈时刻」）；回合完成即打勾。

### 步骤 4：扫码配对手机（可选）

- 执行「显示配对二维码」时若 `dionysus.lan.enabled` 为 `false`，弹确认框「需要开启局域网连接才能让手机访问，是否开启？」，确认后自动写回配置并生效——用户不碰 settings.json。
- 配对弹层固定包含：二维码（内容为可扫码直达 URL）、**300 秒 TTL 倒计时**（剩余 <30s 自动换新 token 并重渲染，承接 `extract/pairing-mobile.md` §5 缺陷 4）、「手机需与电脑连接同一个 Wi-Fi」提示与防火墙/AP 隔离排障入口（呼应架构 §13 R-3）。

### 5.5 角色客制化系统（persona + 素材库）

客制化范围只保留两类内容（用户决策 2026-07）：**角色展示**与**角色语气**；调色/背景跟随 VS Code 皮肤，不提供（ADR-20）。

- **角色素材库**：每个 persona 绑定一套展示素材——Live2D 模型目录（`model3.json` + `.moc3` + 纹理 + motions/expressions）或静态立绘集（若干表情差分 PNG）。出厂素材内嵌插件包（kal'tsit 为默认），用户素材放 `globalStorageUri/character-library/`，目录结构与出厂一致、同名覆盖；设置页「角色素材库」提供：查看已安装素材、导入本地目录 / URL 下载、切换默认角色、**按设备切换展示模式**（桌面/移动端各自 `live2d | static`，移动端想要 Live2D 也是合法默认）。
- **角色语气客制化（rewriter 路线驱动的 persona `voice` 段）**：自创角色本质是填五个字段，设置页按此出表单：
  1. `tone` — 一句话语气描述（「冷静克制，偶尔毒舌」）；
  2. `catchphrases` — 口头禅/句尾口癖（逐行一条）；
  3. `taboos` — 角色绝不会说的话（rewriter 输出校验）；
  4. `examples` — 3-5 对「平淡汇报 → 角色口吻」改写样例（LLM 模式 few-shot / template 模式风格基准）；
  5. `rewriter_prompt` — LLM 模式的指令模板（高级，可留空用默认）。
  表单提供「试听」按钮：输入一句平淡汇报，实时显示当前 persona 改写后的角色口吻（template 模式本地可算，LLM 模式需已配置 key）。
- 展示模式与语气彼此独立：静态立绘角色的语气客制化完全照常生效。

## 6. 移动端信息架构与 MVP 分级

### 6.1 平台约束（先接受，再设计）

局域网 `http://<IP>:8765` 不是 secure context，手机浏览器上 Service Worker / Web Push / 系统级通知**不可用**；锁屏/切后台后 WS 必被挂起。因此移动端体验目标正确定义为：**「锁屏期间零打扰，解锁打开 3 秒内呈现离开期间发生了什么」**——不是实时推送。README 明示：手机端需保持浏览器页面打开才能实时收到汇报；离开期间请保持电脑唤醒（合盖不休眠）。WS 重连失败超过 3 次显示明确横幅「无法连接电脑，可能已休眠或 VS Code 已退出」，不无限转圈。重连策略沿用 v2 已验证参数（30s 心跳、指数退避 1s→30s、主动断开不重连，`extract/protocol.md` §1），重连成功立即发 `sync_request` 补拉。

### 6.2 信息架构（三屏 + 角色抽屉 + 工作状态页）

界面风格**仿手机 QQ**（用户决策 2026-07）；三态主题：浅色（柔和白，非纯白）/ 深色（柔和黑，非纯黑）/ 跟随系统（架构 §5.5）。

```
首屏：会话状态列表          会话详情（对话）          工作状态全屏页
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ ⏳2 ❗1 聚合条  │   │ 标题栏 [角色🔔]│   │ todo 进度     │
│ ──────────── │   │ ──────────── │ ← │ 操作时间线明细 │
│ 会话项 × N    │ → │ 消息气泡      │ 左滑│ 汇报流       │
│ 头像·状态点·  │   │ 操作 chip 折叠│ 右滑→│             │
│ 未读·❗·摘要   │   │ 短指令栏      │   │             │
└──────────────┘   └──────────────┘   └──────────────┘
                        ↕ 右上角按钮/上滑唤起
                   ┌──────────────┐
                   │ 角色抽屉(底部  │  ← 非全屏，顶部露出
                   │  上滑扫出)    │    一小指宽对话流
                   │ Live2D/立绘   │    透出底部动态
                   │ + 汇报气泡    │
                   └──────────────┘
```

- **首屏 = 会话状态列表**：与桌面 §2.2 同一规格（数据源同为 `session_digest_update`），点进才是单会话详情。列表↔详情两视图切换沿用 v2 基线（`extract/pairing-mobile.md` §4.3-1），用 hash 路由保证刷新可恢复（v2 `mobileView` 无路由缺陷，§5 缺陷 7）。
- **会话详情 = 对话页**：顶部标题栏**右上角放唤起角色按钮**；消息气泡与操作 chip（每次 tool_call 一行：图标 + 动词 + 目标，默认折叠为计数条，点开展开）；底部短指令栏三键「继续 / 打断 / 确认选项」；会话处于 `waiting_option` 时顶部再常驻一条高对比确认条（选项按钮内联），重连后自动滚动定位到该条——这是「回来 3 秒看懂」的 P0 交互。输入框保留中文输入法 composition 保护（`extract/pairing-mobile.md` §4.3-3）。输入区提供「离开模式」快捷开关（yolo 模式 + 抑制非必要 option 提示语），一键降低无人值守阻塞点，走既有 `user_input.mode` 字段、无协议改动。
- **角色抽屉**：点右上角按钮（或对话页上滑）从屏幕底部向上扫出（Apple 风格 sheet）；抽屉**非全屏**——顶部露出一小指宽的内容区，透出底下对话流的实时动态（新消息滚动可见，用户不离开上下文也能感知进度）；抽屉内为角色（Live2D 或静态立绘，按 `dionysus.character.display.mobile`，§5.5）+ 汇报气泡 + 情绪状态；下拉或点遮罩收起。
- **工作状态全屏页**：对话页**左滑**进入（该会话的 todo 进度、操作时间线明细、汇报流），**右滑**返回对话页——手机上「这个 agent 具体干到哪了」的查看路径固定为一次横滑。

### 6.3 归来摘要

锁屏期间错过的一切由「补拉 + 摘要」两件套恢复（协议机制见架构 §4.1/§5.3 修订：`seq` 序号 + `sync_request`/`sync_response` + 瞬态事件落盘）：

- **触发**：重连时 `afterSeq` 落后超过阈值，或断连 > 60 秒；
- **呈现**：首屏顶部一条摘要卡（Supervisor 内置模板，零 LLM 依赖），示例——「你离开的 32 分钟里：会话『auth 重构』完成 1 回合（成功）、执行 14 项操作；会话『mobile 适配』在等待你确认选项 ❗」；点条目跳转对应会话/确认条；
- 完整事件回放 v3.0 不做（范围外），摘要 + digest 快照 + 落盘 event 行足以支撑「3 秒看懂」。

### 6.4 P0 / P1 功能表

| 级别 | 功能 | 说明 |
|---|---|---|
| **P0（门禁项）** | 配对页 | 扫码/输码、token 持久化、401 重新配对闭环（`extract/pairing-mobile.md` §5 缺陷 5） |
| P0 | 会话状态列表首页 | §2.2 同规格，digest 驱动 |
| P0 | 汇报/消息流 | companion + supervisor + tool_call 摘要，纯文本时间线 |
| P0 | 选项确认条 | waiting_option 常驻 + 重连自动定位 |
| P0 | 打断按钮 + 短指令输入 | 含 IME composition 保护 |
| P0 | 断线重连与补拉 | sync 协议 + 归来摘要 |
| P0 | 三态主题 | 浅色（柔和白）/ 深色（柔和黑）/ 跟随系统 |
| P0 | 角色唤起抽屉 | 右上角按钮 + 底部上滑 sheet（透出底部动态），静态立绘形态 |
| P0 | 工作状态全屏页 | 对话页左滑进入、右滑返回 |
| **P1（可砍，不卡验收）** | 移动端 Live2D 完整渲染 | 展示模式已是合法配置（§5.5），此处指 pixi 渲染管线的落地优先级（性能与流量考量，模型资产走局域网 HTTP 数十 MB）；静态立绘形态为 P0 |
| P1 | 点触互动 | 依赖 Live2D |
| P1 | sticker | — |
| P1 | 会话设置修改 | 改标题/切 adapter/改工作目录——手机误触风险大于价值，P0 只读展示 |

分级理由：移动端跑 pixi-live2d 是 Phase 5 工作量与风险最大项，而离机场景要的是**文字进展与确认按钮**，角色在场感由头像 + 台词气泡即可承担；Live2D 不拖垮 P0。Phase 5 验收以「离开电脑全流程」（电脑发起长任务 → 锁屏 → 解锁看摘要 → 手机确认选项/打断 → 任务继续）为主线，而非「手机能聊天」。

---

## 附：与架构文档的接口对应

| 本文决策 | 架构落点 |
|---|---|
| 列表状态数据源 `session_digest_update`（含 todoProgress） | `architecture.md` §4.1（修订新增） |
| tool_call 卡片渲染契约 | §4.1 消息 schema + §7 webview |
| 旁白气泡 / `scope:"global"` / source 标注 | §4.1 companion_message payload + §7 companionStore |
| 角色口吻 = rewriter 路线（voice 段驱动） | §5.4 rewriter.ts + persona YAML `voice` 段 + ADR-12 |
| 汇报仲裁规则 | §5.4 persona 层（Scheduler 出队口） |
| CLI 检测 / 版本适配展示 / adapter.default 语义 | §6.1.1 + §6.5 + ADR-19 |
| 角色素材库 / 静态立绘形态 / 展示模式配置 | §7 角色素材库系统 + §6.5 配置 |
| 桌面无调色主题（跟随 VS Code）/ 移动端三态 | §5.5 + ADR-20 |
| 配对弹层 TTL 倒计时 / lan.enabled 确认框 | §6.4 PairingManager |
| 移动端补拉与归来摘要 | §4.1 sync 消息族 + §5.3 BroadcastHub 环形缓冲 + §8 mobile |
| 角色抽屉 / 工作状态全屏页手势 | §8 mobile（界面风格与 IA） |
