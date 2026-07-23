"""Adapter that talks to the Kimi Code CLI using prompt mode with stream-json output."""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

import structlog

from dionysus_server.models import AgentEvent, StatusEnum

from .base import AgentInput, IAgentAdapter

logger = structlog.get_logger()


class KimiCodeCLIAdapter(IAgentAdapter):
    """Adapter for the Kimi Code CLI.

    Kimi Code CLI does not provide a persistent chat subprocess. Instead, each
    user message is sent with ``kimi -p <text> --output-format stream-json``.
    To preserve conversation context across turns, the adapter extracts the
    ``session_id`` from the first response's ``session.resume_hint`` meta event
    and passes it via ``-S <session_id>`` on subsequent calls.

    Because each ``send()`` call starts a fresh subprocess, "interrupt" is
    implemented by killing the currently running subprocess.
    """

    def __init__(self, config: dict[str, Any]) -> None:
        self._command: str = config.get("command", "kimi")
        self._output_format: str = config.get("output_format", "stream-json")
        self._working_dir: str = config.get("working_dir", ".")
        self._restart_on_crash: bool = config.get("restart_on_crash", True)
        self._max_restart_attempts: int = config.get("max_restart_attempts", 3)
        self._request_timeout_seconds: float = float(
            config.get("request_timeout_seconds", 120)
        )

        self._kimi_session_id: str | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._restart_count: int = 0
        self._logger = logger.bind(adapter_id=self.agent_id)

    @property
    def agent_id(self) -> str:
        return "kimi_cli"

    async def start(self) -> None:
        """No persistent process is needed for prompt-mode CLI."""
        self._logger.debug("adapter_started")

    async def send(self, message: AgentInput) -> AsyncIterator[AgentEvent]:
        text = message.text
        if not text:
            yield AgentEvent(
                type="agent_complete",
                payload={"status": "error", "error_message": "empty input"},
            )
            return

        mode = getattr(message, "mode", "normal")
        if mode in ("plan", "plan_yolo"):
            text = (
                "请进入 plan mode：先列出清晰的执行步骤和计划，"
                "得到确认后再继续实施。\n\n" + text
            )

        args: list[str] = []
        if self._kimi_session_id is not None:
            args.extend(["-S", self._kimi_session_id])
        if mode in ("yolo", "plan_yolo"):
            args.append("-y")
        args.extend(["-p", text, "--output-format", self._output_format])

        self._logger.info(
            "starting_subprocess",
            command=self._command,
            args=args,
            working_dir=self._working_dir,
        )

        try:
            self._process = await asyncio.create_subprocess_exec(
                self._command,
                *args,
                cwd=self._working_dir,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except FileNotFoundError as exc:
            self._logger.error("command_not_found", command=self._command, error=str(exc))
            yield AgentEvent(
                type="agent_complete",
                payload={
                    "status": "error",
                    "error_message": f"Command not found: {self._command}",
                },
            )
            return

        full_content_parts: list[str] = []
        try:
            while True:
                try:
                    raw_line = await asyncio.wait_for(
                        self._process.stdout.readline(),
                        timeout=self._request_timeout_seconds,
                    )
                except asyncio.TimeoutError:
                    self._logger.warning("request_timeout")
                    await self._kill_process()
                    yield AgentEvent(
                        type="agent_complete",
                        payload={"status": "error", "error_message": "request timeout"},
                    )
                    return

                if not raw_line:
                    break

                line = raw_line.decode("utf-8", errors="replace").rstrip("\n")
                if not line.strip():
                    continue

                parsed_objects, remaining = self._extract_json_objects(line)
                for parsed in parsed_objects:
                    async for event in self._handle_structured_object(
                        parsed, full_content_parts
                    ):
                        yield event

                if remaining:
                    full_content_parts.append(remaining)
                    yield AgentEvent(
                        type="agent_stream",
                        payload={
                            "chunk": remaining + "\n",
                            "is_final": False,
                            "status": "outputting",
                        },
                    )

            # The process may have been killed (e.g. by interrupt/timeout); use a
            # local reference to avoid racing with _kill_process().
            process = self._process
            if process is not None:
                return_code = await process.wait()
                if self._process is process:
                    self._process = None
            else:
                return_code = -1

            if return_code != 0:
                self._logger.error("subprocess_error", return_code=return_code)
                yield AgentEvent(
                    type="agent_complete",
                    payload={
                        "status": "error",
                        "error_message": f"kimi exited with code {return_code}",
                    },
                )
                await self._handle_crash_restart()
                return

            self._restart_count = 0
            yield AgentEvent(
                type="agent_complete",
                payload={"status": "success"},
            )

        except asyncio.CancelledError:
            self._logger.info("send_cancelled")
            await self._kill_process()
            raise

    @staticmethod
    def _extract_json_objects(text: str) -> tuple[list[dict[str, Any]], str]:
        """Extract all top-level JSON objects from *text*.

        Kimi CLI may emit multiple JSON objects on a single line, e.g.:
        ``{"role":"assistant","tool_calls":[...]} {"role":"tool",...} text...``
        This helper returns the parsed objects plus any trailing plain text.
        """
        decoder = json.JSONDecoder()
        objects: list[dict[str, Any]] = []
        idx = 0
        length = len(text)
        while idx < length:
            # Skip whitespace between objects.
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

    async def _handle_structured_object(
        self, parsed: dict[str, Any], full_content_parts: list[str]
    ) -> AsyncIterator[AgentEvent]:
        role = parsed.get("role")
        msg_type = parsed.get("type")

        if role == "assistant":
            if "content" in parsed:
                content = parsed["content"]
                if content:
                    full_content_parts.append(content)
                    yield AgentEvent(
                        type="status_update",
                        payload={
                            "status": StatusEnum.OUTPUTTING,
                            "detail": "正在输出回复...",
                        },
                    )
                    yield AgentEvent(
                        type="agent_stream",
                        payload={
                            "chunk": content,
                            "is_final": False,
                            "status": "outputting",
                        },
                    )
            if "tool_calls" in parsed:
                for tc in parsed.get("tool_calls") or []:
                    name = tc.get("function", {}).get("name", "tool")
                    arguments = tc.get("function", {}).get("arguments", "{}")
                    try:
                        args_obj = json.loads(arguments)
                        args_str = ", ".join(
                            f"{k}={v!r}" for k, v in args_obj.items()
                        )
                    except json.JSONDecodeError:
                        args_str = arguments
                    chunk = f"🔧 调用工具: {name}({args_str})\n"
                    full_content_parts.append(chunk)
                    yield AgentEvent(
                        type="agent_stream",
                        payload={
                            "chunk": chunk,
                            "is_final": False,
                            "status": "outputting",
                        },
                    )
        elif role == "tool":
            content = parsed.get("content", "")
            if content:
                chunk = f"🛠️ 工具结果: {content}\n"
                full_content_parts.append(chunk)
                yield AgentEvent(
                    type="agent_stream",
                    payload={
                        "chunk": chunk,
                        "is_final": False,
                        "status": "outputting",
                    },
                )
        elif role == "meta" and msg_type == "session.resume_hint":
            hint_session_id = parsed.get("session_id")
            if hint_session_id:
                self._kimi_session_id = hint_session_id
                self._logger.info(
                    "kimi_session_resumed", session_id=self._kimi_session_id
                )
        elif "type" in parsed:
            # Forward any other structured events if they match our protocol.
            event_type = parsed["type"]
            payload = parsed.get(
                "payload", {k: v for k, v in parsed.items() if k != "type"}
            )
            if event_type in {
                "agent_stream",
                "status_update",
                "option_request",
                "agent_complete",
                "emotion_update",
                "sticker_send",
                "live2d_action",
            }:
                yield AgentEvent(type=event_type, payload=payload)
        else:
            # Unknown JSON shape: stream it as raw text for debugging.
            raw = json.dumps(parsed, ensure_ascii=False)
            full_content_parts.append(raw)
            yield AgentEvent(
                type="agent_stream",
                payload={
                    "chunk": raw + "\n",
                    "is_final": False,
                    "status": "outputting",
                },
            )

    async def interrupt(self) -> None:
        if self._process is None or self._process.returncode is not None:
            self._logger.warning("interrupt_no_running_process")
            return

        self._logger.info("killing_subprocess_for_interrupt")
        await self._kill_process()

    async def shutdown(self) -> None:
        await self._kill_process()
        self._logger.info("adapter_shutdown")

    async def _kill_process(self) -> None:
        if self._process is None:
            return

        if self._process.returncode is None:
            try:
                self._process.kill()
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                pass

        self._process = None

    async def switch_session(self, session_id: str) -> None:
        """Switch to another Kimi CLI session resume id."""
        self._kimi_session_id = session_id
        await self._kill_process()
        self._logger.info("kimi_session_switched", session_id=session_id)

    @property
    def working_dir(self) -> str:
        return self._working_dir

    @working_dir.setter
    def working_dir(self, value: str) -> None:
        self._working_dir = value

    async def _handle_crash_restart(self) -> None:
        if not self._restart_on_crash:
            return

        if self._restart_count >= self._max_restart_attempts:
            self._logger.error(
                "max_restart_attempts_exceeded",
                max_attempts=self._max_restart_attempts,
            )
            return

        self._restart_count += 1
        self._logger.info(
            "restarting_after_crash",
            attempt=self._restart_count,
            max_attempts=self._max_restart_attempts,
        )
