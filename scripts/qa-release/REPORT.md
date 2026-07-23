# Phase 6 发布前自测报告（agent 自测，roadmap Phase 6 第 4 项）

- 日期：2026-07-22（JST）
- 执行：发布自测 agent（只读验证 + 本目录脚本，未改 packages/ 源码，未执行 git 命令）
- 对象：Dionysus v3 monorepo @ 0.1.0，`release/dionysus-vscode-0.1.0.vsix`

## 结论总览

| 自测项 | 结果 |
|---|---|
| 1. 全量重建 + vsix 打包 + 真实安装 | ✅ 通过 |
| 2. 自动化回归（typecheck / lint / test / e2e） | ✅ 全绿（612 单测 + 5 e2e） |
| 3. 视觉抽查（dev host 真实 VS Code 四景） | ✅ 无阻断级视觉缺陷；发现 2 个非阻断观察项 |

## 1. 全量重建与安装验证

- 根 `npm run build`：6 个包全部构建成功（protocol/core/client-core tsc；extension esbuild 973.5 KB；webview Vite 1.03 MB JS；mobile Vite 260 KB JS）。webview 包有 chunk >500 kB 的 Vite 提示（仅警告）。
- `npm run package:vsix`（packages/extension）：`vscode:prepublish`（build + prepackage.mjs 拷贝 webview-dist / mobile-dist / assets）→ `vsce package` 成功，产出 `release/dionysus-vscode-0.1.0.vsix`（154 文件，33.07 MB，覆盖旧 Phase 4 前的包）。
- 真实安装：`code --install-extension release/dionysus-vscode-0.1.0.vsix --force` → "was successfully installed"；`code --list-extensions --show-versions` → `dionysus.dionysus-vscode@0.1.0`；`~/.vscode/extensions/dionysus.dionysus-vscode-0.1.0/` 时间戳与本次打包一致（15:42），确认是新包。
- 注意：安装的是用户主 VS Code 实例，扩展激活需窗口重载，未打扰用户当前窗口，激活态未逐窗验证（e2e 已覆盖激活路径，见下）。

## 2. 自动化回归

全部在仓库根执行，原始输出已逐条核对：

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 6/6 包通过，0 error |
| `npm run lint` | ✅ 6/6 包通过，0 error / 0 warning |
| `npm test`（vitest） | ✅ 72 文件 / **612 用例全绿**（client-core 65、core 225、extension 92、mobile 63、protocol 63、webview 104） |
| extension `npm run test:e2e`（@vscode/test-electron） | ✅ **5/5 通过 / 0 失败**，VS Code stable 1.129.1 重新下载（272.98 MB，缓存此前已清）后运行 19.1s |

e2e 用例：a) 激活 + 七命令注册；b) openChat 创建聊天 webview；c) sidebar 视图注册；d) redetectAgents 可执行；e) FakeAdapter 注入下 user_input → agent_stream → agent_complete 通路。

## 3. 视觉抽查（dev host 真实 VS Code 1.129.1）

方法：`code --extensionDevelopmentPath` 启动隔离实例（独立 `--user-data-dir`/`--extensions-dir` 于 /tmp，不影响用户环境），复用 `scripts/qa-phase3/driver-ext` 信号文件驱动命令，`screencapture` 截图。编排脚本：`scripts/qa-release/run-visual.sh`（首轮）；因用户当时正在使用机器（Edge 前台），后续改为「driver 信号切 tab + `screencapture -l<windowid>` 免聚焦截窗」（`list-windows.swift` 列窗口 id），仅两次受控前置（前置前校验 frontmost==Code，完成后归还焦点）。

| 截图 | 内容 | 核查结果 |
|---|---|---|
| `out/a-chat-panel.png` | 聊天面板整体 | ✅ 会话区/输入框/toast 正常；陪伴区 **Live2D 凯尔希正确渲染且锚底**（聊天面板右下）；无 emoji、无破版 |
| `out/b-sidebar-sessionlist.png` | sidebar 会话列表（已跑会话） | ✅ 列表项五要素齐全：红色 error 状态点、头像（首字母色块「新」）、**adapter 徽标「K」（kimi_cli，头像右下）**、标题+摘要「出错了」+相对时间、未读角标 11；顶部聚合「0 运行中·0 待决策·0 已完成」；无 emoji |
| `out/c-settings.png` | 设置页（角色与素材库） | ✅ 角色列表（能天使/凯尔希，含头像）、voice 客制化表单（语气描述/口头禅/绝不会说的话/改写样例/高级提示词/试听/保存）完整；无破版、无 emoji |
| `out/d-pairing-qr.png` | 配对二维码弹层 | ✅ QR 码、`http://<IP>:8765/#pair=<token>` URL、**TTL 倒计时（多次截图 241→186→139 秒，自动刷新生效）**、手动刷新按钮、「同一个 Wi-Fi」文案、排障指引入口；无 emoji |

佐证截图：`out/debug-chat-state.png`（两轮真实 kimi 回合的完整聊天状态）、`out/a-chat-panel-occluded-artifact{,-2}.png`（见问题 2）。

### 陪伴层顺带验证（超出最低抽查范围，一并记录）

两轮真实回合触发了完整的陪伴链路：Supervisor/CompanionEngine 汇报经 **rewriter 改写为凯尔希口吻**（如「博士，请说明当前任务。仍有 1 个会话在工作中。」「1 个会话全部出现错误，请查看。如有后续，请随时告知。」），toast 标注「来自：新会话」，汇报不进会话消息流；error 状态驱动 Live2D 姿态切换。与 Phase 4 门禁语义一致。

## 发现的问题

### 问题 1（非阻断，环境侧）：kimi CLI 0.28.1 print 模式当前挂起无输出

- 现象：dev host 中两轮真实 kimi 回合均以「request timeout」结束（GenericCliAdapter 120s 单行读取超时，`packages/core/src/adapters/generic-cli.ts:194`），会话正确进入 error 态。
- 定位：**非 Dionysus 缺陷**。在 VS Code 之外直接执行 `~/.kimi-code/bin/kimi -p "hi"` 与 `kimi -p "..." --output-format stream-json`（cwd=/tmp/dionysus-release-ws）同样 75 秒零输出；`kimi --version` 正常（0.28.1）。属 CLI 自身/账号/网络当前状态问题。
- 正面结论：错误路径端到端正确——超时→error 事件→聊天内「request timeout」→sidebar error 态+未读→陪伴层 error 优先插播。
- 建议：发布前用真实 CLI 再做一轮人工验收时先确认本机 kimi print 模式恢复；如长期挂起需排查 CLI 登录态。

### 问题 2（非阻断，测试方法学）：窗口被遮挡时 `screencapture -l` 截到的 WebGL 画布是残帧

- 现象：dev host 窗口处于后台（用户操作其他应用）时，免聚焦截窗得到的陪伴区是横向色带（见 `out/a-chat-panel-occluded-artifact*.png`），看似破版；窗口前置后同一区域渲染完全正常（`out/a-chat-panel.png`）。
- 定位：macOS 遮挡 → Chromium 节流 rAF/canvas 合成，窗口 backing store 残留非最新帧。**非产品缺陷**（Phase 4 基线截图 `workspace/qa-phase4-chat-companion-kaltsit.png` 与前置实拍一致）。
- 建议：后续 QA 截 Live2D/WebGL 内容必须以前置全屏截图为准，遮挡截窗仅用于 DOM 类内容。

### 观察项（不构成立即修复建议）

- sidebar 新会话头像显示首字母色块「新」而非凯尔希头像（设置页角色头像正常）。列表项逻辑为 avatarUrl 缺省回退色块（`SessionListItem.tsx`），会话创建后 persona 头像 URL 可能未随 digest 下发；不影响功能，建议后续版本核实。
- 首轮自动化的点击/粘贴发生时用户 Edge 窗口在前台（焦点被用户切走），粘贴内容未落入其表单（字符计数前后核对无对应增量）；但本次自动化确实覆盖过一次剪贴板（已尽量备份恢复）。后续真机 QA 应先确认机器空闲。

## 需人工验收清单（截图级验证无法覆盖）

1. **动画手感**：Live2D 动作切换流畅度、台词气泡弹出/停留节奏、触摸互动反馈——截图只能证静态正确。
2. **真实手机局域网配对**：扫码 → 配对 → 双端并行 → 锁屏 5 分钟重连后的 sync 补拉与归来摘要（Phase 5 门禁主线，涉及真机与 Wi-Fi 环境）。
3. **真实 CLI 长任务稳定性**：本机 kimi print 模式当前挂起（问题 1），长回合/工具调用密集场景未能在本次自测跑通；恢复后建议跑一轮真实长任务（含打断、waiting_option 确认）。
4. 用户主 VS Code 实例重载后的首次体验抽查（walkthrough 出现、CLI 检测、出厂角色开箱可见）——vsix 已装好，待自然重载验证。

## 产物清单

- `release/dionysus-vscode-0.1.0.vsix`（新包，已装入真实 VS Code）
- `scripts/qa-release/run-visual.sh`（首轮编排脚本）、`scripts/qa-release/list-windows.swift`（免聚焦截窗辅助）
- `scripts/qa-release/out/`：a/b/c/d 四张核查截图 + 佐证截图 + `driver.log`
- 本报告 `scripts/qa-release/REPORT.md`
