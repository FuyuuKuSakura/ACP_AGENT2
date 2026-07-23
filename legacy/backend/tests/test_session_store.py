"""Tests for SessionStore SQLite persistence."""

from __future__ import annotations

import pytest

from dionysus_server.models import Message, MessageRole, SessionStatus
from dionysus_server.session.store import SessionStore


@pytest.mark.asyncio
async def test_create_and_get_session(session_store: SessionStore) -> None:
    await session_store.init()
    session = await session_store.create_session(persona_id="exusiai")

    assert session.title == "新会话"
    assert session.persona_id == "exusiai"

    loaded = await session_store.get_session(session.id)
    assert loaded is not None
    assert loaded.title == session.title
    assert loaded.status == SessionStatus.IDLE


@pytest.mark.asyncio
async def test_list_sessions_ordered_by_updated_at(session_store: SessionStore) -> None:
    await session_store.init()
    first = await session_store.create_session(persona_id="exusiai")
    second = await session_store.create_session(persona_id="exusiai")

    sessions = await session_store.list_sessions(limit=10)
    assert [s.id for s in sessions] == [second.id, first.id]


@pytest.mark.asyncio
async def test_update_session(session_store: SessionStore) -> None:
    await session_store.init()
    session = await session_store.create_session(persona_id="exusiai")
    session.title = "Updated"
    session.status = SessionStatus.STREAMING

    await session_store.update_session(session)
    loaded = await session_store.get_session(session.id)
    assert loaded is not None
    assert loaded.title == "Updated"
    assert loaded.status == SessionStatus.STREAMING


@pytest.mark.asyncio
async def test_append_and_load_messages(session_store: SessionStore) -> None:
    await session_store.init()
    session = await session_store.create_session(persona_id="exusiai")

    await session_store.append_message(
        session.id,
        Message(
            id="m1",
            role=MessageRole.USER,
            content="hello",
            timestamp=1234567890000,
            trace_id="t1",
        ),
    )

    messages = await session_store.load_messages(session.id)
    assert len(messages) == 1
    assert messages[0].role == MessageRole.USER
    assert messages[0].content == "hello"


@pytest.mark.asyncio
async def test_delete_session_cascades_messages(session_store: SessionStore) -> None:
    await session_store.init()
    session = await session_store.create_session(persona_id="exusiai")
    await session_store.append_message(
        session.id,
        Message(
            id="m1",
            role=MessageRole.AGENT,
            content="bye",
            timestamp=1234567890000,
            trace_id="t1",
        ),
    )

    await session_store.delete_session(session.id)
    assert await session_store.get_session(session.id) is None
    assert await session_store.load_messages(session.id) == []
