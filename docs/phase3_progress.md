# Phase 3 进展记录

**日期：** 2026-06-24  
**范围：** Tech-Flat 设计系统、移动端抽屉、配对基础设施。

## 已完成

1. **移动端角色抽屉重写**
   - `frontend/src/components/Layout/MobileCompanionDrawer.tsx` 改为底部向上滑出，占屏幕 `80vh`。
   - 增加拖拽手柄（`GripHorizontal` + `ChevronDown`）和拖拽关闭手势。
   - 气泡区（`CharacterDialogBox`）固定在角色上方。
   - 底部增加工具栏区域（`ToolPanel`）。

2. **发送消息后自动展开角色陪伴**
   - `frontend/src/components/Input/ChatInput.tsx` 在发送用户消息时调用 `useLayoutStore.getState().setCompanionDrawerOpen(true)`。

3. **Tech-Flat 工业蓝主题**
   - 新增 `backend/config/themes/tech_flat.yaml`，采用深蓝灰底 + 工业蓝主色。
   - 保留现有默认暗色/浅色主题不变。

4. **PWA 图标补齐**
   - 从 `frontend/public/icon.png` 生成 `icon-192.png` 与 `icon-512.png`。
   - 更新 `manifest.json` 的 `theme_color` / `background_color` 为默认暗色背景。

5. **后端安全配对基础设施**
   - 新增 `backend/dionysus_server/pairing.py`：
     - 一次性 `pair_token`（5 分钟 TTL，内存存储）。
     - 长期 `device_token`，持久化到 `Dionysus_DATA_DIR/pairing/devices.json`。
     - 支持列出/撤销设备。
   - 新增接口：
     - `POST /api/pair/token` 创建 pair_token。
     - `GET /api/pair/qr` 返回含 pair_token + host 的二维码 PNG。
     - `POST /api/pair` 用 pair_token 换取 device_token。
     - `GET /api/pair/devices` 列出已配对设备。
     - `POST /api/pair/revoke` 撤销 device_token。

## 尚未完成 / 留给后续迭代

- **设计 Token 体系扩展**：尚未新增 `surface-0~3`、`radius`、`shadow` 等语义 Token，也未抽取统一的 `Button/Card/Input/BottomSheet` 组件。
- **Live2D 降级模式**：`live2dStore` 还没有 `renderMode: live2d | image | video`，`Live2DViewer` 仍只有 WebGL/视频 fallback。
- **移动端 onboarding UI**：没有扫码页面、Wi-Fi 检查、连接成功引导；前端没有使用新的 `/api/pair/qr`。
- **主机 base-URL / device_token 存储**：尚未创建 `connectionStore`。
- **首次启动 workspace picker**：尚未实现 Electron/PWA 选择目录流程。
- **平板/小桌面布局**：`RightPanel` 在 `xl` 以下仍直接隐藏。
- **可访问性打磨**：触控目标、焦点环、`prefers-reduced-motion` 未系统处理。

## 验证状态

- 后端：`ruff check` 全过，`pytest tests` 28 passed。
- 前端：`npm run test` 5 passed，`npm run build` 成功。
