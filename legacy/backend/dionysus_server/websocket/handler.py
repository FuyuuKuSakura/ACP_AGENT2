"""Route validated client messages to the SessionManager."""

from __future__ import annotations

from typing import Any

import structlog

from dionysus_server.models import ClientMessage, MessageType
from dionysus_server.session.manager import SessionManager

from .connection import WSConnection

logger = structlog.get_logger()


class MessageHandler:
    """Dispatches client messages to session manager methods."""

    def __init__(
        self,
        session_manager: SessionManager,
        connection: WSConnection,
        on_new_session: Any = None,
    ) -> None:
        self._session_manager = session_manager
        self._connection = connection
        self._on_new_session = on_new_session
        self._logger = logger.bind(component="MessageHandler")

    async def handle(self, client_message: ClientMessage) -> None:
        """Route a client message by type and forward all yielded replies."""
        msg_type = client_message.type
        session_id = client_message.session_id

        if msg_type == MessageType.USER_INPUT:
            async for server_message in self._session_manager.handle_user_input(
                session_id,
                client_message.payload.text,
                client_message.payload.attachments,
                mode=client_message.payload.mode,
            ):
                await self._connection.send_message(server_message)
            return

        if msg_type == MessageType.CLIENT_COMMAND:
            async for server_message in self._session_manager.handle_client_command(
                session_id,
                client_message.payload.command,
                client_message.payload.args,
                client_message.payload.text,
            ):
                await self._connection.send_message(server_message)
            return

        if msg_type == MessageType.OPTION_SELECTED:
            async for server_message in self._session_manager.handle_option_selected(
                session_id,
                client_message.payload.selected_id,
                client_message.payload.selected_label,
            ):
                await self._connection.send_message(server_message)
            return

        if msg_type == MessageType.INTERRUPT:
            async for server_message in self._session_manager.handle_interrupt(
                session_id,
                client_message.payload.reason,
                client_message.payload.insert_message,
            ):
                await self._connection.send_message(server_message)
            return

        if msg_type == MessageType.NEW_SESSION:
            persona_id = client_message.payload.persona_id or "exusiai"
            new_session = await self._session_manager.create_session(persona_id)
            if self._on_new_session:
                await self._on_new_session(new_session)
            return

        if msg_type == MessageType.PING:
            # Pong is already auto-responded by WSConnection; nothing to do here.
            return

        self._logger.warning("unhandled_message_type", type=msg_type)
