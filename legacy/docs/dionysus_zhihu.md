# 我造了一个会动、会说的 AI Agent 桌面助手 —— Dionysus

> 让写代码这件事，多一个会陪你唠嗑的看板娘。

---

## 先说痛点

这两年 AI Agent 工具爆发，Kimi、Claude、Codex、OpenCode…… 每个都很好用，但用久了总觉得少了点什么：

- 界面要么像聊天网页，要么像 IDE 插件，**冷冰冰**；
- 多个 Agent 各自为政，想统一管理还得切来切去；
- 任务跑久了，不知道它在干嘛，只能盯着终端发呆。

我就想：能不能做一个**有角色、有情绪、能常驻桌面**的 Agent 控制台？让 Agent 干活的时候，旁边有个看板娘替你盯进度，状态变了还会开口汇报。

于是就有了 **Dionysus**。

---

## Dionysus 是什么

Dionysus 是一个面向开发者的 **AI Agent 陪伴型前端**。一句话概括：

> 把 Kimi / Claude / Codex / OpenCode 等多个 CLI Agent，塞进一个带有 Live2D 看板娘的桌面应用里。

它不仅是一个多 Agent 控制台，更是一套**角色化交互框架**。你可以切换角色、上传语料、绑定 Live2D 模型，让 AI 以你喜欢的角色口吻陪你工作。

---

## 三个最让我兴奋的亮点

### 1. 一个界面，接管所有 CLI Agent

Dionysus 后端封装了统一的 Agent 适配器层，前端可以同时管理多个 CLI Agent：

- **kimi\_cli**：Kimi Code CLI
- **claude\_cli**：Claude Code
- **codex\_cli**：OpenAI Codex CLI
- **opencode\_cli**：OpenCode

你可以在系统设置里启用/禁用适配器、改命令路径、配默认模型。聊天时通过命令或 UI 切换当前会话使用的 Agent，非常丝滑。

### 2. 角色不是皮肤，是完整的人设系统

Dionysus 的角色由 YAML 文件驱动，包含：

- 系统提示词（system prompt）
- 专属语料（塑造语气）
- 情绪/表情/动作映射
- 触摸区域反馈
- 状态 → 表情映射

内置了「能天使」和「凯尔希」两个示例角色。你也可以通过表单一键创建新角色，系统会自动生成一份完整的默认配置。

### 3. 后台角色播报（Companion Supervisor）

这是我最得意的功能。

Supervisor 会周期性地观察 Agent 会话状态，然后让右侧的看板娘用角色口吻播报进展。比如 Agent 正在读文件，她会说「让我翻翻资料~」；执行成功了，她会说「搞定啦！」。

支持三种模式：

- **不接入模型**：关闭播报，纯陪伴。
- **多开 agent session**：再开一个 Agent 实例总结进度。
- **DeepSeek API**：调用 DeepSeek 生成更自然的播报文案。

---

## 界面长什么样

（这里可以配几张截图）

- 左侧：会话列表 + 主导航
- 中间：聊天区 + 工具面板
- 右侧：Live2D 看板娘 + 角色对话框 + 执行进度
- 角色页：切换角色、编辑语料、上传 Live2D、配置 Supervisor
- 设置页：Agent 适配器、主题、壁纸、CC Switch

整体是深色玻璃拟态风格，圆角大按钮，主题色会随角色变化。

---

## 技术栈

**前端**：React 18 + TypeScript + Vite + TailwindCSS + Zustand + Pixi.js（Live2D）+ Electron（可选桌面打包）

**后端**：Python 3.10+ + FastAPI + Uvicorn + Pydantic + aiosqlite + PyYAML + structlog

**通信**：WebSocket 实时通道 + REST API 配置接口

**特色依赖**：

- `pixi-live2d-display`：Live2D 模型渲染
- `framer-motion`：流畅动画
- `zustand`：轻量状态管理

---

## 适合谁用

- 经常用 CLI Agent 写代码、改 bug、 review 的开发者
- 想给工具加角色化交互的独立开发者
- 对 Live2D、Agent 编排、React 状态管理感兴趣的技术爱好者

---

## 快速体验

```bash
# 启动后端
cd backend
source .venv/bin/activate
python -m uvicorn dionysus_server.main:app --host 0.0.0.0 --port 8765

# 启动前端
cd frontend
npm install
npm run dev
```

然后打开浏览器访问 `http://localhost:5173`。

---

## 为什么开源

我做 Dionysus 有两个目的：

1. 解决自己每天切多个 Agent 工具的痛苦；
2. 探索「AI 工具 + 角色陪伴」的交互形态。

一个人闭门造车太无趣，所以把它开源出来。欢迎一起折腾角色、写适配器、调 Live2D。

---

## 项目地址

GitHub：**https://github.com/FuyuuKuSakura/ACP_AGENT2**

如果这个项目让你眼前一亮，欢迎 star、fork、提 issue。也欢迎在评论区聊聊：你最希望 AI Agent 以什么角色陪你工作？

---

*Dionysus v0.1.0 · By FuyuuKu樱*
