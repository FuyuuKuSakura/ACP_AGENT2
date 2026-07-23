"""Global companion scheduler that aggregates all session states.

The scheduler watches every session's lifecycle and produces a single
session-agnostic companion reaction that reflects the overall workload.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import structlog

from dionysus_server.persona.companion_engine import CompanionReaction

logger = structlog.get_logger()


class _AggregateStatus(str, Enum):
    """Coarse lifecycle states used for aggregation."""

    IDLE = "idle"
    WORKING = "working"
    SUCCESS = "success"
    ERROR = "error"


@dataclass(frozen=True)
class SessionStateSnapshot:
    """Lightweight snapshot of a single session's aggregate state."""

    session_id: str
    status: _AggregateStatus


class CompanionScheduler:
    """Singleton-like scheduler that maps many sessions to one companion line.

    The scheduler is intentionally simple: it keeps the latest aggregate status
    per session and produces a CompanionReaction describing the whole fleet.
    """

    def __init__(self) -> None:
        self._session_states: dict[str, _AggregateStatus] = {}
        self._logger = logger.bind(component="CompanionScheduler")

    @property
    def session_states(self) -> dict[str, SessionStateSnapshot]:
        """Return a read-only view of currently tracked sessions."""
        return {
            sid: SessionStateSnapshot(session_id=sid, status=st)
            for sid, st in self._session_states.items()
        }

    def on_session_status(self, session_id: str, status: str | None) -> CompanionReaction | None:
        """Update the aggregate status for a session and return a global reaction.

        Args:
            session_id: The session whose status changed.
            status: One of ``idle``, ``working``, ``success``, ``error`` or any
                adapter-facing status that maps to these buckets.

        Returns:
            A ``CompanionReaction`` if the state change warrants a new global
            line, or ``None`` when the change is not meaningful.
        """
        aggregate = self._normalize_status(status)
        previous = self._session_states.get(session_id)
        self._session_states[session_id] = aggregate

        if previous == aggregate and aggregate == _AggregateStatus.IDLE:
            # Ignore duplicate idle noise.
            return None

        self._logger.debug(
            "session_status_updated",
            session_id=session_id,
            previous=previous.value if previous else None,
            current=aggregate.value,
        )
        return self._aggregate_reaction()

    def remove_session(self, session_id: str) -> None:
        """Remove a session from aggregation when it is deleted."""
        self._session_states.pop(session_id, None)

    def _normalize_status(self, status: str | None) -> _AggregateStatus:
        if status is None:
            return _AggregateStatus.IDLE
        status = str(status).lower()
        if status in {
            "working",
            "processing",
            "streaming",
            "thinking",
            "reading_file",
            "executing",
            "outputting",
        }:
            return _AggregateStatus.WORKING
        if status in {"success", "completed", "complete"}:
            return _AggregateStatus.SUCCESS
        if status in {"error", "failed", "failure", "interrupted"}:
            return _AggregateStatus.ERROR
        return _AggregateStatus.IDLE

    def _aggregate_reaction(self) -> CompanionReaction:
        states = list(self._session_states.values())
        if not states:
            return self._reaction("我在这里陪着你，有什么需要尽管告诉我~", "idle")

        if any(s == _AggregateStatus.WORKING for s in states):
            return self._reaction("还有任务在进行中，我继续陪着~", "working")

        successes = sum(1 for s in states if s == _AggregateStatus.SUCCESS)
        errors = sum(1 for s in states if s == _AggregateStatus.ERROR)
        total = len(states)

        if successes == total and total > 0:
            return self._reaction("所有任务都完成啦，老板！", "success")
        if errors == total:
            return self._reaction("哎呀，这次都遇到困难了…一起看看日志吧。", "error")
        if errors > 0:
            if errors == 1:
                return self._reaction("部分任务完成啦，不过有个会话出了点小状况。", "error")
            return self._reaction(
                f"部分任务完成啦，不过 {errors} 个会话出了点小状况。", "error"
            )

        # All idle and no work in flight.
        return self._reaction("所有会话都空闲啦，老板还需要我做什么吗？", "idle")

    def _reaction(self, text: str, status: str) -> CompanionReaction:
        """Build a CompanionReaction with sensible default Live2D cues."""
        emotion, expression, motion = self._cues_for(status)
        return CompanionReaction(
            text=text,
            emotion=emotion,
            live2d_expression=expression,
            live2d_motion=motion,
            sticker_id=None,
        )

    def _cues_for(self, status: str) -> tuple[str, str, str]:
        """Map aggregate status to emotion / expression / motion defaults."""
        mapping: dict[str, tuple[str, str, str]] = {
            "working": ("confident", "举起手", "Idle"),
            "success": ("happy", "爱心眼", "Idle"),
            "error": ("worried", "哭哭", "Idle"),
            "idle": ("bored", "原皮", "Idle"),
        }
        return mapping.get(status, mapping["idle"])
