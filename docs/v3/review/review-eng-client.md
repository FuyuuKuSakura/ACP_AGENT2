# Dionysus v3 设计审阅报告 · 工程师视角（客户端与安全）

> 审阅范围：`architecture.md` §6（extension）、§7（webview）、§8（mobile）、§11（安全模型）、§4（协议，涉多端部分）；`roadmap.md` Phase 3 / Phase 5。
> 对照基准：产品核心功能 1–5（见审阅任务书）；v2 已证实缺陷以 `docs/v3/extract/` 各文档"已知缺陷"节为准。
> 结论速览：**阻断 0 / 高 4 / 中 7 / 低 4**。设计骨架（单 protocol 包、Transport 抽象、BroadcastHub、token 强制校验）成立，但移动端"状态追赶 + 多端一致性 + 资产/HTTP 面"三条链路缺少落地设计，直接压住核心功能 5。

---

## 高

### H-1 断线重连后无任何状态追赶机制，手机必然丢失进行中的回合

- 严重度：高
- 核心功能：5（随时清晰得知电脑上 agent 干活进展）、3（角色汇报）
- 出处：`architecture.md` §5.3（BroadcastHub）、§8（mobile）、§9.1 数据流；对照 `extract/protocol.md` §1（v2 仅有指数退避重连，无补发）与 §9 缺陷清单

问题描述：BroadcastHub 只向"当前已连接"的客户端扇出。手机浏览器锁屏、切后台、进电梯后 WS 被系统挂起或回收是**常态而非边缘场景**。断开期间错过的 `agent_stream` / `tool_call` / `companion_message` / `status_update` 全部丢失；重连后协议层没有消息序号、没有 last-seen 游标、没有任何 resync/snapshot 消息。`JsonlSessionStore` 只持久化 user/agent 终态消息（§5.3），`tool_call`、`status_update`、`companion_message` 均为瞬态广播，不落盘。后果：用户吃完饭拿回手机，看到的是"断线前旧界面 → 突然跳到已完成/或仍在流式但前文全无"，中间的角色汇报与工具操作记录永久缺失——这正是核心功能 5 要解决的场景。

修改建议（可直接执行）：

1. `Envelope` 增加 `seq: number`（per-session 单调递增，由 BroadcastHub 分配）。
2. BroadcastHub 为每个活动会话维护**内存环形事件缓冲**（如每会话最近 500 条 ServerMessage）；回合终态消息仍走 JSONL 落盘。
3. `handshake` payload 增加 `lastSeenSeq?: number`（客户端→服务端声明）；服务端收到后：a) 若缓冲覆盖该游标，按序补发缺失消息；b) 若已溢出，先发一条新增的 `session_snapshot` 消息（当前会话 status、进行中回合的流式文本前缀、未完成的 tool_call 列表、`todo_update` 全量快照——它本来就是全量、天然可重发、最新 `emotion_update`），再从缓冲头部续播。
4. mobile 端 WS 实现监听 `visibilitychange`：回到前台立即主动重连并携带 `lastSeenSeq`。
5. roadmap Phase 5"多端一致性"任务项中补验收：手机锁屏 60 秒后解锁，进行中的回合事件流完整补齐（可用 FakeAdapter 慢速流 + 集成测试模拟）。

### H-2 Remote-SSH / WSL / Dev Container 场景下手机如何连接完全未设计

- 严重度：高
- 核心功能：5
- 出处：`architecture.md` §6.3（绑定策略）、§1 非目标；`roadmap.md` Phase 5 验收

问题描述：VS Code 远程开发时 extension 默认运行在**远端** extension host。§6.3 的"绑定 `0.0.0.0` 并显示二维码"此时绑定的是远程服务器的网卡——家庭/办公手机通常根本路由不到那台远程机；即便路由得到，二维码里的 `<LAN-IP>` 也是远端内网地址，扫码必失败。Remote-SSH 是 VS Code 重度用户的常见形态，文档通篇未提该场景，移动端在 remote 下静默不可用。此外 `package.json` 的 `extensionKind` 声明（`ui` / `workspace`）对插件运行位置起决定作用，文档未规定。

修改建议：

1. §6 增补"远程开发场景"小节，显式声明 `extensionKind: ["workspace"]`（适配器/CLI 必须在远端跑），并写明后果：remote 下内嵌服务在远端。
2. 给出 remote 下的官方路径二选一并写入 README：a) 用 `vscode.env.asExternalUri(localPort)` 获得经 VS Code 端口转发回桌面的地址，二维码优先使用该 external URI（桌面 VS Code 的转发默认绑 localhost，需提示用户将转发端口改为公开，或配合桌面防火墙放行）；b) 明确"Remote-SSH 下移动端需自行 SSH 隧道/暂不支持"的降级文案，配对页检测 remote 环境时直接显示该指引而非一个必失败的二维码。
3. Phase 5 验收增加一条：在 Remote-SSH 窗口中执行配对流程，行为符合文档承诺（可用即通、不可用即有明确提示）。

### H-3 多端一致性缺口：用户消息无回显、option 选择无竞态解决

- 严重度：高
- 核心功能：5（传递短指令）、1（agent 对话管理）
- 出处：`architecture.md` §4.1 消息类型清单、§9.1；对照 `extract/protocol.md` §3（S→C 无用户消息回显类型，v2 前端本地乐观添加）

问题描述：ADR-4 声称"BroadcastHub 使多端同步免费获得"，但实际只覆盖了 S→C 的 agent 事件。两类缺口：

1. 手机发 `user_input` 后，core 持久化 USER 消息并跑回合，但**没有任何 S→C 消息把这条用户消息广播给 webview 端**——桌面端聊天流里看不到手机上发的指令，直到 agent 回复才间接感知。会话消息列表两端不再一致。
2. `option_request` 广播到两端后，任一端点击 `option_selected` 即推进回合；另一端的选项 UI 没有失效机制，用户可重复点击产生第二次 `option_selected`，被当作新一轮输入发给 agent（`extract/session.md` 中 option_selected 转 input 的语义），造成混乱回合。

修改建议：

1. protocol 新增 S→C 消息 `user_message_echo`：payload 含 `text`、`attachments`、`origin`（clientId 或设备名，供 UI 标注"来自手机"）。`SessionManager.runAgentTurn` 在持久化 USER 消息后向**除来源 clientId 外**的所有客户端广播（发送端保持本地乐观渲染，避免双份）。
2. protocol 新增 S→C 消息 `option_resolved`（payload：`requestTraceId`、`selectedId`、`origin`）；收到后各端将对应选项组置为已决态。`SessionManager` 对同一回合重复的 `option_selected` 幂等处理：忽略并回 `system_notice(level=info, "该选项已被选择")`。
3. 这两条进入 §4.1 消息清单与 Phase 2/Phase 5 的测试清单（多端 FakeClient 断言）。

### H-4 移动端的资产分发与 HTTP 鉴权方式未定义，Live2D/立绘/头像到不了手机

- 严重度：高
- 核心功能：2（Live2D 陪伴）、3（角色汇报的视觉载体）
- 出处：`architecture.md` §6.3（HTTP 端点仅 `/`、`/api/pair`、`/api/health`）、§3（Live2D 不随 vsix、放 `globalStorageUri/live2d/`）、§8（移动端 Live2D 或静态立绘降级）

问题描述：§8 要求移动端展示 Live2D 或静态立绘，但 §6.3 的 HTTP 面只有静态应用外壳和两个 API，**没有任何资产路由**：模型 `model3.json`/`.moc3`/纹理/motion JSON、persona 头像、降级立绘图片均无送达通道。同时 §11 说"配对端点外一切 HTTP 需设备 token"，但 token 在 HTTP 上如何携带全文未定义——而 `<img>`/`<script>`/pixi 的 XHR 加载**无法带 `Authorization` header**，这条路不专门设计就走不通。webview 侧有 `asWebviewUri` 方案，mobile 侧是空白。

修改建议：

1. §6.3 增加端点 `GET /assets/*`：将路径安全映射到 `globalStorageUri/live2d/` 与内嵌 `assets/personas/`（`path.normalize` + 前缀校验防穿越，与 §11 的 `..` 归一化校验同款），响应 `Cache-Control: private, max-age=300`。
2. 鉴权方式二选一并写死进文档：a) 资产 URL 携带 `?token=<device_token>`（与 WS 的 query 方案一致，实现最简；接受 token 出现在 URL 的局域网风险并在 §11 记录）；b) 配对成功后由服务端 `Set-Cookie`（`HttpOnly; SameSite=Strict`）下发会话凭证，资产与 API 走 cookie，WS 仍用 query token。推荐 a) 与 WS 统一，KISS。
3. Phase 5 任务项"lan-server"中补：`/assets/*` 路由 + 路径穿越单测；mobile 陪伴视图从 `/assets/live2d/<persona>/...` 加载模型或立绘。

---

## 中

### M-1 webview CSP 指令清单不全，pixi 模型加载所需的 `connect-src`/`script-src` 未列入

- 严重度：中
- 核心功能：2
- 出处：`architecture.md` §7（"CSP `img-src/media-src` 白名单"）、§11；对照 `extract/webview-inventory.md` §1（cubismcore 需全局 `<script>`）与 §3（Live2D 静态资源依赖）

问题描述：文档只点了 `img-src/media-src`。但 pixi-live2d-display 的实际加载链是：`live2dcubismcore.min.js` 需 `script-src`；`model3.json`/`.moc3`/`motion3.json`/`physics3.json` 经 XHR/fetch 加载，需 `connect-src`；纹理经 Image/createImageBitmap 需 `img-src`；降级 webm 需 `media-src`。缺 `connect-src` 时模型 JSON 都取不到，R-1 spike 会第一轮就撞上。另外用户自放置模型在 `globalStorageUri/live2d/`，webview 的 `localResourceRoots` 必须显式包含该目录，文档未提。

修改建议：§7 给出完整 CSP 模板作为 spike 验收基线，例如：

```
default-src 'none';
script-src ${webview.cspSource} 'nonce-<boot>';
style-src ${webview.cspSource} 'unsafe-inline';
connect-src ${webview.cspSource};
img-src ${webview.cspSource} data: blob:;
media-src ${webview.cspSource};
font-src ${webview.cspSource};
worker-src blob:;
```

并在 `webview-provider.ts` 中把 `localResourceRoots` 设为 `[extensionUri/webview-dist, globalStorageUri/live2d]`。R-1 spike 的验收改为"模型 JSON、moc3、纹理、motion 全部经 asWebviewUri 在上述 CSP 下加载成功并渲染一帧"。

### M-2 端口冲突、多窗口、配置热更新的服务行为未定义

- 严重度：中
- 核心功能：5
- 出处：`architecture.md` §6.3（"端口默认 8765 可配"）、§6.5（配置热更新）

问题描述：三处空白——a) `EADDRINUSE` 时行为未规定：目标用户不是网络工程师，8765 被占（含另一个 VS Code 窗口也开了本插件——多窗口各有 extension host）时移动端链路直接死；b) 多 VS Code 窗口同时激活插件时谁绑定端口未定义；c) `dionysus.lan.enabled/port` 改动后是否重新 listen 未定义（§6.5 的单引用热更新只覆盖 core 配置，不覆盖 socket 绑定）。

修改建议：§6.3 明确：a) listen 失败时自动递增端口重试（8765→8775 上限），二维码始终使用**实际绑定端口**，并在 webview 弹层显示当前地址；b) 多窗口场景声明"先到先得"：后启动窗口检测到端口已被同插件占用时，`lan-server` 进入 disabled 态并 `system_notice` 提示，不抢占；c) `lan.enabled`/`lan.port` 变更触发 lan-server 重启监听，复用现有配置热更新通道。

### M-3 §4.1 消息清单遗漏 ping/pong/handshake/new_session/client_command，心跳与死连接清理落空

- 严重度：中
- 核心功能：5（连接保活）、1
- 出处：`architecture.md` §4.1"保留"清单；对照 `extract/protocol.md` §1（v2 心跳 30s + 指数退避）、§8.5（v2 解析失败静默断连教训）

问题描述：§4.1 的保留清单只列了业务消息，`ping`/`pong`/`handshake`/`new_session`/`client_command` 全部不见（§4.1 提到"新增 handshake 的 v 协商"，证明 handshake 存在，但清单没列——至少清单不完整）。手机网络下 NAT/运营商会回收空闲 TCP，没有应用层心跳，服务端无法区分"用户锁屏"与"连接已死"，BroadcastHub 会持续向死连接 `send`（结合 H-1 的补发缓冲，还会污染 seq 记账）。v2 已有 ping/pong 机制，v3 清单若照字面实现就是回退。

修改建议：§4.1 清单补回 `ping`/`pong`/`handshake`/`new_session`/`client_command`；`WsTransport` 规定：客户端 30s 心跳，服务端 75s 未收到任何帧即主动断开并注销 clientId（同时喂给 H-1 的"断开只注销自己"逻辑）；`send` 失败时立即注销该 clientId 并从广播表移除，记 warning 不影响其他连接（沿用 v2 `_emit_supervisor_message` 的单点失败隔离语义，`extract/session.md` §5.2）。

### M-4 mobile 引用 `packages/webview/src/shared/` 违反自定义依赖方向，且真正该共享的路由/store 不在共享层

- 严重度：中
- 核心功能：5（两端行为一致）、工程可维护性
- 出处：`architecture.md` §8（"放 `packages/webview/src/shared/` 由两端引用"）vs §3 依赖方向图（"webview/mobile 只依赖 protocol"）、§7（messageRouter、按域 stores 归 webview）

问题描述：两层问题。a) 方向矛盾：§3 声明 mobile 只依赖 protocol，§8 却让 mobile 以源码相对路径引用 webview 包内部目录——这绕过包边界，TS path alias / Vite resolve / pnpm 构建拓扑 / eslint import-boundary 全都要为这种跨包源码引用开特例，且 mobile 的依赖声明（react-markdown 等）会随 webview 内部实现漂移。b) 共享内容错位：共享的只有"气泡、markdown 渲染"等纯 UI；而真正决定两端行为一致性的 `messageRouter`（12 分支消息分发）和按域 stores（sessionStore/streamStore/companionStore）各自实现——结合 H-3，两端对同一消息流的解析逻辑写两遍，漂移只是时间问题。"控制包数量"的理由在已有 5 个包的前提下不成立，第 6 个纯 TS 包成本极低。

修改建议：新建 `packages/client-core/`（`@dionysus/client-core`）：承载 `ClientTransport` 接口、`messageRouter.ts`、按域 stores、协议驱动的 selector；UI 基础组件（气泡、markdown）放 `packages/client-core/ui/` 或独立 `shared-ui` 目录。webview/mobile 各自只剩宿主壳（vscodeApi transport / WS transport、布局、样式）。§3 依赖图改为 `webview ─┐ ├─► client-core ─► protocol`，方向依然单向。

### M-5 token 校验时机描述笼统，HTTP 面鉴权细节缺失

- 严重度：中
- 核心功能：5（安全前提）
- 出处：`architecture.md` §6.3（"握手强制校验 token"）、§11；对照 `extract/pairing-mobile.md` §5.1（v2 `is_device_valid` 无人调用的教训）

问题描述：v2 的教训是"发了证不验票"，v3 的修复只有一句"握手强制校验 token"，工程上仍有歧义：a) WS 校验发生在哪个时机——先 `accept` 再校验再 `close`，还是在 HTTP `upgrade` 事件里先校验？前者给了未授权方一个已建立的 WS 通道窗口，也浪费资源；b) HTTP 端点的校验方式（header/query/cookie）未定义（见 H-4）；c) 校验失败的响应（401 JSON？直接断 socket？）未定义，客户端无法区分"token 失效应重新配对"与"网络错误"——而"401 → 重新配对"正是 `extract/pairing-mobile.md` §5.5 要求从零实现的闭环。

修改建议：§6.3 明确：a) 在 Node `http` server 的 `upgrade` 回调内、调用 `ws.handleUpgrade` **之前**校验 query token，失败直接 `socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')` + `socket.destroy()`，不产生 WS 连接；b) HTTP API 统一返回 `401 {"error":"invalid_device_token"}` JSON，mobile 端收到 401 清本地 token 跳配对页；c)  pairing token 与 device token 均 constant-time 比较（§11 已有，保持不变）。

### M-6 配对二维码弹层无 TTL 倒计时与刷新机制

- 严重度：中
- 核心功能：5（配对 UX）
- 出处：`architecture.md` §6.4；对照 `extract/pairing-mobile.md` §5.4（v2 同缺陷，明确点名 v3 应修）

问题描述：pair token TTL 300 秒，§6.4 未提弹层的倒计时显示与过期刷新——v2 的同款缺陷（弹窗开超过 300 秒二维码即作废，用户扫一个死码）被 extract 文档明确列为"v3 应加倒计时 + 自动/手动刷新"，architecture 未采纳也未回应。

修改建议：§6.4 补：二维码弹层显示 token 剩余 TTL 倒计时；剩余 <30s 或已过期时自动调用 `PairingManager.issueToken()` 重新生成并替换二维码（旧 token 立即失效）；同时提供手动刷新按钮。Phase 5 配对流程集成测试覆盖"过期 token 扫码被拒"。

### M-7 打断双 `agent_complete` 的去重机制（turn_id）未被 v3 采纳

- 严重度：中
- 核心功能：4（操作显示的正确性）、3
- 出处：`architecture.md` §4.1（信封仅 `traceId`）；对照 `extract/protocol.md` §8.3 与 §9.7（v2 打断后客户端收两条 `agent_complete`，建议 turn_id）

问题描述：extract 明确建议"v3 应让一回合共享一个 turn_id"，architecture 的 v3 改动清单未采纳也未说明理由。多端场景下该问题放大：手机发起 interrupt 后，两端都会收到两条 `agent_complete`，各端要各自幂等 finalize；回合粒度的 UI（状态条、角色汇报"回合结束"台词触发）可能双触发。

修改建议：§4.1 信封或回合类消息 payload 增加 `turnId`（回合开始由 SessionManager 生成）；`agent_complete` 携带 `turnId`，客户端按 `turnId` 幂等 finalize；CompanionSupervisor 的回合后回放也以 `turnId` 去重。若决定不采纳，应在 §4.1 显式记录理由与替代幂等方案。

---

## 低

### L-1 二维码内容用 query（`?pair=`）而非 fragment，token 进入浏览器历史

- 严重度：低
- 核心功能：5
- 出处：`architecture.md` §6.4 / §9.2（`http://<LAN-IP>:<port>/?pair=<token>`）；对照 `extract/pairing-mobile.md` §5.3（建议 `#pair_token=`）

问题描述：extract 明确建议把 pair token 放 URL fragment（`#pair=`），避免进入浏览器历史、Referer 与服务器访问日志；architecture 选择了 query 形式且未说明理由。一次性 token 泄露窗口短，故只评低。

修改建议：二维码内容改为 `http://<LAN-IP>:<port>/#pair=<token>`，mobile 应用启动时读 `location.hash` 完成配对后立即 `history.replaceState` 抹掉。若坚持用 query，在 §6.4 写明取舍理由。

### L-2 device token 无 `last_seen` 刷新与轮换，v2 缺陷 6 未回应

- 严重度：低
- 核心功能：5（设备管理 UX）
- 出处：`architecture.md` §6.4；对照 `extract/pairing-mobile.md` §5.6（`last_seen` 只写创建时刻）

问题描述：§6.4 说 token"一次性 + 设备白名单 + 可撤销"，但设备管理体验依赖"哪台设备最近在用"——v2 的 `last_seen` 从不更新被点名，v3 未提。device token 长期有效且无轮换策略，属于可接受的局域网取舍，但应显式记录。

修改建议：`PairingManager` 验票成功时刷新 `last_seen` 并落盘（节流到每分钟最多一次写）；设备列表 UI 展示"最近活跃"；§11 补一句"device token 长期有效、不轮换，撤销为唯一回收手段"的显式决策。

### L-3 LAN 明文 HTTP 的威胁模型未文档化

- 严重度：低
- 核心功能：5
- 出处：`architecture.md` §11

问题描述：绑定 `0.0.0.0` 后全部流量（含 device token、对话内容、代码片段）明文过局域网，同网段可嗅探/重放。对"吃饭场景的家庭网络"风险可接受，但 §11 未声明该威胁模型，用户开公共 Wi-Fi（公司/咖啡厅）时无从知情。`GET /api/health` 无鉴权还暴露了服务存在性（指纹）。

修改建议：§11 增加"已知限制"小节：LAN 模式为明文 HTTP，仅在可信网络开启；公共网络建议关闭 `lan.enabled` 或走隧道；`/api/health` 响应只返回 `{"ok":true}`，不带版本/配置信息。HTTPS/mTLS 列入后置候选（与 Bridge CLI 同列 §10 之外的 backlog）。

### L-4 `lan.enabled: false` 时 127.0.0.1 服务的存在意义不清

- 严重度：低
- 核心功能：—（工程整洁）
- 出处：`architecture.md` §6.3（"默认绑定 127.0.0.1（仅本机 webview 调试用）"）

问题描述：webview 走 postMessage，不需要 HTTP；"本机 webview 调试用"指代不明。若 lan-server 唯一职责是移动端链路，默认关闭时就该不起服务，减少攻击面与常驻资源；若另有调试用途（如 curl 打 API），应写清楚并默认不注册配对以外的端点。

修改建议：§6.3 明确二选一：a) `lan.enabled: false` 时 lan-server 不启动（推荐）；b) 若保留 127.0.0.1 调试服务，限定仅 `/api/health` 且文档说明用途。

---

## 无欠缺的方面（明确确认）

- **WS 握手鉴权的方向性决策**：相比 v2 局域网裸奔（`extract/pairing-mobile.md` §5.1），ADR-7 + §11 的"强制校验 + 白名单 + 可撤销 + 128-bit 随机 + constant-time 比较"闭环完整，方向正确（缺的只是 M-5 的落地细节）。
- **多标签断连不误杀适配器**：§5.3"断开只注销自己，绝不触碰适配器进程"正确修复了 v2 缺陷（`extract/pairing-mobile.md` §5.2），且 Phase 5 验收有对应条目。
- **Live2D 风险前置**：R-1 spike 作为 Phase 1 门禁、失败即停，是对 webview CSP 不确定性的正确工程处理；问题只在 CSP 清单细节（M-1），策略无欠缺。
- **撤销设备后断开连接**：Phase 5 验收明确"撤销设备后连接被断开"，配对安全闭环的关键一环已覆盖。
- **协议信封的版本字段与毫秒时间戳统一**：修复了 v2 的两处实证缺陷，无欠缺。

---

## 总评

**整体判断：架构骨架撑得住核心功能，但移动端相关设计完成度明显低于 core/webview，当前状态直接进入 Phase 5 会返工。** §6.2 的 Transport 抽象、§5.3 的 BroadcastHub、ADR-4/ADR-7 的方向都正确，问题集中在"从抽象到手机浏览器"的最后一段：协议层缺追赶与回显消息、HTTP 面缺资产路由与鉴权方式、部署面缺 remote/端口/多窗口行为。这些不是推倒重来级的问题，而是协议与 lan-server 需要各扩一节。

最大的三个缺口：

1. **断线重连状态追赶机制整体缺失**（H-1）：手机锁屏是常态，协议无 seq/游标/快照，"随时清晰得知电脑上 agent 进展"在真实使用节奏下必然打折。这是最伤核心功能 5 的一条，需要在 Phase 2 定 protocol 时就加 `seq`，否则事后补要动全部消息处理。
2. **多端一致性只做了"广播 agent 事件"一半**（H-3 + M-4）：用户消息无回显、option 无竞态解决、消息路由逻辑两端各写一遍——"BroadcastHub 使多端同步免费获得"（ADR-4）目前是不成立的宣传语，需要补 `user_message_echo`/`option_resolved` 并把 messageRouter/stores 收敛到共享包。
3. **移动端的连接与资产"最后一跳"无设计**（H-2 + H-4 + M-2）：Remote-SSH 下手机连不上且无提示、Live2D/立绘资产无 HTTP 路由与可行的鉴权携带方式、端口冲突/多窗口行为未定义——这三项决定"扫码即用"的配对体验能否兑现，建议在 Phase 5 开工前先补一节"lan-server 完整端点与部署边界"设计。
