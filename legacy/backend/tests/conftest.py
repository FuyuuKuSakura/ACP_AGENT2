"""Shared pytest fixtures for Dionysus backend tests."""

from __future__ import annotations

from pathlib import Path
from typing import AsyncIterator

import pytest

from dionysus_server.agent_adapters.base import AgentInput, IAgentAdapter
from dionysus_server.config import DionysusConfig, load_config
from dionysus_server.models import AgentEvent, Session
from dionysus_server.session.store import SessionStore


@pytest.fixture
def dionysus_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> DionysusConfig:
    """Provide an isolated DionysusConfig backed by temporary directories."""
    config_dir = tmp_path / "config"
    data_dir = tmp_path / "data"
    config_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("Dionysus_CONFIG_DIR", str(config_dir))
    monkeypatch.setenv("Dionysus_DATA_DIR", str(data_dir))
    return load_config()


@pytest.fixture
def session_store(dionysus_config: DionysusConfig, tmp_path: Path) -> SessionStore:
    """Provide an initialised SessionStore using a temporary SQLite database."""
    dionysus_config.sessions.storage_path = str(tmp_path / "sessions.db")
    store = SessionStore(dionysus_config)
    return store


class FakeAdapter(IAgentAdapter):
    """In-memory adapter for testing SessionManager without real CLI tools."""

    def __init__(self, adapter_id: str = "fake_cli") -> None:
        self._adapter_id = adapter_id
        self.inputs: list[AgentInput] = []
        self.started = False
        self.shut_down = False

    @property
    def agent_id(self) -> str:
        return self._adapter_id

    async def start(self) -> None:
        self.started = True

    async def send(self, message: AgentInput) -> AsyncIterator[AgentEvent]:
        self.inputs.append(message)
        yield AgentEvent(
            type="agent_stream",
            payload={"chunk": f"echo: {message.text}", "is_final": True},
        )
        yield AgentEvent(
            type="agent_complete",
            payload={"status": "success"},
        )

    async def interrupt(self) -> None:
        pass

    async def shutdown(self) -> None:
        self.shut_down = True


@pytest.fixture
def fake_adapter() -> FakeAdapter:
    return FakeAdapter()


@pytest.fixture
def sample_session() -> Session:
    return Session(id="session-1", title="Test Session")
