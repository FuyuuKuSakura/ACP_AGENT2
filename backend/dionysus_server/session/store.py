"""Async SQLite persistence layer for sessions and messages."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import aiosqlite
import structlog

from dionysus_server.config import DionysusConfig, load_config
from dionysus_server.models import Message, MessageRole, Session, SessionStatus

logger = structlog.get_logger()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _dt_to_iso(dt: datetime) -> str:
    """Serialize a datetime as an ISO 8601 UTC string."""
    return dt.astimezone(timezone.utc).isoformat()


def _iso_to_dt(iso: str) -> datetime:
    """Parse an ISO 8601 string back into a datetime."""
    return datetime.fromisoformat(iso)


class SessionStore:
    """Persistent store backed by ``aiosqlite``.

    Tables:
        - sessions(id, title, persona_id, status, created_at, updated_at)
        - messages(id, session_id, role, content, timestamp, trace_id, metadata_json)
    """

    def __init__(self, config: DionysusConfig | None = None) -> None:
        self._config = config or load_config()
        self._db_path = Path(self._config.sessions.storage_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._logger = logger.bind(component="SessionStore", db_path=str(self._db_path))

    def _connect(self) -> aiosqlite.Connection:
        return aiosqlite.connect(self._db_path)

    async def init(self) -> None:
        """Create tables and indexes if they do not exist."""
        async with self._connect() as conn:
            conn.row_factory = aiosqlite.Row
            await conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    persona_id TEXT NOT NULL,
                    adapter_id TEXT,
                    working_dir TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    trace_id TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_messages_session
                    ON messages(session_id, timestamp);
                """
            )
            # SQLite < 3.16 does not support "ADD COLUMN IF NOT EXISTS".
            cursor = await conn.execute("PRAGMA table_info(sessions)")
            rows = await cursor.fetchall()
            columns = {row["name"] for row in rows}
            if "adapter_id" not in columns:
                await conn.execute("ALTER TABLE sessions ADD COLUMN adapter_id TEXT")
            if "working_dir" not in columns:
                await conn.execute("ALTER TABLE sessions ADD COLUMN working_dir TEXT")
            await conn.commit()
        self._logger.debug("store_initialized")

    def _row_to_session(self, row: aiosqlite.Row) -> Session:
        return Session(
            id=row["id"],
            title=row["title"],
            persona_id=row["persona_id"],
            adapter_id=row["adapter_id"],
            working_dir=row["working_dir"],
            status=SessionStatus(row["status"]),
            created_at=_iso_to_dt(row["created_at"]),
            updated_at=_iso_to_dt(row["updated_at"]),
            messages=[],
        )

    def _row_to_message(self, row: aiosqlite.Row) -> Message:
        return Message(
            id=row["id"],
            role=MessageRole(row["role"]),
            content=row["content"],
            timestamp=_iso_to_dt(row["timestamp"]),
            trace_id=row["trace_id"],
            metadata=json.loads(row["metadata_json"]),
        )

    async def create_session(self, persona_id: str) -> Session:
        """Create a new session and persist it."""
        now = _utc_now()
        session = Session(
            id=str(uuid4()),
            title="新会话",
            persona_id=persona_id,
            status=SessionStatus.IDLE,
            created_at=now,
            updated_at=now,
            messages=[],
        )
        async with self._connect() as conn:
            conn.row_factory = aiosqlite.Row
            await conn.execute(
                """
                INSERT INTO sessions (id, title, persona_id, adapter_id, working_dir, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session.id,
                    session.title,
                    session.persona_id,
                    session.adapter_id,
                    session.working_dir,
                    session.status.value,
                    _dt_to_iso(session.created_at),
                    _dt_to_iso(session.updated_at),
                ),
            )
            await conn.commit()
        self._logger.info("session_created", session_id=session.id, persona_id=persona_id)
        return session

    async def get_session(self, session_id: str) -> Session | None:
        """Load a session and its message history."""
        async with self._connect() as conn:
            conn.row_factory = aiosqlite.Row
            async with conn.execute(
                "SELECT * FROM sessions WHERE id = ?", (session_id,)
            ) as cursor:
                row = await cursor.fetchone()
                if row is None:
                    return None
                session = self._row_to_session(row)
                session.messages = await self.load_messages(session_id)
                return session

    async def list_sessions(self, limit: int = 100) -> list[Session]:
        """List sessions ordered by most recently updated."""
        sessions: list[Session] = []
        async with self._connect() as conn:
            conn.row_factory = aiosqlite.Row
            async with conn.execute(
                "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?", (limit,)
            ) as cursor:
                async for row in cursor:
                    session = self._row_to_session(row)
                    session.messages = await self.load_messages(session.id)
                    sessions.append(session)
        return sessions

    async def update_session(self, session: Session) -> None:
        """Update mutable session fields and bump ``updated_at``."""
        session.updated_at = _utc_now()
        async with self._connect() as conn:
            conn.row_factory = aiosqlite.Row
            await conn.execute(
                """
                UPDATE sessions
                SET title = ?, persona_id = ?, adapter_id = ?, working_dir = ?, status = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    session.title,
                    session.persona_id,
                    session.adapter_id,
                    session.working_dir,
                    session.status.value,
                    _dt_to_iso(session.updated_at),
                    session.id,
                ),
            )
            await conn.commit()

    async def delete_session(self, session_id: str) -> None:
        """Delete a session and its messages (cascade)."""
        async with self._connect() as conn:
            conn.row_factory = aiosqlite.Row
            await conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            await conn.commit()
        self._logger.info("session_deleted", session_id=session_id)

    async def append_message(self, session_id: str, message: Message) -> None:
        """Append a message to the session and bump the session timestamp."""
        async with self._connect() as conn:
            conn.row_factory = aiosqlite.Row
            await conn.execute(
                """
                INSERT INTO messages
                (id, session_id, role, content, timestamp, trace_id, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message.id,
                    session_id,
                    message.role.value,
                    message.content,
                    _dt_to_iso(message.timestamp),
                    message.trace_id,
                    json.dumps(message.metadata, ensure_ascii=False),
                ),
            )
            await conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                (_dt_to_iso(_utc_now()), session_id),
            )
            await conn.commit()

    async def load_messages(self, session_id: str) -> list[Message]:
        """Load all messages for a session, oldest first."""
        messages: list[Message] = []
        async with self._connect() as conn:
            conn.row_factory = aiosqlite.Row
            async with conn.execute(
                "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
                (session_id,),
            ) as cursor:
                async for row in cursor:
                    messages.append(self._row_to_message(row))
        return messages
