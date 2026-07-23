"""Tests for the agent adapter registry."""

from __future__ import annotations

from dionysus_server.agent_adapters.registry import AdapterRegistry


def test_codebuddy_adapter_is_registered() -> None:
    registry = AdapterRegistry()
    adapters = registry.list_adapters()
    assert "codebuddy_cli" in adapters
    assert adapters["codebuddy_cli"]["enabled"] is True
    assert adapters["codebuddy_cli"]["supports_model"] is True


def test_all_expected_adapters_are_present() -> None:
    registry = AdapterRegistry()
    adapters = registry.list_adapters()
    for adapter_id in ("kimi_cli", "claude_cli", "codex_cli", "opencode_cli", "codebuddy_cli"):
        assert adapter_id in adapters
