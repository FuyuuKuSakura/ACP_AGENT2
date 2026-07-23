# Dionysus v3 Phase 5 集成 E2E 报告（真 extension host + Playwright 移动客户端）

日期：2026-07-22 · 执行环境：macOS（ARM64），VS Code 1.x（Electron），Playwright 1.49.1 chromium headless
结论：**13/14 步 PASS**；发现 1 个集成 bug（归来摘要未接线，BUG-P5-1）+ 1 个环境级阻塞（kimi CLI print 模式默认模型挂起，非产品问题，已绕开）。

## 1. prepackage 修复（任务 1）

- `packages/extension/scripts/prepackage.mjs`：新增 `packages/mobile/dist → packages/extension/mobile-dist/` 拷贝（含头注释说明）。
  路径依据：`packages/extension/src/webview-provider.ts:93` `resolveMobileDist` 打包态优先读 `extensionUri/mobile-dist`（回退 `../mobile/dist` 开发态）；core-host 把它注入 lan-server 静态托管（`core-host.ts:402`）。
- 根 `.gitignore` 增补 `packages/extension/mobile-dist/`（prepackage 注释声明「产物目录已入 .gitignore」，保持兑现）。
- 验证：`node scripts/prepackage.mjs` 输出 4 行拷贝日志，`mobile-dist/{index.html,assets/index-*.js,assets/index-*.css}` 就位。
  E2E 中 VS Code 以 extensionDevelopmentPath 运行，`mobile-dist` 存在即被优先采用——配对页/首屏实际加载的就是该目录产物（截图 b2/c1）。

## 2. E2E 装置（scripts/qa-phase5/，不碰 packages/ 源码）

- `driver-ext/`：QA driver 扩展（信号文件执行 vscode 命令，沿用 qa-phase3 模式）。
- `run-e2e.mjs`：主控。干净 `/tmp/dionysus-phase5-{userdata,exts,ws}`（settings.json 预置 `lan.enabled=true, lan.port=8876`）→
  `code --extensionDevelopmentPath packages/extension + driver-ext` 启动真实 VS Code → 端口扫描 `/api/health` 定位 lan-server。
- **pair token 获取路径（任务 2a 的可行路径说明）**：pair token 只存 PairingManager 内存、不落盘，activate() 无 exports，
  宿主外唯一载体是配对弹层 webview。driver 与 dionysus 同处一个扩展宿主进程，`node:crypto.randomBytes` 是进程级单例；
  driver 在触发 `dionysus.showPairingQr` 前后临时包装它，按 pair token 规格（16 字节）+ 调用栈帧 `issueToken` 精确过滤，
  候选写 `out/pair-token.json`。两次运行均精确命中 1 个候选（`issueToken-hits=1`），Playwright 用它真实配对成功即为正确性验证。
- **锁屏模拟**：前置实验（`ws-offline-test.mjs`）证实 Chromium `setOffline` **不会断开已建立的 WebSocket**，
  改用 Playwright `routeWebSocket` 代理：locked 态拒绝一切新 WS 并掐断在网连接（=锁屏不可达），unlock 后放开；
  补一发合成 `visibilitychange` 触发移动端立即重连（防退避走满停摆）。
- **影子 WS**：node 端以同一 device token 的第二连接，全量记录 S→C 至 `out/shadow-ws.jsonl`，供协议级断言。

## 3. E2E 步骤与证据（out/report.json 逐条，截图在 out/）

| 步 | 结果 | 证据 |
|---|---|---|
| 启动 | PASS | lan-server running，端口 8876 |
| a. 取 pair token | PASS | 候选 1 个、issueToken 栈命中；错误 pair token → 401 `invalid_or_expired_pair_token` |
| b. 配对+首屏 | PASS | `#/pair/<token>` 自动 POST /api/pair → device token 存 localStorage、hash 抹除（#/list）、首屏渲染（b2-first-screen.png）；影子 WS handshake |
| c. 真实 kimi 回合 | PASS | 移动 UI 新建会话自动切入 chat；发「只回复两个字：你好」→ `agent_complete status=success`（3s），消息流渲染「你好」（c1-chat-turn1.png）；回合内消息类型含 user_message_echo/digest/todo/status/stream/companion/emotion/complete；JSONL 落盘含 user+agent 两行 |
| d. 锁屏追赶 | PASS（sync） | locked 后重连横幅出现（d1-offline-banner.png）；断线期间影子 WS 跑完第二回合（success）；unlock 重连后 sync 补拉把「收到」渲染进消息流（d2-reconnected-chat.png，可见两轮对话与来源标注） |
| d. 归来摘要卡 | **FAIL → BUG-P5-1** | 重连回首屏后 `return-summary-card` 不存在（d3-list-after-return.png：有头像/状态/未读角标，无摘要卡） |
| e. 负例 | PASS | `/ws?token=wrong` → HTTP 401 拒绝、无 WS 连接；`/assets/` 无 token 401、错误 token 401、正确 device token 200（对照；d3 中 kal'tsit 头像经 `/assets/?token=` 加载成功为正例旁证） |

设备持久化旁证：`globalStorage/paired-devices.json` 在配对后落盘。

## 4. 发现的集成 bug（只定位，未改源码）

### BUG-P5-1 归来摘要全链路未接线（core↔extension 装配缺口）

- 现象：锁屏追赶后移动端首屏无归来摘要卡。
- 定位：`packages/core/src/broadcast.ts:218` `maybeSendReturnSummary` 有完整实现（内置模板「你离开期间：…」、lag/disconnect 双阈值、rewriter 挂钩），
  但**全仓生产代码无任何调用方**（仅 `broadcast.test.ts` 调用）；`packages/extension/src/core-host.ts` 的 `sync_request` 分支只调
  `hub.handleSyncRequest`，WS 重连注册（`wsTransport.onConnect → hub.registerClient`）处也不触发摘要。
  mobile 端检测（`packages/mobile/src/stores/returnSummaryStore.ts`）与 UI 卡（`ReturnSummaryCard.tsx`）均就绪——缺的是 core-host 装配层在
  sync_request（或 WS onConnect）时以客户端游标调用 `maybeSendReturnSummary`（重连断连时长也无人统计传入）。
- 证据：d3 截图无卡；report.json `d-归来摘要卡` FAIL；grep 全仓仅定义与测试引用。

### 环境问题（非产品 bug）：kimi CLI print 模式默认模型挂起

- 现象：首跑回合 1 在 240s 内无任何 agent_stream/agent_complete，适配层无子进程退出、无错误事件。
- 定位：`kimi -p … --output-format stream-json`（0.28.0 与 0.28.1 均复现）在默认模型 `moonshot-cn/kimi-k2.6` 下挂起——
  无 stdout/stderr、无 TCP 连接、主线程空转于事件循环；干净 HOME 立即报「No model configured」（二进制正常）；
  显式 `-m kimi-code/kimi-for-coding` 秒级完成；本机 cron 的 `kimi -p` 同时段同样挂起（环境级，与 Dionysus 无关）。
  挂起点在 moonshot-cn（managed OAuth）provider 路径，疑似凭证/握手静默等待。
- QA 绕开：`scripts/qa-phase5/kimi-with-model.sh` 包装器注入 `-m kimi-code/kimi-for-coding`，
  QA 实例 settings 以 `dionysus.adapters.kimi_qa`（type=kimi_code_cli）指向包装器。不改产品源码、不动用户配置。

## 5. 遗留与建议

- BUG-P5-1 修复建议：core-host 在 `sync_request` 分支汇总该客户端各会话游标后调用 `hub.maybeSendReturnSummary`
  （另需在 WS onDisconnect/onConnect 处记录断连时长以覆盖 >60s 阈值路径），补一条「重连 → 摘要单播」的集成测试。
- 次要观察（代码层面确认，未做运行时复现）：mobile `probeDeviceToken`（packages/mobile/src/pairing.ts:96）
  依赖 `GET /api/health?token=` 判 401，但 lan-server 的 /api/health 固定回 `{"ok":true}` 不验 token
  （packages/extension/src/lan-server.ts:327-329）——设备被撤销后移动端会按「不可达」退避重连而非跳配对页
  （§6.3「401 → 重新配对」闭环在此路径不闭合）。
- QA 装置复用：`node scripts/qa-phase5/run-e2e.mjs` 一键全量（约 15s，真实 kimi 回合 2 个）。
- 首跑 b1 截图在配对完成后才拍下（配对过快），如需配对中画面可在 goto 与截图间加短延迟，不影响结论。
