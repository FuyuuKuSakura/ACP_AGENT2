# Dionysus 会话管理与状态机规格（知识提取）

> 目标读者：不了解旧代码、要用 TypeScript 重写 Dionysus 为 VS Code 插件的工程师。
> 本文档描述 v2 后端的会话数据模型、SQLite 持久化、回合编排管线、斜杠命令与 supervisor/广播机制。
> 主要信息源：`backend/dionysus_server/session/manager.py`（863 行，编排主源）、
> `backend/dionysus_server/session/store.py`（SQLite 持久化）、
> `backend/dionysus_server/session/models.py`（前端友好消息模型）、
> `backend/dionysus_server/models.py`（共享 Pydantic 模型）。

---

## 1. 数据模型

### 1.1 Session

定义在 `backend/dionysus_server/models.py:408-417`：

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `id` | string（UUID4） | 必填 | 会话 ID，由 store 生成（`store.py:125`） |
| `title` | string | `"新会话"` | 标题。**创建后从未被自动更新** |
| `persona_id` | string | `"exusiai"` | 陪伴角色 ID |
| `adapter_id` | string \| null | null | 绑定的 agent 适配器 ID；null 时用配置默认值 |
| `working_dir` | string \| null | null | 工作目录 |
| `status` | SessionStatus | `idle` | 会话状态，见 1.3 |
| `created_at` / `updated_at` | datetime | 当前 UTC | 线路上序列化为 Unix 毫秒（`models.py:38-42`），SQLite 里存 ISO 字符串（`store.py:25-27`） |
| `messages` | `Message[]` | `[]` | 消息历史（内存对象内嵌；DB 里在另一张表） |

### 1.2 Message

定义在 `models.py:391-397`：

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `id` | string（UUID4） | 自动生成 | 消息 ID |
| `role` | MessageRole | 必填 | `user` / `agent` / `system`（`models.py:385-388`） |
| `content` | string | 必填 | 全文（agent 消息为所有 chunk 拼接，`manager.py:351-354`） |
| `timestamp` | datetime | 当前 UTC | |
| `trace_id` | string（UUID4） | 自动生成 | |
| `metadata` | dict | `{}` | 自由元数据；agent 消息会写入 `{"complete_status": ...}`（`manager.py:354`） |

另有前端友好镜像 `ChatMessage`（`backend/dionysus_server/session/models.py:13-48`），字段相同但 `timestamp` 保留 `datetime` 类型（不走毫秒序列化基类），提供 `from_internal` / `to_internal` 双向转换。

### 1.3 状态枚举

`SessionStatus`（`models.py:400-405`）：

```python
class SessionStatus(str, Enum):
    IDLE = "idle"
    PROCESSING = "processing"
    WAITING_OPTION = "waiting_option"
    STREAMING = "streaming"
    INTERRUPTED = "interrupted"
```

实际状态迁移（全部由 `SessionManager` 驱动）：

- 收到 user_input / option_selected → `PROCESSING`（`manager.py:382`、`manager.py:476`）
- 回合正常结束 → `IDLE`；被打断结束 → `INTERRUPTED`（`manager.py:359-363`）
- handle_interrupt → `INTERRUPTED`（`manager.py:533`）
- 注意：`WAITING_OPTION` 和 `STREAMING` **后端从未赋值**，只有前端本地使用（`frontend/src/App.tsx:123`、`App.tsx:183`）。`STREAMING` 在后端是死枚举值。

## 2. SQLite 持久化（SessionStore）

`SessionStore`（`store.py:35-256`）基于 `aiosqlite`，DB 路径来自配置 `sessions.storage_path`（`store.py:45`）。时间戳在 DB 中以 ISO 8601 UTC 字符串存储（`store.py:25-32`），与线路格式（Unix 毫秒）不同——两套时间表示并存。

### 2.1 建表语句（原样引用，`store.py:59-85`）

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    adapter_id TEXT,
    working_dir TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, timestamp);
```

另有轻量迁移逻辑：旧库缺 `adapter_id` / `working_dir` 列时 `ALTER TABLE ADD COLUMN`（`store.py:87-94`）。外键通过每次连接的 `PRAGMA foreign_keys = ON` 开启（`store.py:52`），删会话级联删消息。

### 2.2 CRUD 一览

| 方法 | 行号 | 行为 |
|---|---|---|
| `create_session(persona_id)` | `store.py:121-156` | 生成 UUID、title 固定"新会话"、status=idle |
| `get_session(session_id)` | `store.py:158-170` | 读 session 行 + 全量消息 |
| `list_sessions(limit=100)` | `store.py:172-184` | 按 `updated_at DESC` 取前 100；**每行再单独 load_messages（N+1，见第 7 节）** |
| `update_session(session)` | `store.py:186-209` | 更新可变字段并刷新 `updated_at` |
| `delete_session(session_id)` | `store.py:211-217` | 删除会话（消息级联） |
| `append_message(session_id, message)` | `store.py:219-243` | 插消息 + 顺手 bump 会话 `updated_at` |
| `load_messages(session_id)` | `store.py:245-256` | 按 `timestamp ASC` 读全部消息 |

## 3. 回合编排管线

### 3.1 `handle_user_input`（`manager.py:366-458`）完整时序

1. 取会话（内存优先，miss 则读库并回填内存，`manager.py:220-227`）；不存在抛 `ValueError`（`manager.py:374-376`）。
2. 构造并**持久化 USER 消息**，追加到内存 `session.messages`（`manager.py:378-380`）。
3. 置 `status=PROCESSING` 并落库（`manager.py:382-383`）。
4. 通知全局 companion scheduler（`"working"`），有反应则 yield `companion_message`（`session_id="global"`）和可能的 `emotion_update`（`manager.py:385-386`，实现 `manager.py:300-324`）。
5. 首轮注入 persona system prompt（`manager.py:388`，详见第 4 节）。
6. 构造 `AgentInput(text, attachments=dict 化, mode)`（`manager.py:390-394`；附件归一化 `manager.py:113-123`）。
7. 逐事件消费 `adapter.send(agent_input)` 流（`manager.py:400-444`），每个事件：
   - 喂给 `CompanionEngine.on_event`，有反应则 yield `companion_message`（`session_id` 为本会话）+ 可选 `emotion_update`（`manager.py:403-426`）；
   - 喂给 `TodoTracker.on_event`，有产出则 yield `todo_update` 全量快照（`manager.py:428-433`）；
   - 经 `_agent_event_to_server_message` 转成协议消息 yield 给客户端（`manager.py:435-436`，转换函数 `manager.py:60-110`）；
   - `agent_stream` 的 chunk 累积进 `agent_content_parts`（`manager.py:438-441`）；收到 `agent_complete` 记录终态并 `break`（`manager.py:442-444`）。
8. 异常路径：捕获后合成 `agent_complete(status=error)` yield（`manager.py:445-451`），**不抛出**。
9. 回合后再通知 scheduler（传入终态 success/error/interrupted）并 yield 其反应（`manager.py:453-456`）。
10. `_finalize_agent_turn`（`manager.py:343-364`）：若有内容则拼接所有 chunk 为一条 AGENT 消息持久化（metadata 带 `complete_status`）；按终态把 status 置回 `IDLE` 或 `INTERRUPTED` 并落库。

### 3.2 `handle_option_selected`（`manager.py:460-504`）

与 3.1 几乎同构，差异仅：

- 持久化的 USER 消息文本是格式化的 `"选择：{selected_label}（{selected_id}）"`（`manager.py:471`）；
- 发给 adapter 的输入只有 `AgentInput(text=selected_label)`，**不带 attachments、mode 用默认、不注入 system prompt**（`manager.py:482`）；
- 没有 CompanionEngine / TodoTracker 的逐事件旁路，直接走 `_stream_agent_response`（`manager.py:326-341`）简化版循环（`manager.py:486-497`）。

**重复点**（`manager.py:460-504` vs `manager.py:366-458`）：取会话/持久化 USER 消息/置 PROCESSING/scheduler 前后两次反应/chunk 收集/终态 break/finalize 共 8 处逻辑逐行重复；且错误处理不一致——`handle_user_input` 捕获异常合成 error 消息（`manager.py:445-451`），而 `_stream_agent_response` 内部也捕获（`manager.py:336-341`），但 `handle_option_selected` 自身对 `get_or_create_adapter` 之外的异常没有兜底（如 `get_session` 之后步骤抛错会直接冒泡到 handler）。

### 3.3 `handle_interrupt`（`manager.py:506-537`）

1. 调 `adapter.interrupt()`（失败只记日志，`manager.py:517-521`）；
2. 若带 `insert_message`，持久化为 USER 消息（`manager.py:523-526`）；
3. 主动 yield `agent_complete(status=interrupted)`（`manager.py:528-531`）；
4. status 置 `INTERRUPTED` 落库（`manager.py:533-534`）；
5. 通知 scheduler（`"error"`）并 yield 反应（`manager.py:536-537`）。

注意：**已收集的半截流式内容不会持久化**（finalize 只在 handle_user_input 路径里）。

### 3.4 会话 CRUD 与适配器管理

- `create_session`：超过 `max_concurrent` 时**驱逐最老会话（连消息一起删库）**（`manager.py:207-218`）。
- `list_sessions`：store 结果与内存活跃会话合并，内存版优先，按 `updated_at` 倒序（`manager.py:229-234`）。
- `delete_session`：关 adapter → 删库 → 清内存 → 从 scheduler 移除（`manager.py:236-241`）。
- `get_or_create_adapter`：懒创建并 start，记录到 `_session_adapters` 和 `_session_adapter_ids`（`manager.py:243-262`）。
- `switch_adapter`：校验 adapter 存在 → 持久化 `session.adapter_id` → 关旧 adapter（`manager.py:848-863`）。
- `update_adapter_config`：热改配置并重启所有同 ID 的活跃 adapter（`manager.py:834-846`）。

## 4. 系统提示注入机制

`_inject_system_prompt_if_needed`（`manager.py:282-298`）：

```python
async def _inject_system_prompt_if_needed(self, session: Session) -> None:
    """Inject persona system prompt on the first user turn."""
    if session.messages:
        return
    try:
        persona = load_persona(session.persona_id)
        system_prompt = persona.get("system_prompt")
        if system_prompt:
            adapter = await self.get_or_create_adapter(session.id)
            await adapter.inject_system_prompt(
                system_prompt,
                context_vars={"session_id": session.id},
            )
    except Exception:
        self._logger.exception(
            "system_prompt_injection_failed", session_id=session.id
        )
```

要点：

- 触发条件：`session.messages` 为空即视为首轮。但调用点在 `handle_user_input` 持久化 USER 消息**之后**（`manager.py:388` vs `manager.py:378-380`）——等等，注意时序：USER 消息在 `manager.py:378-380` 已 append 到 `session.messages`，所以注入判断时 `session.messages` **已经非空**……实际上调用顺序是先 append 再判断（`manager.py:378` 在前，`manager.py:388` 在后），这意味着该注入**几乎永远不触发**，除非内存对象与 store 出现偏差。这是一个实际存在的逻辑 bug（见第 7 节）。
- 只在 `handle_user_input` 调用；`handle_option_selected` 不注入。
- 注入失败仅记日志，不阻断回合。
- `load_persona` 从 persona 配置读 `system_prompt` 字段，注入时带 `context_vars={"session_id": ...}`。

## 5. Supervisor 与广播机制

### 5.1 Supervisor 生命周期（`manager.py:145-205`）

- `init()`（`manager.py:145-155`）：加载 supervisor 设置 → 构造 `CompanionSupervisor`，注入两个回调：
  - `session_provider=self.list_sessions`（让它能看所有会话）；
  - `emit_callback=self._emit_supervisor_message`（让它能发消息）。
- `update_supervisor_config`（`manager.py:177-190`）：持久化设置；supervisor 不存在则新建并 start，存在则热更新。
- `_get_or_create_supervisor_adapter`（`manager.py:198-205`）：为 `agent_session` 监督模式维护一个**独立的专用 adapter**，不占用会话 adapter 表。

### 5.2 多连接广播（`manager.py:157-175`）

支持多 tab/多客户端同时连接。每个 WebSocket 连接注册一个回调：

```python
def register_broadcast_callback(
    self, connection_id: str, callback: Any
) -> None:
    """Register a connection-specific broadcast callback."""
    self._broadcast_callbacks[connection_id] = callback
```

- `_broadcast_callbacks: dict[str, Any]`，key 为连接 UUID（在 `main.py:937-944` 注册，连接关闭时注销，`main.py:956-957`）。
- `_emit_supervisor_message`（`manager.py:157-165`）：遍历所有回调逐个 await，单个失败只记 warning 不影响其他连接。

### 5.3 Companion scheduler 反应

`_yield_scheduler_reaction`（`manager.py:300-324`）：把会话状态（`working`/`success`/`error`/`interrupted`）报给全局 `CompanionScheduler`，若有反应则产出 `companion_message`（`session_id="global"`）+ 可选 `emotion_update`（confidence 固定 1.0）。在每个回合的开始和结束各调一次。

## 6. 斜杠命令清单

所有命令经 `client_command` 消息进入 `handle_client_command`（`manager.py:539-599`）分发。参数统一取 `args or text`（两者都 strip，`manager.py:551-552`）。未知命令回 `system_notice(level=warning)`（`manager.py:593-599`）。

| 命令 | 实现 | 行号 | 行为 | CLI 专有？ |
|---|---|---|---|---|
| `change_working_dir` | `_cmd_change_working_dir` | `manager.py:601-647` | 校验目录存在 → 持久化 `session.working_dir` → 关闭旧 adapter（下次懒重建用新目录）→ **顺便用系统文件管理器打开该目录**（`subprocess.Popen`，`manager.py:637-640`）→ system_notice | 否，但有桌面 OS 副作用 |
| `open_working_dir` | `_cmd_open_working_dir` | `manager.py:649-668` | 用系统文件管理器打开当前工作目录；会话无 working_dir 时回退到 adapter 配置的 `working_dir` 或 `"."`（`manager.py:654-657`） | 否，纯桌面副作用 |
| `list_kimi_sessions` | `_cmd_list_kimi_sessions` | `manager.py:670-707` | 读 `~/.kimi-code/session_index.jsonl`（`manager.py:673`），每行 JSON 取 `sessionId`/`workDir`，列出前 20 条 | **是，Kimi CLI 专有** |
| `switch_kimi_session` / `resume_agent_session` | `_cmd_resume_agent_session` | `manager.py:709-742` | 两个命令名映射同一实现（`manager.py:570`）。若 adapter 有 `switch_session` 方法则调用以恢复指定 agent session；否则回 warning | **是**（命令名与语义均绑定 CLI 会话概念，方法存在性靠 `hasattr` 探测，`manager.py:723`） |
| `restart_adapter` | `_cmd_restart_adapter` | `manager.py:744-753` | 关闭当前 adapter（下次输入时懒重建）→ system_notice | 否 |
| `switch_adapter` | `_cmd_switch_adapter` | `manager.py:755-782` | 调 `switch_adapter` 持久化切换，成功/失败各回 system_notice | 否 |
| `switch_persona` | `_cmd_switch_persona` | `manager.py:784-823` | 先用 `load_persona` 验证角色存在（`manager.py:797`）→ 持久化 `session.persona_id` → system_notice | 否 |

前端命令名枚举见 `frontend/src/types/protocol.ts:100-108`，与上表一致。

## 7. 已知缺陷与 v3 改进

1. **双路径重复且错误处理不一致**。`handle_user_input`（`manager.py:366-458`）与 `handle_option_selected`（`manager.py:460-504`）有约 8 处逐行重复的编排逻辑；前者有完整的异常→error 消息兜底，后者部分异常会直接冒泡。v3 应合并为单一回合管线，把"输入来源"参数化。
2. **system prompt 注入判断失效/脆弱**。`_inject_system_prompt_if_needed` 以 `session.messages` 为空判断首轮（`manager.py:284`），但调用点在 USER 消息 append 之后（`manager.py:378-388`），首轮注入实际上不会触发；即便修正顺序，"messages 为空"这个判据本身也脆弱（删消息、恢复历史都会影响）。v3 应使用显式的 `system_prompt_injected` 标志位（持久化）。
3. **SessionStore.list_sessions 的 N+1 查询**。每行 session 都单独 `load_messages`（`store.py:180-183`），列出 100 个会话就是 101 次查询，而列表页通常不需要消息体。v3 应提供不含消息的 summary 查询。
4. **Kimi 专有逻辑泄漏进通用 manager**。`_cmd_list_kimi_sessions` 硬编码读 `~/.kimi-code/session_index.jsonl`（`manager.py:673`），`_cmd_resume_agent_session` 用 `hasattr(adapter, "switch_session")` 探测能力（`manager.py:723`）。v3 应把 adapter 专有命令下沉到各 adapter 插件，manager 只做通用分发；能力探测改为显式的 adapter capability 声明。
5. **`_session_adapter_ids` 是只写不读的死状态**。写入于 `manager.py:255` 和 `manager.py:862`，全仓库无任何读取点（实际取 adapter ID 走 `_get_session_adapter_id`，`manager.py:825-832`，读的是 `_session_adapters` 与 `session.adapter_id`）。v3 直接删除。
6. **字符串比较消息类型 + `type: ignore`**。manager 里用 `server_message.type.value == "agent_stream"` 字符串比较判断消息类别，并靠 `# type: ignore[attr-defined]` 访问 payload 字段（`manager.py:438-443`、`manager.py:491-496`）。TypeScript 重写时用 discriminated union（`switch (msg.type)` + 字面量类型）即可彻底消除。
7. **打断路径丢失已生成内容**。`handle_interrupt` 不持久化半截 agent 输出（`manager.py:506-537`），打断后历史里只剩用户消息。v3 应在 finalize 时把已收集 chunk 以 `status=interrupted` 落库。
8. **两套时间表示并存**。线路上是 Unix 毫秒（`models.py:38-42`），SQLite 里是 ISO 字符串（`store.py:25-32`），还有 `session/models.py` 的 `ChatMessage` 保留 datetime。v3 建议统一存储与传输表示（推荐全程 Unix 毫秒整数）。
9. **`Session.title` 创建后永不更新**（`store.py:126` 固定"新会话"），且 `SessionStatus.STREAMING` 后端从未赋值——前端状态与后端状态实际各跑各的。v3 应明确状态机的单一事实来源（建议服务端权威、前端订阅）。
10. **会话驱逐策略激进**：`create_session` 超上限直接 `delete_session` 最老会话（`manager.py:209-214`），消息一并删库且无确认。v3 在 VS Code 插件里应改为提示或归档。
