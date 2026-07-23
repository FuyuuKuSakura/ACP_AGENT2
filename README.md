# Dionysus

> 带 Live2D 角色陪伴的 AI 编程助手客户端 —— VS Code 插件 + 手机端浏览器

Dionysus 是一个 **VS Code 插件**，把多个 AI 编程助手 CLI（Kimi Code、Claude Code、Codex、OpenCode、CodeBuddy）统一收进一个界面：桌面端有 Live2D 角色（出厂角色凯尔希 kal'tsit）在场陪伴、实时汇报进展；手机扫个码，就能在浏览器里随时查看 agent 干到哪了、替它确认选项或打断它。

> 现在的 agent 不只会写代码——它读文件、改代码、跑命令的每一步你都看得见，还有个角色在旁边给你汇报。

---

## 功能特性

- **多 AI 助手统一接入**：一个界面同时驱动 Kimi Code / Claude Code / Codex / OpenCode / CodeBuddy 五种 CLI，随装随检测，可并行调度（默认上限 3 个）。
- **多会话并行与全局状态面**：QQ 式 sidebar 会话列表（角色头像 + 状态点 + 一行进展摘要 + 未读角标），活动栏 badge 累计待决策数，StatusBar 常驻「⏳N 运行中 ❗M 待决策」。
- **角色陪伴与进度汇报**：Live2D 角色（默认凯尔希）用角色口吻播报各会话进展——rewriter 输出后处理通道，不污染 agent 输入；可切换角色、客制化语气（voice 表单 + 试听）、导入自己的素材。
- **操作过程透明**：agent 每次读文件/改代码/跑命令都渲染成自然语言操作卡片（「正在修改 `auth.ts`」），原始参数默认折叠，结果自动配对、失败标红。
- **手机端离席掌控**：扫码配对后，手机浏览器里看会话状态列表、收汇报、确认选项、打断任务；锁屏离开再回来，断线期间的事件自动补拉，并附一条「你离开期间发生了什么」的归来摘要。

---

## 安装

从 Releases 下载 `.vsix`（或自行打包，见「开发指南」），然后：

```bash
code --install-extension dionysus-vscode-0.3.0.vsix
```

或在 VS Code 内：`扩展` 面板右上角 `...` → `从 VSIX 安装...`。

前置条件：**至少安装并登录一个 AI 助手 CLI**（Dionysus 本身不含 AI）——Kimi Code、Claude Code、Codex、OpenCode、CodeBuddy 任选其一，按其官方文档安装即可。

---

## 快速开始

1. **CLI 检测**：安装插件后 Dionysus 自动探测本机已装的 CLI（命令面板可手动运行「Dionysus: 重新检测 AI 助手」）。一个都没装时会看到安装引导页，不会报错。
2. **Walkthrough 引导**：欢迎页出现「Dionysus 上手引导」，四步走完全部流程。
3. **第一轮对话**：运行「Dionysus: 打开聊天」，出厂角色凯尔希已在场。在输入框布置一个小任务（比如「帮我看看这个项目是干什么的」）并发送，每一步操作都会实时显示。
4. **扫码配对手机**：运行「Dionysus: 显示配对二维码」（首次会自动开启局域网服务），用手机扫码——**手机需与电脑连接同一个 Wi-Fi**——即可在手机浏览器里使用。

---

## 配置项

全部配置在 VS Code 设置中搜索 `dionysus` 即可，改动即时生效：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `dionysus.adapter.default` | `""` | 默认使用的 AI 助手。留空 = 自动用第一个检测到的可用 CLI。 |
| `dionysus.adapters` | `{}` | AI 助手适配器配置表：键为自定义助手名，条目含 CLI 类型、命令名、可选模型。 |
| `dionysus.maxConcurrentAgents` | `3` | 同时运行的 AI 助手数量上限（每个进行中的会话对应一个 CLI 子进程）。 |
| `dionysus.workingDir` | `${workspaceFolder}` | AI 助手的工作目录，默认跟随当前工作区。 |
| `dionysus.persona.default` | `""` | 默认角色。留空 = 按已安装的角色素材自动选择。 |
| `dionysus.persona.injectIntoAgent` | `false` | 可选增强：把角色语气拼进 AI 助手的第一轮输入。默认关闭——角色语气默认只体现在汇报旁白里，不影响 AI 的实际回答。 |
| `dionysus.character.display.desktop` | `live2d` | 桌面端角色展示方式：Live2D 动态模型或静态立绘。 |
| `dionysus.character.display.mobile` | `live2d` | 手机端角色展示方式，默认 Live2D 动态模型，想省流量可改静态立绘。 |
| `dionysus.session.optionTimeoutAction` | `keep` | AI 助手向你确认选项、超时未回复时的处理：`deny` 视为拒绝 / `default` 采用默认选项 / `keep` 继续等你。 |
| `dionysus.lan.enabled` | `false` | 开启局域网连接（手机扫码配对）。仅在可信网络（如家里 Wi-Fi）开启。 |
| `dionysus.lan.port` | `8765` | 局域网服务端口；被占用时自动向后递增重试。 |
| `dionysus.supervisor.mode` | `template` | 角色进度播报的生成方式：`disabled` 关闭 / `template` 内置模板（零成本、离线可用）/ `agent_session` 复用 CLI 生成 / `deepseek_api` 调 DeepSeek API。 |
| `dionysus.supervisor.intervalSeconds` | `15` | 播报检查各会话进展的间隔（秒），最小 5。 |
| `dionysus.supervisor.adapterId` | `""` | `agent_session` 模式复用的 AI 助手；留空 = 跟随默认助手。 |
| `dionysus.supervisor.llm.baseUrl` | `""` | `deepseek_api` 模式的 API 地址。 |
| `dionysus.supervisor.llm.model` | `""` | `deepseek_api` 模式的模型名（API key 存在 VS Code 密钥存储中，不会写入配置文件）。 |

---

## 手机端使用

**配对流程**：

1. 命令面板运行「Dionysus: 显示配对二维码」（`lan.enabled` 为关时会先弹确认并自动开启）。
2. 手机与电脑连同一 Wi-Fi，用相机/扫码工具扫二维码，浏览器自动打开配对页完成配对。
3. 二维码里的配对码有有效期，快过期会自动换新并刷新二维码；设备可在设置中撤销，撤销后连接立即断开。

**手机端能做什么**：会话状态列表（首屏即见哪些 agent 在跑、哪个要你决策）、汇报与操作时间线、选项确认、打断、发短指令（含「离开模式」快捷开关）、角色抽屉、工作状态全屏页（对话页左滑进入）。会话设置修改（改标题/换助手/改目录）在手机端为只读，请回桌面端操作。

**安全提示**：局域网模式为明文 HTTP，仅在可信网络开启；公共网络（公司/咖啡厅）建议关闭 `dionysus.lan.enabled`。

---

## FAQ

- **手机锁屏后能实时收到汇报吗？** 不能。局域网 HTTP 不是安全上下文，手机浏览器的系统级推送不可用，这是平台限制。正确用法是：**锁屏期间零打扰，解锁打开页面 3 秒内呈现离开期间发生的一切**（断线自动重连 + 事件补拉 + 归来摘要）。要实时看到汇报流，需保持浏览器页面打开在前台。
- **离开电脑时要注意什么？** 请保持电脑唤醒、VS Code 不关。agent 在电脑上跑，手机只是窗口；电脑休眠后手机端会显示「无法连接电脑，可能已休眠或 VS Code 已退出」。
- **扫码连不上怎么办？** 按顺序排查：①手机与电脑是否同一 Wi-Fi；②路由器是否开了 AP 隔离/客户端隔离（开了就换网络或关掉）；③电脑防火墙是否放行了 VS Code 的入站连接；④电脑是否休眠。
- **Remote-SSH / 远程开发能用手机端吗？** 插件运行在远程侧（workspace 端）。若环境支持 `asExternalUri` 端口转发，二维码会自动用转发地址，可正常配对；否则会明确提示「需 SSH 隧道/暂不支持」，不会给一个必失败的二维码。
- **支持哪些 AI 助手？** Kimi Code、Claude Code、Codex、OpenCode、CodeBuddy。本机 CLI 版本超出已适配范围时会显示警告角标，但不阻断使用。
- **角色语气会改变 AI 的回答吗？** 默认不会——角色口吻只作用于汇报旁白（rewriter 后处理），agent 的输入与实质回复原样不动。想更深度的代入可开 `dionysus.persona.injectIntoAgent`。

---

## 开发指南

**结构**（npm workspaces monorepo）：

```
packages/
├── protocol/      # @dionysus/protocol —— 消息协议 + zod schema（冻结）
├── core/          # @dionysus/core —— 适配器/会话/persona/汇报引擎（宿主无关）
├── client-core/   # @dionysus/client-core —— 两端共享的 stores/messageRouter/transport
├── extension/     # dionysus-vscode —— VS Code 插件宿主（含局域网服务与配对）
├── webview/       # @dionysus/webview —— 插件内 React 应用（聊天 + Live2D）
└── mobile/        # @dionysus/mobile —— 手机端 React 应用（仿 QQ IA）
assets/            # 出厂角色素材（Live2D 模型、persona YAML）
legacy/            # v2 旧实现，已于 v0.3.0 发布前移除（需查阅请从 git 历史获取）
docs/v3/           # v3 架构文档与开发计划
```

**环境要求**：Node.js ≥ 18.18，npm ≥ 10。

**常用命令**（仓库根目录）：

```bash
npm install          # 安装全部依赖
npm run build        # 构建全部包
npm test             # 全部单测（686 用例）
npm run lint         # eslint
npm run typecheck    # tsc --noEmit

# 打包 vsix（产物在 release/）
cd packages/extension && npm run package:vsix

# 宿主集成测试（自动下载 VS Code，需要图形环境）
cd packages/extension && npm run test:e2e

# 不依赖 VS Code，直跑一轮真实 Kimi CLI 对话（需已安装 kimi 并登录）
cd packages/core && npm run demo:kimi
```

**调试**：VS Code 中按 `F5` 启动调试宿主，插件自动加载。

---

## 许可

- 出厂角色素材（kal'tsit Live2D 模型与 persona 配置）随包分发，**版权已经确认无问题**。
- 代码许可证：MIT（详见仓库根目录 LICENSE）。

架构与开发计划详见 `docs/v3/`（`architecture.md` / `roadmap.md`）。
