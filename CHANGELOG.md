# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。

## [3.0.0] - 2026-07-22

Dionysus v3 首个版本：从 v2 的 Electron + Python 后端架构全面重写为 **VS Code 插件 + 手机端浏览器** 形态（TypeScript monorepo，零 Python 依赖）。

### 新增

- **VS Code 插件宿主**：插件内嵌全部运行时（core / HTTP / WebSocket 服务），安装即用，无需独立后端进程。
- **多 AI 助手统一接入**：支持 Kimi Code、Claude Code、Codex、OpenCode、CodeBuddy 五种 CLI；激活时自动检测已装 CLI 并探测版本，未安装时显示安装引导页；本机版本超出已适配范围时显示警告角标。
- **多会话并行**：每会话独占 CLI 子进程，并发上限可配（`dionysus.maxConcurrentAgents`，默认 3）；打断、选项确认互不影响。
- **全局状态面**：QQ 式 sidebar 会话列表（角色头像、状态点、一行进展摘要、未读角标、待决策标记）、活动栏 badge 待决策计数、StatusBar 聚合「运行中 / 待决策」。
- **操作过程透明**：`tool_call` / `tool_result` 结构化事件渲染为自然语言操作卡片（读文件 / 改代码 / 跑命令 / 搜索），原始参数默认折叠，调用与结果自动配对、失败标红。
- **角色陪伴层**：
  - 出厂角色凯尔希（kal'tsit）开箱可见，Live2D 动态模型（PixiJS + pixi-live2d-display）或静态立绘两种展示模式，桌面/手机分别可配。
  - 角色语气由 rewriter 输出后处理承担（只改写汇报旁白，不碰 agent 输入与实质回复）；可选 `injectIntoAgent` 增强把语气注入首轮输入。
  - CompanionEngine / Scheduler / Supervisor 三声源统一仲裁出队（error 优先插播、最小间隔、语义去重）；Supervisor 周期播报默认 `template` 纯模板模式（零外部依赖、离线可用），可选 `agent_session` / `deepseek_api`（API key 走 VS Code SecretStorage）。
  - 角色素材库：出厂素材内嵌，用户素材放 `character-library/` 同名覆盖；管理页支持导入、切换默认角色、voice 语气客制化表单与「试听」。
- **会话持久化**：JSONL 存储（无 index），首行 meta 原子重写，坏行容忍。
- **断连追赶**：每会话单调递增 `seq` + 环形事件缓冲，客户端重连后 `sync_request` 补拉缺失事件，缓冲溢出时快照 + 续播。
- **手机端（局域网 Web 应用，仿手机 QQ）**：
  - 扫码配对（一次性 token、TTL 倒计时自动刷新、设备白名单可撤销）。
  - 首屏会话状态列表、汇报/操作时间线、选项确认条、打断按钮、短指令输入（IME composition 保护、「离开模式」快捷开关）。
  - 断线自动重连 + sync 补拉 + 「归来摘要」（断连超阈值时单播「你离开期间发生了什么」）。
  - 三态主题（柔和白 / 柔和黑 / 跟随系统）、角色唤起抽屉、工作状态全屏页（左滑/右滑手势）。
- **首次体验**：walkthrough 四步上手引导（装 CLI → 打开聊天 → 第一轮对话 → 扫码配对）。
- **Remote-SSH 边界**：`extensionKind: ["workspace"]`，配对二维码优先走 `asExternalUri` 端口转发，不可用时给出明确指引。

### 安全

- 局域网服务默认关闭，需显式开启 `dionysus.lan.enabled`。
- 移动端一切 HTTP/WS（配对端点除外）需有效设备 token（128-bit 随机、constant-time 比较）；WS token 在 upgrade 前校验。
- `/assets/*` 路由路径穿越校验；CLI 子进程工作目录限定工作区内。
- webview CSP 收紧（`default-src 'none'`，按需白名单）。

### 移除（相对 v2）

- Electron 桌面打包、Python/FastAPI 后端、SQLite 会话存储（v2 会话数据不迁移）。
- 桌面端调色/壁纸主题系统（插件跟随 VS Code 皮肤）；角色语气死字段（`emotion_mapping`/`corpus_file`/`preferred_theme`/`theme_override`）。
- Web Push / PWA 系统级通知（局域网 HTTP 非安全上下文，平台不可用，明示放弃）。

### 已知限制

- 局域网模式为明文 HTTP，仅在可信网络开启；device token 长期有效，撤销为唯一回收手段。
- 手机端无锁屏实时推送（平台限制），体验目标为「解锁打开 3 秒内呈现离开期间发生了什么」。
