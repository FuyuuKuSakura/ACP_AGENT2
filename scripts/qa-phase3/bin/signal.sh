#!/bin/bash
# 写信号文件让 driver 扩展执行命令：signal.sh <command-id>
set -euo pipefail
QA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$QA_DIR/signals"
printf '%s' "$1" > "$QA_DIR/signals/$(date +%s%N).cmd"
echo "signaled: $1"
