#!/bin/bash
# Phase 3 真机门禁 · 阶段 1：干净环境启动真实 VS Code 宿主。
# 前提：机器已解锁（锁屏下 GUI 自动化完全无效）。
# 用法：scripts/qa-phase3/01-launch.sh
set -euo pipefail
QA_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$QA_DIR/../.." && pwd)"
export DIONYSUS_QA_DIR="$QA_DIR"

rm -rf /tmp/dionysus-phase3-userdata /tmp/dionysus-phase3-ws
mkdir -p /tmp/dionysus-phase3-ws "$QA_DIR/out" "$QA_DIR/signals"
rm -f "$QA_DIR/out/driver.log" "$QA_DIR"/signals/*.cmd 2>/dev/null || true

# 经 code CLI 启动：继承本 shell 的 PATH（kimi 在 ~/.kimi-code/bin 才能被探测到）
# --extensions-dir 指向空目录：隔离用户已装插件（含旧 dionysus vsix，避免视图贡献冲突）
rm -rf /tmp/dionysus-phase3-exts && mkdir -p /tmp/dionysus-phase3-exts
code --new-window \
  --user-data-dir /tmp/dionysus-phase3-userdata \
  --extensions-dir /tmp/dionysus-phase3-exts \
  --disable-workspace-trust \
  --extensionDevelopmentPath "$REPO/packages/extension" \
  --extensionDevelopmentPath "$QA_DIR/driver-ext" \
  /tmp/dionysus-phase3-ws

# 等 driver 激活并完成起始动作（openChat ×1 + sessionList.focus + openChat，约 10s）
for i in $(seq 1 40); do
  [ -f "$QA_DIR/out/driver.log" ] && grep -q 'exec-done: dionysus.sessionList.focus' "$QA_DIR/out/driver.log" && break
  sleep 1
done
sleep 3
# 激活并最大化窗口
osascript -e '
tell application "System Events"
  tell process "Code"
    set frontmost to true
    delay 1
    set position of window 1 to {0, 25}
    set size of window 1 to {1470, 931}
  end tell
end tell' || true
sleep 2
"$QA_DIR/bin/shot.sh" 02-layout
echo "LAUNCH OK — 查看 out/02-layout.png 确定聊天输入框与 sidebar 坐标"
