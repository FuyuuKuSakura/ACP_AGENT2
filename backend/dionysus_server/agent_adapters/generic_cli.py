"""Generic subprocess adapter that delegates CLI specifics to a strategy."""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

import structlog

from dionysus_server.models import AgentEvent

from .base import AgentInput, IAgentAdapter
from .strategy import CLIAdapterStrategy

logger = structlog.get_logger()


class GenericCLIAdapter(IAgentAdapter):
    """Adapter that runs any headless coding agent CLI via a strategy.

    The strategy is responsible for:
    - Building argument lists (including session resume and mode flags).
    - Parsing one line of stdout into ``AgentEvent`` objects.
    - Extracting a session id from provider-specific meta events.

    This adapter handles process lifecycle, timeouts, restarts, and interruption.
    """

    def __init__(self, config: dict[str, Any], strategy: CLIAdapterStrategy) -> None:
        self._config = config
        self._strategy = strategy
        self._command: str = config.get("command", strategy.adapter_id)
        self._working_dir: str = config.get("working_dir", ".")
        self._restart_on_crash: bool = config.get("restart_on_crash", True)
        self._max_restart_attempts: int = config.get("max_restart_attempts", 3)
        self._request_timeout_seconds: float = float(
            config.get("request_timeout_seconds", 120)
        )

        self._session_id: str | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._restart_count: int = 0
        self._logger = logger.bind(adapter_id=strategy.adapter_id)

    @property
    def agent_id(self) -> str:
        return self._strategy.adapter_id

    async def start(self) -> None:
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
        if mode not in self._strategy.supports_mode:
            mode = "normal"

        args = self._strategy.build_args(text, self._session_id, mode, self._config)
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
            # Most agent CLIs detect an open stdin pipe and wait for additional
            # input. We pass the prompt as CLI arguments, so close stdin early.
            if self._process.stdin is not None:
                self._process.stdin.close()
                await self._process.stdin.wait_closed()
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

        session_holder: dict[str, str | None] = {"session_id": self._session_id}
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

                for event in self._strategy.handle_line(line, session_holder):
                    yield event

                # If strategy discovered a session id, persist it.
                if session_holder["session_id"] != self._session_id:
                    self._session_id = session_holder["session_id"]
                    self._logger.info(
                        "session_resumed", session_id=self._session_id
                    )

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
                        "error_message": f"{self.agent_id} exited with code {return_code}",
                    },
                )
                await self._handle_crash_restart()
                return

            self._restart_count = 0
            yield AgentEvent(type="agent_complete", payload={"status": "success"})

        except asyncio.CancelledError:
            self._logger.info("send_cancelled")
            await self._kill_process()
            raise

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
        self._session_id = session_id
        await self._kill_process()
        self._logger.info("session_switched", session_id=session_id)

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
