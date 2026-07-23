"""Session-level re-exports and frontend-facing chat message helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from dionysus_server.models import Message, MessageRole, Session, SessionStatus


class ChatMessage(BaseModel):
    """Frontend-friendly representation of a chat message.

    Mirrors the internal :class:`dionysus_server.models.Message` while being
    explicitly exported from the session package for frontend consumers.
    """

    id: str
    role: MessageRole
    content: str
    timestamp: datetime
    trace_id: str
    metadata: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_internal(cls, message: Message) -> ChatMessage:
        """Convert an internal Message into a ChatMessage."""
        return cls(
            id=message.id,
            role=message.role,
            content=message.content,
            timestamp=message.timestamp,
            trace_id=message.trace_id,
            metadata=message.metadata,
        )

    def to_internal(self) -> Message:
        """Convert a ChatMessage back into an internal Message."""
        return Message(
            id=self.id,
            role=self.role,
            content=self.content,
            timestamp=self.timestamp,
            trace_id=self.trace_id,
            metadata=self.metadata,
        )


__all__ = ["Session", "Message", "MessageRole", "SessionStatus", "ChatMessage"]
