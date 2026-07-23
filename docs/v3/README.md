# Dionysus v3 文档索引

本目录是 Dionysus v3（VS Code 插件化重写）的全部前置文档。阅读顺序建议：架构 → UX 核心流程 → 提取文档（按需深入）→ 开发计划。

## 架构与计划

- [architecture.md](architecture.md) — v3 总体架构：monorepo 布局、五个包的模块设计（接口签名级）、数据流、ADR、安全模型、测试策略、风险登记册。
- [roadmap.md](roadmap.md) — 开发计划：6 个 Phase 的任务分解与验收门禁、pytest→vitest 翻译清单、范围外清单。
- [ux-core-flows.md](ux-core-flows.md) — UX 核心流程与信息架构：核心功能定义、QQ 式会话列表规格、agent 操作显示规范、角色汇报通道、新手引导、移动端 IA 与 P0/P1 分级。

## 审阅报告（review/）

v3 设计文档的六视角审阅，共 54 条发现；修订以各报告「修改建议」为依据。

| 文档 | 视角 |
|---|---|
| [review/review-novice.md](review/review-novice.md) | 新手用户：首次使用路径、Live2D 开箱可见性、移动端触达闭环 |
| [review/review-pm-core.md](review/review-pm-core.md) | 产品经理（核心功能闭环）：多会话一等公民地位、调度汇报载体、全局信息架构 |
| [review/review-pm-mobile.md](review/review-pm-mobile.md) | 产品经理（移动端场景）：断线补拉、会话枚举通道、无人值守交互、MVP 分级 |
| [review/review-eng-core.md](review/review-eng-core.md) | 工程师（core 与协议）：语气注入实现路径、tool_call schema、多会话并发语义 |
| [review/review-eng-client.md](review/review-eng-client.md) | 工程师（客户端与安全）：重连状态追赶、多端一致性、资产/HTTP 面 |
| [review/review-persona.md](review/review-persona.md) | 陪伴专项：语气注入链路、多 agent 汇报仲裁、persona YAML schema 修订 |

## 提取文档（extract/）

旧实现（v2：Python FastAPI + React + Electron）的行为规格，重实现的可信基线。每份附旧代码出处（文件:行号）与真实样例。

| 文档 | 内容 |
|---|---|
| [extract/protocol.md](extract/protocol.md) | 前后端通信协议：消息信封、全部消息类型逐字段定义、生命周期时序 |
| [extract/adapters.md](extract/adapters.md) | 5 个 CLI 适配器行为规格：参数构建、stream-json 行→事件映射、resume 语义（最难重新获得的知识） |
| [extract/session.md](extract/session.md) | 会话管理与状态机：数据模型、回合编排管线、斜杠命令、广播机制 |
| [extract/persona.md](extract/persona.md) | 角色陪伴引擎：persona YAML schema、情绪映射、台词调度、Supervisor、TodoTracker |
| [extract/config-and-assets.md](extract/config-and-assets.md) | server.yaml/主题/persona 配置 schema、Live2D 资产清单、环境变量语义 |
| [extract/design-style.md](extract/design-style.md) | 设计规范与风格样式：设计 token、主题运行时机制、组件视觉规范、布局 |
| [extract/pairing-mobile.md](extract/pairing-mobile.md) | 二维码配对流程、/api/pair 端点、移动端功能基线 |
| [extract/webview-inventory.md](extract/webview-inventory.md) | 前端组件盘点与迁移分类（可迁移/需改造/丢弃/移动端参考）、API 端点清单 |

## 状态

- 旧代码（`backend/`、`frontend/`、`electron/` 等）已于 2026-07 移入 `legacy/` 原样保留，仅作提取文档的参考来源（见文末「legacy 路径映射」）。
- `../dionysus_fullstack.agent.final.md` 为 v2.0 设计稿（2025-07-12），已被 v3 架构取代，仅具历史/概念参考价值。

## legacy 路径映射

2026-07 迁移后，extract/ 文档中引用的 v2 路径对应 `legacy/` 下的同路径（extract/ 文档正文未逐处改写，阅读时按本节映射）：

- `backend/...` → `legacy/backend/...`（含 `backend/config/server.yaml`、`backend/config/themes`，后者按 ADR-20 不迁移进 v3）
- `frontend/...` → `legacy/frontend/...`
- `electron/...` → `legacy/electron/...`
- `scripts/...` → `legacy/scripts/...`
- `docs/` 旧文档（handbook、user_guide、review 报告等）→ `legacy/docs/...`
- 设计稿图片（`设计稿-主界面区.png`、`设计草稿1.png`、`测试壁纸.JPG`）→ `legacy/docs/design/`
- `kal'tsit_live2d/` → `assets/live2d/kal'tsit/`；`exusiai_live2d/` → `assets/live2d/exusiai/`
- `backend/config/personas/` → `assets/personas/`（runtime YAML 已与 builtin 版按键合并补全）
