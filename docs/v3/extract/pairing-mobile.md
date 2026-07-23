# 二维码配对与移动端规格（v2 知识提取）

> 目标读者：要在 v3 中实现"VS Code 插件 + 手机浏览器"配对与移动端 UI 的工程师。
> 重要前提：**v2 只实现了配对链路的服务端一半**——token 生成、二维码 PNG、设备登记都在，但没有任何端点校验 device_token，前端也没有消费配对结果的移动端代码。手机访问 v2 靠的是"后端直接托管静态前端 + 局域网无鉴权"。本文如实记录现状，并在末尾给出 v3 必须补的安全闭环。
> 所有行号均已对照源文件核实。

## 1. 配对流程完整时序

### 1.1 PairingManager 数据模型

`backend/dionysus_server/pairing.py`（93 行，全文）：

- 常量：`PAIR_TOKEN_TTL_SECONDS = 300`（pairing.py:17）、`DEVICE_TOKEN_BYTES = 32`（:18）。
- 两类 token：
  - **pair token**：`secrets.token_urlsafe(16)`（约 22 字符），只存内存 `_pair_tokens: dict[str, float]`（值为过期时间戳），TTL 300 秒，一次性（验证即 `pop`，pairing.py:71）。来源：pairing.py:61-66。
  - **device token**：`secrets.token_urlsafe(32)`，长期有效，持久化到 `<DATA_DIR>/pairing/devices.json`（pairing.py:30-33）。DATA_DIR 默认是 `<config_dir>/../data`（开发态即 `backend/data`），可用环境变量 `Dionysus_DATA_DIR` 覆盖（backend/dionysus_server/paths.py:45-51）。
- devices.json 格式（pairing.py:74-79 写入，:49-53 序列化）：

```json
{
  "<device_token>": {
    "created_at": 1718000000.0,
    "last_seen": 1718000000.0
  }
}
```

注意 `last_seen` 只在创建时写入一次，之后**从不更新**（verify 里没有刷新逻辑）。

- 管理操作：`list_devices`（pairing.py:82-83）、`revoke_device`（:85-90）、`is_device_valid`（:92-93）。

### 1.2 时序（现状）

```
桌面端点击导航条 QR 按钮（NavSidebar.tsx:91 → QRCodeButton.tsx）
  └─ <img src="/api/pair/qr">（QRCodeButton.tsx:56-60）
     └─ GET /api/pair/qr（main.py:812-823）
        ├─ pairing_manager.create_pair_token()          ← 每次请求都生成新 token
        ├─ payload = {"pair_token": token, "host": "http://<Host头>"}（main.py:818）
        └─ qrcode.make(payload) → PNG（box_size=6, border=2）
手机扫码 → 得到一段 JSON 文本（不是 URL！）
  └─ 【断裂点】v2 没有手机端代码解析这段 JSON、调用 POST /api/pair、保存 device_token
     （全仓库 grep 不到任何 /api/pair 的客户端调用，QRCodeButton 是唯一引用）
理论上的后半程（服务端已就绪、客户端缺失）：
  └─ POST /api/pair {"pair_token": ...} → {"device_token": ...}（main.py:825-840）
     └─ 之后所有请求携带 device_token → is_device_valid 校验 ← 【无人调用】
```

**关键事实**：二维码内容不是 URL 而是 JSON 字符串（main.py:818），手机系统相机扫出来只是一段文本，无法直接跳转到网页。QRCodeButton 弹窗里展示的 `window.location.origin` 文本（QRCodeButton.tsx:10,61-63）给人"扫码即访问该 URL"的错觉，但 URL 并不在二维码里。v3 若要"扫码即开网页"，应把二维码内容改为 `http://<host>/?pair_token=<token>#/` 之类的 URL。

### 1.3 手机实际如何访问 v2

不经过配对：后端 `host: 0.0.0.0`（backend/config/server.yaml:2），uvicorn 直接以 StaticFiles 托管 `frontend/dist`（main.py:1088 `app.mount("/", StaticFiles(directory=static_dir, html=True))`），手机浏览器打开 `http://<局域网IP>:8765` 即用全功能。开发态则是 vite dev server `host: 0.0.0.0`（frontend/vite.config.ts:46）+ `/api`、`/ws` 代理到 127.0.0.1:8765（vite.config.ts:49-57）。

## 2. /api/pair* 及相关端点逐个说明

全部位于 `backend/dionysus_server/main.py`，逐一核实：

| 方法/路径 | 行号 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| GET `/api/server/info` | main.py:782-787 | 无 | `{"url": "<scheme>://<host>"}` | 从 `Host` 头和 `x-forwarded-proto` 拼客户端可达 URL。Electron 主进程用它做后端就绪探测 |
| GET `/api/server/qr?url=...` | main.py:789-796 | query `url` | PNG 流 | 通用 QR 生成器（任意 URL），`box_size=6, border=2`。**前端未使用** |
| POST `/api/pair/token` | main.py:798-810 | 无 | `{"pair_token", "expires_in": 300, "host"}` | 创建 pair token。前端未使用 |
| GET `/api/pair/qr` | main.py:812-823 | 无 | PNG 流 | 内含 `{"pair_token","host"}` JSON 的二维码，每次调用生成新 token。**前端唯一消费的配对端点**（QRCodeButton.tsx:57 作为 `<img>` src） |
| POST `/api/pair` | main.py:825-840 | JSON `{"pair_token"}` | 200 `{"device_token"}`；400 `missing_pair_token` / `invalid_json(_object)`；401 `invalid_or_expired_pair_token` | pair token 一次性换 device token（pairing.py:68-80） |
| GET `/api/pair/devices` | main.py:842-845 | 无 | devices dict | 列出已配对设备 |
| POST `/api/pair/revoke` | main.py:847-861 | JSON `{"device_token"}` | 200 `{"ok": true}`；404 `device_not_found` | 吊销设备 |

`PairingManager` 在 `create_app` 内实例化（main.py:897）。

### WebSocket 端点（与移动端强相关）

`@app.websocket(config.server.ws_path)`（main.py:903，ws_path 默认 `/ws`，backend/config/server.yaml:4）：query 参数 `session_id`、`persona_id`（main.py:906-908），无 session 则新建（:910-915）；断连后在 `finally` 里 `close_adapter`（main.py:956-958）。**无任何鉴权**。前端连接方式：`useWebSocket('/ws', ...)`（App.tsx:264），相对路径经 vite 代理或与静态页同源。

## 3. 前端配对 UI 行为

`frontend/src/components/Layout/QRCodeButton.tsx`（87 行）：

- 入口：桌面导航条底部一个 44×44 图标按钮（QRCodeButton.tsx:73-82），在 NavSidebar 底部区（NavSidebar.tsx 引用 QRCodeButton）。
- 弹层：`createPortal` 到 body，`fixed z-[200] w-64` 玻璃风卡片，定位在按钮右侧（QRCodeButton.tsx:14-19,39-43,84）；Esc 关闭（:30-37）。
- 内容：标题"扫码连接"（:45）、`<img src="/api/pair/qr">` 44×44px 白底（:56-60）、下方显示 `window.location.origin`（:10,61-63）。
- **刷新行为**：没有手动刷新按钮；每次重新打开弹窗（或 React 重新挂载 `<img>`）会重新请求 `/api/pair/qr`，服务端每次生成新 token——弹窗开着 token 过期（300 秒）后不会自动更新。v3 应加倒计时 + 自动/手动刷新。
- 移动端：NavSidebar 是 `hidden md:flex`（Layout.tsx:77），**手机上根本看不到 QR 按钮**——配对入口只对桌面用户存在，这与"手机扫码配对"的目的一致（桌面展示、手机扫）。

## 4. 现有移动端 UI 信息架构盘点

移动端适配方式：**纯 CSS 断点 `md`（768px）**，无 JS UA/宽度检测；`hidden md:flex` 与 `md:hidden` 成对出现。无 react-router，移动端"页面切换"靠 layoutStore 的 `mobileView: 'session-list' | 'chat'`（layoutStore.ts:5,22-23）。

### 4.1 视图与组件清单

| 视图/组件 | 文件:行号 | 说明 |
|---|---|---|
| 会话列表（首屏） | Layout.tsx:184-188 | `mobileView==='session-list'` 时整页渲染 SessionList + `cel-session-list` 背景 |
| 会话列表头部 | MobileSessionListHeader.tsx:9-35 | 头像+应用名+在线状态点+搜索框（搜索框**无逻辑**，纯 UI） |
| 会话项选择 | SessionList.tsx:59-62 | 点击会话 `setCurrentSession` + `setMobileView('chat')` |
| 聊天页 | Layout.tsx:190-230 | Header(showBack) + MobileCompanionBar + ChatContainer + ToolHUD + ChatInput |
| Header 返回键 | Header.tsx:57-66 | `setMobileView('session-list')` |
| 陪伴状态条 | MobileCompanionBar.tsx:29-44 | 整宽按钮，显示流式状态图标（thinking/reading_file/executing/outputting 转圈、error 红叉、idle 星星）+ 文案（detail → 最新 todo → companionLine → 占位"点击展开角色陪伴"），点击开抽屉 |
| 陪伴抽屉 | MobileCompanionDrawer.tsx:13-86 | 底部抽屉 80vh：遮罩 `bg-black/60`；Framer Motion y 弹簧滑入；**支持下拉拖拽关闭**（drag="y"，下拉 >120px 关闭，:30-37）；内容 = CharacterDialogBox + Live2DViewer + 底部 ToolPanel |
| 资源面板 | MobileResourcePanel.tsx:13-26 | 右侧全高抽屉（左遮罩 `bg-black/40`），内嵌 SessionSettingsPanel（会话标题/Adapter/工作目录） |
| 全局覆盖页 | Layout.tsx:202-228 | 调色盘/角色/系统设置在移动端也以 OverlayPage 盖在聊天区上 |
| 发送即展开 | ChatInput.tsx:89-90 | 移动端发消息自动 `setCompanionDrawerOpen(true)`，让用户看到角色反应 |

### 4.2 移动端特有交互细节

- 触屏滚动：`.touch-pan-y`（`touch-action: pan-y` + `-webkit-overflow-scrolling: touch`，styles/index.css:176-179）用于 TodoPanel/ToolPanel 列表。
- Live2D 画布 `touch-none`（Live2DViewer.tsx:157），触摸事件由 useMouseTracking 的 touchstart/touchmove 监听接管并转换为注视参数（useMouseTracking.ts:136-153）。
- 点触互动：点按角色按 Y 坐标分头/身两区（head: normY > 0.35），随机台词 + 表情，600ms 冷却（Live2DViewer.tsx:357-388）。
- Header 在移动端 `h-14`、桌面端 `h-8`（Header.tsx:55）。
- QA 线索：`scripts/qa_mobile_chat.js` 用 390×844（iPhone 12 尺寸）视口截图验证移动端聊天页；`qa_screenshots/novice_test/04_companion_drawer.png` 验证了陪伴抽屉。

### 4.3 v3 移动端功能基线（从零构建时应覆盖）

1. 会话列表 ↔ 聊天两视图切换（含返回手势/按钮）。
2. 聊天流：Markdown 气泡、流式状态、思考折叠、选项交互（ButtonGroup/DropdownOptions/CardList）、系统通知。
3. 输入框：快捷指令（/plan /yolo /cd /switch /adapter）、Plan/Yolo 模式切换、中文输入法 composition 保护（ChatInput.tsx:243-248）。
4. 陪伴：底部抽屉承载 Live2D + 台词气泡 + 工具/Todo 面板；状态条实时反映流式状态；点触互动。
5. 配对：扫码/输码进入，token 持久化（localStorage），断线重连自动带 token。
6. 会话设置：改标题、切 adapter、切工作目录。

## 5. 已知缺陷与 v3 改进

1. **鉴权形同虚设（最严重）**：`is_device_valid`（pairing.py:92-93）在全仓库没有任何生产调用——仅测试引用（backend/tests/test_pairing.py:22,36）。所有 HTTP 端点和 `/ws` WebSocket 对局域网完全开放（main.py:903-959 的 WS 处理连 query 里的 token 都不读）。而后端绑定 `0.0.0.0`（backend/config/server.yaml:2）、`/ws` 能驱动任意 CLI agent 执行命令。等于"配对"做了一套完整的发证体系却从不验票。**v3 必须**：HTTP 中间件 + WS 握手（query `device_token`）强制 `is_device_valid` 校验；桌面 localhost 连接可豁免或自动配对。
2. **多标签页断连误杀共享适配器进程**：每个 WS 连接断开后 `finally` 里无条件 `await manager.close_adapter(connection.session_id or session.id)`（main.py:956-958）。两个标签页连同一 session 时，关一个标签就把另一个还在用的 agent 子进程杀掉。**v3 必须**：按 session 做连接引用计数，仅当最后一个连接断开才关闭适配器。
3. **二维码内容不可直接用**：内容是 JSON 文本而非 URL（main.py:818），手机相机扫了不会跳浏览器；且 QRCodeButton 展示的 origin 文本与二维码内容不一致（QRCodeButton.tsx:10,57）。v3 应改为 URL 形式（`https://host/m#pair_token=...`），手机打开后前端自动完成配对换取 device_token 并持久化。
4. **无刷新机制**：`/api/pair/qr` 每次调用生成新 token（main.py:815），前端 `<img>` 无过期提示与刷新（QRCodeButton.tsx:56-60），弹窗开超过 300 秒二维码即作废。v3 应显示 TTL 倒计时并自动刷新。
5. **配对闭环客户端缺失**：没有任何前端代码调用 `POST /api/pair`、存储 device_token、或在 WS/HTTP 请求中携带它——v3 手机端需从零实现"扫码→换 token→持久化→携带→401 重新配对"全流程。
6. **`last_seen` 从不更新**（pairing.py:75-78 只写创建时刻），设备列表无法用于"最近活跃"判断；v3 应在每次验票时刷新。
7. **mobileView 初始值问题**：`mobileView` 默认 `'session-list'`（layoutStore.ts:49）且被 persist 之外的 state 管理，桌面端无影响，但手机直接刷新深链无路由可恢复；v3 移动端建议用真路由（hash router 即可）。
8. **MobileSessionListHeader 搜索框无逻辑**（MobileSessionListHeader.tsx:27-34），v3 要么实现要么删掉。
