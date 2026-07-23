"""Unit tests for the Companion Supervisor."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest

from dionysus_server.persona.supervisor import (
    CompanionSupervisor,
    SupervisorConfig,
    _FleetState,
    load_supervisor_settings,
    save_supervisor_settings,
)


@dataclass
class FakeMessage:
    role: str
    content: str


@dataclass
class FakeSession:
    id: str
    persona_id: str
    status: str
    updated_at: float
    messages: list[Any] = field(default_factory=list)


def make_config(**overrides: Any) -> SupervisorConfig:
    defaults = {
        "mode": "disabled",
        "interval_seconds": 0.05,
        "adapter_id": None,
        "api_url": "http://localhost/v1/chat/completions",
        "api_model": "test-model",
        "api_key": None,
    }
    defaults.update(overrides)
    return SupervisorConfig(**defaults)


@pytest.mark.asyncio
async def test_disabled_mode_emits_nothing() -> None:
    emitted: list[tuple[str, str, Any]] = []

    async def emit(session_id: str, msg: Any) -> None:
        emitted.append((session_id, msg.type.value, getattr(msg.payload, "text", None)))

    async def provider() -> list[FakeSession]:
        return [FakeSession("s1", "exusiai", "idle", 1.0)]

    sv = CompanionSupervisor(config=make_config(), session_provider=provider, emit_callback=emit)
    sv.start()
    await asyncio.sleep(0.15)
    sv.stop()

    assert emitted == []


@pytest.mark.asyncio
async def test_detects_status_change_and_emits() -> None:
    emitted: list[tuple[str, str, Any]] = []

    async def emit(session_id: str, msg: Any) -> None:
        emitted.append((session_id, msg.type.value, getattr(msg.payload, "text", None)))

    state = {"status": "idle"}

    async def provider() -> list[FakeSession]:
        return [FakeSession("s1", "exusiai", state["status"], 1.0)]

    sv = CompanionSupervisor(
        config=make_config(mode="deepseek_api"),
        session_provider=provider,
        emit_callback=emit,
    )
    sv.start()
    await asyncio.sleep(0.08)

    state["status"] = "working"
    await asyncio.sleep(0.08)

    sv.stop()

    texts = [t for _, _, t in emitted if t is not None]
    assert any("任务" in t for t in texts)


@pytest.mark.asyncio
async def test_no_sessions_emits_nothing() -> None:
    emitted: list[tuple[str, str, Any]] = []

    async def emit(session_id: str, msg: Any) -> None:
        emitted.append((session_id, msg.type.value, getattr(msg.payload, "text", None)))

    async def provider() -> list[FakeSession]:
        return []

    sv = CompanionSupervisor(
        config=make_config(mode="deepseek_api"),
        session_provider=provider,
        emit_callback=emit,
    )
    sv.start()
    await asyncio.sleep(0.15)
    sv.stop()

    assert emitted == []


def test_fleet_state_summary() -> None:
    fleet = _FleetState(total=2)
    fleet.working = 1
    fleet.idle = 1
    assert "2 个会话" in fleet.summarize()


def test_settings_roundtrip(tmp_path: Any, monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "dionysus_server.persona.supervisor._supervisor_settings_path",
        lambda: tmp_path / "supervisor_settings.json",
    )
    data = {
        "mode": "agent_session",
        "interval_seconds": 30,
        "adapter_id": "kimi_cli",
        "api_url": "http://test",
        "api_model": "test",
        "api_key": "secret",
    }
    save_supervisor_settings(data)
    loaded = load_supervisor_settings()
    assert loaded["mode"] == "agent_session"
    assert loaded["interval_seconds"] == 30
