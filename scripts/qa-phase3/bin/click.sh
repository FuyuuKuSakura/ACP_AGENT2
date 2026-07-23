#!/bin/bash
# 点击前台窗口中坐标 (x,y)（macOS 点坐标 = screencapture 像素 / 2）
set -euo pipefail
"$(cd "$(dirname "$0")" && pwd)/qaclick" "$1" "$2"
