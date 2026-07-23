#!/bin/bash
# Phase 3 真机门禁 · 阶段 2：会话 A（建会话 + 发长 prompt）。
# 用法：02-session-a.sh <输入框x> <输入框y>   （点坐标，从 02-layout.png 读）
set -euo pipefail
QA_DIR="$(cd "$(dirname "$0")" && pwd)"
X="$1"; Y="$2"

"$QA_DIR/bin/signal.sh" dionysus.newSession
for i in $(seq 1 15); do
  grep -q 'exec-done: dionysus.newSession' "$QA_DIR/out/driver.log" && break
  sleep 1
done
sleep 4  # 等 sidebar/chat webview 收到 session_digest_update
"$QA_DIR/bin/shot.sh" 03-sessionA-created

"$QA_DIR/bin/type.sh" "$X" "$Y" "$QA_DIR/prompts/a.txt" enter
sleep 3
"$QA_DIR/bin/shot.sh" 04-A-running
echo "SESSION A SENT — 查看 out/04-A-running.png 确认用户消息已回显、回合开始"
