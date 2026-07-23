# 设计规范与风格样式（v2 前端知识提取）

> 目标读者：要在 v3（VS Code 插件 webview + 手机浏览器）中重实现 UI 的工程师。
> 本文只描述 v2（React + Tailwind + FastAPI）实际落地的设计体系，并在末尾对照 `dionysus_fullstack.agent.final.md` §2 的"纸面规范"标注差异。
> 所有行号均已对照源文件核实。

## 1. 设计 token 体系

### 1.1 Token 三层结构

实际实现是"三层"而非规范文档里的单层：

1. **静态兜底**：`frontend/src/styles/variables.css` 在 `:root`、`[data-theme-mode="dark"]`、`[data-theme-mode="light"]` 三个选择器下硬编码全部 `--dionysus-*` 变量（variables.css:1-79）。
2. **运行时注入**：`applyTheme()` 遍历 Theme 对象把 ~35 个变量 `setProperty` 到 `document.documentElement`（frontend/src/lib/theme.ts:44-119），同时设置 `data-theme-mode` / `data-theme-id` 属性（theme.ts:111-112）并更新 `<meta name="theme-color">`（theme.ts:115-118）。
3. **Tailwind 桥接**：tailwind.config.js 把每个 CSS 变量映射成 `dionysus` 颜色命名空间，组件里写 `bg-dionysus-panel-bg`、`text-dionysus-text-primary` 等（frontend/tailwind.config.js:7-33）。

注入逻辑核心代码（theme.ts:49-59）：

```ts
const cssVars: Record<string, string> = {
  '--dionysus-primary': fullTheme.colors.primary,
  '--dionysus-primary-hover': fullTheme.colors.primaryHover,
  '--dionysus-accent': fullTheme.colors.accent,
  '--dionysus-background': fullTheme.colors.background,
  '--dionysus-chat-bg': fullTheme.colors.chatBackground,
  '--dionysus-user-bubble': fullTheme.colors.userBubble,
  '--dionysus-agent-bubble': dark
    ? fullTheme.colors.agentBubbleDark
    : fullTheme.colors.agentBubbleLight,
  '--dionysus-text-primary': dark
    ? fullTheme.colors.textPrimaryDark
    : fullTheme.colors.textPrimaryLight,
```

注意：**亮/暗双值 token（气泡、文字、代码背景、边框）在 `applyTheme` 里按 `isDarkMode()` 二选一注入**（theme.ts:56-71）；而 `--dionysus-panel-bg`、`--dionysus-glass-bg` 等"派生玻璃色"不是主题数据，是 applyTheme 里按 dark/light 硬编码的 rgba（theme.ts:72-95），主题 YAML 改不了它们。

### 1.2 色板（来自主题 YAML 的实际色值）

三个内置主题存于 `backend/config/themes/*.yaml`，每个 28 行，schema 相同。完整色值表：

| token | default_dark | default_light | tech_flat |
|---|---|---|---|
| primary | `#FFC940`（金） | `#E6B130` | `#3b82f6` |
| primaryHover | `#FFD966` | `#FFC940` | `#60a5fa` |
| accent | `#E6B130` | `#D4A028` | `#06b6d4` |
| background | `#1A1B1F` | `#f5f5f7` | `#0a0f1a` |
| chatBackground | `transparent` | `#ffffff` | `#0f172a` |
| userBubble | `#FFC940` | `#FFC940` | `#3b82f6` |
| agentBubbleLight | `#ffffff` | `#ffffff` | `#ffffff` |
| agentBubbleDark | `rgba(255,255,255,0.06)` | `#f4f4f5` | `rgba(30,41,59,0.72)` |
| textPrimaryLight | `#1d1d1f` | `#1d1d1f` | `#0f172a` |
| textPrimaryDark | `#f5f5f7` | `#f5f5f7` | `#e2e8f0` |
| textSecondary | `#9ca3af` | `#6b7280` | `#94a3b8` |
| system | `#6b7280` | `#9ca3af` | `#64748b` |
| danger | `#ef4444` | `#ef4444` | `#ef4444` |
| success | `#22c55e` | `#22c55e` | `#22c55e` |
| codeBackgroundLight | `#f4f4f5` | `#f4f4f5` | `#f1f5f9` |
| codeBackgroundDark | `#0c0c0e` | `#1f2937` | `#020617` |
| borderLight | `#e5e5e7` | `rgba(0,0,0,0.06)` | `rgba(0,0,0,0.08)` |
| borderDark | `rgba(255,255,255,0.10)` | `rgba(255,255,255,0.1)` | `rgba(148,163,184,0.16)` |
| manifestThemeColor | `#1A1B1F` | `#f5f5f7` | `#0a0f1a` |

出处：backend/config/themes/default_dark.yaml:7-28、default_light.yaml:7-28、tech_flat.yaml:7-28。

`ThemeColors` 的 TS 类型共 18 个必填色值（frontend/src/types/protocol.ts:308-327），后端 `validate_theme` 也校验同一组 key（backend/dionysus_server/theme_manager.py:69-91）——两侧各自硬编码，增删 token 要同步三处（TS 类型、Python 校验、YAML）。

### 1.3 字体

- body：`"Inter", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`（theme.ts:8，三份 YAML 的 fonts.body 相同，如 default_dark.yaml:5）。
- code：`"JetBrains Mono", "Fira Code", "SF Mono", monospace`（theme.ts:9，default_dark.yaml:6）。
- 全局绑定：`html, body, #root` 用 `var(--dionysus-font-body)`，`code, pre` 用 `var(--dionysus-font-code)`（frontend/src/styles/index.css:8-21）。
- **注意**：`frontend/index.html:11` 从 Google Fonts 加载的是 `M PLUS Rounded 1c` 和 `Quicksand`，这两个字体不在任何 font stack 里——是历史残留，实际无效。
- 字号档位：`[data-font-size="small|default|large"]` → 14/16/18px（variables.css:81-91），由 App.tsx:40-43 按 settingsStore.fontSize 写到根元素。

### 1.4 间距 / 圆角 / 阴影约定

没有独立 spacing token，直接用 Tailwind 刻度。实际约定：

- **圆角**：气泡与卡片 `rounded-2xl`（16px），输入框/小卡片 `rounded-xl`（12px），按钮/徽章 `rounded-full`（见 §4）；聊天气泡带一个"小角"（`rounded-tr-sm` / `rounded-tl-sm`）做方向指示（UserMessage.tsx、AgentMessage.tsx）。
- **阴影**：统一走 `--dionysus-glow`，暗色为 `0 0 0 1px ${primary}18, 0 8px 32px rgba(0,0,0,0.35)`（theme.ts:97-99）；浮动面板用 Tailwind `shadow-xl/shadow-2xl`。
- **状态色**：`--dionysus-status-online/success`、`--dionysus-status-busy: #f59e0b`、`--dionysus-status-offline/danger`（theme.ts:100-102）。
- **z-index**：约定俗成——遮罩 40、抽屉/弹层 50、右键菜单 100、QR 弹窗 200（如 MobileCompanionDrawer.tsx:22,38、SessionList.tsx 菜单 `z-[100]`、QRCodeButton.tsx:41 `z-[200]`），无 token 表。

## 2. 主题运行时机制

### 2.1 完整链路

```
backend/config/themes/*.yaml
  └─ PyYAML safe_load（theme_manager.py:37）
     └─ FastAPI: GET /api/themes · GET /api/themes/{id}.json（main.py:148-159）
        └─ 前端 loadAllThemes()/loadTheme()（theme.ts:140-157）
           └─ themeStore（zustand + persist）
              └─ App.tsx useEffect → applyTheme(currentTheme)（App.tsx:36-38）
                 └─ CSS 变量注入 + data-theme-mode 属性
```

- 后端不是"ThemeManager 类"，而是 `backend/dionysus_server/theme_manager.py` 的 4 个模块级函数：`list_themes`（:29）、`get_theme`（:46）、`save_theme`（:95）、`delete_theme`（:130）。内置主题 `{default_dark, default_light}` 禁止覆盖/删除（theme_manager.py:17,100,132）；保存前校验 schema 并备份旧文件为 `.yaml.bak`（theme_manager.py:114-117）。
- 前端加载失败时静默回退 `DEFAULT_THEME`（theme.ts:145-147,155-157）。
- `mergeTheme` 做浅合并 + colors/fonts/assets 三个子对象的二级合并（theme.ts:121-138），`applyTheme` 总是先和 `DEFAULT_THEME` 合并再注入（theme.ts:45），所以部分字段的主题也能用。

### 2.2 themeStore 的 persist 与 legacy 迁移

`frontend/src/stores/themeStore.ts`（60 行）：

- persist key：`dionysus-cache-theme`（themeStore.ts:43），partialize 只存 `currentTheme` + `availableThemes`（:44-47）。
- 结构校验：`isValidTheme` 要求 `id/colors/fonts/assets` 四件套（:6-10）。
- legacy 迁移：`LEGACY_THEME_IDS = {'exusiai_default','dark_glass','dark_default','paseo_dark'}`（:12-17），rehydrate 时命中则重置为 `DEFAULT_THEME`（:48-57）。

v3 迁移 localStorage 时要识别同名 key，或接受一次性重置。

### 2.3 其他 persist key（迁移对照）

- `dionysus-cache-chat`（chatStore.ts:759，只存 sessions + currentSessionId，chatStore.ts:760-763）
- `dionysus-cache-layout`（layoutStore.ts:63，只存 isSessionListOpen，:64）
- `dionysus-settings`（settingsStore.ts:94）

## 3. Tailwind 使用约定

- 配置：`frontend/tailwind.config.js` 共 42 行；`content` 覆盖 index.html + src（:3）；**dark mode 策略是 `['class', '[data-theme-mode="dark"]']`**（:4）——即 `dark:` 变体跟随 `data-theme-mode` 属性而非 prefers-color-scheme。
- 自定义颜色只有 `dionysus.*` 一组，全部指向 CSS 变量（tailwind.config.js:8-33）；fontFamily 把 `sans`/`mono` 也接到变量上（:35-38）。没有自定义 spacing/radius/shadow。
- 全局 CSS 结构：`frontend/src/styles/index.css`（208 行）= `@import variables.css` → `@tailwind base/components/utilities`（index.css:1-5）→ `@layer base` 全局元素绑定（:7-22）→ `@layer components` 全部自定义类（:24-208）。
- 无 plugins（tailwind.config.js:41），滚动条/触屏工具类是手写的：`.scrollbar-thin`（index.css:163-174）、`.touch-pan-y`（index.css:176-179）。

## 4. 组件视觉规范

### 4.1 "cel-*" 自定义类清单（index.css @layer components）

| 类名 | 行号 | 用途 |
|---|---|---|
| `.cel-panel` / `.cel-surface` | index.css:26-39 | 玻璃面板：顶部高光渐变 + glass-bg + 1px 描边 + glow |
| `.cel-bubble-agent` | index.css:42-55 | agent 气泡：`border: 2px solid glass-border` + 内顶高光 + `::before` 顶部渐变 |
| `.cel-bubble-user` | index.css:58-72 | 用户气泡：金色填充、文字强制 `#1A1B1F`、45% 金色描边 |
| `.cel-button` | index.css:75-87 | 药丸按钮：hover 时 `color-mix(primary 18%)`，active 下沉 1px |
| `.cel-chat-backdrop` | index.css:90-92 | 聊天区透明（露出壁纸） |
| `.cel-session-list` | index.css:95-99 | 会话列表面板底色 + 右侧投影 |
| `.cel-nav-item` | index.css:102-126 | 导航项：active 时金色文字 + 12% 金底 + 左侧 3px 金条（`::before`） |
| `.cel-avatar` | index.css:129-139 | 头像：hover 金色描边 + 2px 金晕 |
| `.cel-status-pill` | index.css:142-147 | 状态小药丸（10px 字） |
| `.markdown-body pre/code` | index.css:149-161 | 代码块接 `--dionysus-code-bg` |
| `.cel-reset-theme` | index.css:182-188 | 把浮出浅色卡片的弹层（历史浮窗、右键菜单）强制回暗色变量 |
| `.cel-light-card` / `.cel-dark-card` | index.css:191-207 | 局部覆盖文字/玻璃变量，实现"暗主题里的浅色卡片" |

用户气泡实际样例（index.css:58-64）：

```css
.cel-bubble-user {
  position: relative;
  background: var(--dionysus-user-bubble);
  color: #1A1B1F;
  border: 2px solid rgba(255, 201, 64, 0.45);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 4px 12px rgba(0, 0, 0, 0.35);
}
```

### 4.2 折叠面板 FoldedPanel（标志性视觉）

`frontend/src/components/Layout/FoldedPanel.tsx`（106 行）：用动态 `clip-path: polygon(...)` 在四角切斜角（默认右上+左下大角 20px、另两角 8px，可在 props 调），并在大角位置叠两个金色三角 accent（`bg-dionysus-fold-accent`）。桌面端所有面板（导航条、会话列表、聊天卡、输入框、右侧面板）都包一层。v3 若沿用此风格，这个组件是纯 CSS/DOM 逻辑可直接迁移；若不沿用，全站外观会明显变化。

### 4.3 聊天气泡

- **用户**：右对齐，`cel-bubble-user max-w-3/4 sm:max-w-2/3 rounded-2xl rounded-tr-sm px-4 py-2.5`（UserMessage.tsx）。内容也走 MarkdownRenderer。
- **agent**：左对齐，带头像（PersonaAvatar size="sm"），`cel-bubble-agent max-w-4/5 rounded-2xl rounded-tl-sm`；`interrupted` 状态右上角浮一个 danger 色"已中断"胶囊（AgentMessage.tsx）。
- **系统**：居中灰色药丸 `rounded-full bg-dionysus-glass-highlight px-3 py-1 text-xs`（SystemStatus.tsx）。
- **流式中**：StreamingStatusBox 复用 agent 气泡，内含旋转 Loader2 + 状态文案 + 超 5 秒显示已用时（StreamingStatusBox.tsx:46-50）。
- **思考过程**：ThinkingSection 折叠面板，ChevronDown 旋转 200ms，展开用 `max-h-96 opacity` 过渡（ThinkingSection.tsx）。

### 4.4 按钮 / 输入框 / 卡片 / 抽屉

- **主按钮**：`rounded-xl bg-dionysus-primary px-3 py-2 text-xs font-bold text-white hover:brightness-110`（ThemeStudio.tsx:430 等）；发送按钮是 `rounded-lg bg-dionysus-primary p-2`，hover 换 `primary-hover`（ChatInput.tsx:261）。
- **icon 按钮**：圆角矩形 + `hover:bg-dionysus-glass-highlight hover:text-dionysus-primary`（Header.tsx、QRCodeButton.tsx:79）。
- **输入框**：`rounded-xl border(-2) border-dionysus-subtle-border bg-dionysus-glass-highlight focus:border-dionysus-primary`（SessionSettingsPanel.tsx、ThemeStudio.tsx:344）。
- **下拉**：`DionysusSelect` 封装原生 select，`appearance-none` + 右侧 ChevronDown，error 态 danger 边框（UI/DionysusSelect.tsx）。
- **卡片**：选项卡 `CardList`（rounded-xl border，hover 金边 + 5% 金底）；工具调用卡 `rounded-xl border-2 border-dionysus-glass-border bg-dionysus-glass-highlight`（ToolPanel.tsx）。
- **桌面抽屉**：ThemeStudio 右侧滑出 `fixed inset-y-0 right-0 z-50` + `backdrop-blur-xl`（ThemeStudio.tsx:228-237）；OverlayPage 是聊天区内的全盖滑页（OverlayPage.tsx）。
- **移动端底部抽屉**：MobileCompanionDrawer，见 pairing-mobile.md §4。

### 4.5 Live2D 区域

- 容器相对定位，Pixi canvas 绝对铺满（Live2DViewer.tsx:156-158）。
- 左上角 presence 状态点 pill（7 种颜色映射，Live2DViewer.tsx:44-55）、左下角"鼠标跟踪中"指示（:440-447）、右上 `look_at` 徽标（:449-453）。
- 加载失败降级为循环播放 `/exusiai_idle.webm` 视频 + 重试按钮（Live2DViewer.tsx:17,413-437）。
- 对话框气泡 CharacterDialogBox 盖在角色上方，气泡下缘有 45° 旋转小三角（CharacterDialogBox.tsx:105）。

### 4.6 Framer Motion 动效清单

仅 7 个文件用了 framer-motion：

| 位置 | 动画 | 参数 |
|---|---|---|
| ThemeStudio.tsx:220-232 | 遮罩淡入淡出；抽屉 x:100%→0 滑入 | spring, damping 25, stiffness 200 |
| MobileCompanionDrawer.tsx:17-37 | 遮罩淡入；抽屉 y:100%→0；**可下拉拖拽关闭**（offset.y>120） | spring damping 28 stiffness 260，dragElastic 0.15 |
| OverlayPage.tsx | 整页 opacity 0 + y:8 浮入 | spring damping 25 stiffness 220 |
| ToolHUD.tsx | 工具调用浮卡 opacity/y/scale 弹入 | spring damping 22 stiffness 260 |
| ToolPanel.tsx | 工具卡展开 height:0→auto | duration 0.2 |
| TodoPanel.tsx / ToolPanel.tsx | 进度条 width 0→N% | duration 0.4 |
| CharacterDialogBox.tsx:11-25,73-102 | 打字三点 y 循环跳动（duration 0.6, repeat Infinity, delay i*0.1）；台词 `popLayout` 列表换位 + 新行 y:8 浮入 | duration 0.25 |

## 5. 布局结构

### 5.1 桌面端三栏（Layout.tsx:73-181）

根容器 `flex h-full w-full md:gap-4 md:p-4`（Layout.tsx:74）：

1. **左导航条**：NavSidebar 固定 `w-32`，竖排 4 项（会话/角色/工具/设置）+ 底部 QRCodeButton 与身份区（NavSidebar.tsx），外包 FoldedPanel（Layout.tsx:76-90）。
2. **中栏**：FoldedPanel 大外框内含 `w-56` 会话列表卡 + 自适应聊天卡（Header + ChatContainer + ToolHUD + ChatInput，Layout.tsx:101-166）。全局页面（调色盘/角色/系统设置）以 OverlayPage 覆盖在聊天卡内（Layout.tsx:137-163）。
3. **右栏**：`panelWidthClasses()` = `w-72 xl:w-80`（lib/layout.ts:5-11），上 ToolPanel（flex-40）下 RightPanel（Live2D + 对话框，flex-60）（Layout.tsx:170-181）；SessionSettingsPanel 以 `absolute inset-y-0 right-0` 滑入滑出（SessionSettingsPanel.tsx）。

### 5.2 移动端（Layout.tsx:183-236）

- 断点只有一个：Tailwind `md`（768px），`hidden md:flex` / `md:hidden` 成对切换，无 JS 断点检测。
- 视图路由无 react-router，用 layoutStore 的 `mobileView: 'session-list' | 'chat'`（layoutStore.ts:5,22-23,49-50）；选会话即切 chat（SessionList.tsx:61），Header 返回键切回（Header.tsx:61）。
- 聊天页 = Header（带返回）+ MobileCompanionBar + ChatContainer + ChatInput（Layout.tsx:190-200）。
- 两个全局浮层：MobileCompanionDrawer（底部 80vh 抽屉）、MobileResourcePanel（右侧全高抽屉包 SessionSettingsPanel）（Layout.tsx:234-236）。

### 5.3 壁纸层

App 根部 `wallpaperUrl` 存在时铺一层 `bg-cover` div，`opacity/blur/brightness` 可调，`scale(1.05)` 防模糊露边（App.tsx:299-311）。聊天区透明因此透出壁纸。v3 桌面端已决定丢弃壁纸（见 webview-inventory.md）。

## 6. 对照 §2 纸面规范：落地 vs 未落地

`dionysus_fullstack.agent.final.md` §2（约 349-1056 行）实际描述的是**目标架构**（VS Code webview 语境），与 v2 实现差异很大：

| §2 规范（行号） | 内容 | v2 落地情况 |
|---|---|---|
| :351-353 | 9 大 token 系统（颜色/字体/间距/圆角/阴影/动画/布局/断点/z-index） | 未落地。v2 只有颜色+字体进 CSS 变量；间距圆角直接用 Tailwind 刻度；z-index 靠约定 |
| :356-497 | `--d-*` 前缀 token | 未落地。v2 用 `--dionysus-*` 前缀 |
| :361-371 | 主色 Sky Blue `#0ea5e9` 系 | 未落地。v2 主色金色 `#FFC940`（default_dark.yaml:8） |
| :374-377 | 语义色 success `#22c55e` / warning `#f59e0b` / error `#ef4444` / info `#3b82f6` | **已落地**（warning 以 status-busy 存在，theme.ts:101；info 无） |
| :380-393 | `--vscode-*` 变量回退适配 | 未落地。v2 无 VS Code 适配，v3 webview 应补上 |
| :398-399 | 等宽字体 JetBrains Mono/Fira Code/SF Mono | **已落地**（theme.ts:9） |
| :419-442 | 8pt 间距网格、radius token | 未落成 token，但 Tailwind 刻度实践中近似遵守 |
| :464-468 | easing token | 未落地，Framer Motion spring 参数散在各组件（见 §4.6） |
| :509-732 | Button/Card/Badge 组件 + CSS Modules | 未落地。v2 用 Tailwind 工具类 + `.cel-*` 类，无独立 UI 组件库 |
| :500-503 | token 使用约定（前缀、var() 回退、8pt） | 前缀约定思想可继承，v3 建议统一为 `--d-*` 或保留 `--dionysus-*` 勿混用 |

结论：§2 应视为 v3 的**设计目标文档**而非 v2 实现记录；v3 直接以其 token 表为准、从 v2 迁移色值（金色系）与 `.cel-*` 视觉语言即可。

## 7. 已知缺陷与 v3 改进

1. **yamlToTheme 正则失效（真实 bug）**：`ThemeStudio.tsx:480` 在模板字符串里写 `` `\s*` ``——JS 字符串把 `\s` 烹饪成普通字母 `s`，正则变成 `^key:s*["']?(.*?)["']?$`，于是：
   - 无法匹配 `key: value`（冒号后空格），只有 `key:value` 能匹配；
   - 侥幸匹配时捕获组包含引号，导致颜色值残留 `"`（如 `"#FFC940"`），注入后 CSS 变量非法。
   - 另外 `get('  body')` 这种把两个空格放进正则 key 的写法（ThemeStudio.tsx:492-493）依赖缩进恰好为 2 空格。
   - **v3 对策**：不要手写真则解析 YAML，直接用 `yaml` 库（前端 js-yaml / extension 侧 yaml），ThemeStudio 迁移前先修此 bug。
2. **手写 YAML 序列化/解析整体脆弱**：`themeToYaml`（ThemeStudio.tsx:459-475）字符串拼接、对所有值统一加双引号（`rgba(...)` 也加引号，虽合法但不必要）；`yamlToTheme`（:477-505）不支持嵌套真实结构、注释、多行字符串， typing 中解析失败被静默吞掉（:145-147）。导入外部 YAML 极易静默丢字段。
3. **亮/暗派生色不可主题化**：`--dionysus-panel-bg`、`--dionysus-glass-*` 等 9 个变量在 applyTheme 内硬编码（theme.ts:72-95），主题作者无法调整玻璃质感；v3 应把它们纳入主题 schema（可选字段 + 默认值）。
4. **三处 schema 硬编码同步**：TS 类型（protocol.ts:308-327）、Python 校验（theme_manager.py:69-91）、YAML 文件各自维护 18 个色值 key，v3 应从单一 schema 生成。
5. **变量双源不一致**：variables.css 的静态值与 theme.ts 注入值有出入（如 `--dionysus-panel-bg` variables.css:11 是 `rgba(22,23,27,0.78)`，theme.ts:73 注入 `rgba(22,23,27,0.94)`），首帧闪烁和"哪个为准"靠加载顺序决定；v3 应让 CSS 只留 fallback、JS 注入唯一权威。
6. **无效字体加载**：index.html:11 加载的 Google Fonts 不在任何字体栈中，纯浪费请求，v3 删除或改载 Inter/JetBrains Mono。
7. **主题预览副作用**：ThemeStudio 打开即对草稿 `applyTheme`（ThemeStudio.tsx:111-113），关闭面板不恢复原主题——用户"随便看看"也会改全站配色；v3 应做预览隔离或关闭时回滚。
