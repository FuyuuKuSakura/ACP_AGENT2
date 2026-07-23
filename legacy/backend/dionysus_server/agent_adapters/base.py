"""Abstract base class for all Agent adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

from dionysus_server.models import AgentEvent


class AgentInput:
    """Input sent from the session manager to an adapter."""

    def __init__(
        self,
        text: str,
        attachments: list[dict[str, Any]] | None = None,
        mode: str = "normal",
    ) -> None:
        self.text = text
        self.attachments = attachments or []
        self.mode = mode

    def __repr__(self) -> str:
        text = repr(self.text)
        count = len(self.attachments)
        mode = repr(self.mode)
        return f"AgentInput(text={text}, attachments={count}, mode={mode})"


class IAgentAdapter(ABC):
    """Unified interface that every Coding Agent adapter must implement."""

    @property
    @abstractmethod
    def agent_id(self) -> str:
        """Unique identifier for this adapter, e.g. 'kimi_cli'."""

    @abstractmethod
    async def start(self) -> None:
        """Start any required background resources (e.g. subprocess)."""

    @abstractmethod
    async def send(self, message: AgentInput) -> AsyncIterator[AgentEvent]:
        """Send user input to the agent and yield events as they arrive."""

    @abstractmethod
    async def interrupt(self) -> None:
        """Interrupt the currently running generation."""

    @abstractmethod
    async def shutdown(self) -> None:
        """Clean up resources."""

    async def inject_system_prompt(
        self,
        system_prompt: str,
        context_vars: dict[str, Any] | None = None,
    ) -> None:
        """Optional hook to inject a system prompt into the agent context.

        Default implementation does nothing. Adapters may override this to
        send the prompt via CLI-specific mechanisms.
        """
