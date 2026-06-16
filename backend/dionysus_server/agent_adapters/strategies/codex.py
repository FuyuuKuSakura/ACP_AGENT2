"""Strategy for the OpenAI Codex CLI."""

from __future__ import annotations

from typing import Any

from dionysus_server.models import AgentEvent, StatusEnum

from ..strategy import JSONStreamStrategy


class CodexStrategy(JSONStreamStrategy):
    @property
    def adapter_id(self) -> str:
        return "codex_cli"

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
        if mode in ("plan", "plan_yolo"):
            text = (
                "Please enter plan mode: list clear execution steps first, "
                "then wait for confirmation before implementing.\n\n" + text
            )

        args = ["exec", "--json", "--ephemeral", "--sandbox", "workspace-write"]

        model = config.get("model")
        if model:
            args.extend(["--model", model])

        if mode in ("yolo", "plan_yolo"):
            args.append("--dangerously-bypass-approvals-and-sandbox")

        # Codex supports resuming a rollout thread if we captured one.
        if session_id:
            args.extend(["--thread", session_id])

        args.append(text)
        return args

    def extract_session_id(self, parsed: dict[str, Any]) -> str | None:
        return parsed.get("thread_id") or parsed.get("session_id")

    def _normalize_object(self, parsed: dict[str, Any]) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        msg_type = parsed.get("type")

        if msg_type in ("agent_message", "message", "output"):
            content = parsed.get("content") or parsed.get("text") or parsed.get("message", "")
            if content:
                events.append(
                    AgentEvent(
                        type="status_update",
                        payload={"status": StatusEnum.OUTPUTTING, "detail": "Codex 正在输出..."},
                    )
                )
                events.append(
                    AgentEvent(
                        type="agent_stream",
                        payload={"chunk": str(content), "is_final": False, "status": "outputting"},
                    )
                )
            return events

        if msg_type in ("command_execution", "command"):
            command = parsed.get("command", "")
            chunk = f"🔧 Codex command: {command}\n"
            events.append(
                AgentEvent(
                    type="agent_stream",
                    payload={"chunk": chunk, "is_final": False, "status": "outputting"},
                )
            )
            return events

        if msg_type in ("tool_call", "tool"):
            name = parsed.get("name", "tool")
            args = parsed.get("arguments", "")
            chunk = f"🔧 Codex tool: {name}({args})\n"
            events.append(
                AgentEvent(
                    type="agent_stream",
                    payload={"chunk": chunk, "is_final": False, "status": "outputting"},
                )
            )
            return events

        # Codex "item.completed" wraps command_execution, reasoning and agent_message.
        if msg_type == "item.completed":
            item = parsed.get("item", {})
            item_type = item.get("type")
            if item_type == "agent_message":
                content = item.get("text", "")
                if content:
                    events.append(
                        AgentEvent(
                            type="agent_stream",
                            payload={"chunk": str(content), "is_final": False, "status": "outputting"},
                        )
                    )
            elif item_type == "command_execution":
                command = item.get("command", "")
                output = item.get("aggregated_output", "")
                exit_code = item.get("exit_code")
                chunk = f"🔧 Codex command: {command}\n"
                if output:
                    chunk += f"🛠️ output: {output}\n"
                if exit_code is not None:
                    chunk += f"exit code: {exit_code}\n"
                events.append(
                    AgentEvent(
                        type="agent_stream",
                        payload={"chunk": chunk, "is_final": False, "status": "outputting"},
                    )
                )
            return events

        # The final result envelope may have a top-level result string.
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
