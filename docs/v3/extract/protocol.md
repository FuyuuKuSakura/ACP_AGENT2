# Dionysus 前后端通信协议规格（知识提取）

> 目标读者：不了解旧代码、要用 TypeScript 重写 Dionysus 为 VS Code 插件的工程师。
> 本文档完整描述 v2（Python FastAPI 后端 + React 前端）的 WebSocket 通信协议。
> 主要信息源：`backend/dionysus_server/models.py`（协议模型权威定义）、
> `frontend/src/types/protocol.ts`（前端镜像）、
> `backend/dionysus_server/websocket/connection.py` / `handler.py`（传输与路由）。

---

## 1. 传输层概览

- 单个 WebSocket 端点，路径由配置 `config.server.ws_path` 决定（默认 `/ws`），见 `backend/dionysus_server/main.py:903`。
- 连接 URL 通过 query 参数标识会话：`?session_id=<id>&persona_id=<persona>`。服务端逻辑见 `main.py:906-915`：
  - 带 `session_id` 且会话存在 → 复用该会话；
  - 带 `session_id` 但会话不存在 → 创建新会话；
  - 不带 `session_id` → 创建新会话，`persona_id` 默认 `"exusiai"`（`main.py:908`）。
- 所有消息为单个 JSON 对象的文本帧。服务端发送时使用 `message.model_dump(mode="json")` + `json.dumps(..., ensure_ascii=False)`，见 `websocket/connection.py:106-109`。
- 前端连接层 `frontend/src/services/websocket.ts`：
  - 心跳：每 30 秒发送 `{ type: 'ping' }`（`websocket.ts:120-125`）；
  - 断线重连：指数退避，初始 1s、上限 30s，最多 10 次（`websocket.ts:12-13`、`websocket.ts:109-118`）；
  - `intentionalClose` 为 true 时不重连（`websocket.ts:65-71`）。

## 2. 消息信封结构

所有消息共享四个公共字段（前端镜像见 `frontend/src/types/protocol.ts:58-63`）：

| 字段 | 类型 | 含义 | 出处 |
|---|---|---|---|
| `type` | string（枚举字面量） | 消息类型，见第 4 节 | `models.py:45-67` |
| `trace_id` | string（UUID4） | 链路追踪 ID，缺省时服务端自动生成 | `models.py:17-18` |
| `timestamp` | number（Unix 毫秒） | 消息时间，序列化为整数毫秒 | `models.py:38-42` |
| `session_id` | string | 会话 ID；`new_session` / `ping` / `pong` 允许为 null | 各消息模型 |
| `payload` | object | 各类型私有负载（`ping`/`pong` 无 payload） | 各消息模型 |

`new_session` 与 `ping` 的 `session_id` 声明为 `str | None = None`（`models.py:161`、`models.py:169`）；`pong` 同样允许 null（`models.py:348`）。其余消息 `session_id` 必填。

特殊值：`session_id` 可以是字面量 `"global"`，用于全局 companion 反应消息（`backend/dionysus_server/session/manager.py:307-324`）。前端会把 `"global"` 重映射到当前会话再处理（`frontend/src/App.tsx:100-101`）。

### 2.1 时间戳格式约定（重要陷阱）

- **序列化方向**（Python → JSON）：所有 `datetime` 字段一律序列化为 Unix **毫秒整数**（`models.py:38-42`，`_dt_to_ms` 在 `models.py:21-22`）。
- **反序列化方向**（JSON → Python）：基类 validator 只在字段名为 `timestamp`/`created_at`/`updated_at` **且数值 `> 1e12`** 时才按毫秒解析（`models.py:28-36`）：

```python
@field_validator("*", mode="before")
@classmethod
def _parse_ms_timestamp(cls, value: Any, info: Any) -> Any:
    if info.field_name in {"timestamp", "created_at", "updated_at"} and isinstance(
        value, (int, float)
    ):
        if value > 1e12:
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    return value
```

含义：小于等于 `1e12`（约 2001-09-09 对应的毫秒值）的数值会被原样透传，之后由 pydantic 自身的 datetime 解析按 **秒** 处理。也就是说协议事实上"同时接受秒和毫秒"，靠阈值区分——v3 应统一为毫秒并去掉该启发式。

## 3. 消息类型总表

`MessageType` 枚举权威定义在 `models.py:45-67`，前端镜像在 `protocol.ts:1-19`：

| type | 方向 | 用途 |
|---|---|---|
| `user_input` | C→S | 用户输入文本（可带附件） |
| `option_selected` | C→S | 用户对 option_request 的选择 |
| `interrupt` | C→S | 打断当前生成 |
| `new_session` | C→S | 请求创建新会话 |
| `client_command` | C→S | 本地命令（不经 LLM），即斜杠命令通道 |
| `ping` | C→S | 心跳 |
| `handshake` | S→C | 连接建立后的握手 |
| `agent_stream` | S→C | agent 输出流式 chunk |
| `agent_complete` | S→C | 一回合结束（success/error/interrupted） |
| `option_request` | S→C | agent 请求用户做选择 |
| `status_update` | S→C | 状态机状态变化（thinking 等） |
| `emotion_update` | S→C | 陪伴情绪/Live2D 表情动作 |
| `sticker_send` | S→C | 发送表情包贴纸 |
| `live2d_action` | S→C | 直接驱动 Live2D（expression/motion/look_at/lip_sync） |
| `companion_message` | S→C | 陪伴角色的旁白文本 |
| `todo_update` | S→C | 任务清单快照 |
| `pong` | S→C | 心跳应答 |
| `system_notice` | S→C | 系统通知（info/warning/error） |

注意：**协议中没有独立的 `thinking_stream` 和 `error` 消息类型**。
- thinking 内容复用 `agent_stream`，靠 payload 的 `is_thinking: true` 区分（`models.py:206`，前端处理见 `App.tsx:120`、`App.tsx:128-129`）。
- 错误通过 `agent_complete` 的 `status: "error"` + `error_message` 表达（`models.py:217-229`），或 `system_notice` 的 `level: "error"`（`models.py:351-353`）。

## 4. Client → Server 消息

### 4.1 `user_input`

定义：`models.py:98-110`（payload）、`models.py:105-110`（信封）。前端镜像 `protocol.ts:67-75`。

payload 字段：

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `text` | string | 必填 | 用户输入文本 |
| `attachments` | `Attachment[]` | `[]` | 附件列表，见第 6 节 |
| `interrupt_before_send` | bool | `false` | 意图为"发送前先打断"。**后端从未消费此字段**（见第 9 节） |
| `mode` | `"normal" \| "plan" \| "yolo" \| "plan_yolo"` | `"normal"` | agent 运行模式，透传给 adapter |

路由：`websocket/handler.py:36-44` → `SessionManager.handle_user_input(session_id, text, attachments, mode=...)`。

样例：

```json
{
  "type": "user_input",
  "trace_id": "3f6b2a1c-9d4e-4c8a-b7f1-2e5d6a8c0b12",
  "timestamp": 1752926400000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": {
    "text": "帮我重构 login 函数",
    "attachments": [],
    "interrupt_before_send": false,
    "mode": "normal"
  }
}
```

### 4.2 `option_selected`

定义：`models.py:113-123`。前端镜像 `protocol.ts:77-83`。

payload 字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `selected_id` | string | 被选选项的 id（对应 `OptionItem.id`） |
| `selected_label` | string | 被选选项的显示文本。后端只把 label 作为新一轮输入发给 agent（`manager.py:482`） |

路由：`handler.py:56-63` → `SessionManager.handle_option_selected`。

```json
{
  "type": "option_selected",
  "trace_id": "a1b2c3d4-1111-4e5f-8a9b-0c1d2e3f4a5b",
  "timestamp": 1752926405000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": { "selected_id": "opt_yes", "selected_label": "确认删除" }
}
```

### 4.3 `interrupt`

定义：`models.py:126-136`。前端镜像 `protocol.ts:85-91`。

payload 字段：

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `reason` | `"user_request" \| "timeout" \| "system"` | `"user_request"` | 打断原因 |
| `insert_message` | string \| null | null | 打断后顺带插入的一条用户消息（会作为 USER 消息持久化，见 `manager.py:523-526`） |

路由：`handler.py:65-72` → `SessionManager.handle_interrupt`。

```json
{
  "type": "interrupt",
  "trace_id": "b2c3d4e5-2222-4f6a-9b0c-1d2e3f4a5b6c",
  "timestamp": 1752926410000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": { "reason": "user_request", "insert_message": null }
}
```

### 4.4 `client_command`

定义：`models.py:139-150`。前端镜像 `protocol.ts:110-117`，前端枚举了 8 个命令名（`protocol.ts:100-108`）。

payload 字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `command` | string | 命令名：`change_working_dir` / `open_working_dir` / `list_kimi_sessions` / `switch_kimi_session` / `resume_agent_session` / `restart_adapter` / `switch_adapter` / `switch_persona` |
| `args` | string \| null | 位置参数 |
| `text` | string \| null | 备用文本参数（后端取 `args or text`，见 `manager.py:555`、`manager.py:571` 等） |

路由：`handler.py:46-53` → `SessionManager.handle_client_command`。未知命令回 `system_notice`（warning，`manager.py:593-599`）。命令的完整行为见 companion 文档 `session.md` 第 3 节。

```json
{
  "type": "client_command",
  "trace_id": "c3d4e5f6-3333-4a7b-8c9d-0e1f2a3b4c5d",
  "timestamp": 1752926415000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": { "command": "switch_persona", "args": "kalt_sit", "text": null }
}
```

### 4.5 `new_session`

定义：`models.py:153-162`。`session_id` 可为 null。前端镜像 `protocol.ts:93-98`。

payload：`{ "persona_id": string | null }`；为空时后端用 `"exusiai"`（`handler.py:75`）。

处理：`handler.py:74-79` 创建新会话后调用 `on_new_session` 回调，后者关闭旧 adapter 并重发一次 `handshake`（`main.py:919-931`）。

### 4.6 `ping`

定义：`models.py:165-169`，无 payload，`session_id` 可为 null。前端心跳每 30s 发一次 `{ type: 'ping' }`（`websocket.ts:122-124`——注意前端实际连 `trace_id`/`timestamp` 都不带，后端 pydantic 会自动补默认值）。

服务端在 `WSConnection.receive_message` 中识别 ping 并**自动回 pong，且回显客户端的 trace_id**（`connection.py:80-82`）；`handler.py:81-83` 对 ping 不再做任何事。

## 5. Server → Client 消息

### 5.1 `handshake`

定义：`models.py:187-199`。前端镜像 `protocol.ts:131-139`。

payload 字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `server_version` | string | 服务端版本。**两处来源不一致**：连接建立时发 `"0.2.0"`（`connection.py:46`），`new_session` 后重发时发 `"0.1.0"`（`main.py:925`）——见第 9 节缺陷 |
| `session_id` | string | 服务端分配的会话 ID |
| `persona_id` | string \| null | 当前角色 ID |
| `supported_features` | string[] | 硬编码 `["streaming", "options", "interrupt"]`（`connection.py:49`、`main.py:928`） |

发送时机：WebSocket accept 后立即发送（`connection.py:39-52`）；`new_session` 处理后重发一次（`main.py:922-931`）。

```json
{
  "type": "handshake",
  "trace_id": "d4e5f6a7-4444-4b8c-9d0e-1f2a3b4c5d6e",
  "timestamp": 1752926420000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": {
    "server_version": "0.2.0",
    "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
    "persona_id": "exusiai",
    "supported_features": ["streaming", "options", "interrupt"]
  }
}
```

前端处理：若本地无此会话则新建一个本地会话条目，否则切到该会话（`App.tsx:105-118`）。

### 5.2 `agent_stream`

定义：`models.py:202-214`。前端镜像 `protocol.ts:141-149`。

payload 字段：

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `chunk` | string | 必填 | 本帧文本增量 |
| `is_final` | bool | `false` | 是否为最后一帧（前端实际未使用，以 `agent_complete` 为准） |
| `status` | StatusEnum | `"outputting"` | 生成时的状态标签 |
| `is_thinking` | bool | `false` | true 表示这是 thinking 内容，前端进独立 thinking 通道（`App.tsx:120`、`App.tsx:128-129`） |

StatusEnum 取值：`thinking` / `reading_file` / `executing` / `outputting` / `error` / `idle`（`models.py:69-75`）。

```json
{
  "type": "agent_stream",
  "trace_id": "e5f6a7b8-5555-4c9d-8e1f-2a3b4c5d6e7f",
  "timestamp": 1752926421000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": { "chunk": "好的，我先看一下 ", "is_final": false, "status": "outputting", "is_thinking": false }
}
```

前端还会对每个 chunk 跑工具调用正则解析（`App.tsx:131-135`，正则见 `frontend/src/lib/tools.ts:12-13`）——这是缺陷，见第 9 节。

### 5.3 `agent_complete`

定义：`models.py:217-229`。前端镜像 `protocol.ts:151-159`。

payload 字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `status` | `"success" \| "error" \| "interrupted"` | 回合终态 |
| `duration_ms` | int \| null | 耗时 |
| `artifacts` | `Artifact[]` | 产物，见第 6 节 |
| `error_message` | string \| null | status=error 时的错误描述 |

```json
{
  "type": "agent_complete",
  "trace_id": "f6a7b8c9-6666-4d0e-9f2a-3b4c5d6e7f8a",
  "timestamp": 1752926430000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": { "status": "success", "duration_ms": 8200, "artifacts": [], "error_message": null }
}
```

前端处理（`App.tsx:154-178`）：finalize 流式消息与工具调用；`error` 时把 `error_message` 追加为系统消息；同时驱动 Live2D presence 为 `success`/`error`。

### 5.4 `option_request`

定义：`models.py:232-251`（`OptionItem` 在 `models.py:232-236`）。前端镜像 `protocol.ts:51-56`、`protocol.ts:161-169`。

`OptionItem`：`{ id, label, description?, icon? }`。

payload 字段：

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `question` | string | 必填 | 提问文本（事件转换时缺省为"请选择一个选项："，`manager.py:80`） |
| `options` | `OptionItem[]` | 必填 | 选项列表 |
| `ui_type` | `"button_group" \| "dropdown" \| "card_list" \| "input_confirm"` | `"button_group"` | 前端渲染方式提示 |
| `timeout_seconds` | int \| null | `60` | 超时时间（后端未强制实施） |

```json
{
  "type": "option_request",
  "trace_id": "a7b8c9d0-7777-4e1f-8a3b-4c5d6e7f8a9b",
  "timestamp": 1752926435000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": {
    "question": "确定要删除该文件吗？",
    "options": [
      { "id": "opt_yes", "label": "确认删除", "description": null, "icon": null },
      { "id": "opt_no", "label": "取消", "description": null, "icon": null }
    ],
    "ui_type": "button_group",
    "timeout_seconds": 60
  }
}
```

### 5.5 `status_update`

定义：`models.py:254-265`。前端镜像 `protocol.ts:171-178`。

payload：`{ status: StatusEnum, detail: string, progress?: float | null }`。

```json
{
  "type": "status_update",
  "trace_id": "b8c9d0e1-8888-4f2a-9b4c-5d6e7f8a9b0c",
  "timestamp": 1752926436000,
  "session_id": "8b1c4f2e-3a5d-4e6f-9c7b-1d2e3f4a5b6c",
  "payload": { "status": "reading_file", "detail": "读取 src/auth.ts", "progress": null }
}
```

### 5.6 `emotion_update`

定义：`models.py:268-280`。前端镜像 `protocol.ts:180-188`。

payload 字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `emotion` | string | 情绪名（happy/curious/...，由 persona 配置决定，协议层不枚举） |
| `confidence` | float | 置信度；scheduler/companion 反应固定填 1.0（`manager.py:322`、`manager.py:424`） |
| `live2d_expression` | string \| null | 要播放的 Live2D 表情名 |
| `live2d_motion` | string \| null | 要播放的 Live2D 动作名 |

前端处理：`App.tsx:226-242`（记录会话情绪 + 请求 expression/motion）。

### 5.7 `sticker_send`

定义：`models.py:283-294`。前端镜像 `protocol.ts:190-197`。

payload：`{ emotion: string, sticker_url: string, sticker_id: string }`。
注意：当前前端 `handleMessage` 对 `sticker_send` **直接忽略**（`App.tsx:257-260`）。

### 5.8 `live2d_action`

定义：`models.py:297-309`。前端镜像 `protocol.ts:199-207`。

payload 字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `action_type` | `"expression" \| "motion" \| "look_at" \| "lip_sync"` | 动作类别 |
| `name` | string | 表情/动作名 |
| `fade_duration` | float \| null | 淡入时长 |
| `params` | object \| null | 附加参数；`look_at` 用 `{ x, y, duration }`（前端解析见 `App.tsx:213-217`） |

### 5.9 `companion_message`

定义：`models.py:312-323`。前端镜像 `protocol.ts:209-216`。

payload：`{ text: string, emotion?: string | null, sticker_id?: string | null }`。
两类来源：全局 scheduler 反应（`session_id` 为 `"global"`，`manager.py:307-314`）和逐事件 companion 反应（`manager.py:406-413`）。前端只取 text 显示为陪伴旁白（`App.tsx:243-248`）。

### 5.10 `todo_update`

定义：`models.py:326-341`（`TodoItem` 在 `models.py:326-329`）。前端镜像 `protocol.ts:218-229`。

payload：`{ items: TodoItem[] }`，`TodoItem = { id, text, done }`。**每次发全量快照**，不是增量。

### 5.11 `pong`

定义：`models.py:344-348`，无 payload。`trace_id` 回显对应 ping 的 trace_id，缺失则为空字符串（`connection.py:111-117`）。前端忽略（`App.tsx:257`）。

### 5.12 `system_notice`

定义：`models.py:351-361`。前端镜像 `protocol.ts:235-241`。

payload：`{ text: string, level: "info" | "warning" | "error" }`（level 默认 `"info"`）。
是斜杠命令结果、错误提示的通用载体（大量产生于 `manager.py` 的 `_cmd_*` 方法）。前端追加为系统消息（`App.tsx:202-209`）。

## 6. attachments 与 artifacts 扩展结构

### 6.1 Attachment（C→S，user_input 的附件）

定义：`models.py:85-90`。前端镜像 `protocol.ts:36-42`。

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `id` | string（UUID4） | 自动生成 | 附件 ID |
| `filename` | string | 必填 | 文件名 |
| `mime_type` | string | 必填 | MIME 类型 |
| `size` | int | 必填 | 字节数 |
| `data` | string | 必填 | base64 内容或 URL |

进入 adapter 前被归一化为 plain dict（`manager.py:113-123`）。

### 6.2 Artifact（S→C，agent_complete 的产物）

定义：`models.py:78-82`。前端镜像 `protocol.ts:44-49`。

| 字段 | 类型 | 含义 |
|---|---|---|
| `type` | `"image" \| "file" \| "mermaid" \| "latex"` | 产物类别（mermaid 图源码、LaTeX 公式、图片、普通文件） |
| `mime_type` | string \| null | MIME 类型 |
| `data` | string \| null | base64 或 URL；mermaid/latex 时可直接是源码文本 |
| `caption` | string \| null | 说明文字 |

## 7. 事件 → 消息转换（服务端内部）

adapter 不直接发协议消息，而是产出内部 `AgentEvent`（`models.py:425-440`），其 `type` 为 7 种字面量之一：`agent_stream` / `status_update` / `option_request` / `agent_complete` / `emotion_update` / `sticker_send` / `live2d_action`（**注意：没有 `todo_update`，todo 由 `TodoTracker` 在 manager 层另行产出**，见 `manager.py:428-433`）。

转换函数 `_agent_event_to_server_message` 在 `manager.py:60-110`：把 event.payload 展开为对应的 `*Payload` 模型，event 的 `trace_id` 透传到消息（`manager.py:65`、`manager.py:71` 等）。未知事件类型抛 `ValueError`（`manager.py:110`）。

## 8. 会话生命周期时序

### 8.1 连接与握手

```
Client                                  Server
  |--- WebSocket connect /ws?session_id=..&persona_id=.. -->|
  |                                  [get or create session]|
  |<------------------- handshake (server_version 0.2.0) ---|
  |--- ping (每 30s) -------------------------------------->|
  |<------------------------------ pong (回显 trace_id) ----|
```

### 8.2 正常回合（user_input → 流式 → 完成）

```
Client                                  Server
  |--- user_input(text, mode) ----------------------------->|
  |                        [持久化 USER 消息; status=processing]
  |<-- companion_message? (scheduler 反应, session_id=global)|
  |<-- emotion_update? -------------------------------------|
  |                        [首轮注入 persona system_prompt]  |
  |                        [adapter.send 流式事件]           |
  |<-- companion_message? / emotion_update? / todo_update? -|  (逐事件伴随)
  |<-- agent_stream (chunk, is_thinking?) ------------------|
  |<-- agent_stream ... ------------------------------------|
  |<-- status_update? / option_request? --------------------|
  |<-- agent_complete (success) ----------------------------|
  |                        [持久化 AGENT 消息; status=idle]  |
```

途中若 agent 发 `option_request`：前端渲染选项（会话状态 `waiting_option`），用户点击后：

```
  |--- option_selected(selected_id, selected_label) ------->|
  |        [作为新 USER 消息 "选择：{label}（{id}）" 持久化]  |
  |        [label 作为新输入再走一遍 8.2 的流式管线]         |
```

### 8.3 打断

```
  |--- interrupt(reason, insert_message?) ----------------->|
  |                        [adapter.interrupt()]            |
  |                        [insert_message 持久化为 USER 消息]|
  |<-- agent_complete (status=interrupted) -----------------|
  |                        [session.status=interrupted]     |
  |<-- companion_message? (scheduler "error" 反应) ---------|
```

注意：正在进行中的 `handle_user_input` 流也可能随后自己产出 `agent_complete`，即打断后客户端可能收到**两条** agent_complete（一条来自 handle_interrupt、一条来自流循环自身 break），前端以 finalize 幂等处理。

### 8.4 错误

adapter 抛异常时由 manager 捕获并合成 `agent_complete(status=error, error_message=str(exc))`（`manager.py:445-451`）；斜杠命令错误走 `system_notice(level=error)`。无独立 error 消息类型。

### 8.5 断线

服务端 `receive_message` 在 `WebSocketDisconnect` / `RuntimeError` / JSON 解析失败 / 未知类型时返回 `None`，主循环即断开（`connection.py:54-104`、`main.py:948-959`）。**任何解析失败都直接关闭连接**，不会回错误消息。finally 中注销广播回调并关闭该会话的 adapter（`main.py:956-959`）。

## 9. 已知缺陷与 v3 改进

1. **无协议版本协商字段**。握手只有 `server_version` 和硬编码的 `supported_features` 列表（`connection.py:46-50`），客户端无法声明自己支持的协议版本。v3 应加 `protocol_version` 字段并做双向协商。
2. **握手版本号不一致**。连接建立时发 `"0.2.0"`（`backend/dionysus_server/websocket/connection.py:46`），而 `new_session` 后重发的握手硬编码 `"0.1.0"`（`backend/dionysus_server/main.py:925`）。v3 应从单一配置源读取。
3. **`UserInputPayload.interrupt_before_send` 是死字段**。定义在 `models.py:101`，前端永远发 `false`（`frontend/src/components/Input/ChatInput.tsx:85`），`handler.py:36-44` 路由时根本不读它（只传 text/attachments/mode）。v3 要么实现要么删除。
4. **工具调用靠前端 emoji 正则从文本流里刮**。后端把工具调用当普通文本 chunk 发，前端用正则 `🔧 调用工具: Name(...)` / `🛠️ 工具结果: ...` 解析（`frontend/src/lib/tools.ts:12-13`，调用点 `App.tsx:131-135`）。脆弱且污染正文。v3 应新增结构化 `tool_call` / `tool_result` 消息类型。
5. **无独立 error 消息类型**，错误语义分散在 `agent_complete.status="error"` 与 `system_notice.level="error"` 两处，客户端要处理两条路径。v3 可统一。
6. **时间戳解析启发式**。仅当数值 `> 1e12` 才按毫秒解析（`models.py:28-36`），秒/毫秒歧义靠阈值猜。v3 应明确规定毫秒整数并严格校验。
7. **打断可能产生两条 agent_complete**（见 8.3），协议层无去重机制（可用 trace_id 关联，但当前 interrupt 与流式各自生成 trace_id）。v3 应让一回合共享一个 turn_id。
8. **消息解析失败即静默断连**（`connection.py:67-104`），客户端无从得知原因。v3 应在关闭前发送 error 帧。
9. **`sticker_send` 前端未实现渲染**（`App.tsx:257-260` 直接 fallthrough），属于发了没人消费的类型。v3 需决策保留或移除。
10. **`todo_update` 全量快照**，大清单时浪费带宽；且 todo 不走 adapter 事件通道，而是 manager 层从事件文本二次提取（`manager.py:428-433`）。v3 宜改为结构化增量事件。
