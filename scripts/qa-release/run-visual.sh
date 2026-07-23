#!/bin/bash
# Phase 6 发布前自测 · 视觉抽查：dev host 启动真实 VS Code，screencapture 四张。
# 复用 scripts/qa-phase3/driver-ext（信号文件驱动命令）与 bin/（qaclick/type）。
# 前提：机器未锁屏。用法：scripts/qa-release/run-visual.sh
set -euo pipefail
QA_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$QA_DIR/../.." && pwd)"
P3="$REPO/scripts/qa-phase3"
export DIONYSUS_QA_DIR="$QA_DIR"
USERDATA=/tmp/dionysus-release-userdata
EXTS=/tmp/dionysus-release-exts
WS=/tmp/dionysus-release-ws

rm -rf "$USERDATA" "$EXTS" "$WS"
mkdir -p "$WS" "$EXTS" "$QA_DIR/out" "$QA_DIR/signals" "$USERDATA/User"
rm -f "$QA_DIR/out/driver.log" "$QA_DIR"/signals/*.cmd 2>/dev/null || true

# 预置配置：开启局域网服务，避免配对命令弹确认框打断自动截图
cat > "$USERDATA/User/settings.json" <<'EOF'
{
  "dionysus.lan.enabled": true,
  "window.titleBarStyle": "native"
}
EOF

code --new-window \
  --user-data-dir "$USERDATA" \
  --extensions-dir "$EXTS" \
  --disable-workspace-trust \
  --extensionDevelopmentPath "$REPO/packages/extension" \
  --extensionDevelopmentPath "$P3/driver-ext" \
  "$WS"

# 等 driver 激活并完成起始动作（openChat ×1 + sessionList.focus + openChat）
for i in $(seq 1 60); do
  [ -f "$QA_DIR/out/driver.log" ] && grep -q 'exec-done: dionysus.sessionList.focus' "$QA_DIR/out/driver.log" && break
  sleep 1
done

# 激活并最大化新实例窗口（按窗口标题匹配工作区名，避免动到用户已有窗口）
osascript -e '
tell application "System Events"
  repeat with p in (every process whose name is "Code")
    repeat with w in (every window of p)
      if name of w contains "dionysus-release-ws" then
        set frontmost of p to true
        delay 1
        set position of w to {0, 25}
        set size of w to {1470, 931}
      end if
    end repeat
  end repeat
end tell' || true

sleep 12  # 等聊天 webview + Live2D/立绘加载
screencapture -x "$QA_DIR/out/a-chat-panel.png"
echo "shot a done"

# b) 跑一个会话：新建 → 键入短 prompt 发送（kimi 真实回合）
printf '%s' 'dionysus.newSession' > "$QA_DIR/signals/001.cmd"
for i in $(seq 1 20); do
  grep -q 'exec-done: dionysus.newSession' "$QA_DIR/out/driver.log" && break
  sleep 1
done
sleep 4
printf '只回复两个字：收到。不要调用任何工具。' > "$QA_DIR/prompts/release-b.txt"
# 输入框坐标：聊天面板底部中央（1470x931 窗口，右侧为聊天面板）
"$P3/bin/type.sh" 1000 860 "$QA_DIR/prompts/release-b.txt" enter || true
sleep 6
printf '%s' 'dionysus.sessionList.focus' > "$QA_DIR/signals/002.cmd"
for i in $(seq 1 20); do
  grep -q 'exec-done: dionysus.sessionList.focus' "$QA_DIR/out/driver.log" && break
  sleep 1
done
sleep 3
screencapture -x "$QA_DIR/out/b-sidebar-sessionlist.png"
echo "shot b done"

# c) 设置页（角色与素材库）
printf '%s' 'dionysus.openSettings' > "$QA_DIR/signals/003.cmd"
for i in $(seq 1 20); do
  grep -q 'exec-done: dionysus.openSettings' "$QA_DIR/out/driver.log" && break
  sleep 1
done
sleep 6
screencapture -x "$QA_DIR/out/c-settings.png"
echo "shot c done"

# d) 配对二维码弹层
printf '%s' 'dionysus.showPairingQr' > "$QA_DIR/signals/004.cmd"
for i in $(seq 1 20); do
  grep -q -e 'exec-done: dionysus.showPairingQr' -e 'exec-fail: dionysus.showPairingQr' "$QA_DIR/out/driver.log" && break
  sleep 1
done
sleep 6
screencapture -x "$QA_DIR/out/d-pairing-qr.png"
echo "shot d done"

echo "VISUAL DONE — 截图在 $QA_DIR/out/"
