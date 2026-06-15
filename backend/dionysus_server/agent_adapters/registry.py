"""Adapter registry: discovers and instantiates configured agent adapters."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import structlog

from dionysus_server.config import load_config

from .base import IAgentAdapter
from .generic_cli import GenericCLIAdapter
from .strategies import ClaudeStrategy, CodexStrategy, KimiStrategy, OpenCodeStrategy

logger = structlog.get_logger()


_STRATEGIES: dict[str, Any] = {
    "kimi": KimiStrategy,
    "claude": ClaudeStrategy,
    "codex": CodexStrategy,
    "opencode": OpenCodeStrategy,
}

_TYPE_TO_STRATEGY: dict[str, str] = {
    "kimi_code_cli": "kimi",
    "generic_cli": "",  # resolved from cfg.strategy
    "claude_code_cli": "claude",
    "codex_cli": "codex",
    "opencode_cli": "opencode",
}


class AdapterRegistry:
    """Registry that builds adapters from ``dionysus_server.config.load_config()``.

    Supports both legacy ``kimi_code_cli`` and new ``generic_cli`` style configs.
    For generic configs the ``strategy`` field (or a type alias) selects the
    per-CLI strategy.
    """

    def __init__(self) -> None:
        self._config = load_config().agent_adapter
        self._adapters: dict[str, IAgentAdapter] = {}

        for adapter_id, cfg in (self._config.adapters or {}).items():
            if not cfg.get("enabled", True):
                logger.info("adapter_disabled", adapter_id=adapter_id)
                continue

            adapter = self._build_adapter(adapter_id, cfg)
            if adapter is not None:
                self._adapters[adapter_id] = adapter

    def _build_adapter(
        self, adapter_id: str, cfg: dict[str, Any]
    ) -> IAgentAdapter | None:
        adapter_type = cfg.get("type", "generic_cli")
        strategy_name = cfg.get("strategy")

        if adapter_type in _TYPE_TO_STRATEGY:
            resolved_strategy = _TYPE_TO_STRATEGY[adapter_type] or strategy_name
        else:
            resolved_strategy = strategy_name

        if not resolved_strategy:
            logger.warning(
                "unknown_adapter_type",
                adapter_id=adapter_id,
                adapter_type=adapter_type,
                strategy=strategy_name,
            )
            return None

        strategy_cls = _STRATEGIES.get(resolved_strategy)
        if strategy_cls is None:
            logger.warning(
                "unknown_strategy",
                adapter_id=adapter_id,
                strategy=resolved_strategy,
            )
            return None

        return GenericCLIAdapter(cfg, strategy_cls())

    def list_adapters(self) -> dict[str, dict[str, Any]]:
        """Return metadata for all configured adapters."""
        result: dict[str, dict[str, Any]] = {}
        for adapter_id, cfg in (self._config.adapters or {}).items():
            strategy_name = cfg.get("strategy") or _TYPE_TO_STRATEGY.get(
                cfg.get("type", ""), ""
            )
            strategy_cls = _STRATEGIES.get(strategy_name)
            supports_model = False
            if strategy_cls is not None:
                supports_model = getattr(strategy_cls(), "supports_model", False)
            result[adapter_id] = {
                "adapter_id": adapter_id,
                "enabled": cfg.get("enabled", True),
                "command": cfg.get("command", strategy_name or adapter_id),
                "working_dir": cfg.get("working_dir", "."),
                "supports_model": supports_model,
                "default": cfg.get("default", False) or adapter_id == self._config.default,
            }
        return result

    def get_adapter(self, adapter_id: str | None = None) -> IAgentAdapter:
        """Return a configured, enabled adapter by id.

        Falls back to the ``agent_adapter.default`` value when ``adapter_id`` is
        not provided. Raises ``ValueError`` for unknown or disabled adapters.
        """
        resolved_id = adapter_id or self._config.default
        if resolved_id not in self._adapters:
            raise ValueError(
                f"Unknown or disabled agent adapter: {resolved_id!r}"
            )
        return self._adapters[resolved_id]

    def create_adapter(
        self, adapter_id: str | None = None, working_dir: str | None = None
    ) -> IAgentAdapter:
        """Create a fresh adapter instance for a specific session.

        The global configuration is copied so that per-session overrides such as
        ``working_dir`` do not leak to other sessions.
        """
        resolved_id = adapter_id or self._config.default
        cfg = self._config.adapters.get(resolved_id)
        if cfg is None:
            raise ValueError(
                f"Unknown or disabled agent adapter: {resolved_id!r}"
            )
        session_cfg = deepcopy(cfg)
        if working_dir is not None:
            session_cfg["working_dir"] = working_dir
        adapter = self._build_adapter(resolved_id, session_cfg)
        if adapter is None:
            raise ValueError(
                f"Failed to build agent adapter: {resolved_id!r}"
            )
        return adapter

    def __repr__(self) -> str:
        return f"AdapterRegistry(adapters={sorted(self._adapters)!r})"
