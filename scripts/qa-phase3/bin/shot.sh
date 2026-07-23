#!/bin/bash
# 截全屏到 out/<name>.png
set -euo pipefail
QA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$QA_DIR/out"
screencapture -x "$QA_DIR/out/$1.png"
echo "$QA_DIR/out/$1.png"
