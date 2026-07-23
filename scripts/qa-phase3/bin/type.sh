#!/bin/bash
# 把文本文件内容真实键入当前前台窗口中坐标 (x,y) 处的输入框：
#   type.sh <x> <y> <textfile> [enter]
# 步骤：点击 (x,y) 聚焦 → Cmd+V 粘贴（pbcopy 供稿）→ 可选回车发送。
# 坐标为 macOS 点坐标（screencapture 像素 / 2，Retina）。
set -euo pipefail
X="$1"; Y="$2"; FILE="$3"; ENTER="${4:-enter}"
BIN="$(cd "$(dirname "$0")" && pwd)"

pbcopy < "$FILE"

# 点击目标坐标聚焦（qaclick：swiftc 编译的 CGEvent 工具）
"$BIN/qaclick" "$X" "$Y" >/dev/null

sleep 0.6
# 粘贴
osascript -e 'tell application "System Events" to keystroke "v" using command down'
sleep 0.5

if [ "$ENTER" = "enter" ]; then
  # 回车发送（ChatInput：Enter 发送，Shift+Enter 换行）
  osascript -e 'tell application "System Events" to key code 36'
fi
echo "typed: $FILE @ ($X,$Y) enter=$ENTER"
