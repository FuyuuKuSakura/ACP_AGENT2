# Dionysus 用户手册

> 版本：v0.2.0  
> 作者：FuyuuKu樱  
> 更新日期：2026-06-24

---

## 1. 项目简介

Dionysus 是一个带有角色陪伴（Companion）功能的 AI Agent 前端。它把聊天会话、Live2D 看板娘、后台角色播报和多个 CLI Agent（kimi / claude / codex / opencode / codebuddy）整合在一个界面里，让你在写代码、查资料的同时，有一个会动、会说的角色陪你。

主要功能：

- 多角色切换：内置能天使、凯尔希，也可以自己创建角色。
- 语料管理：在线编辑或上传 `.txt` 语料，塑造角色口吻。
- Live2D 模型：选择模型文件夹并一键绑定到角色。
- Companion Supervisor：三种后台播报模式可选。
- Agent 连接：同时管理多个 CLI Agent 的启用状态与默认模型。
- 系统设置：历史记录保留条数、缓存清理、CC Switch 扩展入口。

---

## 2. 快速启动

### 2.1 启动后端

```bash
cd backend
source .venv/bin/activate  # 或使用项目自带的 .venv
python -m uvicorn dionysus_server.main:app --host 0.0.0.0 --port 8765
```

后端默认监听 `http://0.0.0.0:8765`，提供角色、语料、Live2D、Supervisor、Agent 适配器等 REST API。

### 2.2 启动前端

```bash
cd frontend
npm install   # 首次运行
npm run dev   # 开发模式，默认 http://localhost:5173
```

如需生产构建：

```bash
npm run build
```

构建产物位于 `frontend/dist/`。

### 2.3 访问

打开浏览器访问 `http://localhost:5173`（开发）或你部署的地址。

---

## 3. 角色管理

### 3.1 切换角色

1. 点击左侧导航栏的「角色」图标。
2. 在「当前角色」下拉框中选择角色。
3. 右侧 Companion 会立即切换到对应角色，并加载该角色的语料与 Live2D 配置。

### 3.2 添加角色

1. 在角色页点击「添加角色」。
2. 填写：
   - **角色 ID**：英文、数字、下划线，作为文件和目录名。
   - **角色名称**：界面上显示的名字。
   - **简介**：一句话描述。
3. 点击「创建」。系统会生成一份默认 YAML，包含系统提示词、Live2D 占位配置、触摸区域、状态表情映射等。
4. 创建成功后，新角色会出现在下拉框中并自动切换。

> 提示：ID 创建后不建议修改，因为它会决定运行时配置文件和 Live2D 目录名。

### 3.3 编辑语料

- **方式一**：直接在「语料文本」框中编辑，点击「保存」写入后端。
- **方式二**：点击「选择 .txt 语料」，选中本地文本文件后点击「上传」。上传成功后，文本框会自动刷新。

语料会用于构建该角色的系统提示词，影响角色语气、称呼和常用语。

---

## 4. Live2D 模型绑定

1. 准备一个包含 `.model3.json` 入口文件的 Live2D 模型文件夹。
2. 在角色页点击「选择模型文件夹」，选中该文件夹。
3. 按钮旁会显示文件数量，点击「上传并应用」。
4. 成功后：
   - 显示「Live2D 模型已更新：/personas/live2d/<角色ID>/...model3.json」。
   - Live2D 区域显示「已绑定」和路径。
   - 右侧 Companion 会尝试加载新模型。

> 注意：
> - 首次选择文件夹时，浏览器可能要求用户授权。
> - 如果右侧模型未立即显示，可点击「重试加载」。
> - 内置角色（能天使、凯尔希）上传模型时，会复制到运行时目录，不会改动内置文件。

### 解绑模型

点击「解绑模型」可删除已上传的 Live2D 文件并清空角色配置中的 `model_path`。

---

## 5. Companion Supervisor（后台角色播报）

Supervisor 负责在后台扫描 Agent 会话状态，并让 Companion 以角色口吻播报当前进展。

点击角色页的「后台角色播报」区域，可在三种模式间切换：

### 5.1 不接入模型

完全关闭 Supervisor。Companion 只响应用户主动发送的消息，不会主动播报 Agent 状态。

适合：不需要后台打扰的场景。

### 5.2 多开 agent session

Supervisor 会启动一个独立的 Agent Session（通过你选择的 Adapter ID），把当前会话上下文交给他处理，处理结果由 Companion 播报。

配置项：

- **Adapter ID**：从已启用的 Agent 适配器中选择，例如 `kimi_cli`、`claude_cli`。
- **扫描间隔（秒）**：Supervisor 轮询间隔，默认 15 秒，最小建议 5 秒。

适合：希望用另一个 Agent 实例异步总结或执行任务的场景。

### 5.3 DeepSeek API

Supervisor 直接调用 DeepSeek API 生成播报内容。

配置项：

- **API URL**：默认 `https://api.deepseek.com/v1/chat/completions`。
- **模型**：默认 `deepseek-reasoner`，可改为 `deepseek-chat` 等。
- **API Key**：填写后保存；留空则后端读取环境变量 `DEEPSEEK_API_KEY`。
- **扫描间隔（秒）**：同上。

> 安全提示：前端保存 API Key 时不会明文回显，建议同时通过环境变量配置后端，避免把真实 Key 写入前端代码。

### 保存设置

修改任意 Supervisor 选项后，点击「保存 Supervisor 设置」。保存成功后按钮旁会显示绿色提示，后端会重新以新配置启动 Supervisor。

---

## 6. Agent 连接设置

1. 点击左侧导航栏的「设置」图标。
2. 在「Agent 连接」区域可以看到所有已配置的 CLI 适配器：
   - `kimi_cli`
   - `claude_cli`
   - `codex_cli`
   - `opencode_cli`
   - `codebuddy_cli`
3. 对每个适配器可配置：
   - **启用**：是否允许该适配器被使用。
   - **命令路径**：本地 CLI 命令，例如 `kimi`、`claude`、`codex`、`opencode`、`codebuddy`。
   - **默认模型**：该适配器默认使用的模型名（如 `claude-sonnet-4-20250514`、`gpt-4o`）。
4. 点击「保存并重启」使配置生效。

> 提示：命令路径必须能在系统 PATH 中找到，否则后端启动 Agent Session 时会失败。

---

## 7. 思考过程（Thinking）

当使用 CodeBuddy CLI 时，Agent 的中间推理步骤会以可折叠的「思考过程」块显示在消息气泡内。

- 默认折叠，避免聊天区被推理内容刷屏。
- 点击「思考过程 · 展开」可查看完整推理。
- 思考内容仅用于展示，不会影响最终发送给 Agent 的上下文。
- 其他 CLI（Kimi / Claude / Codex / OpenCode）若未输出结构化推理内容，则不会显示该块。

---

## 8. 系统设置

### 8.1 历史记录

- **单会话保留消息数（1-500）**：控制每个会话在本地保存的最大消息数，默认 50。

### 8.2 清除本地缓存

点击「清除本地缓存」可清理浏览器本地存储的临时数据，不会删除后端角色、语料或模型文件。

### 8.3 打开 CC Switch

点击「打开 CC Switch」可跳转或打开 CC Switch 相关扩展/页面。按钮左侧会显示图标。

---

## 9. 主题与界面

Dionysus 使用 Dionysus 设计系统：

- 深色玻璃拟态面板
- 圆角大按钮、统一边框与阴影
- 主题色随角色/配置变化

下拉框（`DionysusSelect`）遵循同样的主题变量，支持亮色与暗色切换。

---

## 10. 常见问题

### Q1：角色下拉框为空或显示异常？

- 检查后端是否已启动并可访问 `/api/personas`。
- 检查浏览器控制台是否有网络错误。

### Q2：语料上传失败？

- 仅支持 `.txt` 文件。
- 确保选择了角色后再上传，文件会保存到当前选中角色的语料中。

### Q3：Live2D 模型上传后右侧不显示？

- 确认文件夹内有 `.model3.json` 文件。
- 点击 Companion 区域的「重试加载」。
- 检查浏览器控制台是否有 CORS 或资源加载错误。

### Q4：Supervisor 修改后没有生效？

- 必须点击「保存 Supervisor 设置」。
- 后端日志会显示 `supervisor_started mode=<新模式>`，可通过日志确认。

### Q5：Agent 适配器命令找不到？

- 在系统终端执行对应命令（如 `kimi`、`claude`、`codebuddy`）确认已安装。
- 在设置中填写完整路径（如 `/opt/homebrew/bin/kimi`）。

---

## 11. 目录与文件速查

| 路径 | 说明 |
|------|------|
| `backend/dionysus_server/main.py` | 后端主入口 |
| `backend/config/personas/` | 运行时角色配置、语料、Live2D |
| `frontend/src/components/Pages/PersonaPage.tsx` | 角色页 |
| `frontend/src/components/UI/DionysusSelect.tsx` | 统一下拉组件 |
| `frontend/src/components/Pages/SystemSettingsPage.tsx` | 系统设置页 |
