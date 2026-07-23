#!/bin/bash
# Phase 3 真机门禁 · 阶段 3：会话 B（A 仍在跑时建 B → sidebar 点 B 条目切换 → 发长 prompt）。
# 用法：03-session-b.sh <sidebar会话B条目x> <sidebar会话B条目y> <输入框x> <输入框y>
# 注意：chat 视图不会自动切到新会话（currentSessionId 已占），必须点 sidebar 的 B 条目。
set -euo pipefail
QA_DIR="$(cd "$(dirname "$0")" && pwd)"
BX="$1"; BY="$2"; X="$3"; Y="$4"

"$QA_DIR/bin/signal.sh" dionysus.newSession
sleep 4
"$QA_DIR/bin/shot.sh" 05-B-created

"$QA_DIR/bin/click.sh" "$BX" "$BY"   # sidebar 点 B 条目 → chat 切到 B
sleep 2
"$QA_DIR/bin/shot.sh" 06-B-focused

"$QA_DIR/bin/type.sh" "$X" "$Y" "$QA_DIR/prompts/b.txt" enter
sleep 3
"$QA_DIR/bin/shot.sh" 07-both-running
echo "SESSION B SENT — 两个回合应并行进行中；查看 out/07-both-running.png"
