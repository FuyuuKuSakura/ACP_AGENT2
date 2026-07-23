"""Strategy interface for generic CLI adapters.

A strategy knows how to build CLI arguments and parse one line of CLI output for
a specific agent (Kimi, Claude Code, Codex, OpenCode, ...).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from dionysus_server.models import AgentEvent


class CLIAdapterStrategy(ABC):
    """Per-agent knowledge plugged into :class:`GenericCLIAdapter`."""

    @property
    @abstractmethod
    def adapter_id(self) -> str:
        """Stable id, e.g. 'kimi_cli'."""

    @abstractmethod
    def build_args(
        self,
        text: str,
        session_id: str | None,
        mode: str,
        config: dict[str, Any],
    ) -> list[str]:
        """Return the CLI argument list for this prompt."""

    @abstractmethod
    def handle_line(
        self,
        line: str,
        session_holder: dict[str, str | None],
    ) -> list[AgentEvent]:
        """Parse one line of stdout and return zero or more AgentEvents.

        ``session_holder`` is a mutable dict with key ``session_id`` so the
        strategy can update the persistent session handle across turns.
        """

    @property
    def supports_model(self) -> bool:
        """Whether this adapter can select a model at runtime."""
        return False

    @property
    def supports_mode(self) -> list[str]:
        """Modes this strategy understands (normal/plan/yolo/...)."""
        return ["normal"]


def _extract_json_objects(text: str) -> tuple[list[dict[str, Any]], str]:
    """Extract all top-level JSON objects from *text*.

    Some CLIs emit multiple JSON objects on a single line, e.g.:
    ``{"role":"assistant"} {"role":"tool"} text...``
    Returns the parsed objects plus any trailing plain text.
    """
    import json

    decoder = json.JSONDecoder()
    objects: list[dict[str, Any]] = []
    idx = 0
    length = len(text)
    while idx < length:
        while idx < length and text[idx] in " \t\r\n":
            idx += 1
        if idx >= length or text[idx] != "{":
            break
        try:
            obj, end = decoder.raw_decode(text, idx)
            if isinstance(obj, dict):
                objects.append(obj)
            idx = end
        except json.JSONDecodeError:
            break
    remaining = text[idx:].rstrip()
    return objects, remaining


class JSONStreamStrategy(CLIAdapterStrategy):
    """Base strategy for CLIs that emit newline-delimited JSON.

    Subclasses customize argument building; event parsing is reused but can be
    overridden for provider-specific shapes.
    """

    def handle_line(
        self,
        line: str,
        session_holder: dict[str, str | None],
    ) -> list[AgentEvent]:

        events: list[AgentEvent] = []
        objects, remaining = _extract_json_objects(line)

        for parsed in objects:
            session_id = self.extract_session_id(parsed)
            if session_id:
                session_holder["session_id"] = session_id
            events.extend(self._normalize_object(parsed))

        if remaining:
            events.append(
                AgentEvent(
                    type="agent_stream",
                    payload={"chunk": remaining + "\n", "is_final": False, "status": "outputting"},
                )
            )
        return events

    def extract_session_id(self, parsed: dict[str, Any]) -> str | None:  # noqa: B027
        """Override if the provider emits a session resume hint."""
        return None

    def _normalize_object(self, parsed: dict[str, Any]) -> list[AgentEvent]:
        """Convert a parsed JSON object into protocol AgentEvents.

        The default implementation handles the shapes already used by Kimi and
        falls back to streaming raw JSON for unknown shapes.
        """
        import json

        role = parsed.get("role")
        msg_type = parsed.get("type")
        events: list[AgentEvent] = []

        if role == "assistant":
            content = parsed.get("content")
            if content:
                events.append(
                    AgentEvent(
                        type="status_update",
                        payload={"status": "outputting", "detail": "正在输出回复..."},
                    )
                )
                events.append(
                    AgentEvent(
                        type="agent_stream",
                        payload={"chunk": content, "is_final": False, "status": "outputting"},
                    )
                )
            tool_calls = parsed.get("tool_calls") or []
            for tc in tool_calls:
                name = tc.get("function", {}).get("name", "tool")
                arguments = tc.get("function", {}).get("arguments", "{}")
                try:
                    args_obj = json.loads(arguments)
                    args_str = ", ".join(f"{k}={v!r}" for k, v in args_obj.items())
                except Exception:
                    args_str = arguments
                chunk = f"🔧 调用工具: {name}({args_str})\n"
                events.append(
                    AgentEvent(
                        type="agent_stream",
                        payload={"chunk": chunk, "is_final": False, "status": "outputting"},
                    )
                )
        elif role == "tool":
            content = parsed.get("content", "")
            if content:
                chunk = f"🛠️ 工具结果: {content}\n"
                events.append(
                    AgentEvent(
                        type="agent_stream",
                        payload={"chunk": chunk, "is_final": False, "status": "outputting"},
                    )
                )
        elif role == "meta":
            # Meta events (session hints, etc.) are consumed by the strategy and
            # should not appear in the user-facing stream.
            return events
        elif msg_type in {
            "agent_stream",
            "status_update",
            "option_request",
            "agent_complete",
            "emotion_update",
            "sticker_send",
            "live2d_action",
            "todo_update",
        }:
            payload = parsed.get("payload") or {k: v for k, v in parsed.items() if k != "type"}
            events.append(AgentEvent(type=msg_type, payload=payload))
        else:
            # Unknown JSON shape: stream it as raw text for debugging.
            raw = json.dumps(parsed, ensure_ascii=False)
            events.append(
                AgentEvent(
                    type="agent_stream",
                    payload={"chunk": raw + "\n", "is_final": False, "status": "outputting"},
                )
            )
        return events
