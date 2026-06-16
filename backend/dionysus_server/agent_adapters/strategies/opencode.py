"""Strategy for the OpenCode CLI."""

from __future__ import annotations

from typing import Any

from dionysus_server.models import AgentEvent, StatusEnum

from ..strategy import JSONStreamStrategy


class OpenCodeStrategy(JSONStreamStrategy):
    @property
    def adapter_id(self) -> str:
        return "opencode_cli"

    @property
    def supports_mode(self) -> list[str]:
        return ["normal", "plan", "yolo", "plan_yolo"]

    @property
    def supports_model(self) -> bool:
        return True

    def build_args(
        self,
        text: str,
        session_id: str | None,
        mode: str,
        config: dict[str, Any],
    ) -> list[str]:
        output_format = config.get("output_format", "json")
        if mode in ("plan", "plan_yolo"):
            text = (
                "Please enter plan mode: list clear execution steps first, "
                "then wait for confirmation before implementing.\n\n" + text
            )

        args = ["run", "--format", output_format]

        model = config.get("model")
        if model:
            args.extend(["--model", model])

        working_dir = config.get("working_dir")
        if working_dir:
            args.extend(["--dir", working_dir])

        if session_id:
            args.extend(["--session", session_id])

        if mode in ("yolo", "plan_yolo"):
            args.append("--auto-approve")

        args.append(text)
        return args

    def extract_session_id(self, parsed: dict[str, Any]) -> str | None:
        return parsed.get("session_id") or parsed.get("session") or parsed.get("sessionID")

    def _normalize_object(self, parsed: dict[str, Any]) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        msg_type = parsed.get("type")

        if msg_type in ("message", "agent_message", "output"):
            content = parsed.get("content") or parsed.get("text") or parsed.get("message", "")
            if content:
                events.append(
                    AgentEvent(
                        type="status_update",
                        payload={"status": StatusEnum.OUTPUTTING, "detail": "OpenCode 正在输出..."},
                    )
                )
                events.append(
                    AgentEvent(
                        type="agent_stream",
                        payload={"chunk": str(content), "is_final": False, "status": "outputting"},
                    )
                )
            return events

        # opencode run --format json emits "text" events with a nested part.text.
        if msg_type == "text":
            part = parsed.get("part") or {}
            content = part.get("text") or parsed.get("text", "")
            if content:
                events.append(
                    AgentEvent(
                        type="status_update",
                        payload={"status": StatusEnum.OUTPUTTING, "detail": "OpenCode 正在输出..."},
                    )
                )
                events.append(
                    AgentEvent(
                        type="agent_stream",
                        payload={"chunk": str(content), "is_final": False, "status": "outputting"},
                    )
                )
            return events

        if msg_type in ("tool_call", "tool"):
            name = parsed.get("name", "tool")
            arguments = parsed.get("arguments", "")
            chunk = f"🔧 OpenCode tool: {name}({arguments})\n"
            events.append(
                AgentEvent(
                    type="agent_stream",
                    payload={"chunk": chunk, "is_final": False, "status": "outputting"},
                )
            )
            return events

        if "result" in parsed and isinstance(parsed["result"], str):
            events.append(
                AgentEvent(
                    type="agent_stream",
                    payload={
                        "chunk": parsed["result"],
                        "is_final": False,
                        "status": "outputting",
                    },
                )
            )
            return events

        return super()._normalize_object(parsed)
