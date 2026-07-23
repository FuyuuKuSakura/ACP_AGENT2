# 移动端视觉验收报告（A-2 流程）—— Phase 5 第二波 A-2

> 日期：2026-07-22 · 执行：QA agent（截图+自查）+ 产品专家 subagent（对比审查）
> 基准：`docs/v3/ux-core-flows.md` §2.2/§2.3/§3/§6、`docs/v3/design-principles.md`
> 约束遵守：未改 `packages/` 任何源码；全部脚本与产物在 `scripts/qa-mobile-visual/`；未执行 git 命令。

## 1. 环境与方法

- **mock server**：`mock-server.mjs`（Node http + `ws`），静态托管 `packages/mobile/dist`（构建产物与 src 同步，已校验无更新源文件），端点与 extension lan-server 对齐：
  - `POST /api/pair`：`{pair_token:"QA-PAIR-2026"}` → `{device_token}`，其余 401；
  - `GET /api/health?token=`：错 token 401；
  - `GET /assets/*`：先精确命中 mobile dist 静态文件（公开，与 `lan-server.ts:261-271` 同逻辑），未命中进素材路由强制 `?token=` 鉴权，素材为本目录 SVG（凯尔希头像 + idle/working/happy 三态立绘）；
  - `WS /ws?token=`：upgrade 前校验 token，错 → 401 拒绝升级。
- **截图**：`shoot.mjs`（Playwright chromium，iPhone 13 device profile = 390×844@3x），输出 `out/*.png`。
- 运行方式：`node scripts/qa-mobile-visual/mock-server.mjs`（后台）+ `node scripts/qa-mobile-visual/shoot.mjs`。

## 2. mock 数据清单

| 数据 | 内容 |
|---|---|
| handshake | 3 会话快照：sess-auth（running，latestSeq 2）/ sess-mobile（waiting_option，latestSeq 5）/ sess-docs（done，latestSeq 3） |
| digest ×3 | sess-auth「auth 模块重构」running + todoProgress 3/7 + 「正在改 auth/middleware.ts」（2 分钟前，未读 2）；sess-mobile「移动端适配联调」waiting_option + pendingOptionRequest（6 分钟前，❗）；sess-docs「文档站部署脚本」done（42 分钟前，未读 3） |
| todo_update | sess-auth 7 项任务清单（3 已完成：token.ts 重写等，4 待办） |
| tool_call/result | sess-auth 4 项（read token.ts ✓ / edit session.ts ✓ / pnpm test ✓ / edit middleware.ts 进行中）；sess-mobile 3 项（read .env.example ✓ / search API_BASE ✓ / npm build ✗ 失败） |
| option_request | sess-mobile「.env 旧配置如何处理？」三选项（保留并合并/覆盖为新配置/跳过此步骤），未决 |
| 消息流样例 | 各会话 history_response：用户/agent/system 消息 + companion/todo event 行（中文、代码相关） |
| companion_message | 会话级 ×2（带来源标注）、global 聚合句 ×1、**归来摘要**（「你离开期间…」前缀 global）×1 |
| 其他 | status_update（executing 45%）、agent_stream 流式 chunk、emotion_update（working→happy）、persona_list_response（凯尔希带头像+立绘 / 阿米娅无头像→首字母色块兜底） |

## 3. 截图清单与逐张自查结论

| 截图 | 取景 | 自查结论 |
|---|---|---|
| `a-list-light.png` | 会话列表首屏（浅色） | ✅ 排序 waiting→running→done 正确；摘要 `3/7 · 正在改…`、`等待确认：…` 口径正确；❗与未读角标互斥正确；阿米娅首字母色块兜底正常。偏差：无 adapter 标识、状态点蓝色且在右下、聚合条两段 |
| `b-chat-option-chips.png` | 对话页（sess-mobile） | ✅ option 确认条顶部常驻高对比（橙底+内联三选项按钮）；chip 计数条「本回合已执行 3 项操作」折叠态；气泡 user 右/agent 左/system 居中胶囊；短指令栏+离开模式开关在底。偏差：头部 📋🔔 emoji 按钮、短指令栏缺「确认选项」第三键 |
| `c-character-drawer.png` | 角色唤起抽屉 | ✅ 非全屏（顶部 15% 露出对话页头+确认条）、把手、遮罩仅覆露出区、立绘（happy 差分）+台词气泡+汇报流（带来源跳转链接、global 置灰）。偏差：「情绪：happy」裸英文 |
| `d-status-fullscreen.png` | 工作状态全屏页（sess-auth） | ✅ todo 进度条 3/7 + 全量清单（完成态划线置灰）；操作时间线 4 项含进行中态；汇报流含会话级+global+归来摘要。偏差：标题栏裸 `running`、时间线直渲工具原名 `read_file/Bash` |
| `e-list-dark.png` | 深色模式首屏 | ✅ 柔和黑 `#17171a` 非纯黑，全部 token 换肤，对比度可读 |
| `f-pair.png` | 配对页 | ✅ Wi-Fi 同网提示、扫码指引、手动输码兜底、防火墙/AP 隔离排障、「保持电脑唤醒」提示齐全 |
| `g-return-summary.png` | 归来摘要卡 | ✅ 首屏顶部 attention 描边卡、「你离开期间…」全文、可关闭。偏差：卡内条目不可点跳转 |

7 张均经 ReadMediaFile 逐张查看，渲染无破版、无白屏、无资源 404。

## 4. 差异清单（产品专家审查，按严重度排序）

### 高

- **H1【实现偏差】列表项缺 adapter 标识**：§2.2 八字段之三「头像右下小圆标」未实现；且是链路级缺失——`sessionDigestUpdatePayloadSchema`（`packages/protocol/src/messages.ts:330`）无 `adapterId` 字段，digest 链路根本拿不到。「同角色不同 agent」不可区分，核心卖点受损。修复：digest payload 增 `adapterId`（或从 session 元数据补），列表项渲染小圆标。
- **H2【文档未覆盖/文档冲突】移动端无 Icon 体系，emoji/文字符号充当全部图标**：聚合条 ⏳❗、设置 ⚙、全角＋、头部 📋🔔、确认条 ❗、chip ⚙▾📖✏️⚡🔍🔧✕、工作状态页 ☑☐✓✕、摘要卡 🔔。design-principles §0.2「禁止 emoji」与 ux §2.2/§2.3/§3.2 表格内自写 emoji 直接冲突（chip 五 kind 图标与 §3.2 逐字一致），且 design-principles 审查范围声明为 webview 层，未明确移动端约束。需文档裁决；无论裁决如何，彩色 emoji 跨平台渲染漂移（Android/iOS 不同）是实际风险，建议移动端补 Icon 组件（可复用 webview `Icon.tsx` 路径数据），优先替换主按钮 📋🔔⚙；`📋` 为文档无任何规定的实现自创，应登记或替换。

### 中

- **M1【实现偏差】工作状态页头部裸英文 `running`**（`StatusScreen.tsx:63`）：违反 §5「不出现黑话」；已有 `STATUS_DOT` 中文 label 可复用。
- **M2【实现偏差】工作状态页时间线直渲工具原名**（`StatusScreen.tsx:124`）：违反 §3.1「不直接渲染工具原名」；同包 `ToolCallChips` 已有 KIND_VERB 动词映射（读/改/跑/搜/用）却未复用，两端口径不一致。
- **M3【实现偏差】抽屉「情绪：happy」裸英文枚举**（`CharacterDrawer.tsx:100`）：缺省值中文、有值英文，更突兀；建议枚举→中文映射或情绪徽记。
- **M4【实现偏差+文档冲突】running 状态点蓝色 `#3b82f6` 而非金色**（`index.css:110`，注释自称「与 sidebar 同源」但桌面为金色呼吸）；状态点位于头像右下 10px，§2.2 规定头像左侧 8px。另：ux §2.2 五态（idle/thinking/executing/…）与 protocol 枚举（idle/running/…/done）命名不对齐，`done` 绿点在 §2.2 无定义——状态机命名需文档侧对齐。
- **M5【实现偏差】短指令栏缺「确认选项」第三键**：§6.2「三键『继续/打断/确认选项』；waiting_option 时顶部**再**常驻确认条」。实现仅两键（`CommandBar.tsx`）；功能上被确认条覆盖，门禁前补齐或改文档。

### 低

- **L1【实现偏差】聚合条缺「✅N 已完成」段**：§2.3 三段口径，`selectStatusBarAggregate` 只产两段。
- **L2【实现偏差】相对时间在标题行右端而非摘要行右端**（§2.2「摘要行右端」）：仿 QQ 常见布局，建议改文档。
- **L3【实现偏差】归来摘要卡条目不可点跳转**（§6.3「点条目跳转」）：需模板侧把多会话拆成条目化结构配合。
- **L4【文档未覆盖】配对页「AP 隔离」术语**：文档原文引入，建议白话化（「路由器隔离了设备互访」），文档侧裁决。
- **L5（非缺陷，门禁待验）**：重连横幅、重连后自动定位确认条、抽屉透出区实时滚动、左右滑/上滑手势——静态截图不可证，需实机/录屏验证。

## 5. 修复建议汇总

**实现偏差（移动端代码侧，预估半天量级）**：
1. digest 链路补 adapterId + 列表项小圆标（H1，涉 protocol/client-core/mobile 三处）；
2. `running`/`happy` 裸英文枚举改中文映射（M1/M3，复用 STATUS_DOT.label、加情绪映射表）；
3. 时间线复用 KIND_VERB 动词映射（M2）；
4. running 状态点改金色系 token（M4 颜色部分）；
5. 聚合条补 done 段、短指令栏补第三键或走文档删除（L1/M5）。

**文档未覆盖/冲突（文档侧裁决）**：
1. emoji vs Icon 体系：ux 表格与 design-principles 冲突，且移动端是否受 Icon 约束未明文（H2）；
2. 状态机命名：ux 五态 vs protocol 枚举不对齐、done 绿点无定义（M4 附带）；
3. 状态点位置/相对时间位置与 §2.2 文字不符但更合移动端习惯，建议改文档（M4 位置部分/L2）；
4. 「AP 隔离」白话化（L4）。

## 6. 总体结论

骨架正确：三屏+抽屉+工作状态页 IA、P0 九项中八项有截图证据、排序/互斥/三态主题/chip 折叠/归来摘要/配对页全部按文档落地，仿 QQ 观感成立。**建议暂缓进入门禁验收**：先修 H1 + M1–M3（小改），H2 走文档裁决；门禁阶段以实机补验 L5 动态项。
