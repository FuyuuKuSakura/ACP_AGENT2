# 角色陪伴引擎规格（persona 子系统知识提取）

> 目标读者：不了解 Dionysus v2（Python FastAPI）旧代码、要在 v3（VS Code 插件，TypeScript）中重实现角色陪伴功能的工程师。
> 本文所有行号均已对照当前仓库源码核实。配置键名与代码标识符保留英文原文。

## 0. 子系统总览

陪伴子系统由 5 个组件构成，全部位于 `backend/dionysus_server/persona/`：

| 组件 | 文件 | 职责 |
|---|---|---|
| loader | `persona/loader.py` | 从 `personas/` 目录加载 persona YAML，运行时文件优先于 builtin |
| CompanionEngine | `persona/companion_engine.py` | 单个 agent 回合内的台词/情绪/Live2D 反应生成器 |
| CompanionScheduler | `persona/companion_scheduler.py` | 跨会话聚合状态，产出"全局"陪伴台词 |
| CompanionSupervisor | `persona/supervisor.py` | 后台定时轮询会话列表，用 LLM 或内置模板播报收台 |
| TodoTracker | `persona/todo_tracker.py` | 从 agent 事件流提取简易 todo 列表 |

数据流（由 `SessionManager.handle_user_input` 驱动，`backend/dionysus_server/session/manager.py:366-458`）：

```
用户消息 → handle_user_input
  ├─ 回合开始：scheduler.on_session_status("working")   → CompanionMessage + EmotionUpdateMessage (session_id="global")
  ├─ 每个 adapter event：
  │    ├─ companion_engine.on_event(event) → CompanionReaction → CompanionMessage + EmotionUpdateMessage (session_id=会话)
  │    ├─ todo_tracker.on_event(event)     → TodoUpdateMessage（仅列表变化时）
  │    └─ 事件本身转换为 AgentStream/StatusUpdate/AgentComplete 等消息
  ├─ 回合结束：scheduler.on_session_status(complete_status) → 全局消息
  └─ 打断路径 handle_interrupt：scheduler.on_session_status("error") → 全局消息
```

三类关键消息（`backend/dionysus_server/models.py`）：

- `CompanionMessage`：payload 为 `{text, emotion?, sticker_id?}`（models.py:312-323）。
- `EmotionUpdateMessage`：payload 为 `{emotion, confidence, live2d_expression?, live2d_motion?}`（models.py:268-280）。陪伴反应的情绪与 Live2D 提示通过它下发，engine 产出的反应恒置 `confidence=1.0`（manager.py:420-425）。
- `Live2DActionMessage`：payload 为 `{action_type: "expression"|"motion"|"look_at"|"lip_sync", name, fade_duration?, params?}`（models.py:297-309）。**注意：协议里定义了、`_agent_event_to_server_message` 也做了映射（manager.py:104-109），但全仓库没有任何代码实际产生 `live2d_action` 事件**，当前 Live2D 动作完全经由 `EmotionUpdateMessage` 的 `live2d_expression`/`live2d_motion` 字段传递。

---

## 1. persona YAML 完整 schema

### 1.1 加载规则

- 查找顺序：先 `<config_dir>/personas/<id>.yaml` / `.yml`，再 `<config_dir>/personas/builtin/<id>.yaml` / `.yml`（`persona/loader.py:24-31`）。**是整个文件级别的覆盖，不做逐键合并**。
- `list_personas()` 依次扫 runtime 目录和 builtin 目录的 `*.yaml`/`*.yml`，按 `id` 去重，runtime 优先（loader.py:43-64）。
- `_PERSONA_DIR` 与 `_BUILTIN_DIR` 在**模块导入时**固化为 `get_config_dir() / "personas"`（loader.py:15-16）——导入后再改 `Dionysus_CONFIG_DIR` 环境变量不生效（详见第 7 节缺陷）。

### 1.2 逐字段说明

以 `backend/config/personas/exusiai.yaml`（166 行，功能最全）为参照；`kal'tsit.yaml`（64 行）是精简版。

| 字段 | 类型 | 出处 | 是否被代码读取 | 说明 |
|---|---|---|---|---|
| `id` | str | exusiai.yaml:1 | 是（loader 去重/查找键，loader.py:53） | persona 唯一标识，同时是目录、文件名、头像文件名 |
| `name` | str | exusiai.yaml:2 | 仅经 API 透传 | 显示名 |
| `name_en` | str | exusiai.yaml:3 | 否 | 仅 exusiai 有；kal'tsit.yaml 无此字段 |
| `description` | str | exusiai.yaml:4 | 仅经 API 透传 | 角色简介 |
| `system_prompt` | str | exusiai.yaml:5-28 | 是 | 两个用途：① 会话首个用户回合注入 adapter（manager.py:282-298）；② Supervisor deepseek 模式的 system prompt 基底（supervisor.py:337-346） |
| `tone_rules.prefix_templates` | list[str] | exusiai.yaml:30-33 | 是 | `_apply_tone` 以约 33% 概率加前缀（companion_engine.py:146-156） |
| `tone_rules.suffix_templates` | list[str] | exusiai.yaml:34-36 | 是 | 同上，约 33% 概率加后缀；前缀/后缀二选一，不会同时加 |
| `tone_rules.keyword_replacements` | dict | exusiai.yaml:37-38 | **否** | 声明了（如 `您: 老板`）但无任何代码读取 |
| `tone_rules.random_insertions` | list | exusiai.yaml:39-45 | **否** | 同上，概率插入口癖的规则未实现 |
| `emotion_mapping` | dict | exusiai.yaml:46-76 | **否** | 中文情绪→expression/motion/sticker_pool 映射，全仓库无读取方；`sticker_pool` 引用的贴纸资源也不存在 |
| `companion_templates` | dict[str, list[str]] | exusiai.yaml:77-93 | 是 | 4 个固定键：`work_start`/`long_workflow`/`error`/`success`，逐键回退到代码内置默认值（companion_engine.py:112-121） |
| `status_phrases` | dict[str, list[str]] | exusiai.yaml:94-122 | 是 | 7 个固定键：`thinking`/`reading_file`/`executing`/`outputting`/`success`/`error`/`idle`（companion_engine.py:123-132） |
| `corpus_file` | str | exusiai.yaml:123 | **否（值未被读）** | 语料文件实际按约定路径 `personas/corpus/<id>.txt` 查找（main.py:491-493），此字段的值本身无人解析 |
| `preferred_theme` | str | exusiai.yaml:124 | **否** | 声明了 `exusiai_default`，但该主题在 `config/themes/` 不存在，也无代码读取 |
| `theme_override` | dict | exusiai.yaml:125-129 | **否** | 角色专属主题色覆盖，无读取方 |
| `companion.status_to_emotion` | dict[str, str] | exusiai.yaml:131-139 | 是 | status→emotion 映射，缺失时回退到代码默认值（companion_engine.py:82-93） |
| `companion.live2d.model_path` | str | exusiai.yaml:141 | 是（前端） | 指向后端静态挂载 `/personas/live2d` 下的 model3.json URL；前端 `Live2DViewer` 拉取 `/api/personas/{id}/companion` 后使用（Live2DViewer.tsx:77-86） |
| `companion.live2d.default_expression` | str | exusiai.yaml:142 | 是 | 表情解析失败时的兜底（companion_engine.py:95, 171-172） |
| `companion.live2d.expressions` | dict[str, str] | exusiai.yaml:143-150 | 是 | emotion→表情名映射；表情名必须与模型 expressions 目录中的 `.exp3.json` 文件名一致 |
| `companion.live2d.motions` | dict[str, str] | exusiai.yaml:151-154 | 是 | emotion→动作组名映射；未命中时回退 `idle` 再回退 `"Idle"`（companion_engine.py:174-177） |
| `companion.live2d.scale` | float | exusiai.yaml:155 | 是（前端） | 模型缩放，经 `POST /api/personas/{id}/live2d/scale` 写回，范围钳制 0.1–3.0（main.py:664-698） |
| `companion.touch_zones.<zone>.expression` | str | exusiai.yaml:158 | 是（仅 engine 内） | 触摸区表情 |
| `companion.touch_zones.<zone>.lines` | list[str] | exusiai.yaml:159-161 | 是（仅 engine 内） | 触摸台词池 |

固定 status 键全集（出现在映射/语料各处）：`thinking`、`reading_file`、`executing`、`outputting`、`success`、`error`、`idle`、`long_workflow`。emotion 取值是自由字符串，内置默认用到：`neutral`、`confident`、`happy`、`worried`、`bored`（companion_engine.py:85-93），kal'tsit.yaml 额外用了 `calm`（kal'tsit.yaml:33-34）。

### 1.3 真实片段对比：exusiai vs kal'tsit

`companion` 段是两人共有的核心。exusiai.yaml:130-166：

```yaml
companion:
  status_to_emotion:
    thinking: neutral
    reading_file: neutral
    executing: confident
    outputting: happy
    success: happy
    error: worried
    idle: bored
    long_workflow: bored
  live2d:
    model_path: /personas/live2d/exusiai/00.model3.json
    default_expression: 原皮
    expressions:
      happy: 爱心眼
      worried: 哭哭
      surprised: ？
      annoyed: 出魂
      confident: 举起手
      bored: 原皮
      neutral: 原皮
    motions:
      idle: Idle
      greet: Idle
      nod: Idle
    scale: 2.15
  touch_zones:
    head:
      expression: ？
      lines:
      - 老板？
      - 看这里～
    body:
      expression: 脸红
      lines:
      - 嘿嘿～
      - 呀吼～
```

kal'tsit.yaml:28-64（注意 `outputting`/`success` 映射到 `calm`，`nod` 动作不同，表情名换成凯尔希模型的命名）：

```yaml
companion:
  status_to_emotion:
    thinking: neutral
    reading_file: neutral
    executing: confident
    outputting: calm
    success: calm
    error: worried
    idle: bored
    long_workflow: bored
  live2d:
    default_expression: 原皮
    expressions:
      happy: 微笑
      worried: 叹气
      surprised: 惊讶
      annoyed: 烦躁
      confident: 冷静
      bored: 原皮
      neutral: 原皮
    motions:
      idle: Idle
      greet: Idle
      nod: 待机动耳朵
    model_path: /personas/live2d/kal'tsit/凯尔希直播版1.model3.json
    scale: 0.5
  touch_zones:
    head:
      expression: 惊讶
      lines:
      - 博士，有事吗？
      - 不要碰我的耳朵。
    body:
      expression: 烦躁
      lines:
      - ……请注意分寸。
      - 博士，你变了很多。
```

**关键差异与陷阱**：runtime 版 `kal'tsit.yaml` **没有** `tone_rules`、`emotion_mapping`、`companion_templates`、`status_phrases`、`corpus_file`、`preferred_theme`、`theme_override`。这些字段在 `personas/builtin/kal'tsit.yaml` 里是齐的（含凯尔希口吻的 4 组 `companion_templates` 与 7 组 `status_phrases`），但因为加载是整文件覆盖（loader.py:24-31），runtime 文件一旦存在就把 builtin 文件整体屏蔽。后果：**运行时凯尔希的 `work_start`/`success` 等台词全部回退到 `companion_engine.py:27-58` 里能天使口吻的内置默认**（"啊噗噜派！让我来搞定这个！"）。

另有 `test_char.yaml`、`web_char.yaml` 两个最小 persona（各约 52 行），只有 `id/name/description/system_prompt/companion`，`model_path` 为空串（test_char.yaml:19），代表"无 Live2D 模型"的合法形态。

---

## 2. CompanionEngine — 回合内反应引擎

`backend/dionysus_server/persona/companion_engine.py`（243 行）。**每个用户回合新建一个实例**（manager.py:397），内部状态（冷却、已触发标记、计时）只存活一个回合。

### 2.1 初始化与配置回退链

构造函数（companion_engine.py:70-110）的回退优先级一律为 **persona YAML → 代码内置默认**：

- `_status_to_emotion`：YAML `companion.status_to_emotion` → 内置 8 键默认（82-93 行）。
- `_default_expression`：YAML `default_expression` → `"原皮"`（95 行）。
- `_expressions`：YAML `live2d.expressions` → 内置 7 键默认（96-104 行，全是能天使表情名：爱心眼/哭哭/？/出魂/举起手/原皮）。
- `_motions`：YAML `live2d.motions` → `{idle/greet/nod: "Idle"}`（105-109 行）。
- `_touch_zones`：YAML → `{}`（110 行）。
- `_templates`：对 `DEFAULT_TEMPLATES` 的 4 个键逐个取 YAML `companion_templates[key]`，缺失或非空校验失败则用默认（112-121 行）。
- `_status_phrases`：同上，7 键（123-132 行）。

### 2.2 触发规则（`on_event`，companion_engine.py:189-228）

输入是 adapter 事件 dict（`{type, payload}`），输出 `CompanionReaction | None`：

1. **`status_update`**：
   - 首个 `thinking`/`reading_file`/`executing` 状态触发一次 `work_start` 台词（198-204 行，用 `_last_trigger` 保证每回合一次）。
   - 状态出现在 `status_phrases` 中且过了 5 秒冷却（`_STATUS_COOLDOWN_SECONDS = 5.0`，60 行；冷却判定 158-166 行）→ 播放对应状态短语（207-208 行）。注意首次调用 `_cooldown_ok` 恒为 True。
   - 回合耗时 >12 秒且状态数 >1 → 触发一次 `long_workflow`（210-217 行）。
2. **`agent_complete`**：`error`/`success` 各触发一次对应台词（219-226 行）。
3. 其余事件类型不反应。

### 2.3 台词加工与反应装配

- 选词：从对应键的列表 `random.choice`（134-144 行）。
- 语气加工 `_apply_tone`（146-156 行）：`random.random()` <0.33 加前缀、0.33–0.66 加后缀、否则原样；前后缀不叠加。**只实现了 prefix/suffix，YAML 里的 `keyword_replacements` 和 `random_insertions` 被忽略。**
- 装配 `_reaction`（179-187 行）：`status → emotion`（`_resolve_emotion`，168-169 行，未知 status 归 `neutral`）→ `emotion → expression`（171-172 行，未知 emotion 归 `default_expression`）→ `emotion → motion`（174-177 行，回退 `idle` → `"Idle"`）。`sticker_id` 恒为 None。
- `CompanionReaction` 数据类定义在 15-23 行：`{text, emotion, live2d_expression, live2d_motion, sticker_id}`。

### 2.4 消息生成链路

`SessionManager.handle_user_input` 内（manager.py:402-426）：每个 adapter 事件先过 `companion_engine.on_event`，若返回反应则**先**产出 `CompanionMessage`（文本+emotion），再在有 expression/motion 时产出 `EmotionUpdateMessage`（`confidence=1.0`），最后才转发事件本身对应的消息。即前端每回合收到的顺序是：陪伴消息 →（可能的）表情消息 → 原始事件消息。

### 2.5 触摸反应（`get_touch_reaction`，companion_engine.py:230-243）

按 zone（`head`/`body`）从 `touch_zones` 取台词池随机一句、取 zone 专属 expression，emotion 固定取 `idle` 映射值。**注意：全仓库没有调用方**——没有对应的 WebSocket 消息类型或 REST 端点，当前是死代码，但 v3 实现触摸交互时应以此语义为准。

---

## 3. CompanionScheduler — 跨会话全局反应

`backend/dionysus_server/persona/companion_scheduler.py`（152 行）。`SessionManager` 持有唯一实例（manager.py:137），把所有会话的状态聚合成一条"全局"陪伴线。

### 3.1 状态归一化（`_normalize_status`，scheduler.py:87-105）

任意 adapter 状态字符串归入 4 桶：

- `WORKING` ← `working/processing/streaming/thinking/reading_file/executing/outputting`（91-100 行）
- `SUCCESS` ← `success/completed/complete`（101-102 行）
- `ERROR` ← `error/failed/failure/interrupted`（103-104 行）
- `IDLE` ← 其余一切及 `None`（105 行）

### 3.2 触发时机（SessionManager 侧）

- 回合开始：`handle_user_input` 里状态置 PROCESSING 后调 `on_session_status(session_id, "working")`（manager.py:382-386）。
- 回合结束：以 `complete_status`（success/error/interrupted）调用（manager.py:453-456）。
- 用户打断：`handle_interrupt` 末尾以 `"error"` 调用（manager.py:536-537）。
- 会话删除：`remove_session`（manager.py:241；scheduler.py:83-85）。
- 重复 idle 被去抖：`previous == aggregate == IDLE` 时返回 None（scheduler.py:71-73）。

### 3.3 聚合台词（`_aggregate_reaction`，scheduler.py:107-131）

优先级：无会话 → 陪伴句（110 行）；任一会话 WORKING → "还有任务在进行中"（112-113 行）；全部 SUCCESS → "所有任务都完成啦"（119-120 行）；全部 ERROR（121-122 行）；部分 ERROR（区分 1 个/多个，123-128 行）；全 idle（131 行）。**这些文案也是硬编码中文，不读 persona YAML。**

### 3.4 情绪/表情映射（`_cues_for`，scheduler.py:144-152）

聚合状态→`(emotion, expression, motion)` 表是硬编码的，且表情名全部是能天使模型的：

```python
"working": ("confident", "举起手", "Idle"),
"success": ("happy", "爱心眼", "Idle"),
"error": ("worried", "哭哭", "Idle"),
"idle": ("bored", "原皮", "Idle"),
```

反应经 `_yield_scheduler_reaction` 发出，`session_id` 固定为字符串 `"global"`（manager.py:300-324），与单会话消息区分。

---

## 4. CompanionSupervisor — 后台播报员

`backend/dionysus_server/persona/supervisor.py`（456 行）。职责：**周期性地**（非回合驱动）扫描全部会话，发现状态变动或有会话在工作中时，替"当前可见会话对应的角色"播一句报，通过广播回调推到所有 WebSocket 连接。

### 4.1 运行模式与配置（`SupervisorConfig`，supervisor.py:40-72）

```python
mode: str = "deepseek_api"  # disabled | agent_session | deepseek_api
interval_seconds: float = 15.0
adapter_id: str | None = None
api_url: str = "https://api.deepseek.com/v1/chat/completions"
api_model: str = "deepseek-reasoner"
api_key: str | None = None  # 缺省回退环境变量 DEEPSEEK_API_KEY（61 行）
```

- 持久化：JSON 文件 `<data_dir>/supervisor_settings.json`（supervisor.py:436-456），即上述 6 个键的扁平对象（`to_dict`，64-72 行）。
- REST：`GET/POST /api/settings/supervisor`（main.py:863-894）。GET 会抹掉 `api_key`（867 行）；POST 校验 `interval_seconds >= 5`（881-887 行）与 mode 枚举（888-889 行）。
- 启动：随 `SessionManager.init()` 加载设置并 `start()`（manager.py:145-155）；`mode == "disabled"` 直接不起任务（supervisor.py:142-144）。改 mode 会重启后台任务（135-140 行）。
- 广播：`emit_callback` 由 SessionManager 注入，向所有已注册连接转发（manager.py:157-175）。

### 4.2 轮询循环（`_loop`/`_tick`，supervisor.py:158-199）

每 `interval_seconds` 一次 `_tick`：

1. `_gather_snapshots`（201-221 行）：对每个会话取 `id/persona_id/status/adapter_id/updated_at` 和最后一条 user 消息（截断 200 字符，209 行）。
2. `_compute_fleet_state`（223-233 行）：统计 total/working/idle/error（`working|processing|streaming` 计 working；`error|interrupted` 计 error；其余 idle）。
3. `_detect_changes`（235-247 行）：对比上一轮快照，产出 `created`/`closed`/`"旧 -> 新"` 变动表。
4. **无变动且无会话在工作中则跳过本轮**（186-188 行）——这是"安静期不刷屏"的机制。
5. 选目标会话：优先第一个 `working` 会话，否则 `updated_at` 最新者（192-195 行）。
6. 生成台词并 `_emit`。

### 4.3 台词生成的三级实现（`_compose_line`，supervisor.py:249-259）

- **`agent_session` 模式**（`_compose_via_agent`，261-292 行）：通过 `getattr(self._session_provider, "__self__", None)` 从绑定方法反查 `SessionManager` 实例，再调其私有方法 `_get_or_create_supervisor_adapter`（manager.py:198-205，懒建并 start 一个专用 adapter，复用 `agent_settings` 里配置的 CLI）。把 `_build_prompt` 拼的提示词作为 `AgentInput` 发给该 adapter，拼接 `agent_stream` 的 chunk 直到 `agent_complete`（280-289 行）。任何一步失败回退内置模板。
- **`deepseek_api` 模式**（`_compose_via_deepseek`，294-335 行）：httpx POST OpenAI 兼容 chat completions，`max_tokens=120`、`temperature=0.8`、超时 20s；system prompt = persona 的 `system_prompt` + 一段"系统在让你播报状态"的指令（337-346 行）；user prompt 由 `_build_prompt` 生成（352-367 行：播报角色、目标会话状态、最近用户输入、fleet 摘要、变动列表）。取首行、去引号（330 行）。无 `api_key` 或请求失败回退内置模板。
- **内置模板**（`_compose_builtin`，369-397 行）：working/error/changed/idle 四种情形各一句。每句经 `_with_persona` 二选一（399-404 行）：**`persona_id == "kal'tsit"` 用克制版文案，其余一律用能天使命名风格的活泼版**——这是又一处角色硬编码。

### 4.4 下发（`_emit`，supervisor.py:406-433）

为目标的 `persona_id` 临时 new 一个 `CompanionEngine`，**固定以 `"working"` 状态解析 emotion/expression/motion**（410-412 行，直接调私有方法），然后连发 `CompanionMessage` + `EmotionUpdateMessage`（`confidence=1.0`）。也就是说 Supervisor 播报时 Live2D 表情永远是"工作中"那组 cue，与播报内容无关——这是一个已核实的行为怪癖。

---

## 5. TodoTracker — 回合 todo 提取

`backend/dionysus_server/persona/todo_tracker.py`（101 行）。每个用户回合与 CompanionEngine 一同新建（manager.py:398）。

捕获来源（`on_event`，todo_tracker.py:63-101）：

1. **`status_update`**：4 个固定 status 映射为 todo 项（11-16 行）：`thinking→("think","思考方案")`、`reading_file→("read","读取文件")`、`executing→("exec","执行操作")`、`outputting→("output","输出结果")`。新 status 出现时，把序列中**排在它之前**的项标记完成（73-82 行），再追加新项（去重）。
2. **`agent_stream`**：用正则扫流式文本——`🔧\s*调用工具[:：]?\s*(\w+)` 匹配到工具调用则新增 `调用 <tool>` 项（id 带 6 位随机后缀，86-91 行）；`🛠️\s*工具结果[:：]?` 匹配到则把最近一次工具项标完成（92-94 行）。**依赖 adapter 输出中包含这两个 emoji 标记**，属于脆弱的文本协议。
3. **`agent_complete`**：全部标完成（96-97 行）。

仅当列表实际变化时返回快照（99-101 行，`_snapshot` 逐项 `model_copy`，60-61 行），SessionManager 据此产出 `TodoUpdateMessage`（manager.py:428-433；消息模型 models.py:326-341：`TodoItem{id, text, done}`）。

---

## 6. v3 重实现要点速查

- 状态键全集：`thinking/reading_file/executing/outputting/success/error/idle/long_workflow`；聚合桶：`idle/working/success/error`。
- 消息三件套：`CompanionMessage`、`EmotionUpdateMessage`（携带 Live2D 提示）、`TodoUpdateMessage`；全局消息用 `session_id="global"` 区分。
- 所有"台词选择"都是均匀 `random.choice`，无任何去重/不重复抽选。
- 冷却：状态短语 5 秒；`work_start`/`long_workflow`/`error`/`success` 每回合各一次。
- `long_workflow` 阈值：12 秒。
- Supervisor：默认 15 秒轮询、最小 5 秒；三种 mode；设置持久化为 data 目录下 JSON。
- persona 查找：runtime 整文件覆盖 builtin，无合并。

---

## 7. 已知缺陷与 v3 改进

1. **内置默认台词全是能天使口吻**（companion_engine.py:27-58，`DEFAULT_TEMPLATES` 与 `DEFAULT_STATUS_PHRASES` 共 11 组、33 句）。任何 YAML 缺键的角色（当前 runtime 的 kal'tsit 正是如此）都会说出"啊噗噜派""老板"。v3：默认值应为与角色无关的中性文案，或干脆要求 YAML 必填并做 schema 校验。
2. **内置默认表情映射是能天使模型专属**（companion_engine.py:96-104：爱心眼/哭哭/？/出魂/举起手/原皮）。同上问题。v3：表情名应完全来自 persona 配置，代码侧不持有任何模型相关字面量。
3. **Scheduler 聚合台词与 cue 全硬编码**（scheduler.py:107-131 文案、144-152 的 `_cues_for`），且表情名同样是能天使的，全局消息对不同 persona 无区分。v3：聚合文案进配置，cue 走 persona 的表情映射。
4. **Supervisor 内置模板对 kal'tsit 特判**（supervisor.py:399-404：`_with_persona` 按 `persona_id == "kal'tsit"` 二选一文案）。v3：内置文案也应按 persona 配置提供，或用 LLM 模式统一。
5. **`_compose_via_agent` 用反射拿 SessionManager 调私有方法**（supervisor.py:273-276：`provider.__self__` + `hasattr(manager, "_get_or_create_supervisor_adapter")`）。脆弱且绕过了类型系统。v3：通过显式接口注入" supervisor 专用 agent 会话"能力。
6. **`loader._PERSONA_DIR` 在模块导入时固化**（loader.py:15-16）：进程启动后再设置/修改 `Dionysus_CONFIG_DIR` 不生效；`main.py:24-26` 还把这两个私有常量 import 进来用，放大了影响面。v3：目录解析应为运行期函数调用（`paths.py:33-54` 的 `get_config_dir()` 本身就是函数，loader 却只在 import 时调了一次）。
7. **Supervisor 播报恒用 "working" 情绪**（supervisor.py:410-412）：报错/完成播报也挂着"工作中"的表情 cue。v3：按播报语义映射情绪。
8. **YAML 声明了却无人读取的字段**：`tone_rules.keyword_replacements`、`tone_rules.random_insertions`（exusiai.yaml:37-45）、整个 `emotion_mapping`（46-76）、`corpus_file` 的值（123）、`preferred_theme`（124）、`theme_override`（125-129）。v3：要么实现，要么从 schema 删除，避免误导配置者。
9. **runtime/builtin 整文件覆盖导致配置降级**：runtime `kal'tsit.yaml` 缺台词语料，整文件屏蔽了 builtin 中更完整的版本（loader.py:24-31）。v3：逐键深合并，或明确"runtime 文件必须完整"并配校验。
10. **`get_touch_reaction` 无调用方**（companion_engine.py:230-243）：触摸交互链路只有引擎一侧，协议与端点缺失。v3：补全触摸消息类型与路由，或删除。
11. **`live2d_action` 消息定义了但从不产生**（models.py:297-309；映射 manager.py:104-109）。v3：要么让引擎直接发 `live2d_action`，要么删掉该类型，避免双通道。
12. **TodoTracker 依赖 emoji 文本协议**（todo_tracker.py:18-19）：`🔧 调用工具`/`🛠️ 工具结果` 正则扫流式 chunk，adapter 输出格式一变就静默失效。v3：从结构化的工具调用事件提取 todo。
