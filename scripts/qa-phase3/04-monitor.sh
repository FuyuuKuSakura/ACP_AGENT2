#!/bin/bash
# Phase 3 真机门禁 · 阶段 4：并行期间定时取证 + 结束后发短消息验证会话仍可用。
# 用法：04-monitor.sh <输入框x> <输入框y>
set -euo pipefail
QA_DIR="$(cd "$(dirname "$0")" && pwd)"
X="$1"; Y="$2"
SESS=/tmp/dionysus-phase3-userdata/User/globalStorage/dionysus.dionysus-vscode/sessions

sleep 12; "$QA_DIR/bin/shot.sh" 08-plus15s
sleep 30; "$QA_DIR/bin/shot.sh" 09-plus45s
ls -l "$SESS" > "$QA_DIR/out/sessions-ls-mid.txt" 2>&1 || true

# 等两个 jsonl 都出现 role=agent 消息行（回合结束时持久化 agent 消息；上限 5 分钟）
for i in $(seq 1 60); do
  n=$(grep -l '"role":"agent"' "$SESS"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -ge 2 ] && break
  sleep 5
done
sleep 3
"$QA_DIR/bin/shot.sh" 10-both-done
ls -l "$SESS" > "$QA_DIR/out/sessions-ls-final.txt" 2>&1 || true

# 短消息确认会话仍可用（chat 当前在 B）
"$QA_DIR/bin/type.sh" "$X" "$Y" "$QA_DIR/prompts/short.txt" enter
sleep 20
"$QA_DIR/bin/shot.sh" 11-after-short
echo "MONITOR DONE — 核查 08~11 截图与 driver.log"
