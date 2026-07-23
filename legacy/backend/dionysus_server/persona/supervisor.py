"""Companion Supervisor: periodically inspects sessions and announces state changes.

The Supervisor supports three operating modes:

* disabled: do nothing.
* agent_session: spawn a dedicated agent adapter session and ask it for
  character-voiced status lines.
* deepseek_api: call a DeepSeek-compatible OpenAI chat completions endpoint.

It scans active sessions every 15 seconds (configurable) and emits a companion
message for the currently visible session.  Announcements are keyed by the
persona tied to the session so that each character speaks in her own voice.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog

from dionysus_server.models import (
    CompanionMessage,
    CompanionMessagePayload,
    EmotionUpdateMessage,
    EmotionUpdatePayload,
    ServerMessage,
)
from dionysus_server.persona.companion_engine import CompanionEngine
from dionysus_server.persona.loader import load_persona

logger = structlog.get_logger()


@dataclass(frozen=True)
class SupervisorConfig:
    """Runtime supervisor configuration."""

    mode: str = "deepseek_api"  # disabled | agent_session | deepseek_api
    interval_seconds: float = 15.0
    adapter_id: str | None = None
    api_url: str = "https://api.deepseek.com/v1/chat/completions"
    api_model: str = "deepseek-reasoner"
    api_key: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "SupervisorConfig":
        if not data:
            return cls()
        return cls(
            mode=data.get("mode", cls.mode),
            interval_seconds=float(data.get("interval_seconds", cls.interval_seconds)),
            adapter_id=data.get("adapter_id"),
            api_url=data.get("api_url", cls.api_url),
            api_model=data.get("api_model", cls.api_model),
            api_key=data.get("api_key") or os.environ.get("DEEPSEEK_API_KEY"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "interval_seconds": self.interval_seconds,
            "adapter_id": self.adapter_id,
            "api_url": self.api_url,
            "api_model": self.api_model,
            "api_key": self.api_key,
        }


@dataclass
class _SessionSnapshot:
    """Snapshot of a session used by the supervisor."""

    session_id: str
    persona_id: str
    status: str
    adapter_id: str | None
    updated_at: float
    last_user_message: str = ""


@dataclass
class _FleetState:
    """Aggregated fleet state derived from session snapshots."""

    total: int = 0
    working: int = 0
    idle: int = 0
    error: int = 0
    just_finished: list[str] = field(default_factory=list)

    def summarize(self) -> str:
        if self.total == 0:
            return "当前没有活跃会话。"
        if self.working > 0:
            return f"共有 {self.total} 个会话，其中 {self.working} 个正在处理任务。"
        if self.error > 0:
            return f"所有任务已结束，但 {self.error} 个会话遇到了问题。"
        return f"所有 {self.total} 个会话均已完成或空闲。"


class CompanionSupervisor:
    """Background companion announcer for Dionysus sessions.

    The supervisor is started with ``start()`` and stopped with ``stop()``.
    While running it polls the supplied ``session_provider`` at the configured
    interval and broadcasts ``CompanionMessage`` + ``EmotionUpdateMessage``
    messages via ``emit_callback``.
    """

    def __init__(
        self,
        config: SupervisorConfig | None = None,
        session_provider: Any | None = None,
        emit_callback: Any | None = None,
    ) -> None:
        self._config = config or SupervisorConfig()
        self._session_provider = session_provider
        self._emit_callback = emit_callback
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._last_states: dict[str, _SessionSnapshot] = {}
        self._last_finished_at: dict[str, float] = {}
        self._logger = logger.bind(component="CompanionSupervisor")

    @property
    def config(self) -> SupervisorConfig:
        return self._config

    def update_config(self, config: SupervisorConfig) -> None:
        restart = self._task is not None and self._config.mode != config.mode
        self._config = config
        if restart:
            self.stop()
            self.start()

    def start(self) -> None:
        if self._config.mode == "disabled":
            return
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._loop())
        self._logger.info("supervisor_started", mode=self._config.mode)

    def stop(self) -> None:
        if self._task is None or self._task.done():
            return
        self._stop_event.set()
        self._task.cancel()
        self._logger.info("supervisor_stopped")

    async def _loop(self) -> None:
        try:
            while not self._stop_event.is_set():
                try:
                    await self._tick()
                except Exception as exc:
                    self._logger.warning("supervisor_tick_failed", error=str(exc))
                try:
                    await asyncio.wait_for(
                        self._stop_event.wait(),
                        timeout=self._config.interval_seconds,
                    )
                except asyncio.TimeoutError:
                    pass
        except asyncio.CancelledError:
            self._logger.info("supervisor_loop_cancelled")

    async def _tick(self) -> None:
        if self._session_provider is None:
            return

        snapshots = await self._gather_snapshots()
        if not snapshots:
            self._last_states = {}
            return

        fleet = self._compute_fleet_state(snapshots)
        changed = self._detect_changes(snapshots)
        if not changed and fleet.working == 0:
            self._last_states = {s.session_id: s for s in snapshots}
            return

        # Pick the most relevant session to speak for.  Prefer the currently
        # active/working session, then the most recently changed one.
        working_snaps = [s for s in snapshots if s.status == "working"]
        target = next(iter(working_snaps), None) or max(
            snapshots, key=lambda s: s.updated_at
        )

        text = await self._compose_line(target, fleet, changed)
        await self._emit(target.session_id, target.persona_id, text)
        self._last_states = {s.session_id: s for s in snapshots}

    async def _gather_snapshots(self) -> list[_SessionSnapshot]:
        sessions = await self._session_provider()
        snapshots: list[_SessionSnapshot] = []
        for session in sessions:
            messages = getattr(session, "messages", []) or []
            last_user = ""
            for msg in reversed(messages):
                if getattr(msg, "role", None) == "user":
                    last_user = getattr(msg, "content", "")[:200]
                    break
            snapshots.append(
                _SessionSnapshot(
                    session_id=getattr(session, "id", ""),
                    persona_id=getattr(session, "persona_id", "exusiai"),
                    status=getattr(session, "status", "idle"),
                    adapter_id=getattr(session, "adapter_id", None),
                    updated_at=getattr(session, "updated_at", time.time()),
                    last_user_message=last_user,
                )
            )
        return snapshots

    def _compute_fleet_state(self, snapshots: list[_SessionSnapshot]) -> _FleetState:
        fleet = _FleetState(total=len(snapshots))
        for s in snapshots:
            status = s.status.lower()
            if status in {"working", "processing", "streaming"}:
                fleet.working += 1
            elif status in {"error", "interrupted"}:
                fleet.error += 1
            else:
                fleet.idle += 1
        return fleet

    def _detect_changes(self, snapshots: list[_SessionSnapshot]) -> dict[str, str]:
        changes: dict[str, str] = {}
        by_id = {s.session_id: s for s in snapshots}
        for sid, prev in self._last_states.items():
            curr = by_id.get(sid)
            if curr is None:
                changes[sid] = "closed"
            elif curr.status != prev.status:
                changes[sid] = f"{prev.status} -> {curr.status}"
        for sid, curr in by_id.items():
            if sid not in self._last_states:
                changes[sid] = "created"
        return changes

    async def _compose_line(
        self,
        target: _SessionSnapshot,
        fleet: _FleetState,
        changes: dict[str, str],
    ) -> str:
        if self._config.mode == "agent_session":
            return await self._compose_via_agent(target, fleet, changes)
        if self._config.mode == "deepseek_api":
            return await self._compose_via_deepseek(target, fleet, changes)
        return self._compose_builtin(target, fleet, changes)

    async def _compose_via_agent(
        self,
        target: _SessionSnapshot,
        fleet: _FleetState,
        changes: dict[str, str],
    ) -> str:
        if self._session_provider is None:
            return self._compose_builtin(target, fleet, changes)
        # The agent_session mode is implemented by asking the session provider's
        # manager to run a short prompt through a dedicated adapter.  If the
        # provider does not support that, fall back to built-in templates.
        provider = self._session_provider
        manager = getattr(provider, "__self__", None)
        if manager is None or not hasattr(manager, "_get_or_create_supervisor_adapter"):
            return self._compose_builtin(target, fleet, changes)
        adapter = await manager._get_or_create_supervisor_adapter(
            self._config.adapter_id
        )
        prompt = self._build_prompt(target, fleet, changes)
        try:
            from dionysus_server.agent_adapters.base import AgentInput

            result = ""
            async for event in adapter.send(AgentInput(text=prompt)):
                if event.type == "agent_stream":
                    result += event.payload.get("chunk", "")
                elif event.type == "agent_complete" and event.payload.get("status") == "success":
                    break
            return result.strip() or self._compose_builtin(target, fleet, changes)
        except Exception as exc:
            self._logger.warning("supervisor_agent_failed", error=str(exc))
            return self._compose_builtin(target, fleet, changes)

    async def _compose_via_deepseek(
        self,
        target: _SessionSnapshot,
        fleet: _FleetState,
        changes: dict[str, str],
    ) -> str:
        import httpx

        if not self._config.api_key:
            return self._compose_builtin(target, fleet, changes)

        system_prompt = self._system_prompt_for(target.persona_id)
        user_prompt = self._build_prompt(target, fleet, changes)
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    self._config.api_url,
                    headers={
                        "Authorization": f"Bearer {self._config.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self._config.api_model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        "max_tokens": 120,
                        "temperature": 0.8,
                    },
                )
                response.raise_for_status()
                data = response.json()
                choices = data.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", "")
                    text = content.strip().strip('"').split("\n")[0]
                    if text:
                        return text
        except Exception as exc:
            self._logger.warning("supervisor_deepseek_failed", error=str(exc))
        return self._compose_builtin(target, fleet, changes)

    def _system_prompt_for(self, persona_id: str) -> str:
        persona = load_persona(persona_id) or {}
        prompt = persona.get("system_prompt") or ""
        if prompt:
            return (
                prompt.strip()
                + "\n\n现在用户没有主动问你问题，而是系统在让你播报当前状态。"
                "请用一句简短、符合角色身份的中文台词播报，"
                "语气自然，不要解释设定，不要道歉，不要列出数据表格。"
            )
        return (
            "你是角色的代言人。请用一句简短、自然的中文台词播报系统状态，"
            "语气符合角色设定，不要道歉，不要列出数据表格。"
        )

    def _build_prompt(
        self,
        target: _SessionSnapshot,
        fleet: _FleetState,
        changes: dict[str, str],
    ) -> str:
        lines = [
            f"当前播报角色：{target.persona_id}",
            f"目标会话状态：{target.status}",
            f"最近用户输入：{target.last_user_message or '无'}",
            fleet.summarize(),
        ]
        if changes:
            lines.append("状态变动：" + "；".join(f"{k}: {v}" for k, v in changes.items()))
        lines.append("请用一句简短的中文台词播报当前状态。")
        return "\n".join(lines)

    def _compose_builtin(
        self,
        target: _SessionSnapshot,
        fleet: _FleetState,
        changes: dict[str, str],
    ) -> str:
        if fleet.working > 0:
            return self._with_persona(
                target.persona_id,
                "还有任务在进行中，我继续陪着~",
                "流程尚未结束，请稍等。",
            )
        if fleet.error > 0:
            return self._with_persona(
                target.persona_id,
                "哎呀，有会话遇到了问题，一起看看日志吧。",
                "检测到异常，需要排查。",
            )
        if changes:
            return self._with_persona(
                target.persona_id,
                "状态有变化，我这边已经感知到啦~",
                "状态已更新。",
            )
        return self._with_persona(
            target.persona_id,
            "所有会话都空闲啦，还需要我做什么吗？",
            "目前一切正常，等待指令。",
        )

    def _with_persona(
        self, persona_id: str, exusiai_line: str, kaltsit_line: str
    ) -> str:
        if persona_id == "kal'tsit":
            return kaltsit_line
        return exusiai_line

    async def _emit(self, session_id: str, persona_id: str, text: str) -> None:
        if self._emit_callback is None:
            return
        engine = CompanionEngine(persona_id)
        emotion = engine._resolve_emotion("working")  # type: ignore[attr-defined]
        expression = engine._resolve_expression(emotion)  # type: ignore[attr-defined]
        motion = engine._resolve_motion(emotion)  # type: ignore[attr-defined]
        messages: list[ServerMessage] = [
            CompanionMessage(
                session_id=session_id,
                payload=CompanionMessagePayload(text=text, emotion=emotion),
            ),
            EmotionUpdateMessage(
                session_id=session_id,
                payload=EmotionUpdatePayload(
                    emotion=emotion,
                    live2d_expression=expression,
                    live2d_motion=motion,
                    confidence=1.0,
                ),
            ),
        ]
        for msg in messages:
            try:
                await self._emit_callback(session_id, msg)
            except Exception as exc:
                self._logger.warning("supervisor_emit_failed", error=str(exc))
                break


def _supervisor_settings_path() -> Path:
    from dionysus_server.paths import get_data_dir

    return get_data_dir() / "supervisor_settings.json"


def load_supervisor_settings() -> dict[str, Any]:
    path = _supervisor_settings_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("load_supervisor_settings_failed", error=str(exc))
        return {}


def save_supervisor_settings(data: dict[str, Any]) -> None:
    path = _supervisor_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
