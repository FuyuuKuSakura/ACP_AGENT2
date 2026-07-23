# Williams 设计原则审查报告 —— webview 组件层

> 版本：v3.0 · 状态：只读审查（未改动任何源码）
> 审查基准：Robin Williams《写给大家看的设计书》四原则——对比（Contrast）、重复（Repetition）、对齐（Alignment）、亲密性（Proximity）。
> 审查范围：`packages/webview/src/components/` 下全部组件（sidebar / chat / companion / settings / guide / Icon 体系），证据引用到 `文件:行号`。

## 0. 设计系统总览：token 层与 Icon 体系如何体现「重复」

### 0.1 token 层（`packages/webview/src/theme/vscode.css`）

全部语义 token 统一定义在 `:root` 下的 `--dn-*` 命名空间，每个 token 只做一件事——映射到 `var(--vscode-*)` 宿主变量（`vscode.css:14-56`），组件不允许写死色值。映射分组：

- 基底：`--dn-bg / --dn-fg / --dn-panel-bg / --dn-border / --dn-muted`（vscode.css:16-20）
- 气泡：`--dn-user-bubble-bg/-fg`、`--dn-agent-bubble-bg`、`--dn-system-fg`（vscode.css:23-26）
- 强调/状态：`--dn-accent / --dn-accent-hover / --dn-error / --dn-warning / --dn-success / --dn-attention`（vscode.css:29-34）
- 按钮/输入框：`--dn-button-*`、`--dn-input-*`、`--dn-focus-border`（vscode.css:37-45）
- 代码/徽标/字体：`--dn-code-bg`、`--dn-badge-bg/-fg`、`--dn-font / --dn-font-mono / --dn-font-size`（vscode.css:48-55）

这本身就是「重复」原则的基础设施级应用：**同一语义在任何组件里必须渲染为同一颜色**。VS Code 浅/深/高对比主题切换时由宿主刷新 `--vscode-*`，全部组件随之整体换肤，对比度关系（如 user 气泡用 button 实色 vs agent 气泡用 widget 底色 + 边框）在所有主题下保持一致。

### 0.2 Icon 体系（`components/Icon.tsx`）

全产品唯一的图标来源（文件头注释明确「禁止 emoji」），风格参数全部锁定在组件内部：

- `viewBox="0 0 16 16"`、`strokeWidth={1.5}`、`strokeLinecap/Linejoin="round"`、`stroke="currentColor"`（Icon.tsx:160-169）；
- 22 个图标全是手绘几何路径，分三族：会话状态（running 开环弧 / waiting_option 三角 / done 对勾圆 / error 叉圆 / idle 月牙）、工具 kind（文档/铅笔/终端/放大镜/扳手）、13 个情绪徽记（几何线条与点阵区分，不画面部表情，Icon.tsx:97-146）；
- `currentColor` 意味着图标颜色永远等于所在位置的文字色，自动接入 token 层——着色决策只发生一次（在消费方的 className 里），不在图标内部重复。

「重复」在此的体现：任何一个图标出现在 sidebar 聚合条、聊天头部、工具卡片还是陪伴气泡里，用户看到的是同一套描边粗细、同一套圆角端点、同一套隐喻（对勾永远是「完成」，三角永远是「需要你注意」）。测试以 `data-icon` 属性断言图标身份（Icon.tsx:161），把这套一致性变成了可回归验证的契约。

---

## 1. sidebar 会话列表（`components/sidebar/`）

### 1.1 SidebarApp（SidebarApp.tsx）

- **亲密性**：三段式纵向结构——聚合条（顶部，全局信息）→ 会话列表（中部，可滚动主体）→「新建会话」按钮（底部固定），信息按「总 → 分 → 动作」分层排布（SidebarApp.tsx:93-127）；空态文案「暂无会话，点击下方『新建会话』开始」紧贴列表区并直接指向下方的动作按钮（:100-106），文案与所指对象空间相邻。
- **对齐**：`flex h-screen flex-col`，聚合条、列表项、按钮全部占满行宽，左边缘天然对齐（:89-128）。
- **对比**：「新建会话」用 button 实色（`:124`），是整页唯一的实心动作块，从列表的中性背景中跳出。

### 1.2 AggregateBar（AggregateBar.tsx）

- **重复**：三段计数共享同一结构「Icon(12px) + 数字 + 状态词」+ 同一分隔符 `·`（AggregateBar.tsx:30-52），扫描节奏一致。
- **对比**：「待决策」一段单独着警示色（`:40`），在灰/主色的其余两段中形成视觉锚点——优先级最高的信息获得唯一的颜色。
- **对齐**：`items-center` + `inline-flex items-center gap-0.5`，图标与文字中线对齐（:28,32,40,48）。

### 1.3 SessionListItem（SessionListItem.tsx）

- **亲密性**：48px 单行联系人卡片（文件头注释 §2.2），四个信息元按亲疏分组：状态点（8px）贴头像左缘 → 头像（32px）→ 标题/摘要双行文本块 → 右端角标（SessionListItem.tsx:63-130）；摘要行内「摘要文字 flex-1 + 相对时间 flex-none」把弱信息挤到行尾（:97-110），标题与摘要用 `leading-tight` 收紧行距形成一块，与相邻卡片拉开。
- **对齐**：`items-center` 保证点/头像/文字/角标同轴；摘要行用 `items-baseline` 让两种字号的文字基线对齐（:97）。
- **对比**：五态状态点色板（idle 灰 / running 金色呼吸 / waiting_option 橙 / error 红 / done 绿，sidebar.css:11-35）+ running 态独有的呼吸动画（sidebar.css:37-45）——「正在进行」同时获得颜色和动效双重对比；选中态整行换 `--vscode-list-activeSelectionBackground`（SessionListItem.tsx:64）。
- **重复**：待决策角标与未读角标复用同一 pill 结构（`h-4 min-w-4 rounded-full` + badge 配色，:112-129），互斥逻辑（待决策优先）在数据层而非视觉层区分（:52-53）。

### 1.4 状态点色板（sidebar.css）与摘要 helpers（format.ts）

- **重复**：五态颜色全部来自 `--vscode-*` 语义变量且每态一行、命名一律 `.dio-dot-<status>`（sidebar.css:11-35），与 `STATUS_DOT` 映射表的键一一对应（SessionListItem.tsx:22-31）——状态语义从协议层到 CSS 类名同名传递。
- 首字母色块把会话 key 散列到 6 个 `--vscode-charts-*` 变量（format.ts:53-68）：同一会话永远同色（可预期的重复），不同会话彼此区分（对比）。

---

## 2. chat 聊天视图（`components/chat/`）

### 2.1 ChatApp（ChatApp.tsx）

- **亲密性**：纵向五层「标题栏 → 通知条 → 消息流 → 选项组 → 输入框」（ChatApp.tsx:99-124），与信息的时间序/操作序一致；消息列 `max-w-3xl mx-auto` 收窄居中（:111），陪伴区用 `border-l` 分隔在右（:145）。
- **对比**：空会话态把唯一动作「开始新会话」渲染为大面积 `rounded-xl` 实心按钮居中（:127-139），与有会话态的密集 UI 形成整页级对比。

### 2.2 MessageList 消息气泡（MessageList.tsx）

- **对比**：三种角色三种形态——user 右对齐实色气泡（button 底色，`MessageList.tsx:14-16`）、agent 左对齐描边气泡（`rounded-tl-sm` 小角 + border，:27-28）、system 居中胶囊（`rounded-full` + panel 底色 + xs 字号，:37-38）。方向（左/右/中）、形状（方角方位/全圆）、色深（实/描边/浅底）三个维度同时区分，任何一条消息一眼可辨来源；方向小角（user 右上、agent 左上）沿用 design-style §1.4 规范。
- **重复**：user/agent 气泡共享 `max-w-[80/85%] rounded-2xl px-3.5 py-2` 的内距体系（:15,28），只有语义差异项（方向、色、边框）不同。
- **对齐**：`flex justify-end / justify-start / justify-center` 把对齐轴变成角色语义本身（:14,27,37）。

### 2.3 ToolCallList / ToolCallCard（ToolCallList.tsx）

- **亲密性**：文件头明确定义三级信息层级——L1 自然语言动作、L2 行内状态 + 耗时、L3 默认折叠详情（ToolCallList.tsx:4-8）；L1+L2 同一行（`flex items-center gap-2`，:70），L3 用 `border-t` 分隔收进折叠区（:124），层级与物理距离一一对应。
- **对比**：kind 四类描边分级——edit 主色 `--dn-accent` 最显著、bash 警示色 `--dn-attention`、read/search/other 中性 `--dn-border` 弱化（`KIND_BORDER`，:38-44）；error 态整卡描边变红覆盖 kind 色（:67），状态优先级高于类别优先级；bash 命令额外加 `font-mono`（:78-79）用字体区分。
- **重复**：状态三态复用 Icon 体系同一尺寸（Loader 旋转 / done 对勾 / error 叉，均 14px，:86-104）；卡片共享 `rounded-xl border px-3 py-2`（:65）；卡片列 `flex flex-col gap-1.5`（:157）与 StreamingView 间距一致。
- **对齐**：图标、动作描述、状态、耗时、展开钮在同一 `items-center` 轴上，描述 `min-w-0 flex-1 truncate` 把右侧状态元挤到行尾形成右列（:70-119）。

### 2.4 OptionGroup（OptionGroup.tsx）

- **对比**：未决/已决双态整卡换肤——未决 `--dn-attention` 描边 + agent 气泡底色 + 「需要你确认：」前缀（OptionGroup.tsx:24-31），已决中性描边 + panel 底色 + `opacity-70`（:25-26）；按钮三态（未决实心 button 色 / 已决未选中 secondary / 已决选中 badge 色 + done 图标，:45-56）。
- **重复**：选项按钮一律 `rounded-full px-3 py-1` 胶囊（:45），选中标注复用 Icon `done`（:55）。
- **亲密性**：问题文案 `mb-2` 贴按钮组（:30），「已选择（来自 …）」来源注释放按钮组下方 `mt-1.5`（:61-64），三段垂直紧凑成一张卡。

### 2.5 ChatInput（ChatInput.tsx）

- **亲密性**：斜杠命令候选浮层锚定输入框正上方（`absolute bottom-full`，ChatInput.tsx:46），候选项内「命令（mono + accent 色）+ 一句话说明（xs + muted）」基线对齐成对出现（:53-57）。
- **对比**：textarea focus 时边框变 `--dn-focus-border`（:77），发送键实心主色 vs 输入框描边（:84），禁用态双降（cursor + opacity-50）。
- **重复**：候选浮层、textarea、发送键共享 `rounded-xl`（:46,77,84），与消息流卡片同一圆角语言。

### 2.6 ChatHeader（ChatHeader.tsx）

- **对齐**：标题 `flex-1 truncate` + 三类右侧元信息全部 `shrink-0`（ChatHeader.tsx:33-62），标题让位、状态元永不换行挤压。
- **重复**：persona/adapter 两个标识复用同一 `rounded-full border px-2 py-0.5 text-xs` pill（:46-51）；「待决策」徽标复用 badge 配色 + Icon `waiting_option`（:37-40），与 sidebar 聚合条同一隐喻。
- **对比**：打断按钮用 error 色描边的 ghost 形态（:58）——危险动作用颜色标出但不做实心，避免与发送类主按钮争视觉权重。

### 2.7 SystemNoticeBar（SystemNoticeBar.tsx）

- **对比**：level → 文字色三级映射（info muted / warning / error，`LEVEL_CLASS`，SystemNoticeBar.tsx:14-18），多条通知逐条 `border-b` 分隔（:30）。
- **亲密性**：通知文本 `flex-1` + 关闭钮 `shrink-0` 同行（:32-40），关闭动作贴着它作用的对象。

### 2.8 StreamingView 与 Markdown（StreamingView.tsx / Markdown.tsx）

- **重复**：流式气泡与 MessageList 的 agent 气泡逐字同款（`max-w-[85%] rounded-2xl rounded-tl-sm border … px-3.5 py-2`，StreamingView.tsx:48 对照 MessageList.tsx:28）——流式结束转正时用户感知不到形态跳变；呼吸动画 `dn-breathe` 与工具卡 Loader 的 `dn-loader` 都定义在全局 index.css（index.css:35-65），动效参数单一来源。
- **亲密性**：thinking 折叠区在流式气泡上方、状态行在下方（StreamingView.tsx:42-61），与「先想 → 再说 → 报告进度」的叙事顺序一致；`.dn-md` 给 markdown 元素统一的 0.4rem 纵向节奏与代码块底色（index.css:71-151）。

---

## 3. companion 陪伴区（`components/companion/` + `StaticPortrait.tsx`）

### 3.1 CompanionArea（CompanionArea.tsx）

- **亲密性**：气泡栈绝对定位于陪伴区顶部、覆盖角色上方（CompanionArea.tsx:71-79）——台词物理上从角色「头顶」发出；`pointer-events-none` + 内层 `pointer-events-auto` 让气泡可读可点但不遮挡角色触摸区（:71-72）。
- **重复**：live2d / static 双形态共用同一外壳（panel 底色 + 气泡层），展示模式切换对气泡栈透明（:80-97）。

### 3.2 CompanionBubbles（CompanionBubbles.tsx）

- **重复**：每条气泡共享 `rounded-xl border bg-agent-bubble/95 px-3 py-2 shadow-lg` 卡片语言（CompanionBubbles.tsx:45）——与聊天 agent 气泡同族但加阴影和半透明，暗示「浮层」；情绪徽记统一 `Icon size={14}` + muted 色（:48-56），徽记→情绪的映射集中在 `emotionIcon.ts` 单点（emotionIcon.ts:10-24）。
- **亲密性**：情绪徽记 `gap-1.5` 贴文本（:47），来源标注「来自：xx」右对齐小字收在气泡底部（:61-72），点击即跳转会话——标注与跳转动作同位。
- **对比**：全部历史进滚动面板（最久在顶、最新贴角色头顶），新句配 220ms 浮入动画 + 贴底自动跟随，翻阅历史时以「有新汇报 ↓」浮钮提示而不打断（CompanionBubbles.tsx）——新旧信息用位置、动效和跟随策略三重区分。

### 3.3 Live2DViewer 与 StaticPortrait（Live2DViewer.tsx / StaticPortrait.tsx）

- Live2DViewer 是无 UI 的渲染容器，设计原则主要体现在交互契约：触摸命中按上下半区判定 head/body（Live2DViewer.tsx:121-126），触摸目标与角色身体部位空间重合（亲密性）。
- StaticPortrait 台词气泡居中置顶、立绘 `object-contain` 底部对齐（StaticPortrait.tsx:28-49），气泡与角色构成「说话者 + 台词」的亲密组合；`key={src}` 切换贴图时 300ms 透明度过渡（:48），情绪切换不生硬。

---

## 4. settings 设置页（`components/settings/`）

### 4.1 SettingsApp（SettingsApp.tsx）

- **亲密性**：左栏角色列表（`w-56`）与右侧表单主区 `border-r` 相邻（SettingsApp.tsx:188-235），选中角色即编辑该角色——选择器与编辑对象同屏同页；保存反馈 notice 紧贴页头标题下方（:178-185），离触发它的「保存」按钮虽远但出现在视觉起点。
- **重复**：角色列表项与 sidebar 会话列表项同构（头像/首字母色块 32px 圆形 + 主行名称 + 次行 id，:212-227），跨视图复用同一「联系人卡片」模式。
- **对齐**：选中态整行换 secondary 底色（:209），与 sidebar 的 active 高亮同一手法。

### 4.2 VoiceForm（VoiceForm.tsx）

- **重复**：全部输入控件共享 `inputCls`（描边 + input 底色 + focus 边框，VoiceForm.tsx:35-36），全部标签共享 `labelCls`（xs + semibold + muted，:37）——表单节奏单一来源，新增字段自动继承。
- **亲密性**：label `mb-1` 紧贴控件、字段组之间 `gap-3` 拉开（:81-143），「标签-控件」对与「字段-字段」的间距差形成明确分组；改写样例「平淡 → 角色口吻」同行双输入 + 中间箭头（:108-123），成对数据物理成对；高级项收进 `<details>`（:145-156），低频配置不占主视觉；试听区独立描边盒（:158-188），输入、按钮、结果垂直相邻。
- **对比**：保存按钮 `font-semibold` 实心主色（:190-198），是表单唯一强调动作；删除用 error 色文字钮弱化（:127），危险但低频的动作降权。

### 4.3 AssetLibraryPanel（AssetLibraryPanel.tsx）

- **重复**：三个下拉共享 `selectCls`（AssetLibraryPanel.tsx:30-31）；素材条目的 kind / source 徽标复用 pill 模式（badge 实色 / secondary 浅色，:106-114）。
- **亲密性**：label 文字与对应下拉包在同一个 `<label className="flex items-center gap-2">` 里（:66-89），控件与说明不可拆散。

---

## 5. guide 引导页（`components/guide/CliGuidePage.tsx`）

- **重复**：五张 CLI 卡同一模板（`rounded-xl border p-3.5`，CliGuidePage.tsx:78）——名称/文档链接一行、简介一段、命令 + 复制钮一行（:80-114），五张卡零差异结构，用户扫第二张卡时无需重新学习布局。
- **亲密性**：卡内三段 `mt-1 / mt-2.5` 紧凑堆叠；安装命令（mono + code 底色）与它的复制按钮 `gap-2` 同行（:96-113），命令文本与对其的操作不可分离。
- **对比**：复制成功态按钮文字变「已复制」+ done 图标（:105-112）；页面级 `max-w-xl mx-auto` 收窄（:122），大标题 → 说明 → 卡列 → 选型建议的阅读序由字号（base/sm/xs）和间距（mt-1.5/mt-4）分级（:123-139）。

---

## 6. 违反原则之处（逐条，可直接执行）

### V1【高】sidebar 组件族与 StaticPortrait 整体绕过 `--dn-*` token 层 —— 违反「重复」

**现象**：项目约定「组件只消费 `--dn-*` token」（vscode.css:5），但以下组件直接引用 `var(--vscode-*)`，且多处写死 hex 兜底（vscode.css:4 明确「不写死任何色值」）：

- SidebarApp.tsx:91（`--vscode-sideBar-background` / `--vscode-foreground`）、:103（`--vscode-descriptionForeground`）、:124（`--vscode-button-*` 三枚）；
- SessionListItem.tsx:63-64（`--vscode-list-hoverBackground` / `--vscode-list-activeSelectionBackground`）、:85,94,97（`--vscode-*-foreground`）、:117,126（`--vscode-badge-*`）；
- AggregateBar.tsx:28（`--vscode-panel-border`）、:37,40,45（`--vscode-descriptionForeground` / `--vscode-editorWarning-foreground`）；
- sidebar.css:13-34（五态色值直接写 `--vscode-*` + 硬编码 hex 兜底 `#8c8c8c / #e5c07b / #d18616 / #f14c4c / #89d185`）；
- format.ts:53-60（`AVATAR_COLORS` 六个 `--vscode-charts-*` + 硬编码 hex）；
- StaticPortrait.tsx:33,54（`--vscode-panel-border,#3c3c3c` / `--vscode-editor-background,#1e1e1e` / `--vscode-editor-foreground,#d4d4d4` / `#888`）。

**为什么违反**：同一语义（如「弱化文字」）在 chat 里走 `--dn-muted`、在 sidebar 里走 `--vscode-descriptionForeground`，主题适配的单一入口被劈成两条路径；硬编码 hex 兜底在脱离 VS Code 的环境（测试/预览/未来移动端 webview 复用）会与主题脱钩——token 层这个「重复」机制在 sidebar 上整体失效。

**修复**（按序执行）：
1. 有现成 token 的直接替换：`--vscode-foreground → --dn-fg`、`--vscode-descriptionForeground → --dn-muted`、`--vscode-panel-border → --dn-border`、`--vscode-button-* → --dn-button-*`、`--vscode-badge-* → --dn-badge-*`、`--vscode-sideBar-background → --dn-panel-bg`；
2. 无现成 token 的在 `theme/vscode.css` 补齐再消费：新增 `--dn-list-hover-bg: var(--vscode-list-hoverBackground, …)`、`--dn-list-active-bg: var(--vscode-list-activeSelectionBackground, …)`、`--dn-avatar-1..6: var(--vscode-charts-*, …)`，分别替换 SessionListItem.tsx:63-64 与 format.ts:53-60；
3. sidebar.css 五态色改引 `--dn-muted / --dn-attention / --dn-error / --dn-success`（running 金色需新增 `--dn-running: var(--vscode-charts-yellow, …)`），删除全部 hex 兜底；
4. StaticPortrait.tsx:33,54 同样替换为 `--dn-border / --dn-bg / --dn-fg / --dn-muted`。

### V2【中】「待决策」的视觉优先级未落实、警示色三处不同源 —— 违反「对比」+「重复」

**现象**：ux 规格定 waiting_option 为「最高视觉优先级」（Icon.tsx:43 注释亦同），但：
- SessionListItem 的待决策角标与未读角标逐字同款（同样的 badge 中性底色 pill，SessionListItem.tsx:112-129），在一排列表里待决策并不比未读醒目；
- 警示色来源分裂：状态点用 `--vscode-charts-orange`（sidebar.css:24）、聚合条用 `--vscode-editorWarning-foreground`（AggregateBar.tsx:40）、OptionGroup/ToolCallList 用 `--dn-attention`（OptionGroup.tsx:27、ToolCallList.tsx:41）——同一语义三种取色路径，某些主题下三者可能不同色。

**修复**：
1. 统一走 `--dn-attention`（V1 修复后 sidebar.css 与 AggregateBar 一并切换）；
2. SessionListItem.tsx:117 待决策角标改为 `bg-[var(--dn-attention)] text-[var(--vscode-editor-background)]`（或新增 `--dn-attention-bg/-fg` token 后消费），与未读角标拉开对比；未读角标保持中性 badge 色。

### V3【中】文字符号充当图标，绕过 Icon 体系 —— 违反「重复」

**现象**：`■`（ChatHeader.tsx:60 打断）、`▸`（StreamingView.tsx:28）、`▾`（ToolCallList.tsx:118）、`▴/▾`（CompanionBubbles.tsx:115）、`＋`（SidebarApp.tsx:126，全角加号）、`→`（VoiceForm.tsx:116）、`↗`（CliGuidePage.tsx:90）。这些字符的粗细/大小随字体走，与 1.5px 描边几何图标并排时风格断裂（「打断」按钮里 `■` 与同行的 Icon 徽标对比最明显）。

**修复**：Icon.tsx 增补 `chevron-right / chevron-down / chevron-up / stop（实心小方块 path）/ plus / arrow-right / external` 七个图标（沿用 16 viewBox + 1.5 描边），逐处替换；`■` 与 `＋` 优先（出现在主操作按钮上）。若决定保留文本符号，应在设计规范里显式登记为例外，而非默认状态。

### V4【低】`emotion-error` 与 `waiting_option` 图标形状完全相同 —— 违反「对比」

**现象**：Icon.tsx:138-143 与 :44-49 是同一条三角路径。前者语义是「角色汇报出错」，后者是「等你决策」；且 CompanionBubbles 里徽记一律 muted 色（CompanionBubbles.tsx:52），error 情绪连颜色区分也丢失，只能靠上下文猜。

**修复**：`emotion-error` 改用 `error` 的叉圆路径（或给三角加区分元素）；CompanionBubbles 按徽记语义着色——error/success 类用 `--dn-error / --dn-success`，其余保持 muted（可在 emotionIcon.ts 的映射表并列返回一个色调枚举）。

### V5【低】已决/禁用态整体降透明，正文对比度连带受损 —— 违反「对比」

**现象**：OptionGroup 已决态 `opacity-70` 作用于整卡（OptionGroup.tsx:26），问题文案、已选标注、来源说明全部被拉灰；同理 ChatInput 禁用 `disabled:opacity-60`（ChatInput.tsx:77）、发送键 `disabled:opacity-50`（:84）。在浅主题 + 弱对比显示器上可能跌破可读阈值。

**修复**：已决态改为「描边/底色中性化 + 文字 `--dn-muted`」的显式配色（`border-[var(--dn-border)] bg-[var(--dn-panel-bg)] text-[var(--dn-muted)]`），仅对未选中按钮保留降透明；输入类禁用态同理用文字/边框色表达而非整体 opacity。

### V6【低】圆角双轨无 token、无文档 —— 「重复」的潜在裂缝

**现象**：`rounded-2xl`（消息气泡）/ `rounded-xl`（工具卡、OptionGroup、输入框、引导卡、陪伴气泡）/ `rounded`（sidebar 新建按钮、settings 全部表单控件与素材条目）三档并存，靠惯例维持。目前分布自洽（气泡 2xl、卡片 xl、表单控件默认），但无 token 无规范，下一个组件很容易选错档。

**修复**：二选一——在 vscode.css 增加 `--dn-radius-bubble / --dn-radius-card`  token（Tailwind arbitrary value 消费）；或在 design-style 规范文档里写死这三档的适用场景。改动量后者为零，建议后者。

### V7【低】素材条目行内信息无亲疏分层 —— 违反「亲密性」

**现象**：AssetLibraryPanel 素材条目 `flex items-center gap-2`（AssetLibraryPanel.tsx:99-115）把名称、personaId、kind 徽标、source 徽标等距平铺，主名与从属 id 被拉开到和其他元数据相同的距离，条目长时主从关系要靠读完才能建立。

**修复**：参照 SessionListItem 的主/次行结构——名称 + personaId 收进 `min-w-0 flex-1` 的文本块（名称 text-sm、personaId text-xs muted 紧随其后 `gap-1`），kind/source 徽标移到行尾 `ml-auto`。

---

## 7. Williams 四原则速查

- **对比（Contrast）**：不同的东西就要做得显著不同，靠差异建立视觉层级。本项目示例：user 实色气泡 vs agent 描边气泡（MessageList.tsx:15,28）；待决策卡的 attention 描边（OptionGroup.tsx:27）；running 状态点的呼吸动画（sidebar.css:19）。
- **重复（Repetition）**：重复视觉元素让作品成为一个整体，一致性本身即专业感。本项目示例：`--dn-*` token 层（vscode.css 全文）；Icon 体系 16 viewBox + 1.5px 描边 + currentColor（Icon.tsx:160-169）；`rounded-xl border px-3 py-2` 卡片语言横贯 ToolCallCard / OptionGroup / CompanionBubbles / CliCard。
- **对齐（Alignment）**：页面上任何元素都不应随意摆放，每个元素都要与另一元素有视觉连线。本项目示例：消息左/右/中三轴对齐即角色语义（MessageList.tsx:14,27,37）；工具卡 L1/L2 行内 `items-center` 单轴（ToolCallList.tsx:70）；设置页左栏与主区 `border-r` 分界（SettingsApp.tsx:189）。
- **亲密性（Proximity）**：相关的项物理靠近，无关的项拉开距离，距离即分组。本项目示例：工具卡 L1/L2/L3 三级信息的行内/折叠分区（ToolCallList.tsx:4-8）；表单 label `mb-1` 贴控件、字段组 `gap-3` 拉开（VoiceForm.tsx:37,81）；陪伴气泡悬浮于角色头顶（CompanionArea.tsx:71）。

---

## 8. endfield 风格接入说明（2026-07 决策）

来源：[ark-ui-skill](https://github.com/Brandon030722/ark-ui-skill)（clean-room 设计规则集，无官方素材）的 endfield（终末地）风格族。接入的是**设计语言**（色板语义 + 几何规则 + 排版规则），不是素材库；token 值取自该仓库 `assets/tokens/ark-ui.tokens.json` 与 `references/design-language.md` / `references/recipes.md` 实测拉取。

### 8.1 接入深度决策

| 端 | 深度 | 范围 |
|---|---|---|
| 桌面 webview | **minimal** | 仅几何点缀：tool_call 卡片左侧 2px 引导线、陪伴区舞台顶部细刻度线；**色彩零改动**，全部仍走 `--dn-* → var(--vscode-*)`（ADR-20 不破，桌面不做调色主题系统） |
| 移动 mobile | **moderate** | 三态主题重定为 endfield 色板 + 几何语言点缀（引导线/刻度线/大型编号/斜切角/方形控件）；不堆 HUD 装饰、不降信息密度 |

不做 complex / maximal 的理由：

1. **生产力工具，不是营销站**：endfield 的 complex/maximal 深度（全 dossier、索引舞台、分区编排动效）服务于「运营落地页/工业产品站」场景；Dionysus 是高频扫读的状态面板，舞台层装饰会与会话列表、消息流争夺注意力，违反本报告 §1「信息架构先于装饰被读懂」的质量线；
2. **ADR-20 硬约束**：桌面端客制化只保留角色展示与角色语气，全面换肤是已裁决的重复建设——桌面因此只取「不依赖色板」的几何元素；
3. **可读性红线**：endfield 信号黄 `#fffa00` 在米白 `#f2f2f0` 上对比度约 1.1:1，风格族自身规则即「信号色不做浅色底长文本」「不搞施工黄底长文」——越深度的接入越容易踩这条线。

### 8.2 token 对照表（endfield 原色 → --dn-*）

| endfield token | 值 | 移动端落点（`packages/mobile/src/index.css`） |
|---|---|---|
| `paper` 米白 | `#f2f2f0` | 浅色 `--dn-bg`（替代原 `#f7f7f5`） |
| `ink` 炭黑 | `#191919` | 深色 `--dn-bg`（替代原 `#17171a`）；浅色 `--dn-fg` / 文字级 `--dn-accent` / `--dn-attention` / `--dn-badge-bg` / `--dn-user-bubble-bg` |
| `signal` 信号黄 | `#fffa00` | `--dn-signal`（引导线/刻度/进度条/呼吸点）；`--dn-button-bg`（+ `--dn-button-fg: #191919`）；`--dn-attention-bg`（+ `--dn-attention-fg: #191919`）；深色主题文字级 `--dn-accent` / `--dn-attention` |
| `state` 验证绿 | `#00ffa2` | 深色 `--dn-success`（仅「已验证/完成」语义；浅色文字级 success 保留 `#16a34a`，#00ffa2 在米白底不可读） |
| `muted` | `#888888` | 双主题 `--dn-muted`、idle 状态点 |
| `panel` | `rgba(25,25,25,0.84)` | 未直取：移动端 panel 用实色（浅 `#fafaf8` / 深 `#222224`），半透明舞台面板留给有插画舞台的场景 |
| `radius` 技术/功能 | `2px` / `4px` | `--dn-radius-sm: 2px` / `--dn-radius-md: 4px`（替代原 6/10） |

**浅色底的双 accent 制**（关键裁决，依据 design-language「不用信号色做浅色底长文本」）：浅色主题「文字级 accent」（链接、目标路径、返回箭头）= 炭黑墨 `#191919`，信号黄只做**图形元素**（实底按钮、引导线、刻度、呼吸点、进度条）；深色主题信号黄可直接作文字色（对 `#191919` 对比度充足）。用户气泡在浅色为炭黑块、深色反转为米白块，始终保持「用户块跳出舞台」的对比关系。

字体栈（未安装时自然回退，零打包成本）：display/编号 `"Space Grotesk", "Arial Narrow", "Roboto Condensed", "DIN Condensed", "Noto Sans SC", sans-serif`（`--dn-font-display`）；编号/计数一律 `font-variant-numeric: tabular-nums`。

### 8.3 几何规则清单（已落地项）

| 规则（design-language / recipes 出处） | 落地 |
|---|---|
| 长引导线（endfield「long guide lines」） | 移动：会话列表项左侧 2px 引导线（待决策/出错常亮、进行中呼吸）；桌面：tool_call 卡左侧 2px inset 引导线（随 kind 色） |
| 校准刻度（「calibration labels/ticks」） | `.dn-ticks` 细刻度线（1px 竖刻度 8px 间距、opacity .4-.45）：移动首屏与工作状态页顶部、桌面陪伴区舞台顶部 |
| 大型编号（「very large section numerals」） | 移动工作状态页：todo 步骤 01–NN 大编号（当前步骤 accent 色高亮）、分区头 `01 / TODO` `02 / OPS` `03 / LOG` 微标签（大写拉丁 + .12em 字距）、进度计数 `03/07` 补零等宽数字 |
| 45° 斜切角（「45° cuts / clipped wedges」） | `.dn-wedge`（clip-path 右上 16px 切角）：仅用于待决策确认条——全界面唯一的楔形强调元素 |
| 矩形控件（「rectangular tiles / square button」） | 移动：主按钮（新会话/发送/确认选项/选项按钮/操作 chip）走 2px 功能圆角方形；头像、状态点、未读角标保留圆形（QQ 列表身份，属 POPUCOM 式圆润，不混入） |
| 呼吸信号块（「restrained breathing activity block」） | running 状态点 = 信号黄 + 既有 1.6s 呼吸动画（浅色底加 1px 墨描边保证可辨） |
| 1px 细线（「1px rules」） | agent 气泡/卡片描边统一 1px `--dn-border`；确认条底部 2px 墨线 |

明确**不采用**的 endfield 元素（recipes 的 Avoid 清单 + 本项目克制原则）：警示斜纹（hazard stripes）、大面积施工黄底长文、伪军事警告文案、HUD  telemetry 装饰、竖排装饰文字。

### 8.4 验证与回退记录

- 视觉验证：`scripts/qa-mobile-visual/` mock + shoot 重截 7 张（浅/深首屏、对话页确认条、角色抽屉、工作状态页、配对页、归来摘要），逐张核查无破版、无对比度事故；
- 斜切角仅落在确认条容器（整条 clip-path，不伤内部布局），未出现「斜切破坏布局」的情况，无回退项；
- 测试：组件样式改动全部经 token/工具类完成，不断言 class 的既有测试零改动通过。
