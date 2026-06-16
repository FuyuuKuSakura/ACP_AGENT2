"""Test all enabled agent adapters end-to-end via WebSocket."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import websockets

BASE_URL = "ws://127.0.0.1:8765/ws"
WORK_DIR = Path("/Users/fuyuuku/ACP_AGENT2/test_workspace")
REPORT_DIR = Path("/Users/fuyuuku/ACP_AGENT2/qa_reports")
ADAPTERS = ["kimi_cli", "codex_cli", "claude_cli", "opencode_cli"]
TIMEOUTS = {
    "kimi_cli": 120,
    "codex_cli": 300,
    "claude_cli": 300,
    "opencode_cli": 300,
}


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def make_msg(session_id: str, msg_type: str, payload: dict) -> dict:
    return {
        "type": msg_type,
        "trace_id": f"test-{int(time.time()*1000)}",
        "timestamp": now(),
        "session_id": session_id,
        "payload": payload,
    }


async def test_adapter(adapter_id: str) -> dict:
    result = {
        "adapter": adapter_id,
        "session_id": None,
        "connected": False,
        "switched": False,
        "status_flow": [],
        "chunks": [],
        "complete": None,
        "error": None,
        "file_created": False,
        "duration_ms": None,
    }
    start = time.time()
    session_id: str | None = None
    try:
        async with websockets.connect(f"{BASE_URL}?persona_id=exusiai") as ws:
            result["connected"] = True
            # wait for handshake
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if msg.get("type") != "handshake":
                raise RuntimeError(f"expected handshake, got {msg.get('type')}")
            session_id = msg["payload"]["session_id"]
            result["session_id"] = session_id

            # switch adapter
            await ws.send(json.dumps(make_msg(session_id, "client_command", {
                "command": "switch_adapter",
                "args": adapter_id,
                "text": None,
            })))
            deadline = time.time() + 10
            while time.time() < deadline:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
                except asyncio.TimeoutError:
                    break
                if msg.get("type") == "system_notice":
                    text = msg.get("payload", {}).get("text", "")
                    if adapter_id in text and "切换" in text:
                        result["switched"] = True
                        break
                    if "失败" in text or "未知" in text:
                        result["error"] = f"switch failed: {text}"
                        return result

            if not result["switched"]:
                result["error"] = "did not receive switch confirmation"
                return result

            # send task
            filename = f"hello_{adapter_id}.txt"
            task = (
                f"请用 Python 在当前工作目录创建一个名为 {filename} 的文件，"
                f"文件内容为 'hello from {adapter_id}'。完成后告诉我。"
            )
            await ws.send(json.dumps(make_msg(session_id, "user_input", {
                "text": task,
                "attachments": [],
                "mode": "normal",
            })))

            deadline = time.time() + TIMEOUTS[adapter_id]
            while time.time() < deadline:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
                except asyncio.TimeoutError:
                    continue
                mtype = msg.get("type")
                if mtype == "status_update":
                    status = msg.get("payload", {}).get("status")
                    if status and (not result["status_flow"] or result["status_flow"][-1] != status):
                        result["status_flow"].append(status)
                elif mtype == "agent_stream":
                    chunk = msg.get("payload", {}).get("chunk", "")
                    result["chunks"].append(chunk)
                elif mtype == "agent_complete":
                    result["complete"] = msg.get("payload", {})
                    break
                elif mtype == "system_notice":
                    level = msg.get("payload", {}).get("level", "info")
                    text = msg.get("payload", {}).get("text", "")
                    if level == "error":
                        result["error"] = text
                elif mtype == "error":
                    result["error"] = msg.get("payload", {}).get("message", "unknown error")

            if result["complete"] is None and result["error"] is None:
                result["error"] = "timeout waiting for agent_complete"

    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        result["duration_ms"] = int((time.time() - start) * 1000)
        if session_id:
            try:
                target = WORK_DIR / f"hello_{adapter_id}.txt"
                result["file_created"] = target.exists()
            except Exception:
                pass
    return result


async def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "adapter_test_report.json"
    results = []
    for adapter_id in ADAPTERS:
        print(f"\n[{now()}] Testing {adapter_id} ...")
        res = await test_adapter(adapter_id)
        results.append(res)
        print(json.dumps(res, ensure_ascii=False, indent=2))

    report = {
        "tested_at": now(),
        "base_url": BASE_URL,
        "results": results,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nReport saved to {report_path}")

    all_ok = all(
        r["switched"] and r["complete"] and r["complete"].get("status") == "success" and r["file_created"]
        for r in results
    )
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
