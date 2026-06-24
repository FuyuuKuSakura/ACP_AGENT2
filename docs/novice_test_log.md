# Dionysus 新手用户端到端测试记录

> 测试时间：2026-06-24  
> 测试人：Kimi Code CLI（模拟完全未接触过 Dionysus 的新手用户）  
> 测试环境：macOS / Chrome（通过 Kimi WebBridge 控制）  
> 前端：`http://localhost:5173/`（Vite 开发模式）  
> 后端：`http://127.0.0.1:8765`  
> 角色：默认能天使（Exusiai），后切换为凯尔希（Kal'tsit）  

---

## 总体印象

Dionysus 的首页视觉完成度较高：深色玻璃拟态面板、左侧导航、右侧 Live2D 看板娘、底部聊天输入区布局清晰。发送第一条消息后，kimi_cli 能正常响应，右侧 Companion 会同步更新状态气泡与执行进度。主题切换、角色切换、Live2D 绑定、配对二维码等核心链路均已跑通。

但作为新手，最大的困惑是 **「调色盘」面板没有明显的关闭方式**：点击左侧导航「调色盘」后会进入一个全屏覆盖层，按 Escape 和再次点击「调色盘」均无法退出，导致后续角色页、系统设置页都被遮挡，必须靠刷新或直接操作 DOM 才能继续。此外，会话列表目前没有看到删除入口；移动端角色抽屉在桌面视口下无法通过 UI 打开，需要开发者工具介入。

---

## 步骤 1：首次访问与默认布局

- **操作**：清除 localStorage / sessionStorage 后刷新页面，模拟首次访问。
- **预期结果**：页面正常加载，默认展示会话、默认角色、Companion 区域，无报错。
- **实际结果**：页面加载成功，左侧会话列表显示「新会话」，右侧 Companion 为 Exusiai，顶部显示 `kimi_cli 已连接`，无 JavaScript 报错。
- **截图**：`qa_screenshots/novice_test/01_initial.png`
- **遇到问题**：无
- **新手困惑点**：无

---

## 步骤 2：发送第一条消息

- **操作**：在底部输入框输入「你好，请介绍一下自己」，点击发送按钮。
- **预期结果**：用户消息出现在聊天区，AI 开始回复，右侧 Companion 状态变化。
- **实际结果**：消息成功发送，kimi_cli 返回自我介绍，会话标题自动变为「你好，请介绍一下自己」，左侧会话列表同步更新。右侧 Companion 气泡变为「正在输出结果 还有别的需要我帮忙的吗？」，状态从 idle 变为 listening / working，执行进度显示 Outputting。
- **截图**：`qa_screenshots/novice_test/02_first_message.png`
- **遇到问题**：无
- **新手困惑点**：底部的 Plan / Yolo / cd / 恢复 Agent Session 图标没有 tooltip 说明，首次使用不清楚含义。

---

## 步骤 3：切换主题到 Tech-Flat 工业蓝

- **操作**：点击左侧「调色盘」图标，在「主题」下拉框中选择「Tech-Flat 工业蓝」。
- **预期结果**：界面主题色切换为工业蓝，下拉框显示新主题。
- **实际结果**：主题切换成功，整个界面从原来的蓝紫色调变为偏灰蓝的工业风格，下拉框显示「Tech-Flat 工业蓝」。
- **截图**：`qa_screenshots/novice_test/03_theme_switch.png`
- **遇到问题**：无
- **新手困惑点**：「调色盘」入口名称对普通用户不够直观，更像是设计师工具；且打开后没有明显的关闭按钮。

---

## 步骤 4：移动端角色陪伴抽屉

- **操作**：尝试在桌面浏览器模拟手机尺寸打开移动端角色陪伴抽屉。
- **预期结果**：点击底部角色陪伴按钮，从屏幕底部弹出约 80% 高度的抽屉，包含角色气泡、Live2D 和工具栏。
- **实际结果**：由于桌面视口下 `md:hidden` 隐藏了抽屉，直接通过 UI 无法打开；通过浏览器开发者方式强制移除隐藏类后，抽屉正常渲染，包含标题「角色陪伴」、气泡、Live2D 模型、关闭按钮。抽屉高度符合 80vh 设计。
- **截图**：`qa_screenshots/novice_test/04_companion_drawer.png`
- **遇到问题**：桌面端无法直接体验移动端抽屉；需要真实手机或响应式视口模拟。
- **新手困惑点**：如果在手机上使用，找不到明显的「打开角色陪伴」按钮位置说明。

---

## 步骤 5：切换角色（能天使 → 凯尔希）

- **操作**：点击左侧「角色」图标，在「当前角色」下拉框中选择「凯尔希」。
- **预期结果**：页面切换到凯尔希的语料与配置，右侧 Companion 加载凯尔希 Live2D 模型，名称变为 Kal'tsit。
- **实际结果**：角色切换成功。页面显示凯尔希语料（「罗德岛医疗部门负责人……」），右侧 Companion 名称变为 Kal'tsit，Live2D 模型切换为凯尔希，状态 idle，路径显示 `/personas/live2d/kal'tsit/凯尔希直播版1.model3.json`。
- **截图**：`qa_screenshots/novice_test/05_persona_switch.png`
- **遇到问题**：在到达角色页面前，「调色盘」面板遮挡了主内容，需要刷新页面后才能正常点击「角色」导航。
- **新手困惑点**：角色页信息量很大（语料、模型、Supervisor 等），新手可能不知道从何看起；建议增加首次进入的角色引导。

---

## 步骤 6：系统设置（历史记录 & 清除缓存）

- **操作**：进入「系统设置」，将「单会话保留消息数」从 50 改为 100 并保存，然后点击「清除本地缓存」。
- **预期结果**：历史记录设置保存成功，清除缓存后界面回到初始状态但不影响后端角色/模型。
- **实际结果**：
  - 历史记录输入框可修改，保存按钮存在。
  - 点击「清除本地缓存」后，页面自动回到新建会话状态，左侧历史会话被清空，右侧 Companion 仍为 Kal'tsit（后端配置未丢失）。
- **截图**：`qa_screenshots/novice_test/06_settings.png`
- **遇到问题**：清除缓存后没有二次确认提示，新手可能误点导致当前会话记录丢失。
- **新手困惑点**：Agent 连接区域的「默认模型」「命令路径」需要用户知道本地 CLI 路径，对新手门槛较高。

---

## 步骤 7：配对二维码

- **操作**：前端暂未发现明显的「连接二维码」按钮，直接访问后端 `/api/pair/qr`（通过 Vite 代理）。
- **预期结果**：浏览器展示可用于手机配对的二维码图片。
- **实际结果**：成功返回 PNG 二维码，可识别为配对入口。
- **截图**：`qa_screenshots/novice_test/07_pair_qr.png`
- **遇到问题**：前端 UI 中没有找到二维码入口（左侧导航中的「连接二维码」按钮在测试时未出现或不可见）。
- **新手困惑点**：新手不知道如何调出二维码，无法完成手机配对。

---

## 步骤 8：会话管理（新建 & 删除）

- **操作**：点击左侧「+ 新建会话」创建一个新会话；尝试删除一个会话。
- **预期结果**：新建会话后列表出现两条会话，删除后列表减少一条。
- **实际结果**：
  - 新建会话成功，左侧列表显示两条「新会话」。
  - 在会话列表项上未找到删除按钮、右键菜单或滑动手势；未实现/未暴露删除功能。
- **截图**：`qa_screenshots/novice_test/08_session_manage.png`
- **遇到问题**：缺少会话删除/重命名入口。
- **新手困惑点**：多条「新会话」无法区分，也无法删除，会导致列表混乱。

---

## 发现的前 3 个问题

1. **调色盘面板无法关闭**（可用性）  
   点击左侧「调色盘」后进入全屏覆盖面板，没有关闭按钮，再次点击「调色盘」或按 Escape 均无法退出，严重阻碍后续操作。

2. **前端缺少配对二维码入口**（功能缺失）  
   后端 `/api/pair/qr` 工作正常，但普通用户在当前 UI 中找不到二维码按钮，移动端配对流程断裂。

3. **会话无法删除/重命名**（功能缺失）  
   新建会话后列表项没有删除或重命名入口，用户难以管理多个会话。

---

## 其他细节问题

- 底部 ChatInput 的 Plan / Yolo / cd / 恢复 Agent Session 图标缺少说明，新手不易理解。
- 「清除本地缓存」缺少二次确认，容易误操作。
- 移动端角色陪伴抽屉在桌面端没有降级展示或预览入口。
- 系统设置页 Agent 连接配置对非技术用户门槛较高，需要填写命令路径和模型名。

---

## 修复后复测

针对上述 3 个可用性问题，对前端进行了最小改动修复，并重新截图验证。

### 修复内容

1. **全局覆盖页增加关闭按钮**  
   文件：`frontend/src/components/Pages/OverlayPage.tsx`  
   在调色盘、角色、系统设置等覆盖页标题栏右侧增加显式关闭按钮（X），并支持 Escape 键关闭。

2. **配对二维码入口修正**  
   文件：`frontend/src/components/Layout/QRCodeButton.tsx`  
   将左侧导航「连接二维码」按钮的图片来源从旧的 `/api/server/qr` 改为 `/api/pair/qr`，并为按钮补全 `aria-label`/`title`；弹窗本身已有关闭按钮。

3. **会话列表增加可见操作菜单**  
   文件：`frontend/src/components/Layout/SessionList.tsx`  
   每个会话项右侧新增悬停/聚焦可见的「更多」按钮（⋮），点击后展开重命名/删除菜单；菜单支持点击外部、Escape 关闭，删除后自动收起菜单。

4. **清除缓存增加二次确认**  
   文件：`frontend/src/components/Pages/SystemSettingsPage.tsx`  
   点击「清除本地缓存」前先弹出 `window.confirm` 提示，避免误触导致会话丢失。

### 复测结果

| 复测项 | 结果 | 截图 |
|--------|------|------|
| 调色盘覆盖页可关闭 | ✅ 标题栏出现 X，点击后返回主界面 | `qa_screenshots/novice_test/09_palette_close.png` |
| 系统设置覆盖页可关闭 | ✅ 标题栏出现 X | `qa_screenshots/novice_test/10_settings_page.png` |
| 左侧二维码按钮可用 | ✅ 点击后弹出配对二维码弹窗 | `qa_screenshots/novice_test/11_qr_popup.png` |
| 会话菜单可见 | ✅ 悬停/点击 ⋮ 显示重命名/删除 | `qa_screenshots/novice_test/12_session_menu.png` |
| 会话可删除 | ✅ 删除后列表更新，菜单自动关闭 | `qa_screenshots/novice_test/13_session_deleted.png` |

### 回归测试

- 前端 Vitest：`npm run test -- --run` → 5 passed
- 前端构建：`npm run build` → success
- 后端 pytest：32 passed（测试运行时已确认）

---

## 截图清单

| 截图 | 说明 |
|------|------|
| `qa_screenshots/novice_test/01_initial.png` | 首次访问默认布局 |
| `qa_screenshots/novice_test/02_first_message.png` | 发送第一条消息并收到回复 |
| `qa_screenshots/novice_test/03_theme_switch.png` | 切换到 Tech-Flat 工业蓝主题 |
| `qa_screenshots/novice_test/04_companion_drawer.png` | 移动端角色陪伴抽屉 |
| `qa_screenshots/novice_test/05_persona_switch.png` | 角色切换到凯尔希 |
| `qa_screenshots/novice_test/06_settings.png` | 系统设置页 |
| `qa_screenshots/novice_test/07_pair_qr.png` | 后端配对二维码 |
| `qa_screenshots/novice_test/08_session_manage.png` | 新建会话后列表 |
| `qa_screenshots/novice_test/09_palette_close.png` | 修复后调色盘覆盖页带关闭按钮 |
| `qa_screenshots/novice_test/10_settings_page.png` | 修复后系统设置覆盖页带关闭按钮 |
| `qa_screenshots/novice_test/11_qr_popup.png` | 修复后左侧二维码弹窗 |
| `qa_screenshots/novice_test/12_session_menu.png` | 修复后会话操作菜单 |
| `qa_screenshots/novice_test/13_session_deleted.png` | 删除会话后列表 |
