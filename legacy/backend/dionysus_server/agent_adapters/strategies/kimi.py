"""Strategy for the Kimi Code CLI."""

from __future__ import annotations

from typing import Any

from ..strategy import JSONStreamStrategy


class KimiStrategy(JSONStreamStrategy):
    @property
    def adapter_id(self) -> str:
        return "kimi_cli"

    @property
    def supports_mode(self) -> list[str]:
        return ["normal", "plan", "yolo", "plan_yolo"]

    def build_args(
        self,
        text: str,
        session_id: str | None,
        mode: str,
        config: dict[str, Any],
    ) -> list[str]:
        output_format = config.get("output_format", "stream-json")
        if mode in ("plan", "plan_yolo"):
            text = (
                "请进入 plan mode：先列出清晰的执行步骤和计划，"
                "得到确认后再继续实施。\n\n" + text
            )

        args: list[str] = []
        if session_id is not None:
            args.extend(["-S", session_id])
        if mode in ("yolo", "plan_yolo"):
            args.append("-y")
        args.extend(["-p", text, "--output-format", output_format])
        return args

    def extract_session_id(self, parsed: dict[str, Any]) -> str | None:
        if parsed.get("role") == "meta" and parsed.get("type") == "session.resume_hint":
            return parsed.get("session_id")
        return None
