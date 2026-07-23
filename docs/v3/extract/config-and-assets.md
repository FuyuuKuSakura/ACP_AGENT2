# 配置 schema 与资产清单（config / themes / personas / Live2D 知识提取）

> 目标读者：不了解 Dionysus v2（Python FastAPI）旧代码、要在 v3（VS Code 插件，TypeScript）中重实现配置与资产体系的工程师。
> 本文所有行号均已对照当前仓库源码核实；YAML 片段均从实际文件原样复制。配置键名与代码标识符保留英文原文。

## 1. 环境变量与路径推导

路径解析集中在 `backend/dionysus_server/paths.py`（81 行），语义：

- **`Dionysus_CONFIG_DIR`**：静态配置根目录。未设置时默认 `<源码树>/backend/config`（paths.py:33-42，`get_config_dir()`，`_SOURCE_ROOT` 在 paths.py:15 定义为 `paths.py` 的上两级即 `backend/`）。Electron 打包版应把它指向可写位置（如 `userData/config`，见 paths.py:36-37 注释）。
- **`Dionysus_DATA_DIR`**：运行时数据目录。未设置时默认 `<config_dir>/../data`（paths.py:45-54，`get_data_dir()`），即源码树 `backend/data`。存放 SQLite 会话库、wallpaper、三份运行时 JSON 设置等。
- 相对路径解析助手：`resolve_config_path`（paths.py:57-68，相对路径以 config 目录为基准）与 `resolve_data_path`（paths.py:71-81，以 data 目录为基准）。`server.yaml` 里的相对路径因此与进程 CWD 无关。

data 目录下已知的运行时文件：

| 文件 | 写出位置 | 内容 |
|---|---|---|
| `sessions.db` | `session/store.py:45`（`resolve_data_path(config.sessions.storage_path)`） | SQLite 会话存储 |
| `server_settings.json` | `main.py:40-41` | 运行时覆盖：当前只有 `history_limit`（main.py:57-66） |
| `agent_settings.json` | `main.py:44-45` | 运行时覆盖：按 adapter_id 合并进 `agent_adapter.adapters`（main.py:69-80） |
| `wallpaper_settings.json` | `main.py:48-49` | 壁纸 url/opacity/blur/brightness（默认值 main.py:52-54, 112-118） |
| `supervisor_settings.json` | `persona/supervisor.py:436-439` | Supervisor 配置（见 persona.md 第 4 节） |
| pairing 数据 | `main.py:897`（`PairingManager(get_data_dir())`） | 设备配对 token |

**注意**：运行时 JSON 覆盖在 `load_config()` 之后、创建 app 时静默合并（main.py:142-144），优先级高于 `server.yaml`，且不回写 YAML——同一份配置有两个真实来源。

---

## 2. server.yaml 全字段 schema

### 2.1 实际文件全文（`backend/config/server.yaml`，113 行，原样引用）

```yaml
server:
  host: "0.0.0.0"
  port: 8765
  ws_path: "/ws"
  static_dir: "../frontend/dist"
  log_level: "info"

sessions:
  max_concurrent: 5
  history_limit: 50
  storage_backend: "sqlite"
  storage_path: "./data/sessions.db"
  ttl_seconds: 86400

agent_adapter:
  # working_dir 为相对路径时，以本配置文件所在目录（backend/config）为基准。
  # "../../workspace" 解析到仓库根目录的 workspace/ 文件夹。
  default: "kimi_cli"
  adapters:
    kimi_cli:
      type: "kimi_code_cli"
      strategy: "kimi"
      command: "kimi"
      # Kimi Code CLI prompt mode with stream-json output.
      # The adapter builds args per message: [-S, <session_id>, -p, <text>, --output-format, stream-json]
      output_format: "stream-json"
      working_dir: "../../workspace"
      restart_on_crash: true
      max_restart_attempts: 3
      request_timeout_seconds: 120
    claude_cli:
      type: "claude_code_cli"
      strategy: "claude"
      command: "claude"
      model: ""
      output_format: "stream-json"
      working_dir: "../../workspace"
      restart_on_crash: true
      max_restart_attempts: 3
      request_timeout_seconds: 600
      enabled: true
    codex_cli:
      type: "codex_cli"
      strategy: "codex"
      command: "codex"
      model: ""
      working_dir: "../../workspace"
      restart_on_crash: true
      max_restart_attempts: 3
      request_timeout_seconds: 600
      enabled: true
    opencode_cli:
      type: "opencode_cli"
      strategy: "opencode"
      command: "opencode"
      model: ""
      output_format: "json"
      working_dir: "../../workspace"
      restart_on_crash: true
      max_restart_attempts: 3
      request_timeout_seconds: 600
      enabled: true
    codebuddy_cli:
      type: "codebuddy_cli"
      strategy: "codebuddy"
      command: "codebuddy"
      model: ""
      output_format: "stream-json"
      working_dir: "../../workspace"
      restart_on_crash: true
      max_restart_attempts: 3
      request_timeout_seconds: 600
      enabled: true

emotion:
  method: "keyword"
  llm_model: "moonshot-v1-8k"
  embedding_model: "text-embedding-3-small"
  cache_ttl: 60
  confidence_threshold: 0.6
  cooldown_seconds: 5

tts:
  enabled: false
  engine: "edge_tts"
  voice: "zh-CN-XiaoxiaoNeural"
  speed: 1.0
  auto_play: true

live2d:
  sdk_version: "4.2"
  models_dir: "./assets/live2d"
  default_model: "exusiai"
  enable_lip_sync: true
  idle_motion_interval: 10

# Connection / remote access (reserved for future Electron / relay / intranet-penetration)
# connection:
#   public_endpoint: ""
#   relay:
#     enabled: false
#     endpoint: ""
#     public_key: ""

security:
  allowed_hosts:
    - "localhost"
    - "127.0.0.1"
    - "192.168.*.*"
  max_upload_size_mb: 10
  enable_ast_audit: true
  enable_sensitive_filter: true
```

### 2.2 pydantic 模型逐字段（`backend/dionysus_server/config.py`，110 行）

加载链：`load_config()` 读 `<config_dir>/server.yaml` 后用 `DionysusConfig(**data)` 构造（config.py:103-109）；`DionysusConfig` 同时是 pydantic-settings `BaseSettings`，环境变量前缀 `Dionysus_`、嵌套分隔符 `__`、读 `.env`、`extra="ignore"`（config.py:77-84），即 `Dionysus_server__port=9000` 这类环境变量可覆盖 YAML。

**server（`ServerSettings`，config.py:18-23）**

| 字段 | 类型 | 默认值（代码） | YAML 值 | 实际读取处 |
|---|---|---|---|---|
| `host` | str | `"0.0.0.0"` | 同 | `__main__.py:14`（uvicorn host）；也用于拼接展示 URL（main.py:785, 802, 816） |
| `port` | int | `8765` | 同 | `__main__.py:15` |
| `ws_path` | str | `"/ws"` | 同 | `main.py:903`（`@app.websocket(config.server.ws_path)`） |
| `static_dir` | str | `"./frontend/dist"` | `"../frontend/dist"` | `main.py:1080-1088`（`resolve_config_path` 后挂 StaticFiles；YAML 的相对路径以 `backend/config` 为基准解析到 `frontend/dist`，代码默认值 `./frontend/dist` 若生效则会解析到 `backend/config/frontend/dist`，两者基准不同，见第 6 节缺陷） |
| `log_level` | str | `"info"` | 同 | `__main__.py:16`（uvicorn log_level） |

**sessions（`SessionSettings`，config.py:26-31）**

| 字段 | 类型 | 默认值（代码） | YAML 值 | 实际读取处 |
|---|---|---|---|---|
| `max_concurrent` | int | `5` | 同 | `session/manager.py:133, 209-214`（超限驱逐最旧会话） |
| `history_limit` | int | `100` | `50` | 经 `GET/POST /api/settings/server` 读写（main.py:758-779），并被 `server_settings.json` 运行时覆盖（main.py:63-64） |
| `storage_backend` | str | `"sqlite"` | 同 | **声明后从未被读取**（grep 全仓库无消费方） |
| `storage_path` | str | `"./data/sessions.db"` | 同 | `session/store.py:45`（`resolve_data_path`，相对路径以 data 目录为基准） |
| `ttl_seconds` | int | `86400` | 同 | **声明后从未被读取** |

**agent_adapter（`AgentAdapterConfig`，config.py:34-36）**

| 字段 | 类型 | 默认值 | 实际读取处 |
|---|---|---|---|
| `default` | str | `"kimi_cli"` | `session/manager.py:247`（会话未指定 adapter 时使用） |
| `adapters` | `dict[str, dict[str, Any]]` | `{}` | `session/manager.py:252`（`create_adapter`）；`main.py:69-80` 用 `agent_settings.json` 逐 adapter `cfg.update(overrides)` 合并运行时覆盖 |

`adapters.<id>` 子键无 pydantic 校验，是自由 dict。从 YAML 与实际 adapter 代码归纳的键：`type`/`strategy`/`command`/`model`/`output_format`/`working_dir`（相对路径以 config 目录为基准，见 server.yaml:16-17 注释）/`restart_on_crash`/`max_restart_attempts`/`request_timeout_seconds`/`enabled`。注意 `kimi_cli` 没有 `enabled` 键（server.yaml:20-30），其余四个有。

**emotion（`EmotionSettings`，config.py:39-45）、tts（`TTSSettings`，config.py:48-53）、live2d（`Live2DSettings`，config.py:56-61）、security（`SecuritySettings`，config.py:64-74）**

**这四个 settings 类整体声明后从未被读取。** 已用 grep 核实：除 config.py 自身定义外，`emotion.`/`tts.`/`live2d.`/`security.` 的配置访问在 `backend/dionysus_server/` 下零命中。逐字段列出仅供 v3 决定去留：

- `emotion`: `method="keyword"`, `llm_model="moonshot-v1-8k"`, `embedding_model="text-embedding-3-small"`, `cache_ttl=60`, `confidence_threshold=0.6`, `cooldown_seconds=5`（config.py:39-45）。实际情绪判断是 persona 引擎的确定性映射，从未走 LLM/embedding。
- `tts`: `enabled=false`, `engine="edge_tts"`, `voice="zh-CN-XiaoxiaoNeural"`, `speed=1.0`, `auto_play=true`（config.py:48-53）。TTS 未实现。
- `live2d`: `sdk_version="4.2"`, `models_dir="./assets/live2d"`, `default_model="exusiai"`, `enable_lip_sync=true`, `idle_motion_interval=10`（config.py:56-61）。实际模型目录走的是 `personas/live2d/` 静态挂载（见第 4、5 节），`./assets/live2d` 不存在。
- `security`: `allowed_hosts=["localhost","127.0.0.1","192.168.*.*"]`, `max_upload_size_mb=10`, `enable_ast_audit=true`, `enable_sensitive_filter=true`（config.py:64-74）。上传接口未做大小校验，无 AST 审计与敏感词过滤实现。

---

## 3. 主题 YAML schema 与 ThemeManager

### 3.1 主题清单

`backend/config/themes/` 下共 3 个主题：`default_dark.yaml`、`default_light.yaml`、`tech_flat.yaml`。ThemeManager 认定 `default_dark`/`default_light` 为内置（`_BUILTIN_THEME_IDS`，theme_manager.py:17），内置主题禁止覆盖/删除（100-101, 132-133 行）。

### 3.2 schema 与校验

顶层键固定为 `{id, name, mode, fonts, colors, assets}`（`_THEME_SCHEMA_KEYS`，theme_manager.py:18）。`validate_theme`（59-92 行）规则：

- 6 个顶层键缺一不可（63-65 行）；
- `mode` 必须是 `light`/`dark`/`auto`（66-67 行）；
- `colors` 必须包含 18 个必需色值（69-91 行）：`primary, primaryHover, accent, background, chatBackground, userBubble, agentBubbleLight, agentBubbleDark, textPrimaryLight, textPrimaryDark, textSecondary, system, danger, success, codeBackgroundLight, codeBackgroundDark, borderLight, borderDark`。

自定义 theme_id 只允许 `[a-z0-9_\-]+`（25-26 行）。

### 3.3 default_dark.yaml 全文（28 行，原样引用）

```yaml
id: default_dark
name: "默认暗色"
mode: dark
fonts:
  body: '"Inter", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
  code: '"JetBrains Mono", "Fira Code", "SF Mono", monospace'
colors:
  primary: "#FFC940"
  primaryHover: "#FFD966"
  accent: "#E6B130"
  background: "#1A1B1F"
  chatBackground: "transparent"
  userBubble: "#FFC940"
  agentBubbleLight: "#ffffff"
  agentBubbleDark: "rgba(255, 255, 255, 0.06)"
  textPrimaryLight: "#1d1d1f"
  textPrimaryDark: "#f5f5f7"
  textSecondary: "#9ca3af"
  system: "#6b7280"
  danger: "#ef4444"
  success: "#22c55e"
  codeBackgroundLight: "#f4f4f5"
  codeBackgroundDark: "#0c0c0e"
  borderLight: "#e5e5e7"
  borderDark: "rgba(255, 255, 255, 0.10)"
assets:
  manifestThemeColor: "#1A1B1F"
  manifestBackgroundColor: "#1A1B1F"
```

### 3.4 其余主题差异色值（fonts 段三者相同）

**default_light**（`backend/config/themes/default_light.yaml:7-28`）：

```yaml
colors:
  primary: "#E6B130"
  primaryHover: "#FFC940"
  accent: "#D4A028"
  background: "#f5f5f7"
  chatBackground: "#ffffff"
  userBubble: "#FFC940"
  agentBubbleLight: "#ffffff"
  agentBubbleDark: "#f4f4f5"
  textPrimaryLight: "#1d1d1f"
  textPrimaryDark: "#f5f5f7"
  textSecondary: "#6b7280"
  system: "#9ca3af"
  danger: "#ef4444"
  success: "#22c55e"
  codeBackgroundLight: "#f4f4f5"
  codeBackgroundDark: "#1f2937"
  borderLight: "rgba(0, 0, 0, 0.06)"
  borderDark: "rgba(255, 255, 255, 0.1)"
assets:
  manifestThemeColor: "#f5f5f7"
  manifestBackgroundColor: "#ffffff"
```

**tech_flat**（`backend/config/themes/tech_flat.yaml:7-28`，`mode: dark`）：

```yaml
colors:
  primary: "#3b82f6"
  primaryHover: "#60a5fa"
  accent: "#06b6d4"
  background: "#0a0f1a"
  chatBackground: "#0f172a"
  userBubble: "#3b82f6"
  agentBubbleLight: "#ffffff"
  agentBubbleDark: "rgba(30, 41, 59, 0.72)"
  textPrimaryLight: "#0f172a"
  textPrimaryDark: "#e2e8f0"
  textSecondary: "#94a3b8"
  system: "#64748b"
  danger: "#ef4444"
  success: "#22c55e"
  codeBackgroundLight: "#f1f5f9"
  codeBackgroundDark: "#020617"
  borderLight: "rgba(0, 0, 0, 0.08)"
  borderDark: "rgba(148, 163, 184, 0.16)"
assets:
  manifestThemeColor: "#0a0f1a"
  manifestBackgroundColor: "#0a0f1a"
```

### 3.5 ThemeManager 行为（`backend/dionysus_server/theme_manager.py`，141 行）

- **加载**：主题目录为 `<config_dir>/themes`（21-23 行）。`list_themes` 扫 `*.yaml`、注入 `builtin` 布尔标志返回（29-43 行）；`get_theme` 读单个文件，解析失败返回 None（46-56 行）。**主题只从磁盘读取，无缓存，每次 API 调用重新 parse。**
- **保存**：`save_theme`（95-127 行）——拒绝内置 id → 校验 id 字符集 → 强制把 URL 里的 theme_id 写入 `data["id"]`（105 行，body 中的 id 被忽略）→ schema 校验 → 若目标文件已存在，先复制为 `<id>.yaml.bak` 备份（114-117 行）→ `yaml.safe_dump` 写盘。
- **删除**：`delete_theme`（130-141 行）——内置拒绝，文件不存在报错。
- REST 端点：`GET /api/themes`、`GET /api/themes/{id}.json`、`POST /api/themes/{id}`、`DELETE /api/themes/{id}`（main.py:148-176）。

---

## 4. persona 目录约定

### 4.1 目录结构（`backend/config/personas/`）

```
personas/
├── exusiai.yaml            # 运行时 persona（优先于 builtin）
├── kal'tsit.yaml
├── test_char.yaml
├── web_char.yaml
├── avatars/                # 用户上传头像，<persona_id>.<ext>；_default.png 为兜底
│   └── _default.png
├── default_avatars/        # 内置默认头像
│   ├── exusiai.png
│   └── kaltsit.png         # 注意：文件名是 kaltsit，与 persona id "kal'tsit" 不一致
├── corpus/                 # 运行时语料，约定文件名 <persona_id>.txt
│   └── web_char.txt
├── builtin/                # 内置 persona（被 runtime 同 id 文件整份覆盖）
│   ├── exusiai.yaml
│   ├── kal'tsit.yaml
│   └── corpus/
│       ├── exusiai.txt     # 67 行角色语料
│       └── kal'tsit.txt
└── live2d/                 # Live2D 模型，按 persona id 分目录
    ├── exusiai/            # 32 个文件，2.2M
    ├── kal'tsit/           # 36 个文件，13M（含 wav 语音与 VTube 扩展字段）
    └── kal'tsit.old/       # 15 个文件，9.3M，遗留旧版
```

### 4.2 约定规则

- **加载**：runtime 整文件覆盖 builtin，见 persona.md 第 1.1 节（loader.py:24-31）。
- **头像**：上传存 `avatars/<id>.<ext>`；`GET /api/personas/{id}/avatar` 的回退链由 `_find_default_avatar_source` 实现（main.py:200-225）：① `default_avatars/<id>.png` → ② 硬编码的仓库根目录 Live2D 贴图（`exusiai_live2d/00.4096/texture_00.png`、`kal'tsit_live2d/凯尔希直播版1.4096/texture_00.png`，main.py:213-217）→ ③ 任意可用贴图 → ④ `_ensure_default_avatar` 生成 64×64 灰色 PNG（Pillow 不可用时写 1×1 透明 PNG 字节，main.py:236-253）。
- **语料**：`GET/POST /api/personas/{id}/corpus` 读写 `personas/corpus/<id>.txt`，builtin 语料为只读回退（main.py:489-493, 506-511）。**注意语料路径是按 id 约定的，persona YAML 里 `corpus_file` 字段的值不被解析。**
- **运行时 persona 生成**：`_ensure_runtime_persona_yaml`（main.py:178-190）在需要写盘时把 builtin YAML 复制为 runtime 文件；新建 persona 时 `_build_default_persona_yaml`（main.py:263-318）生成一份最小但完整的 YAML（含 companion.live2d/touch_zones/status_to_emotion 全套默认，test_char.yaml 就是它产物的实例）。
- **Live2D 绑定**：`POST /api/personas/{id}/live2d` 接收整个模型文件夹上传（多文件），写入 `personas/live2d/<id>/`，自动找第一个 `.model3.json` 作为入口并把 `companion.live2d.model_path` 写回 persona YAML（main.py:558-627）；`DELETE` 删除目录并移除 `model_path`（main.py:629-662）；`POST .../live2d/scale` 写 `scale`，钳制 0.1–3.0（main.py:664-698）。
- **静态服务**：`personas/live2d` 目录挂载在 URL `/personas/live2d`（main.py:1083-1087），因此 YAML 中的 `model_path`（如 `/personas/live2d/exusiai/00.model3.json`）是同源 URL；前端 `Live2DViewer` 经 `GET /api/personas/{id}/companion`（main.py:407-413）取到该路径后加载，失败时回退 `frontend/public` 内的 `/exusiai_live2d/00.model3.json`（Live2DViewer.tsx:16, 83-86）。

---

## 5. Live2D 资产清单

### 5.1 副本分布（已用 diff/du 核实）

| 位置 | 文件数 | 体积 | 与仓库根目录版本的关系 |
|---|---|---|---|
| `exusiai_live2d/`（仓库根） | 33 | 2.2M | 源副本 |
| `kal'tsit_live2d/`（仓库根） | 16 | 9.3M | 源副本（model3.json 为 30 行极简版） |
| `backend/config/personas/live2d/exusiai/` | 32 | 2.2M | 与根目录逐文件相同（仅少 `.DS_Store`） |
| `backend/config/personas/live2d/kal'tsit/` | 36 | 13M | **与根目录不同**：model3.json 为 286 行 VTube 扩展版，且多 8 个 `.wav` 语音与更多 motion3 文件 |
| `backend/config/personas/live2d/kal'tsit.old/` | 15 | 9.3M | model3.json 与根目录极简版相同，遗留旧目录 |
| `frontend/public/exusiai_live2d/` | 32 | 2.2M | 与根目录逐文件相同（仅少 `.DS_Store`），作前端 fallback |
| `frontend/public/kal'tsit_live2d/` | 15 | 9.3M | 与根目录逐文件相同（仅少 `.DS_Store`） |

实际生效路径：后端挂载 `personas/live2d`（main.py:1083-1087），所以线上加载的是 `backend/config/personas/live2d/` 下的副本；`frontend/public/` 副本仅作 fallback（Live2DViewer.tsx:16）；仓库根目录副本只被头像回退逻辑引用（main.py:213-217）。三份拷贝无同步机制。

### 5.2 能天使模型（exusiai）`00.model3.json` 引用结构

`exusiai_live2d/00.model3.json`（131 行）`FileReferences`：

- `Moc`: `00.moc3`（模型本体）
- `Textures`: `00.4096/texture_00.png`（单贴图 4096）
- `Physics`: `00.physics3.json`
- `DisplayInfo`: `00.cdi3.json`
- `Expressions`: 24 个表情，全部位于 `expressions/*.exp3.json`：`o.o、举起手、光环、光环亮灯、光环跑马灯、兔女郎、出魂、原皮、吐血、哭哭、喂我花生、天使翅膀、恶魔翅膀、手机发光、拿手机、持花、爱心眼、白旗、白裙、胸前手、脸红、西装、饭碗、？`
- `Motions`: 仅 `Idle` 组一个动作 `motions/idle.motion3.json`
- `Groups`: `EyeBlink`（ParamEyeLOpen/ParamEyeROpen）、`LipSync`（Ids 为空，即唇形同步未接线）
- 附带 `00.vtube.json`（VTube Studio 参数配置）与 `items_pinned_to_model.json`，后端/前端均未解析。

与 persona YAML 的对应：exusiai.yaml 的 `expressions` 映射值（爱心眼/哭哭/？/出魂/举起手/原皮/脸红）全部存在于上述 24 个表情中，可用。

### 5.3 凯尔希模型（kal'tsit）`凯尔希直播版1.model3.json` 引用结构

存在**两个不同版本**的入口文件：

**A. 极简版**（`kal'tsit_live2d/凯尔希直播版1.model3.json` 及 `frontend/public/`、`kal'tsit.old/` 副本，30 行）：

- `Moc`: `凯尔希直播版1.moc3`；`Textures`: `凯尔希直播版1.4096/texture_00.png`；`Physics`: `凯尔希直播版1.physics3.json`；`DisplayInfo`: `凯尔希直播版1.cdi3.json`
- **没有 `Expressions` 和 `Motions` 段**；`Groups` 有 `LipSync`（空）与 `EyeBlink`（6 个参数含前发/侧发/后发）。
- 根目录下散放 9 个 `.motion3.json`（分针旋转、烦躁、叹气、待机动耳朵、我的愿望、惊讶、疑问、lenghan、M3待机），但 model3.json 不声明它们，Cubism 加载器不会发现。

**B. VTube 扩展版**（`backend/config/personas/live2d/kal'tsit/凯尔希直播版1.model3.json`，286 行，**线上实际加载的就是它**）：

- 基础引用同上（Moc/Textures/Physics），另有非标准 `PhysicsV2` 段。
- `Motions` 分三组：`Idle`（待机 `daiji(gai)`、时间 `分针旋转`）、`Tick`（办公打盹、闲置、M3闲置）、`戳戳`（戳头、烦躁、感谢、惊讶、冷汗、猫猫脸、叹气、无语、信赖、疑问、我的愿望，共 11 个），多数动作带 `Sound`（`.wav`）、`Priority`、`Text`/`TextDelay` 及自定义 `Intimacy`（好感度 Min/Bonus）扩展字段。
- `Controllers`：EyeBlink（500–6000ms 随机眨眼）、LipSync Gain 5.0、MouseTracking、AutoBreath、ExtraMotion、Accelerometer、FaceTracking 等 VTube Studio 风格控制器声明。
- `HitAreas`：11 个点击区域（pen/biji/刘海/左右发/左右耳/zhongbiao/右文件/touding/zhuomian/face4）→ 映射到 `戳戳:*` 动作。
- 同目录 8 个 `.wav` 语音（戳一下/感谢/闲置/信赖触摸/我的愿望/醒过来/猫猫脸/M3），合计约 3.3M。

与 persona YAML 的对应（**两处失配，已核实**）：kal'tsit.yaml 的 `expressions` 映射到 微笑/叹气/惊讶/烦躁/冷静——B 版 model3.json 没有 `Expressions` 段，这些表情在模型侧不存在，表情切换会静默无效；`motions.nod` 映射的 `待机动耳朵.motion3.json` 文件只存在于根目录副本和 `kal'tsit.old/`，不在 B 版目录中。

### 5.4 前端运行依赖

`frontend/public/live2dcubismcore.min.js`：Cubism 4 SDK for Web 的 core runtime（pixi-live2d-display 依赖它）。另有一个 `frontend/public/exusiai_idle.webm` 待机动画视频（非 Live2D 体系）。

### 5.5 许可证注意事项

- 两个 Live2D 模型目录及整个仓库中**均无任何 LICENSE/README 文件**（已用 find 核实）。模型为《明日方舟》角色（能天使、凯尔希）的同人/拆包衍生资产，版权归属鹰角网络，**不可随 v3 插件分发到商店或公开仓库**，v3 应改为用户自备模型的加载机制。
- `live2dcubismcore.min.js` 受 Live2D Cubism SDK 许可约束（专有软件，再分发需遵循 Live2D 的 SDK License Agreement），v3 若上架 VS Code Marketplace 需重新评估合规性。

---

## 6. 已知缺陷与 v3 改进

1. **四个 settings 类声明后从未被读取**：`EmotionSettings`（config.py:39-45）、`TTSSettings`（48-53）、`Live2DSettings`（56-61）、`SecuritySettings`（64-74），以及 `SessionSettings.storage_backend`（29 行）与 `SessionSettings.ttl_seconds`（31 行）。server.yaml 中对应段落（server.yaml:75-113）是纯装饰，会误导配置者以为能生效。v3：删除或实现，并加"配置键必须被消费"的校验。
2. **代码默认值与 YAML 值不一致**：`history_limit` 代码默认 100（config.py:28）而 YAML 写 50（server.yaml:10）；`static_dir` 代码默认 `./frontend/dist`（config.py:22）与 YAML 的 `../frontend/dist`（server.yaml:5）相对基准不同（YAML 值以 `backend/config` 为基准解析，见 main.py:1080 与 paths.py:57-68），删掉 YAML 该行反而得到错误路径。v3：单一默认值来源。
3. **配置有三个写入来源且不回写**：`server.yaml` → 环境变量（`Dionysus_` 前缀，config.py:77-84）→ data 目录下的 `server_settings.json`/`agent_settings.json` 运行时覆盖（main.py:57-80）。排查"为什么配置没生效"需要看三处。v3：统一为 VS Code settings + 单一 workspace 覆盖层。
4. **`loader._PERSONA_DIR` 导入期固化**：`Dionysus_CONFIG_DIR` 在模块导入后再修改不生效（loader.py:15-16；main.py:24-26 还 import 了这两个私有常量）。详见 persona.md 第 7 节。v3：路径一律运行期解析。
5. **Live2D 资产三份拷贝、内容已分叉**：根目录 / `backend/config/personas/live2d/` / `frontend/public/` 各存一份；kal'tsit 的后端副本（286 行 VTube 版）与其余两份（30 行极简版）已不是同一文件，且无同步机制；另有遗留目录 `kal'tsit.old/` 与 `.DS_Store` 噪音。v3：单一资产来源 + 明确的模型包格式（zip/目录约定）。
6. **persona YAML 与模型资产失配未被校验**：kal'tsit 的表情名（微笑/叹气/…）在其 model3.json 中不存在，`motions.nod` 指向的 `待机动耳朵.motion3.json` 不在生效目录（见 5.3）。引擎回退逻辑会静默吞掉这些错误。v3：加载时交叉校验 YAML 引用与 model3.json 声明，缺失即告警。
7. **头像回退硬编码仓库根路径**：`_find_default_avatar_source` 写死了 `exusiai_live2d/...`、`kal'tsit_live2d/...` 相对仓库根的路径（main.py:213-217），且 `default_avatars/kaltsit.png` 文件名与 persona id `kal'tsit` 不一致（导致 ② 号回退才会命中）。v3：头像解析走 persona 配置，不写死角色名。
8. **安全声明无实现**：`allowed_hosts`（含 `"192.168.*.*"` 通配）、`max_upload_size_mb`、`enable_ast_audit`、`enable_sensitive_filter`（config.py:64-74）均无对应中间件/校验，上传接口（main.py:558-627）不检查文件大小与类型。v3：上传白名单 + 大小限制必须真实落地。
9. **语料路径双轨**：YAML 声明 `corpus_file`（exusiai.yaml:123）但代码按 `<id>.txt` 约定查找（main.py:491-493），两者不一致时以约定为准、字段成摆设。v3：二选一。
10. **版权风险**：全部 Live2D 模型与语料为第三方 IP 衍生资产且无许可文件（见 5.5）。v3 架构应把"角色资产"设计成用户侧数据，而非随产品分发。
