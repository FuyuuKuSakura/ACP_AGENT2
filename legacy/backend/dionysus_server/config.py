"""Configuration loading for Dionysus server."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import structlog
import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from dionysus_server.paths import get_config_dir

logger = structlog.get_logger()


class ServerSettings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8765
    ws_path: str = "/ws"
    static_dir: str = "./frontend/dist"
    log_level: str = "info"


class SessionSettings(BaseSettings):
    max_concurrent: int = 5
    history_limit: int = 100
    storage_backend: str = "sqlite"
    storage_path: str = "./data/sessions.db"
    ttl_seconds: int = 86400


class AgentAdapterConfig(BaseSettings):
    default: str = "kimi_cli"
    adapters: dict[str, dict[str, Any]] = Field(default_factory=dict)


class EmotionSettings(BaseSettings):
    method: str = "keyword"
    llm_model: str = "moonshot-v1-8k"
    embedding_model: str = "text-embedding-3-small"
    cache_ttl: int = 60
    confidence_threshold: float = 0.6
    cooldown_seconds: int = 5


class TTSSettings(BaseSettings):
    enabled: bool = False
    engine: str = "edge_tts"
    voice: str = "zh-CN-XiaoxiaoNeural"
    speed: float = 1.0
    auto_play: bool = True


class Live2DSettings(BaseSettings):
    sdk_version: str = "4.2"
    models_dir: str = "./assets/live2d"
    default_model: str = "exusiai"
    enable_lip_sync: bool = True
    idle_motion_interval: int = 10


class SecuritySettings(BaseSettings):
    allowed_hosts: list[str] = Field(
        default_factory=lambda: [
            "localhost",
            "127.0.0.1",
            "192.168.*.*",
        ]
    )
    max_upload_size_mb: int = 10
    enable_ast_audit: bool = True
    enable_sensitive_filter: bool = True


class DionysusConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="Dionysus_",
        env_file=".env",
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    server: ServerSettings = Field(default_factory=ServerSettings)
    sessions: SessionSettings = Field(default_factory=SessionSettings)
    agent_adapter: AgentAdapterConfig = Field(default_factory=AgentAdapterConfig)
    emotion: EmotionSettings = Field(default_factory=EmotionSettings)
    tts: TTSSettings = Field(default_factory=TTSSettings)
    live2d: Live2DSettings = Field(default_factory=Live2DSettings)
    security: SecuritySettings = Field(default_factory=SecuritySettings)


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        logger.warning("config_file_not_found", path=str(path))
        return {}
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_config(config_dir: str | Path | None = None) -> DionysusConfig:
    config_dir_path = Path(config_dir) if config_dir else get_config_dir()
    server_yaml = config_dir_path / "server.yaml"
    data = load_yaml(server_yaml)

    # Allow environment variables to override anything in server.yaml
    return DionysusConfig(**data)

