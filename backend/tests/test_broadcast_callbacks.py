"""Verify per-connection broadcast callbacks for multi-tab/multi-client support."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from dionysus_server.models import (
    CompanionMessage,
    CompanionMessagePayload,
    SystemNoticeMessage,
    SystemNoticePayload,
)
from dionysus_server.session.manager import SessionManager


@pytest.mark.asyncio
async def test_broadcast_callbacks_are_per_connection() -> None:
    """Each registered connection should receive supervisor broadcasts independently."""
    manager = SessionManager()
    received_a: list[Any] = []
    received_b: list[Any] = []

    async def callback_a(message: Any) -> None:
        received_a.append(message)

    async def callback_b(message: Any) -> None:
        received_b.append(message)

    manager.register_broadcast_callback("conn-a", callback_a)
    manager.register_broadcast_callback("conn-b", callback_b)

    msg = CompanionMessage(
        session_id="global",
        payload=CompanionMessagePayload(text="hello", emotion="happy"),
    )
    await manager._emit_supervisor_message("global", msg)

    assert len(received_a) == 1
    assert len(received_b) == 1
    assert received_a[0].payload.text == "hello"
    assert received_b[0].payload.text == "hello"


@pytest.mark.asyncio
async def test_unregister_broadcast_callback_stops_delivery() -> None:
    """Removing a callback should stop messages from reaching that connection."""
    manager = SessionManager()
    received: list[Any] = []

    async def callback(message: Any) -> None:
        received.append(message)

    manager.register_broadcast_callback("conn-1", callback)
    manager.unregister_broadcast_callback("conn-1")

    msg = SystemNoticeMessage(
        session_id="global",
        payload=SystemNoticePayload(text="notice", level="info"),
    )
    await manager._emit_supervisor_message("global", msg)

    assert received == []


@pytest.mark.asyncio
async def test_failed_callback_does_not_break_other_deliveries() -> None:
    """A failing callback must not prevent delivery to remaining connections."""
    manager = SessionManager()
    received_good: list[Any] = []

    async def failing_callback(_message: Any) -> None:
        raise RuntimeError("boom")

    async def good_callback(message: Any) -> None:
        received_good.append(message)

    manager.register_broadcast_callback("bad", failing_callback)
    manager.register_broadcast_callback("good", good_callback)

    msg = CompanionMessage(
        session_id="global",
        payload=CompanionMessagePayload(text="broadcast", emotion="neutral"),
    )
    await manager._emit_supervisor_message("global", msg)

    assert len(received_good) == 1
    assert received_good[0].payload.text == "broadcast"
