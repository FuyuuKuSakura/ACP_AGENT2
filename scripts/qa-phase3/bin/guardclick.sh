#!/bin/bash
# 原子交互：仅当 VS Code 为前台应用时才执行动作，避免污染用户其他窗口。
# 用法: guardclick.sh <x> <y>
set -euo pipefail
BIN="$(cd "$(dirname "$0")" && pwd)"
osascript -e 'tell application "System Events" to tell process "Code" to set frontmost to true' 2>/dev/null || true
sleep 0.6
FRONT=$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true')
if [ "$FRONT" != "Code" ]; then
  echo "ABORT: frontmost=$FRONT (not Code)"
  exit 1
fi
"$BIN/qaclick" "$1" "$2"
