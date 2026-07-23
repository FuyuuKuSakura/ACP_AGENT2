# 适配器层行为规格（v2 → v3 知识提取）

> 目标读者：不了解旧代码、需要据此用 TypeScript 在 VS Code 插件中重实现适配器层的工程师。
> 本文覆盖 v2 后端 `backend/dionysus_server/agent_adapters/` 下的全部 5 个 CLI 适配器。
> 所有 `路径:行号` 引用均已对照源码逐行核实。行号基于 v2 代码库当前版本，重写时请以行为语义为准。

---

## 1. 总览：适配器 + 策略双层架构

v2 的适配器层是**两层设计**，把"进程管理"与"CLI 方言"彻底分离：

```
SessionManager（session/manager.py）
    │  持有
    ▼
AdapterRegistry（registry.py）            ← 配置驱动，按 server.yaml 实例化
    │  创建 / 按 session 克隆
    ▼
GenericCLIAdapter（generic_cli.py）       ← 通用层：子进程生命周期、逐行读 stdout、
    │  组合（构造注入）                       超时、interrupt、session 持久化
    ▼
CLIAdapterStrategy（strategy.py 及其子类） ← 策略层：每个 CLI 一个策略，负责
    ├─ KimiStrategy      （strategies/kimi.py）       build_args() 拼命令行
    ├─ ClaudeStrategy    （strategies/claude.py）     handle_line() 解析一行 stdout
    ├─ CodexStrategy     （strategies/codex.py）      extract_session_id() 抓会话 id
    ├─ OpenCodeStrategy  （strategies/opencode.py）
    └─ CodeBuddyStrategy （strategies/codebuddy.py）
```

关键事实：

- **5 个 CLI 共用一个 GenericCLIAdapter**（registry.py:93），差异全部收敛在策略类里。重写时应保持这一分层：一个进程运行器 + 每 CLI 一个解析/拼参数模块。
- 5 个策略全部继承 `JSONStreamStrategy`（strategy.py:85），即"stdout 是换行分隔的 JSON（NDJSON）"是统一假设。`JSONStreamStrategy` 自身又继承抽象基类 `CLIAdapterStrategy`（strategy.py:15）。
- **每次 send() 都新建一个子进程**，没有常驻进程（generic_cli.py:87）。会话连续性靠 CLI 自己的 session 持久化 + 适配器记住 session_id 下次传回（见 §2.4、§4）。

### 1.1 IAgentAdapter 接口契约

定义于 `base.py`。任何适配器实现（包括 v3 重写版）对上层（SessionManager）暴露的契约如下：

| 成员 | 签名 | 语义 | 出处 |
|---|---|---|---|
| `agent_id` | `@property -> str` | 适配器唯一 id，如 `'kimi_cli'`。注意它来自**策略**而非配置 key（generic_cli.py:56-58） | base.py:34-37 |
| `start()` | `async -> None` | 启动后台资源。GenericCLIAdapter 里**是空操作**，只打 debug 日志（generic_cli.py:60-61），因为进程在 send() 时才创建 | base.py:39-41 |
| `send(message)` | `async (AgentInput) -> AsyncIterator[AgentEvent]` | 发送一轮用户输入，**异步生成器**，边到边产出事件。一轮结束（成功或失败）必然以某个 `agent_complete` 事件收尾 | base.py:43-45 |
| `interrupt()` | `async -> None` | 打断当前生成。GenericCLIAdapter 的实现 = 杀掉当前子进程（generic_cli.py:173-178） | base.py:47-49 |
| `shutdown()` | `async -> None` | 清理资源 = 杀子进程（generic_cli.py:180-182） | base.py:51-53 |
| `inject_system_prompt(system_prompt, context_vars)` | `async -> None` | 可选钩子，**基类默认空实现**（base.py:55-64）。GenericCLIAdapter **没有覆写它**——即 v2 中 5 个 CLI 的 system prompt 注入实际上什么都不做。SessionManager 会在首轮调用它（manager.py:282-298），但调用落进空操作 | base.py:55-64 |

接口之外的"半官方"成员（不在 ABC 里，但 SessionManager 依赖）：

- `switch_session(session_id)`：SessionManager 用 `hasattr` 探测后调用（manager.py:723-724）。GenericCLIAdapter 的实现：替换 `self._session_id` 并杀掉当前进程（generic_cli.py:195-198）。
- `working_dir` 属性 + setter（generic_cli.py:200-206）：供运行时为某次会话改工作目录。

### 1.2 AgentInput 数据结构

`base.py:11-28`，纯数据类（非 pydantic）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `text` | `str` | 必填 | 用户输入文本 |
| `attachments` | `list[dict]` | `[]` | 附件。**GenericCLIAdapter 完全忽略它**——5 个 CLI 都没有附件通道，只有 text 被拼进命令行 |
| `mode` | `str` | `"normal"` | 模式。合法值见上游 `UserInputPayload.mode`：`"normal" / "plan" / "yolo" / "plan_yolo"`（models.py:102）。send() 里若策略不支持该 mode 则静默降级为 `"normal"`（generic_cli.py:72-74） |

### 1.3 AgentEvent 数据结构

`models.py:425-440`，pydantic 模型，适配器对上层输出的**唯一**事件类型：

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | 字面量枚举，8 种：`agent_stream` / `status_update` / `option_request` / `agent_complete` / `emotion_update` / `sticker_send` / `live2d_action` / `todo_update`（models.py:428-437） | 适配器层实际只产出前 4 种；后 4 种虽然定义在枚举里、且基类解析器会透传（strategy.py:177-188），但 5 个 CLI 策略自身从不生成 |
| `payload` | `dict[str, Any]` | 自由结构，约定见下 |
| `trace_id` | `str`，自动生成 | 链路追踪 id |
| `timestamp` | `datetime`，自动生成 | 事件时间戳 |

payload 事实标准（从各策略代码反推）：

| event.type | payload 字段 | 出处示例 |
|---|---|---|
| `agent_stream` | `chunk: str`（增量文本）、`is_final: bool`（恒为 `False`，真正的结束由 `agent_complete` 表达）、`status: str`（`"outputting"` / `"thinking"` / `"executing"`）、可选 `is_thinking: bool`（仅 CodeBuddy 思维块，codebuddy.py:157） | strategy.py:142-146 |
| `status_update` | `status: StatusEnum`、`detail: str`（UI 提示文案，如 `"正在输出回复..."`） | strategy.py:135-140 |
| `agent_complete` | `status: "success" \| "error"`；error 时附 `error_message: str`；CodeBuddy 错误时附 `duration_ms`（codebuddy.py:111-113） | generic_cli.py:155-161、166 |
| `option_request` | 枚举透传路径保留，5 个策略均不产出 | strategy.py:177-188 |

`StatusEnum` 合法值（models.py:69-75）：`thinking` / `reading_file` / `executing` / `outputting` / `error` / `idle`。

---

## 2. GenericCLIAdapter：进程生命周期规格

`generic_cli.py`（222 行）。这是重写的核心参照。

### 2.1 构造与配置读取

构造函数从 config dict 读 5 个键（generic_cli.py:31-45）：

| config 键 | 默认 | 说明 |
|---|---|---|
| `command` | `strategy.adapter_id` | CLI 可执行文件名，如 `"kimi"`、`"claude"` |
| `working_dir` | `"."` | 子进程工作目录 |
| `restart_on_crash` | `True` | **死配置**，见 §7.1 |
| `max_restart_attempts` | `3` | **死配置**，见 §7.1 |
| `request_timeout_seconds` | `120` | 单行读取超时（不是整轮超时！） |

`working_dir` 解析规则（generic_cli.py:47-54）：绝对路径原样使用；相对路径相对 **server.yaml 所在目录**（`Dionysus_CONFIG_DIR`，经 `resolve_config_path`）解析，与进程 cwd 无关。子进程启动前还会 `mkdir(parents=True, exist_ok=True)` 确保目录存在（generic_cli.py:78）。

### 2.2 send()：每次调用新建进程

完整流程（generic_cli.py:63-171）：

1. **空输入短路**：`text` 为空直接 yield `agent_complete{status:"error", error_message:"empty input"}` 并返回（generic_cli.py:64-70）。
2. **mode 降级**：mode 不在 `strategy.supports_mode` 里则置为 `"normal"`（generic_cli.py:72-74）。
3. **拼参数**：`args = strategy.build_args(text, self._session_id, mode, self._config)`（generic_cli.py:76）。**注意：当前 session_id 在拼参数时传入**，即 resume 语义由策略在命令行层面实现。
4. **spawn**：`asyncio.create_subprocess_exec(command, *args, cwd=..., stdin=PIPE, stdout=PIPE, stderr=STDOUT)`（generic_cli.py:87-94）。**stderr 合并进 stdout**——错误输出会混进 JSON 流，由策略的"未知行 fallback"兜底成 `agent_stream` 原文（见 §6）。
5. **立即关闭 stdin**（generic_cli.py:97-99）：注释说明原因——多数 agent CLI 检测到 stdin 管道打开会等待交互输入；prompt 走命令行参数，所以必须尽早关闭 stdin。重写时这是易踩的坑。
6. **命令不存在**：`FileNotFoundError` → yield `agent_complete{status:"error", error_message:"Command not found: <cmd>"}`（generic_cli.py:100-109）。
7. **逐行读 stdout**：见 §2.3。
8. **EOF 后取退出码**（generic_cli.py:145-151）：
   - 非零：yield `agent_complete{status:"error", error_message:"<agent_id> exited with code N"}`，再调 `_handle_crash_restart()`（generic_cli.py:153-163）。
   - 零：`_restart_count` 清零，yield `agent_complete{status:"success"}`（generic_cli.py:165-166）。
9. **CancelledError**：杀进程后继续抛出（generic_cli.py:168-171）。

### 2.3 stdout 逐行读取与超时

读循环（generic_cli.py:112-143）：

- 每次 `readline()` 包在 `asyncio.wait_for(..., timeout=request_timeout_seconds)` 里（generic_cli.py:115-118）。**超时粒度是"一行"**：只要 CLI 持续吐行，整轮可以无限长；静默超过 N 秒才判超时。
- 超时处理：杀进程 + yield `agent_complete{status:"error", error_message:"request timeout"}`（generic_cli.py:119-126）。
- 空字节（EOF）跳出循环（generic_cli.py:128-129）。
- 每行 `decode("utf-8", errors="replace")`、去 `\n`；空白行跳过（generic_cli.py:131-133）。
- 一行可能产出**多个事件**：`for event in strategy.handle_line(line, session_holder): yield event`（generic_cli.py:135-136）。

### 2.4 session_holder：session_id 的带外通道

`handle_line` 只返回事件列表，session_id 通过**可变 dict 带外回传**（generic_cli.py:111、139-143）：

```python
session_holder: dict[str, str | None] = {"session_id": self._session_id}
# 每行解析后：
if session_holder["session_id"] != self._session_id:
    self._session_id = session_holder["session_id"]
```

策略在 `handle_line` 内写 `session_holder["session_id"]`（strategy.py:102-104），适配器每行解析后比对并持久化到 `self._session_id`，下一次 send() 的 build_args 就能拿到它做 resume。这是刻意但隐晦的设计，v3 应改为显式返回值（见 §7.3）。

### 2.5 interrupt / shutdown / kill

- `interrupt()`：无运行中进程（`_process is None` 或已有 returncode）则打 warning 返回；否则杀进程（generic_cli.py:173-178）。被杀的进程会以非零退出码收尾，于是 send() 循环走到 §2.2 第 8 步的非零分支——**interrupt 后上层会再收到一个 `agent_complete{status:"error", error_message:"... exited with code -9"}`**，调用方需要容忍这一点。
- `_kill_process()`：`kill()`（SIGKILL，非 terminate）+ 最多等 5 秒；`ProcessLookupError` / 超时都吞掉；最后 `_process = None`（generic_cli.py:184-193）。
- `switch_session(session_id)`：换 session_id 并杀当前进程（generic_cli.py:195-198）。语义：下轮 send() 用新 id resume，**CLI 侧该 id 必须真实存在**，否则行为取决于具体 CLI。

---

## 3. registry 与 server.yaml：配置驱动注册

### 3.1 配置 schema（server.yaml `agent_adapter` 段）

实例见 `backend/config/server.yaml:15-73`。结构：

```yaml
agent_adapter:
  default: "kimi_cli"          # server.yaml:18，get_adapter() 不传 id 时的兜底
  adapters:                    # server.yaml:19，key 为适配器实例 id（可任意命名）
    kimi_cli:
      type: "kimi_code_cli"    # 类型别名，见 §3.2 映射表
      strategy: "kimi"         # 策略名，对应 _STRATEGIES 的 key
      command: "kimi"          # 可执行文件名
      model: ""                # （部分 CLI）--model 参数值；空串 = 不传
      output_format: "stream-json"
      working_dir: "../../workspace"   # 相对 server.yaml 所在目录解析
      restart_on_crash: true           # 死配置，见 §7.1
      max_restart_attempts: 3          # 死配置
      request_timeout_seconds: 120     # 单行读取超时
      enabled: true                    # 缺省视为 true（registry.py:56）
```

逐字段说明：

| 字段 | 消费位置 | 说明 |
|---|---|---|
| `type` | registry.py:67 | 适配器类型别名。历史遗留，实际只用于推策略名 |
| `strategy` | registry.py:68 | 策略名。`type` 映射为空串时用它兜底（registry.py:71） |
| `command` | generic_cli.py:34 | 可执行文件名；缺省 = 策略的 adapter_id |
| `model` | claude.py:45-47、codex（不用，见 §5.3）、opencode.py:41-43、codebuddy.py:66-68 | 模型名。空串/缺失则不加 `--model`。kimi 策略不读它 |
| `output_format` | kimi.py:26（默认 `"stream-json"`）、opencode.py:32（默认 `"json"`） | 输出格式参数。**claude/codex/codebuddy 策略不读它**（codebuddy 硬编码 `stream-json`，codebuddy.py:61） |
| `working_dir` | generic_cli.py:35、opencode.py:45-47 | 子进程 cwd。**OpenCode 额外把它拼成 `--dir` 参数**（两处都传） |
| `restart_on_crash` / `max_restart_attempts` | generic_cli.py:36-37 | 死配置，见 §7.1 |
| `request_timeout_seconds` | generic_cli.py:38-40 | 单行读超时，kimi 配 120s，其余配 600s（server.yaml:30、40、50、61、72） |
| `enabled` | registry.py:56 | `false` 时跳过实例化 |
| `default`（adapter 级） | registry.py:112 | list_adapters 元数据用 |

### 3.2 类型/策略映射表

两处硬编码字典（registry.py:25-40）：

```python
_STRATEGIES = {           # registry.py:25-31，策略名 → 策略类
    "kimi": KimiStrategy, "claude": ClaudeStrategy, "codex": CodexStrategy,
    "opencode": OpenCodeStrategy, "codebuddy": CodeBuddyStrategy,
}
_TYPE_TO_STRATEGY = {     # registry.py:33-40，type 别名 → 策略名
    "kimi_code_cli": "kimi",
    "generic_cli": "",          # 空字符串哨兵：registry.py:71 用 `or strategy_name` 兜底
    "claude_code_cli": "claude",
    "codex_cli": "codex",
    "opencode_cli": "opencode",
    "codebuddy_cli": "codebuddy",
}
```

`_build_adapter` 决策逻辑（registry.py:64-93）：

1. `type` 缺省视为 `"generic_cli"`（registry.py:67）。
2. 若 `type` 在映射表里：策略名 = 映射值 **或**（映射值为空串时）`strategy` 字段（registry.py:70-71）。若 `type` 不在表里：直接用 `strategy` 字段（registry.py:72-73）。
3. 策略名解析不出 → warning `unknown_adapter_type`，跳过（registry.py:75-82）；策略类不存在 → warning `unknown_strategy`，跳过（registry.py:84-91）。
4. 一切正常 → `GenericCLIAdapter(cfg, strategy_cls())`（registry.py:93）。**永远是 GenericCLIAdapter**，`type` 字段不改变适配器类。

### 3.3 Registry 对外行为

- **构造时即实例化全部 enabled 适配器**（registry.py:51-62）：`__init__` 里调 `load_config()` 读 `agent_adapter` 段，遍历 adapters，enabled 的立即 `_build_adapter` 存进 `self._adapters`。
- `list_adapters()`（registry.py:95-114）：返回**全部配置项**的元数据（含 disabled 的——它遍历 `self._config.adapters` 而非 `self._adapters`），每项含 `adapter_id / enabled / command / working_dir / supports_model / default`。注意 `supports_model` 是**现场实例化一个策略对象**再读属性得来的（registry.py:105），见 §7.4。
- `get_adapter(adapter_id=None)`（registry.py:116-127）：返回**共享单例**适配器；id 缺省用 `agent_adapter.default`；未知/未启用抛 `ValueError("Unknown or disabled agent adapter: ...")`。
- `create_adapter(adapter_id=None, working_dir=None)`（registry.py:129-151）：deepcopy 配置后新建**独立实例**（供每个会话隔离 working_dir 等覆盖，配置不外泄）。同样抛 ValueError。

---

## 4. 策略基类：JSONStreamStrategy 的通用解析管线

5 个策略共享同一套入口（strategy.py:92-114）。理解它是理解各策略的前提。

### 4.1 handle_line 入口

```
一行 stdout
  → _extract_json_objects(line)          # strategy.py:99
  → 得到 (objects: list[dict], remaining: str)
  → 对每个 object:
        extract_session_id(obj)          # strategy.py:102，写 session_holder
        _normalize_object(obj) → events  # strategy.py:105，策略可覆写
  → remaining 非空 → 包成 agent_stream 原文输出  # strategy.py:107-113
```

### 4.2 _extract_json_objects：一行多个 JSON

`strategy.py:56-82`。用 `json.JSONDecoder().raw_decode` 从行首**贪心连续解析多个顶层 JSON 对象**——有的 CLI 会在一行里连发多个对象，如 `{"role":"assistant"} {"role":"tool"} 残余文本`（strategy.py:59-61 的 docstring 原例）。规则：

- 跳过空白后遇到 `{` 才尝试解析；非 `{` 或 JSON 解析失败即停。
- 解析成功的 dict 依次入列；**剩余尾巴作为纯文本**（`remaining`，右 strip）。
- 返回 `(objects, remaining)`。

含义：**一行 = 0..N 个 JSON 事件 + 0..1 段裸文本**。裸文本（包括 stderr 混进来的报错）统一包成 `agent_stream{chunk: remaining + "\n", is_final: False, status: "outputting"}`（strategy.py:107-113）。

### 4.3 基类 _normalize_object（Kimi 方言，兼作全员 fallback）

`strategy.py:120-198`。识别以下形状（按优先级）：

| 分支 | 条件 | 产出 | 出处 |
|---|---|---|---|
| assistant 消息 | `role == "assistant"` | 有 `content` → **双事件**：`status_update{status:"outputting", detail:"正在输出回复..."}` + `agent_stream{chunk:content}`；有 `tool_calls` → 每个调用一条 `agent_stream{chunk:"🔧 调用工具: name(k=v, ...)\n"}` | strategy.py:132-162 |
| tool 结果 | `role == "tool"` | `agent_stream{chunk:"🛠️ 工具结果: <content>\n"}` | strategy.py:163-172 |
| meta | `role == "meta"` | **不产出事件**（session hint 已被 extract_session_id 消费） | strategy.py:173-176 |
| 协议事件透传 | `type` ∈ {`agent_stream`, `status_update`, `option_request`, `agent_complete`, `emotion_update`, `sticker_send`, `live2d_action`, `todo_update`} | 原样转为 AgentEvent；payload 取 `parsed["payload"]`，缺失时用除 `type` 外的全部字段拼一个 | strategy.py:177-188 |
| 未知形状 | 其余 | `agent_stream{chunk: json.dumps(parsed) + "\n"}`（原始 JSON 调试用） | strategy.py:189-197 |

tool_calls 的参数格式化细节（strategy.py:147-156）：`tc["function"]["arguments"]` 是 JSON 字符串，先 `json.loads` 再拼 `k=repr(v)`；解析失败则原样塞入。

**样例（根据解析逻辑重建）**——Kimi/基类方言的三种行：

```json
{"role": "assistant", "content": "好的，我来修改这个文件。"}
{"role": "assistant", "tool_calls": [{"function": {"name": "read_file", "arguments": "{\"path\": \"a.py\"}"}}]}
{"role": "tool", "content": "file contents..."}
{"role": "meta", "type": "session.resume_hint", "session_id": "sess-abc-123"}
```

---

## 5. 五个 CLI 策略逐章规格

共性先行：

- 5 个策略的 `supports_mode` 都是 `["normal", "plan", "yolo", "plan_yolo"]`（kimi.py:16-17、claude.py:18-19、codex.py:18-19、opencode.py:18-19、codebuddy.py:33-34）。
- `supports_model`：kimi = False（基类默认，strategy.py:45-48）；claude/codex/opencode/codebuddy = True（claude.py:21-23、codex.py:21-23、opencode.py:21-23、codebuddy.py:36-38）。
- plan / plan_yolo 模式 = **在 prompt 前注入前缀文本**，CLI 本身并不感知 plan mode（各策略 build_args 开头）。yolo / plan_yolo = 加"跳过确认"CLI 参数。

### 5.1 kimi（KimiStrategy，strategies/kimi.py，44 行）

**adapter_id**：`"kimi_cli"`（kimi.py:11-13）。

**build_args**（kimi.py:19-39）：

```
plan/plan_yolo → text 前加中文前缀（见下）
[-S <session_id>]（仅当 session_id 非 None）
[-y]（仅当 yolo/plan_yolo）
-p <text> --output-format <output_format>   # output_format 默认 "stream-json"
```

真实参数列表示例：

| 场景 | args |
|---|---|
| 首轮 normal，`output_format` 缺省 | `["-p", "hello", "--output-format", "stream-json"]` |
| resume + yolo | `["-S", "sess-abc", "-y", "-p", "继续", "--output-format", "stream-json"]` |

plan-mode 前缀（**中文**，原文引用，kimi.py:28-31）：

```
请进入 plan mode：先列出清晰的执行步骤和计划，得到确认后再继续实施。\n\n
```

**session 捕获**（kimi.py:41-44）：仅在 `role=="meta"` 且 `type=="session.resume_hint"` 时取 `parsed["session_id"]`。即首轮输出里的 meta 行：

```json
{"role": "meta", "type": "session.resume_hint", "session_id": "sess-abc-123"}
```

（样例为根据解析逻辑重建。）后续 send 用 `-S sess-abc-123` resume。

**行类型映射**：kimi 完全使用基类 `_normalize_object`（§4.3），共 5 类分支：assistant（content / tool_calls 两种子形状）、tool、meta、协议透传 8 种 type、未知 fallback。

**怪癖**：kimi 是 5 个策略里唯一不覆写 `_normalize_object` 的——基类解析器本质就是"kimi 方言解析器"，其余 4 个都是先匹配自己的形状、不匹配再 `super()` 落回 kimi 方言。

### 5.2 claude（ClaudeStrategy，strategies/claude.py，109 行）

**adapter_id**：`"claude_cli"`（claude.py:13-15）。`supports_model = True`。

**build_args**（claude.py:25-52）：

```
plan/plan_yolo → text 前加英文前缀
["-p", text]
+ ["--continue", "--session-id", session_id]（仅当 session_id 非空）
+ ["--model", model.strip()]（仅当 config.model 是非空字符串）
+ ["--dangerously-skip-permissions"]（恒加）
```

真实参数列表示例：

| 场景 | args |
|---|---|
| 首轮 normal，model 为空 | `["-p", "hello", "--dangerously-skip-permissions"]` |
| resume + model | `["-p", "继续", "--continue", "--session-id", "sess-1", "--model", "claude-sonnet-4-5", "--dangerously-skip-permissions"]` |

plan-mode 前缀（英文，claude.py:33-36，与 codex/opencode/codebuddy 逐字相同）：

```
Please enter plan mode: list clear execution steps first, then wait for confirmation before implementing.\n\n
```

**session 捕获**（claude.py:54-56）：无条件取 `parsed.get("session_id")`——任何带 `session_id` 字段的 JSON 行都会更新 holder。注释说明新会话由 Claude 自建 id、从输出里捕获。

**行类型映射**（`_normalize_object` 覆写，claude.py:58-109，共 3 个自有分支 + 基类 fallback）：

| type 值 | 产出 | 样例（根据解析逻辑重建） | 出处 |
|---|---|---|---|
| `content_block_delta` / `message_delta` | 有文本时双事件：`status_update{detail:"Claude 正在输出..."}` + `agent_stream{chunk:text}` | `{"type":"content_block_delta","delta":{"text":"你好"}}`（也兼容顶层 `"text"` 字段） | claude.py:63-78 |
| `tool_use` / `tool_result` | 单事件 `agent_stream{chunk:"🔧 Claude tool: <name>\n"}`，有 content 再追加 `"🛠️ result: <content>\n"` | `{"type":"tool_use","name":"Bash","content":""}` | claude.py:81-93 |
| （无 type 匹配但）顶层有字符串 `result` | `agent_stream{chunk:result}`（`--output-format json` 的结果信封） | `{"type":"result","result":"完成","session_id":"s1"}` | claude.py:96-107 |
| 其余 | 落回基类 §4.3 | — | claude.py:109 |

**怪癖**：

- resume 用 `--continue --session-id <id>` **两个参数同时给**（claude.py:43）——`--continue` 语义是"继续最近会话"，与显式 `--session-id` 叠加是旧代码的既有写法，重写时建议核实 Claude CLI 当前语义后决定是否保留。
- build_args **从不加 `--output-format`**：server.yaml 里的 `output_format: "stream-json"`（server.yaml:36）对 claude 策略是死配置。`-p` 默认输出是否真是 stream-json 取决于 CLI 自身版本。
- yolo 模式**无额外参数**——`--dangerously-skip-permissions` 本来就恒加（claude.py:49-50），normal 与 yolo 在参数层面无区别。

### 5.3 codex（CodexStrategy，strategies/codex.py，148 行）

**adapter_id**：`"codex_cli"`（codex.py:13-15）。`supports_model = True`（但实际不可选模型，见怪癖）。

**build_args**（codex.py:25-51）：

```
plan/plan_yolo → text 前加英文前缀（同 §5.2）
["exec", "--json", "--ephemeral", "--sandbox", "workspace-write"]
+ ["--dangerously-bypass-approvals-and-sandbox"]（仅 yolo/plan_yolo）
+ ["--thread", session_id]（仅当 session_id 非空）
+ [text]   # prompt 作为最后一个位置参数，无 -p
```

真实参数列表示例：

| 场景 | args |
|---|---|
| 首轮 normal | `["exec", "--json", "--ephemeral", "--sandbox", "workspace-write", "hello"]` |
| yolo + resume | `["exec", "--json", "--ephemeral", "--sandbox", "workspace-write", "--dangerously-bypass-approvals-and-sandbox", "--thread", "thr-1", "继续"]` |

**session 捕获**（codex.py:53-54）：`parsed.get("thread_id") or parsed.get("session_id")`。codex 的会话叫 rollout thread，resume 参数是 `--thread`。

**行类型映射**（`_normalize_object` 覆写，codex.py:56-148，共 4 个自有分支 + 基类 fallback）：

| type 值 | 产出 | 样例（根据解析逻辑重建） | 出处 |
|---|---|---|---|
| `agent_message` / `message` / `output` | 有内容时双事件：`status_update{detail:"Codex 正在输出..."}` + `agent_stream{chunk:content}`；content 取 `content`/`text`/`message` 首个非空 | `{"type":"agent_message","content":"修复完成"}` | codex.py:60-75 |
| `command_execution` / `command` | `agent_stream{chunk:"🔧 Codex command: <command>\n"}` | `{"type":"command_execution","command":"ls -la"}` | codex.py:77-86 |
| `tool_call` / `tool` | `agent_stream{chunk:"🔧 Codex tool: <name>(<arguments>)\n"}` | `{"type":"tool_call","name":"shell","arguments":"{\"cmd\":\"ls\"}"}` | codex.py:88-98 |
| `item.completed` | 按 `item.type` 分发：`agent_message` → `agent_stream{chunk:item.text}`；`command_execution` → `agent_stream{chunk:"🔧 Codex command: ..."}` 追加 `"🛠️ output: <aggregated_output>\n"` 和 `"exit code: <exit_code>\n"` | `{"type":"item.completed","item":{"type":"command_execution","command":"ls","aggregated_output":"a.py","exit_code":0}}` | codex.py:101-132 |
| （无匹配但）顶层字符串 `result` | `agent_stream{chunk:result}` | `{"type":"result","result":"done"}` | codex.py:135-146 |
| 其余 | 落回基类 §4.3 | — | codex.py:148 |

**怪癖**：

- `config.model` **完全不被使用**：codex.py:40-41 注释明说 `exec` 没有 `--model` 参数，model 仅用于设置页展示。但 `supports_model` 仍返回 True——UI 上可选、选了无效，是名义与实际不符。
- `--ephemeral` + `--sandbox workspace-write` 恒加（codex.py:38）：默认有沙箱；yolo 的 `--dangerously-bypass-approvals-and-sandbox` 把它整体关掉（codex.py:43-44）。
- prompt 是裸位置参数（codex.py:50），没有 `-p` 之类的旗标。

### 5.4 opencode（OpenCodeStrategy，strategies/opencode.py，126 行）

**adapter_id**：`"opencode_cli"`（opencode.py:13-15）。`supports_model = True`。

**build_args**（opencode.py:25-56）：

```
plan/plan_yolo → text 前加英文前缀（同 §5.2）
["run", "--format", output_format]      # output_format 默认 "json"
+ ["--model", model.strip()]（仅非空 model）
+ ["--dir", working_dir]（仅当 config.working_dir 非空）
+ ["--session", session_id]（仅当 session_id 非空）
+ ["--auto-approve"]（仅 yolo/plan_yolo）
+ [text]   # 位置参数
```

真实参数列表示例（config 取 server.yaml:52-62 的值）：

| 场景 | args |
|---|---|
| 首轮 normal | `["run", "--format", "json", "--dir", "../../workspace", "hello"]` |
| resume + yolo + model | `["run", "--format", "json", "--model", "gpt-4o", "--dir", "../../workspace", "--session", "s1", "--auto-approve", "继续"]` |

**session 捕获**（opencode.py:58-59）：`parsed.get("session_id") or parsed.get("session") or parsed.get("sessionID")`——兼容三种键名。

**行类型映射**（`_normalize_object` 覆写，opencode.py:61-126，共 4 个自有分支 + 基类 fallback）：

| type 值 | 产出 | 样例（根据解析逻辑重建） | 出处 |
|---|---|---|---|
| `message` / `agent_message` / `output` | 双事件：`status_update{detail:"OpenCode 正在输出..."}` + `agent_stream{chunk:content}`；content 取 `content`/`text`/`message` 首个非空 | `{"type":"message","content":"hello"}` | opencode.py:65-80 |
| `text` | 双事件（同上）；**取嵌套 `part.text`**，兼容顶层 `text` 兜底。注释：`opencode run --format json` 实际发出的就是这种 | `{"type":"text","part":{"text":"部分文本"}}` | opencode.py:82-99 |
| `tool_call` / `tool` | `agent_stream{chunk:"🔧 OpenCode tool: <name>(<arguments>)\n"}` | `{"type":"tool_call","name":"edit","arguments":"{...}"}` | opencode.py:101-111 |
| （无匹配但）顶层字符串 `result` | `agent_stream{chunk:result}` | `{"type":"result","result":"done"}` | opencode.py:113-124 |
| 其余 | 落回基类 §4.3 | — | opencode.py:126 |

**怪癖**：

- `working_dir` 被消费**两次**：GenericCLIAdapter 用它做子进程 cwd（generic_cli.py:35），opencode 策略又把它拼成 `--dir`（opencode.py:45-47）。注意 `--dir` 传的是**未解析的原始配置值**（可能是相对路径 `../../workspace`），而 cwd 是解析后的绝对路径——`--dir` 的相对基准是 CLI 自身实现细节，潜在不一致。
- `output_format` 默认是 `"json"` 而非 `"stream-json"`（opencode.py:32），与其余 CLI 不同。

### 5.5 codebuddy（CodeBuddyStrategy，strategies/codebuddy.py，198 行）

**adapter_id**：`"codebuddy_cli"`（codebuddy.py:28-30）。`supports_model = True`。

这是 5 个策略中**解析最完整、唯一有真实测试 fixture** 的一个（`backend/tests/test_codebuddy_strategy.py`，123 行），可作为 v3 重写时的验收参照。

**build_args**（codebuddy.py:44-73）：

```
plan/plan_yolo → text 前加英文前缀（同 §5.2）
["-p", text, "--output-format", "stream-json"]   # 硬编码 stream-json
+ ["--resume", session_id]（仅当 session_id 非空）
+ ["--model", model.strip()]（仅非空 model）
+ ["-y"]（恒加，跳过权限确认）
```

参数示例**来自测试 fixture**（test_codebuddy_strategy.py:19-35）：

- `build_args("hello", None, "normal", {})` → `["-p", "hello", "--output-format", "stream-json", "-y"]`
- plan 模式：`args[0]=="-p"`，`args[1]` 含 "plan mode" 与原文本，尾部固定 `["--output-format", "stream-json", "-y"]`
- `build_args("hi", "sess-1", "normal", {"model": "gpt-4o"})` → 含 `--resume sess-1` 与 `--model gpt-4o`

**session 捕获**（codebuddy.py:79-83）：仅 `type=="system"` 且 `subtype=="init"` 时取 `session_id`。测试 fixture（test_codebuddy_strategy.py:39-43）：

```json
{"type": "system", "subtype": "init", "session_id": "abc"}
```

**行类型映射**（`_normalize_object` 覆写，codebuddy.py:89-198，共 4 个顶层分支、assistant 下 4 种内容块，+ 基类 fallback）。CodeBuddy 输出格式在类 docstring 有官方清单（codebuddy.py:13-26）：

| type 值 | 产出 | 样例 | 出处 |
|---|---|---|---|
| `system`（init/status 等所有 subtype） | **零事件**，内部消费（init 的 session_id 已被 extract_session_id 拿走） | fixture：`{"type":"system","subtype":"init","session_id":"abc"}` → `[]`（test_codebuddy_strategy.py:47-50） | codebuddy.py:94-95 |
| `file-history-snapshot` | **零事件**，纯噪音 | fixture：`{"type":"file-history-snapshot","files":[]}` → `[]`（test_codebuddy_strategy.py:52-55） | codebuddy.py:98-99 |
| `result` | 仅 `is_error=true` 时产出 `agent_complete{status:"error", error_message:result, duration_ms}`；成功时**静默零事件**（成功 complete 由 GenericCLIAdapter 在进程退出码 0 后统一发，generic_cli.py:166） | fixture：`{"type":"result","is_error":true,"result":"boom"}` → 1 个 agent_complete（test_codebuddy_strategy.py:105-111）；`is_error:false` → `[]`（test_codebuddy_strategy.py:113-116） | codebuddy.py:102-116 |
| `assistant` | 遍历 `message.content[]` 内容块，见下表 | — | codebuddy.py:119-194 |
| 其余 | 落回基类 §4.3 | fixture：`{"type":"weird","data":1}` → 1 个 agent_stream 含原始 JSON（test_codebuddy_strategy.py:118-123） | codebuddy.py:198 |

`assistant` 内容块分派（样例均**来自测试 fixture**）：

| block.type | 产出 | fixture（test_codebuddy_strategy.py 行号） | 出处 |
|---|---|---|---|
| `text` | 双事件：`status_update{status:OUTPUTTING, detail:"CodeBuddy 正在输出..."}` + `agent_stream{chunk:text, status:"outputting"}` | `{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}`（57-68） | codebuddy.py:128-145 |
| `thinking` | 单事件 `agent_stream{chunk:thinking, status:"thinking", is_thinking:true}`——**唯一会打 thinking 状态的策略** | `{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"step 1"}]}}`（70-80） | codebuddy.py:147-160 |
| `tool_use` | 单事件 `agent_stream{chunk:"调用工具: <name>(k=v, ...)\n", status:"executing"}`——**唯一打 executing 状态的策略**；input 为 dict 时拼 `k=repr(v)`，否则 str() | `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"read","input":{"path":"x"}}]}}`（82-93） | codebuddy.py:162-178 |
| `tool_result` | 单事件 `agent_stream{chunk:"工具结果: <content>\n", status:"outputting"}` | `{"type":"assistant","message":{"content":[{"type":"tool_result","content":"done"}]}}`（95-103） | codebuddy.py:180-192 |

**怪癖**：

- `message.content` 不是 list 时直接丢弃整条消息（codebuddy.py:122-123）。
- `is_error` 用 `bool(parsed.get("is_error", False))` 强转（codebuddy.py:103），truthy 值（如字符串 `"false"`）也会判错。
- result 错误时的 `error_message` 兜底文案是中文 `"CodeBuddy 执行出错"`（codebuddy.py:105）。
- `output_format` 配置键对 codebuddy 无效——`--output-format stream-json` 硬编码（codebuddy.py:61），server.yaml:68 的配置是摆设。
- 工具展示文本**不带 emoji**（`"调用工具:"`、`"工具结果:"`），与基类的 `🔧`/`🛠️` 风格不同。

---

## 6. 策略间共性模式总结

重写时应提取为共享代码的模式：

1. **"文本块 → status_update + agent_stream 双事件"**：assistant 文本到达时，先发一条 `status_update{status:OUTPUTTING, detail:"<X> 正在输出..."}` 再发 `agent_stream{chunk:...}`。claude.py:66-77、codex.py:63-74、opencode.py:68-79/87-98、codebuddy.py:131-145 四处**近乎逐字重复**，仅 detail 文案和取值链不同。kimi 的等价逻辑在基类 strategy.py:135-146。
2. **content 取值链**：`content or text or message` 首个非空，codex.py:61 与 opencode.py:66 完全相同。
3. **plan-mode 前缀**：英文版在 claude.py:33-36、codex.py:33-36、opencode.py:34-37、codebuddy.py:56-59 重复 4 次，逐字相同；kimi.py:28-31 是唯一中文版。
4. **tool_call 展示**：`"🔧 <X> tool: <name>(<arguments>)\n"` 模式在 codex.py:88-98 与 opencode.py:101-111 重复。
5. **顶层 `result` 字符串信封**：claude.py:96-107、codex.py:135-146、opencode.py:113-124 三处相同的兜底分支。
6. **model 参数拼法**：`isinstance(model, str) and model.strip()` 后 `--model <stripped>`，claude.py:45-47、opencode.py:41-43、codebuddy.py:66-68 三处相同。
7. **统一的 fallback 链**：自有 `_normalize_object` 不匹配 → `super()._normalize_object`（kimi 方言）→ 再不认识 → 原始 JSON 文本流；连 JSON 都不是的行 → `_extract_json_objects` 的 remaining 通道（§4.2）。**任何输出都不会丢**，最多降级为原文展示。

---

## 7. 已知缺陷与 v3 改进建议

以下为阅读源码确认的事实，重写时**不要照抄这些行为**：

### 7.1 崩溃重启是空转（死配置 ×2）

`_handle_crash_restart`（generic_cli.py:208-222）只做三件事：检查 `restart_on_crash`、比较并递增 `_restart_count`、打日志。**没有任何重新 spawn 进程的逻辑**——而且它的调用点在 send() 非零退出分支的 `return` 之前（generic_cli.py:162-163），即使想重启也没有下一轮循环可回。成功时 `_restart_count` 清零（generic_cli.py:165）倒是真的。结论：`restart_on_crash`（server.yaml:28、38、48、59、70）与 `max_restart_attempts`（server.yaml:29、39、49、60、71）是**死配置**，v3 要么实现真重启，要么删掉。

### 7.2 registry 与 SessionManager 配置双副本

`AdapterRegistry.__init__` 自行调 `load_config()`（registry.py:52），而 `SessionManager.__init__` 也调 `load_config()`（manager.py:130）再 `AdapterRegistry()`（manager.py:132）。两份配置对象各自独立：构造后修改 server.yaml 或改 SessionManager 持有的 config，registry 那份不会变，**运行时热更新失效**。v3 应让 registry 接收注入的 config 而非自行加载。

### 7.3 session_holder 可变 dict 带外通道

`handle_line(line, session_holder)` 用可变 dict 的 key 回传 session_id（generic_cli.py:111、strategy.py:37-43）。副作用隐藏、类型签名看不出这个通道，且每行解析后都要做一次比对持久化（generic_cli.py:139-143）。v3 建议改为显式返回 `(events, session_id_or_none)`。

### 7.4 list_adapters 为读一个布尔值而实例化策略

`list_adapters()` 对每个配置项执行 `getattr(strategy_cls(), "supports_model", False)`（registry.py:105）——为读一个声明式属性，每次调用都 new 一遍策略对象。当前策略类构造无副作用所以无害，但属无谓开销；v3 中 supports_model 应是策略的静态元数据。

### 7.5 "generic_cli": "" 空字符串哨兵

`_TYPE_TO_STRATEGY["generic_cli"] = ""`（registry.py:35）依赖 `"" or strategy_name` 的短路求值兜底（registry.py:71）。能工作但隐晦：空串在这里是"无映射"的哨兵值，若 strategy 字段也缺失则走到 unknown_adapter_type 分支。v3 应用显式的 None/Optional 表达。

### 7.6 kimi_code_cli.py 是死代码（已验证）

`backend/dionysus_server/agent_adapters/kimi_code_cli.py`（358 行）定义了旧版 `KimiCodeCLIAdapter`（kimi_code_cli.py:18）——一个把进程管理与 kimi 解析硬编码在一起的单体适配器，是 GenericCLIAdapter+KimiStrategy 重构前的形态。已用 Grep 全仓验证：`KimiCodeCLIAdapter` 除自身文件外**无任何 import 或实例化**；`kimi_code_cli` 字符串仅作为 type 别名出现在 registry.py:34 和 server.yaml:21。registry 的 `"kimi_code_cli": "kimi"` 映射（registry.py:34）意味着配 `type: "kimi_code_cli"` 得到的也是 GenericCLIAdapter+KimiStrategy，旧类彻底不会被触达。v3 直接忽略该文件即可，无需迁移。

### 7.7 其他值得注意的小事实（非预期清单内，阅读时发现）

- **inject_system_prompt 对所有 CLI 是空操作**：基类默认实现什么都不做（base.py:55-64），GenericCLIAdapter 未覆写。SessionManager 首轮会调它（manager.py:282-298），异常还被静默吞掉只记日志（manager.py:295-298）。v2 中 persona 的 system prompt **实际从未到达任何 CLI**。若 v3 产品语义依赖 system prompt，需要新设计（如拼进首条 prompt）。
- **claude 策略的 yolo 与 normal 参数无区别**（§5.2 怪癖）；**codex 的 supports_model=True 但 model 不生效**（§5.3 怪癖）；**codebuddy/claude 的 output_format 配置是死配置**（§5.2、§5.5）。
- **interrupt 之后必跟一个 error 级 agent_complete**（`"... exited with code -9"`，见 §2.5），上层/前端目前需要自己消化这个伪错误。
- **stderr 并入 stdout**（generic_cli.py:93）：CLI 崩溃时的 Python traceback 等会以裸文本 `agent_stream` 形式漏到用户流里。
