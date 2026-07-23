# Phase 2-2 Review 后续跟进说明

**日期：** 2026-06-24  
**范围：** 针对 Phase 2-2 变更的多 Agent 复审结果与已修复项。

## 已修复的阻塞/严重问题

1. **`SessionStore` 数据库路径现在尊重 `Dionysus_DATA_DIR`**
   - 使用 `resolve_data_path(self._config.sessions.storage_path)` 解析，避免默认 `./data/sessions.db` 落到进程 CWD。
2. **adapter `working_dir` 支持 `~` 展开**
   - `generic_cli._resolve_working_dir` 在解析前调用 `.expanduser()`。
3. **毫秒时间戳阈值从 `1e10` 提升到 `1e12`**
   - 防止把未来秒级时间戳误识别为毫秒。
4. **`/cd` 命令校验路径是否为目录**
   - `_cmd_change_working_dir` 现在检查 `path.is_dir()`，并返回更准确的错误提示。
5. **壁纸目录复用 `get_data_dir()`**
   - 删除 `main.py` 中重复的 `_data_root` 逻辑。
6. **静态文件目录统一走 `resolve_config_path`**
   - 使 `server.static_dir` 的相对路径语义与 `working_dir` 一致（以 `Dionysus_CONFIG_DIR` 为基准）。

## 仍然存在的非阻塞债务（留给后续阶段）

- `/api/open-cc-switch` 仍硬编码 macOS 应用路径，需改为可配置外部命令或移除。
- Electron 打包未设置 `Dionysus_CONFIG_DIR` / `Dionysus_DATA_DIR`，实际打包后可能写到只读 app bundle；需在 `electron/main.cjs` 或 `launcher.py` 中注入。
- `config.py` 的 env vs YAML 优先级注释与实际行为相反（YAML kwargs 优先级高于 env），待统一配置加载策略。
- 部分模块仍从 `dionysus_server.config` 导入 `get_config_dir`，可改为从 `dionysus_server.paths` 导入以强化中心化。
- `test_session_isolation.py` 是依赖真实后端的集成测试，建议迁移到 `scripts/` 或加 `@pytest.mark.integration`。
- 前端 store 测试尚未在每个用例前重置全局 store，扩展 coverage 时需补充 `beforeEach(resetStores)`。

## 测试状态

- 后端：`ruff check` 全过，`pytest tests` 28 passed。
- 前端：`npm run test` 5 passed，`npm run build` 成功。
