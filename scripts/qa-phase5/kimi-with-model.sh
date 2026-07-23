#!/bin/bash
# Phase 5 QA 专用：kimi CLI 包装器。
# 背景：本机 kimi 0.28.0/0.28.1 print 模式在默认模型 moonshot-cn/kimi-k2.6 下
# 挂起（无任何输出、无 TCP 连接；用户 cron 的 kimi -p 同样挂起，环境问题），
# 显式指定 kimi-code/kimi-for-coding 模型则正常。dionysus 的 KimiStrategy
# 不支持 -m 透传（supportsModel=false），故用本包装器注入模型参数。
# 仅被 QA 的 dionysus.adapters 配置引用，不影响产品代码与用户环境。
exec "$HOME/.kimi-code/bin/kimi" -m 'kimi-code/kimi-for-coding' "$@"
