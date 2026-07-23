# Phase 4 门禁：5 CLI 真实对话验证（core 层）

日期：2026-07-22 · 执行方式：`node_modules/.bin/tsx scripts/qa-phase4/demo-cli.ts --adapter <id>`
判定口径：≥1 条 agent_stream 或 status_update；恰好 1 条 agent_complete(status=success)；全部消息过 `@dionysus/protocol` parseServerMessage 校验；180s 总超时。
统一 prompt：`只回复两个字：你好。不要调用任何工具，不要读写任何文件，不要执行任何命令。`（纯文本、零副作用）
每轮原始证据：`out/demo-<adapter>-<ts>.json`（完整事件序列 + schema 校验结果）。

## 结果总览

| CLI | 安装 | 结果 | 耗时 | 事件序列摘要 |
|---|---|---|---|---|
| kimi_cli | ✅ /Users/fuyuuku/.kimi-code/bin/kimi | **PASS** | 6.1s | status_update → agent_stream("你好") → agent_complete(success)；共 8 条 |
| kimi_cli（重跑回归确认） | 同上 | **PASS**（事件形状与首轮一致，不回归） | 7.3s | 同上；证据 `out/demo-kimi_cli-1784654911670.json` |
| claude_cli | ✅ /opt/homebrew/bin/claude | **PASS** | 4.3s | agent_stream("你好\n") → agent_complete(success)；共 6 条 |
| opencode_cli | ✅ /opt/homebrew/bin/opencode | **PASS**（有解析泄漏，见下） | 4.7s | agent_stream×3（含 2 条原始 JSON 泄漏）+ status_update → agent_complete(success)；共 10 条 |
| codex_cli | ✅ /opt/homebrew/bin/codex (0.140.0) | **FAIL（环境原因，非实现 bug）** | 24.9s | 10× agent_stream（重连错误）→ agent_complete(error, "codex_cli exited with code 1")；共 15 条 |
| codebuddy_cli | ❌ `which codebuddy` 无命中 | **SKIP**（本机未安装，按任务约定跳过） | — | — |

注：四个已装 CLI 的验证是并行发起的（同一时刻四个 SessionManager 进程各跑一轮），期间互不干扰，顺带佐证多 CLI 并行路径。

## codex 失败详情（如实记录，不计实现 bug）

- 错误原文（codex CLI 自身 stdout，重试 2 次均复现）：
  `{"type":"error","message":"stream disconnected before completion: error sending request for url (http://127.0.0.1:15721/v1/responses)"}`
  随后 `{"type":"turn.failed",...}`，进程退出码 1。
- 根因：codex 配置的上游是本地代理 `127.0.0.1:15721`，`lsof -iTCP:15721 -sTCP:LISTEN` 确认**该端口无任何监听进程**——代理未启动，CLI 连不上模型后端。属本机环境/登录态问题，与 Dionysus 适配层无关。
- 适配层行为正确：错误事件全部透传、回合以恰好一条 `agent_complete(status=error, errorMessage="codex_cli exited with code 1")` 收尾、无挂死无双 complete。
- 待用户启动该代理（或改配）后用同一命令重跑即可补验。

## schema 校验

四轮（含 codex 失败轮）全部消息均通过 `parseServerMessage`，无任何 SCHEMA FAIL——信封 v=1、毫秒 ts、payload 形状符合 v3 协议。

## 发现的策略解析问题（均为基类「未知形状 → 原始 JSON 流」兜底泄漏，不阻断门禁）

1. **opencode**：`step_start` / `step_finish` 行未识别，原样泄漏进 agent_stream，用户会在聊天里看到大段原始 JSON。样例：
   `{"type":"step_start","timestamp":1784651690387,"sessionID":"ses_07a7853f6ffexlLzSaRJsq93B9","part":{...,"type":"step-start"}}`
   `{"type":"step_finish",...,"part":{...,"reason":"stop","tokens":{"total":7657,...},"cost":0.003356895}}`
   建议：策略对这两类行吞掉或映射为 status_update（tokens/cost 可进 detail）。
2. **codex**：`thread.started` / `turn.started` / `error` / `turn.failed` 同样原样泄漏；其中 `error`/`turn.failed` 建议映射为 status_update(error) 并把 message 带进 agent_complete.errorMessage（现在只有笼统的 "exited with code 1"）。另有一行非 JSON 提示 `Reading additional input from stdin...` 也进了流。
3. 上述泄漏是 `JsonStreamStrategy` 基类分支 5「任何输出都不丢」的既定语义，属已知取舍；按 ADR-19 不做自动修复，仅登记。

## 复跑命令

```bash
node_modules/.bin/tsx scripts/qa-phase4/demo-cli.ts --adapter kimi_cli     # PASS
node_modules/.bin/tsx scripts/qa-phase4/demo-cli.ts --adapter claude_cli   # PASS
node_modules/.bin/tsx scripts/qa-phase4/demo-cli.ts --adapter opencode_cli # PASS
node_modules/.bin/tsx scripts/qa-phase4/demo-cli.ts --adapter codex_cli    # 待本地 15721 代理恢复后重跑
# codebuddy_cli：本机未安装，跳过
```
