# Dionysus v0.2.0 - 带 Live2D 陪伴的 Coding Agent 客户端

Dionysus（代号“苹果派”）是一个带 **Live2D 角色陪伴** 的 Coding Agent 交互界面。它通过本地 FastAPI 后端连接 [Kimi Code CLI](https://kimi.com/kimicode)、Claude Code CLI、OpenCode CLI 等 Coding Agent，并在桌面端以 Electron 应用形式运行。

> 现在你的 Agent 不仅会写代码，还会有表情、会看你鼠标、会陪你聊天。

---

## 下载安装（macOS）

> **当前 Release 仅限 macOS**（Apple Silicon + Intel）。Windows / Linux 版本后续计划支持。

1. 访问 [Releases](https://github.com/FuyuuKuSakura/DionysusC/releases) 页面。
2. 下载 `Dionysus-0.2.0-arm64.dmg`（M 系列芯片）或 `Dionysus-0.2.0.dmg`（Intel 芯片）。
3. 打开 DMG，将 `Dionysus.app` 拖入 `Applications`。
4. 首次启动时，由于应用**未进行 Apple 代码签名**，系统会提示“无法打开”。
   - 请前往 **系统设置 → 隐私与安全性**，点击“仍要打开”；
   - 或在 **访达 → 应用程序** 中右键 `Dionysus.app`，选择“打开”。
5. 启动后，Dionysus 会自动在后台启动本地服务，无需手动配置 Python 或 Node。

---

## 使用截图

### 桌面端主界面（Live2D 角色陪伴 + 会话区 + 执行进度）

![桌面端主界面](docs/screenshots/desktop-view.png)

### 聊天后角色进入「success」状态，显示爱心眼表情与台词

![聊天成功状态](docs/screenshots/chat-success.png)

---

## 核心特性

- 🖥️ **macOS 原生 Electron 客户端**：一键下载，自动集成后端，无需命令行。
- 🎭 **Live2D 角色陪伴**：接入 pixi-live2d-display + Cubism 4，角色会跟随鼠标、点击头部/身体触发不同台词与表情。
- 😊 **情绪引擎**：后端根据 Agent 执行状态（thinking / executing / success / error）自动映射角色情绪与 Live2D 表情/动作。
- 💬 **角色台词气泡**：Agent 执行过程中，角色会在右侧实时说出台词，并显示对应情绪 emoji。
- 🌐 **浏览器聊天界面**：React 18 + TypeScript + Tailwind CSS，支持响应式桌面/移动端。
- 🔌 **多 Agent 兼容**：已接入 Kimi CLI、Claude CLI、OpenCode CLI、Codex CLI，可在会话设置中切换。
- 🎨 **可更换配色方案**：主题完全由 `backend/config/themes/*.yaml` 驱动，切换无需重新编译。
- ⚡ **实时流式反馈**：Agent 执行状态与回复在同一消息气泡内流式更新。
- 🛑 **打断机制**：前端发送 `interrupt`，后端终止当前 CLI 进程。
- 💬 **选项交互**：Plan Mode 选项以按钮/下拉框/卡片形式渲染。
- 💾 **会话持久化**：基于 SQLite 的会话历史存储，运行数据存放在用户目录。
- 🏠 **局域网访问**：前后端均支持监听 `0.0.0.0`，手机连同一 Wi-Fi 即可通过域名/IP 访问（开发模式）。

---

## 技术栈

- **前端**：React 18, TypeScript, Vite, Tailwind CSS, Zustand, Framer Motion, react-markdown
- **Live2D**：PixiJS, pixi-live2d-display, Live2D Cubism 4
- **后端**：Python 3.10+, FastAPI, uvicorn, pydantic, aiosqlite, structlog
- **CLI 桥接**：Kimi Code CLI、Claude Code CLI、OpenCode CLI、Codex CLI
- **桌面打包**：Electron + electron-builder + PyInstaller

---

## 目录结构

```
.
├── backend/
│   ├── dionysus_server/          # FastAPI 后端
│   │   ├── agent_adapters/       # Agent 适配器接口与各 CLI 实现
│   │   ├── session/              # 会话管理与 SQLite 持久化
│   │   ├── websocket/            # WebSocket 连接与消息路由
│   │   ├── persona/              # 角色配置加载与陪伴引擎
│   │   ├── main.py               # FastAPI 入口
│   │   ├── models.py             # WebSocket 协议模型
│   │   └── config.py             # 配置加载
│   ├── config/                   # 服务端配置（主题、内置角色）
│   ├── electron_entry.py         # PyInstaller 打包入口
│   └── dionysus_server.spec      # PyInstaller 规格文件
├── frontend/
│   ├── src/                      # React 源码
│   ├── public/                   # 静态资源与 Live2D 模型
│   ├── electron/                 # Electron 主进程与 preload
│   ├── build/icon.icns           # macOS 应用图标
│   ├── package.json
│   └── vite.config.ts
├── scripts/                      # 开发/测试脚本
├── docs/
│   └── screenshots/              # 使用截图
└── README.md
```

---

## 从源码运行（开发模式）

如果你希望二次开发或从源码运行，请按以下步骤操作。

### 环境要求

- Python 3.10+
- Node.js 18+（推荐 Node 20+）
- 已安装并登录至少一个 Coding Agent CLI（如 [Kimi Code CLI](https://kimi.com/kimicode)）

### 1. 安装后端依赖

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. 安装前端依赖并构建

```bash
cd frontend
npm install
npm run build
```

### 3. 配置

编辑 `backend/config/server.yaml`：

```yaml
agent_adapter:
  default: "kimi_cli"
  adapters:
    kimi_cli:
      type: "kimi_code_cli"
      strategy: "kimi"
      command: "kimi"
      output_format: "stream-json"
      working_dir: "/Users/fuyuuku/projects"  # 修改为你的工作目录
```

### 4. 启动服务

```bash
# 后端（监听所有网卡，方便局域网访问）
cd backend
.venv/bin/uvicorn dionysus_server.main:app --host 0.0.0.0 --port 8765

# 前端（开发模式，同时监听所有网卡）
cd frontend
npm run dev -- --host 0.0.0.0
```

### 5. 访问

- 本机：http://localhost:5173
- 局域网内其他设备：
  - 域名：`http://<本机IP>.nip.io:5173`
  - 直接 IP：`http://<本机IP>:5173`

> 前端会代理 `/ws` 和 `/api` 到后端，因此手机上只需打开前端地址即可使用全部功能。

---

## 打包 macOS 应用（维护者）

```bash
# 1. 构建前端
cd frontend && npm run build

# 2. 打包后端可执行文件
cd ../backend
source .venv/bin/activate
pyinstaller dionysus_server.spec

# 3. 打包 Electron 应用
cd ../frontend
npm run electron:build
```

产物位于 `frontend/release/`，包含 DMG 与 ZIP，可直接上传到 GitHub Release。

---

## 主题定制

在 `backend/config/themes/` 下新增 YAML 文件即可被自动识别。主题格式示例见 `default_dark.yaml` / `default_light.yaml`。切换主题无需重新编译前端。

---

## 角色陪伴配置

角色陪伴行为由 `backend/config/personas/builtin/*.yaml` 中的 `companion` 区块控制：

```yaml
companion:
  status_to_emotion:
    thinking: neutral
    executing: confident
    success: happy
    error: worried
  live2d:
    expressions:
      happy: "爱心眼"
      worried: "哭哭"
    motions:
      idle: "Idle"
  touch_zones:
    head: { expression: "？", lines: ["老板？", "看这里～"] }
    body: { expression: "脸红", lines: ["嘿嘿～", "呀吼～"] }
```

修改后刷新页面即可生效，无需重启后端。

---

## 后续扩展

- 🔊 **TTS**：接入 edge-tts 等语音合成，让角色开口说话
- 🧠 **情绪引擎增强**：LLM / Embedding / Keyword 三层级联分析
- 🤖 **更多 Agent**：基于 `IAgentAdapter` 接口继续扩展
- 🪟 **跨平台**：支持 Windows / Linux 桌面客户端

---

## 许可证

MIT
