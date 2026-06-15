"""Verify per-session workspace isolation via WebSocket and SQLite."""
from __future__ import annotations

import asyncio
import json
import sqlite3
import tempfile
from pathlib import Path

import websockets

WS_URL = "ws://127.0.0.1:8765/ws"
DB_PATH = Path("/Users/fuyuuku/ACP_AGENT2/backend/data/sessions.db")


def db_session(session_id: str) -> dict:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT id, title, adapter_id, working_dir FROM sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    conn.close()
    if row is None:
        return {}
    return dict(row)


async def recv_handshake(ws):
    raw = await ws.recv()
    msg = json.loads(raw)
    assert msg["type"] == "handshake", f"expected handshake, got {msg['type']}"
    return msg["payload"]["session_id"]


async def send_command(ws, session_id: str, command: str, args: str):
    msg = {
        "type": "client_command",
        "session_id": session_id,
        "payload": {"command": command, "args": args, "text": args},
    }
    await ws.send(json.dumps(msg))
    # Drain a few messages (system_notice / status) until quiet for 0.5s
    for _ in range(10):
        try:
            await asyncio.wait_for(ws.recv(), timeout=0.5)
        except asyncio.TimeoutError:
            break


async def new_session(ws) -> str:
    msg = {"type": "new_session", "payload": {"persona_id": "exusiai"}}
    await ws.send(json.dumps(msg))
    return await recv_handshake(ws)


async def main():
    tmp_a = tempfile.mkdtemp(prefix="dionysus_session_a_")
    tmp_b = tempfile.mkdtemp(prefix="dionysus_session_b_")

    async with websockets.connect(WS_URL) as ws_a:
        session_a = await recv_handshake(ws_a)
        await send_command(ws_a, session_a, "change_working_dir", tmp_a)

        async with websockets.connect(WS_URL) as ws_b:
            session_b = await new_session(ws_b)
            await send_command(ws_b, session_b, "change_working_dir", tmp_b)

    row_a = db_session(session_a)
    row_b = db_session(session_b)

    print("Session A:", row_a)
    print("Session B:", row_b)

    assert row_a.get("working_dir") == tmp_a, f"A working_dir mismatch: {row_a}"
    assert row_b.get("working_dir") == tmp_b, f"B working_dir mismatch: {row_b}"
    assert row_a.get("id") != row_b.get("id"), "sessions must be different"
    print("PASS: per-session workspace isolation verified")


if __name__ == "__main__":
    asyncio.run(main())
