"""Strategy for the CodeBuddy Code CLI."""

from __future__ import annotations

from typing import Any

from dionysus_server.models import AgentEvent, StatusEnum

from ..strategy import JSONStreamStrategy


class CodeBuddyStrategy(JSONStreamStrategy):
    """Strategy that parses CodeBuddy Code ``stream-json`` output.

    CodeBuddy ``--output-format stream-json`` emits:

    - ``{"type":"system","subtype":"init","session_id":"<uuid>",...}``
    - ``{"type":"system","subtype":"status",...}``
    - ``{"type":"file-history-snapshot",...}`` (ignored)
    - ``{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}]}}``
    - ``{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}``
    - ``{"type":"assistant","message":{"content":[{"type":"tool_use","name":"...","input":{...}}]}}``
    - ``{"type":"result","subtype":"success|error","is_error":false,"result":"...","session_id":"..."}``
    """

    @property
    def adapter_id(self) -> str:
        return "codebuddy_cli"

    @property
    def supports_mode(self) -> list[str]:
        return ["normal", "plan", "yolo", "plan_yolo"]

    @property
    def supports_model(self) -> bool:
        return True

    # ------------------------------------------------------------------
    # CLI argument building
    # ------------------------------------------------------------------

    def build_args(
        self,
        text: str,
        session_id: str | None,
        mode: str,
        config: dict[str, Any],
    ) -> list[str]:
        """Build CodeBuddy CLI args for a single prompt turn.

        ``codebuddy -p <text> --output-format stream-json -y [--resume <id>] [--model <model>]``
        """
        if mode in ("plan", "plan_yolo"):
            text = (
                "Please enter plan mode: list clear execution steps first, "
                "then wait for confirmation before implementing.\n\n" + text
            )

        args = ["-p", text, "--output-format", "stream-json"]

        if session_id:
            args.extend(["--resume", session_id])

        model = config.get("model")
        if isinstance(model, str) and model.strip():
            args.extend(["--model", model.strip()])

        # Non-interactive mode: skip permission prompts.
        args.append("-y")

        return args

    # ------------------------------------------------------------------
    # Session ID extraction
    # ------------------------------------------------------------------

    def extract_session_id(self, parsed: dict[str, Any]) -> str | None:
        """CodeBuddy emits ``session_id`` in the init system message."""
        if parsed.get("type") == "system" and parsed.get("subtype") == "init":
            return parsed.get("session_id")
        return None

    # ------------------------------------------------------------------
    # Per-object normalisation
    # ------------------------------------------------------------------

    def _normalize_object(self, parsed: dict[str, Any]) -> list[AgentEvent]:
        msg_type = parsed.get("type")
        events: list[AgentEvent] = []

        # --- system messages -------------------------------------------------
        if msg_type == "system":
            return events  # init/status are consumed internally

        # --- file-history-snapshot (noise) -----------------------------------
        if msg_type == "file-history-snapshot":
            return events

        # --- CodeBuddy "result" envelope -------------------------------------
        if msg_type == "result":
            is_error = bool(parsed.get("is_error", False))
            if is_error:
                result_text = parsed.get("result", "CodeBuddy 执行出错")
                events.append(
                    AgentEvent(
                        type="agent_complete",
                        payload={
                            "status": "error",
                            "error_message": result_text,
                            "duration_ms": parsed.get("duration_ms"),
                        },
                    )
                )
            return events

        # --- assistant message -----------------------------------------------
        if msg_type == "assistant":
            message = parsed.get("message", {})
            content_blocks = message.get("content", [])
            if not isinstance(content_blocks, list):
                return events

            for block in content_blocks:
                block_type = block.get("type")

                if block_type == "text":
                    text = block.get("text", "")
                    if text:
                        events.append(
                            AgentEvent(
                                type="status_update",
                                payload={"status": StatusEnum.OUTPUTTING, "detail": "CodeBuddy 正在输出..."},
                            )
                        )
                        events.append(
                            AgentEvent(
                                type="agent_stream",
                                payload={"chunk": text, "is_final": False, "status": "outputting"},
                            )
                        )

                elif block_type == "thinking":
                    thinking = block.get("thinking", "")
                    if thinking:
                        events.append(
                            AgentEvent(
                                type="agent_stream",
                                payload={
                                    "chunk": thinking,
                                    "is_final": False,
                                    "status": "thinking",
                                    "is_thinking": True,
                                },
                            )
                        )

                elif block_type == "tool_use":
                    name = block.get("name", "unknown_tool")
                    tool_input = block.get("input", {})
                    if isinstance(tool_input, dict):
                        args_str = ", ".join(f"{k}={v!r}" for k, v in tool_input.items())
                    else:
                        args_str = str(tool_input)
                    events.append(
                        AgentEvent(
                            type="agent_stream",
                            payload={
                                "chunk": f"调用工具: {name}({args_str})\n",
                                "is_final": False,
                                "status": "executing",
                            },
                        )
                    )

                elif block_type == "tool_result":
                    result_content = block.get("content", "")
                    if result_content:
                        events.append(
                            AgentEvent(
                                type="agent_stream",
                                payload={
                                    "chunk": f"工具结果: {result_content}\n",
                                    "is_final": False,
                                    "status": "outputting",
                                },
                            )
                        )

            return events

        # Fall back to the base (role-based Kimi format) for anything
        # unrecognised.
        return super()._normalize_object(parsed)
