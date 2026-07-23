"""Build a lightweight todo list from agent status and tool-call events."""

from __future__ import annotations

import re
import uuid
from typing import Any

from dionysus_server.models import TodoItem

_STATUS_TODOS: dict[str, tuple[str, str]] = {
    "thinking": ("think", "思考方案"),
    "reading_file": ("read", "读取文件"),
    "executing": ("exec", "执行操作"),
    "outputting": ("output", "输出结果"),
}

_TOOL_CALL_RE = re.compile(r"🔧\s*调用工具[:：]?\s*(\w+)")
_TOOL_RESULT_RE = re.compile(r"🛠️\s*工具结果[:：]?")


class TodoTracker:
    """Tracks a per-turn todo list based on agent events.

    Emits updates only when the list actually changes.
    """

    def __init__(self) -> None:
        self._items: list[TodoItem] = []
        self._last_tool_id: str | None = None
        self._done_status: set[str] = set()

    def _index(self, item_id: str) -> int:
        for idx, item in enumerate(self._items):
            if item.id == item_id:
                return idx
        return -1

    def _add(self, item_id: str, text: str) -> bool:
        if self._index(item_id) >= 0:
            return False
        self._items.append(TodoItem(id=item_id, text=text, done=False))
        return True

    def _mark_done(self, item_id: str) -> bool:
        idx = self._index(item_id)
        if idx < 0 or self._items[idx].done:
            return False
        self._items[idx].done = True
        return True

    def _mark_all_done(self) -> bool:
        changed = False
        for item in self._items:
            if not item.done:
                item.done = True
                changed = True
        return changed

    def _snapshot(self) -> list[TodoItem]:
        return [item.model_copy() for item in self._items]

    def on_event(self, event: dict[str, Any]) -> list[TodoItem] | None:
        """Inspect an event; return the updated todo list if it changed."""
        event_type = event.get("type")
        payload = event.get("payload") or {}
        changed = False

        if event_type == "status_update":
            status = payload.get("status")
            if status in _STATUS_TODOS:
                item_id, text = _STATUS_TODOS[status]
                # Mark earlier status todos as done.
                seen = False
                for sid, (tid, _) in _STATUS_TODOS.items():
                    if sid == status:
                        seen = True
                    if seen and sid != status:
                        continue
                    if not seen:
                        changed = self._mark_done(tid) or changed
                changed = self._add(item_id, text) or changed

        elif event_type == "agent_stream":
            chunk = payload.get("chunk", "")
            call_match = _TOOL_CALL_RE.search(chunk)
            if call_match:
                tool_name = call_match.group(1)
                item_id = f"tool-{tool_name}-{uuid.uuid4().hex[:6]}"
                self._last_tool_id = item_id
                changed = self._add(item_id, f"调用 {tool_name}") or changed
            elif _TOOL_RESULT_RE.search(chunk) and self._last_tool_id:
                changed = self._mark_done(self._last_tool_id) or changed
                self._last_tool_id = None

        elif event_type == "agent_complete":
            changed = self._mark_all_done() or changed

        if changed:
            return self._snapshot()
        return None
