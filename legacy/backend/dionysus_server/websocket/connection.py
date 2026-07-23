"""Thin wrapper around a FastAPI WebSocket for the Dionysus protocol."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import WebSocket, WebSocketDisconnect

from dionysus_server.models import (
    ClientCommandMessage,
    ClientMessage,
    HandshakeMessage,
    HandshakePayload,
    InterruptMessage,
    MessageType,
    NewSessionMessage,
    OptionSelectedMessage,
    PingMessage,
    PongMessage,
    ServerMessage,
    UserInputMessage,
)

logger = structlog.get_logger()


class WSConnection:
    """Wraps a FastAPI WebSocket with protocol-aware helpers."""

    def __init__(self, websocket: WebSocket) -> None:
        self._ws = websocket
        self.session_id: str = ""
        self.last_ping: datetime | None = None
        self._logger = logger.bind(component="WSConnection")

    async def accept(self, session: Any) -> None:
        """Accept the socket and send the handshake message."""
        self.session_id = getattr(session, "id", "")
        await self._ws.accept()
        handshake = HandshakeMessage(
            session_id=self.session_id,
            payload=HandshakePayload(
                server_version="0.2.0",
                session_id=self.session_id,
                persona_id=getattr(session, "persona_id", None),
                supported_features=["streaming", "options", "interrupt"],
            ),
        )
        await self.send_message(handshake)

    async def receive_message(self) -> ClientMessage | None:
        """Read, parse, and validate the next client message.

        Automatically tracks ping timestamps and responds with a pong.
        Returns ``None`` when the connection closes.
        """
        try:
            data = await self._ws.receive_text()
        except WebSocketDisconnect:
            return None
        except RuntimeError:
            return None

        try:
            payload = json.loads(data)
        except json.JSONDecodeError as exc:
            self._logger.warning("invalid_json_received", error=str(exc))
            return None

        if not isinstance(payload, dict):
            self._logger.warning("non_object_message_received", payload=repr(payload))
            return None

        msg_type = payload.get("type")

        # Heartbeat: track timestamp and auto-respond pong.
        if msg_type == MessageType.PING.value:
            self.last_ping = datetime.now(timezone.utc)
            await self.send_pong(payload.get("trace_id"))

        try:
            if msg_type == MessageType.USER_INPUT.value:
                return UserInputMessage.model_validate(payload)
            if msg_type == MessageType.OPTION_SELECTED.value:
                return OptionSelectedMessage.model_validate(payload)
            if msg_type == MessageType.INTERRUPT.value:
                return InterruptMessage.model_validate(payload)
            if msg_type == MessageType.CLIENT_COMMAND.value:
                return ClientCommandMessage.model_validate(payload)
            if msg_type == MessageType.NEW_SESSION.value:
                return NewSessionMessage.model_validate(payload)
            if msg_type == MessageType.PING.value:
                return PingMessage.model_validate(payload)
        except Exception as exc:
            self._logger.warning(
                "invalid_message_payload", type=msg_type, error=str(exc)
            )
            return None

        self._logger.warning("unknown_message_type", type=msg_type)
        return None

    async def send_message(self, message: ServerMessage) -> None:
        """Serialize and send a server message."""
        data = message.model_dump(mode="json")
        await self._ws.send_text(json.dumps(data, ensure_ascii=False, default=str))

    async def send_pong(self, trace_id: str | None = None) -> None:
        """Send a pong response."""
        pong = PongMessage(
            session_id=self.session_id or None,
            trace_id=trace_id or "",
        )
        await self.send_message(pong)

    async def close(self, code: int = 1000) -> None:
        """Close the underlying WebSocket gracefully."""
        try:
            await self._ws.close(code=code)
        except Exception:
            pass
