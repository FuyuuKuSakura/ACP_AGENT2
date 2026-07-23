"""Generate short companion dialogue lines based on agent events and persona config."""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Any

import structlog

from dionysus_server.persona.loader import load_persona


@dataclass(frozen=True)
class CompanionReaction:
    """A companion response that may include dialogue and Live2D cues."""

    text: str
    emotion: str
    live2d_expression: str
    live2d_motion: str
    sticker_id: str | None = None

logger = structlog.get_logger()

DEFAULT_TEMPLATES: dict[str, list[str]] = {
    "work_start": [
        "老板，这个我看看！",
        "交给我吧～",
        "啊噗噜派！让我来搞定这个！",
    ],
    "long_workflow": [
        "步骤有点多，不过我能搞定，老板稍等～",
        "还在处理中，别急别急！",
        "这部分有点绕，我再看看～",
    ],
    "error": [
        "呃……出错了，老板别慌，我重新试试！",
        "哎呀，碰壁了，换个角度再来！",
        "有点小意外，放心，我在处理！",
    ],
    "success": [
        "搞定啦！老板看看怎么样？",
        "收工～还有别的需要我帮忙吗？",
        "顺利完成！随时叫我哦，老板！",
    ],
}

DEFAULT_STATUS_PHRASES: dict[str, list[str]] = {
    "thinking": ["让我想想~", "嗯…这个得琢磨一下", "老板稍等，我在思考方案~"],
    "reading_file": ["让我翻翻资料~", "正在读取文件哦", "我看看里面写了什么~"],
    "executing": ["正在动手操作~", "啊噗噜派，执行中！", "正在跑起来，老板稍等~"],
    "outputting": ["快整理好了~", "正在输出结果", "马上就好，等我一下~"],
    "success": ["搞定啦！", "收工~", "完成！老板请过目~"],
    "error": ["哎呀，出了点小状况…", "别急，我重新试试", "有点意外，我再处理一下~"],
    "idle": ["我在这里陪着你~", "有什么需要尽管告诉我", "随时待命，老板~"],
}

_STATUS_COOLDOWN_SECONDS = 5.0


class CompanionEngine:
    """Produces short persona-flavored lines at key agent lifecycle moments.

    The engine is stateful for a single agent turn; create a new instance for
    each user message.
    """

    def __init__(self, persona_id: str) -> None:
        self._persona_id = persona_id
        self._persona = load_persona(persona_id) or {}
        self._templates = self._load_templates()
        self._status_phrases = self._load_status_phrases()
        self._last_trigger: str | None = None
        self._start_time = time.time()
        self._status_count = 0
        self._last_status_at: float | None = None
        self._logger = logger.bind(component="CompanionEngine", persona_id=persona_id)

        companion_cfg = self._persona.get("companion") or {}
        self._status_to_emotion: dict[str, str] = companion_cfg.get(
            "status_to_emotion"
        ) or {
            "thinking": "neutral",
            "reading_file": "neutral",
            "executing": "confident",
            "outputting": "happy",
            "success": "happy",
            "error": "worried",
            "idle": "bored",
            "long_workflow": "bored",
        }
        live2d_cfg = companion_cfg.get("live2d") or {}
        self._default_expression: str = live2d_cfg.get("default_expression", "原皮")
        self._expressions: dict[str, str] = live2d_cfg.get("expressions") or {
            "happy": "爱心眼",
            "worried": "哭哭",
            "surprised": "？",
            "annoyed": "出魂",
            "confident": "举起手",
            "bored": "原皮",
            "neutral": "原皮",
        }
        self._motions: dict[str, str] = live2d_cfg.get("motions") or {
            "idle": "Idle",
            "greet": "Idle",
            "nod": "Idle",
        }
        self._touch_zones: dict[str, Any] = companion_cfg.get("touch_zones") or {}

    def _load_templates(self) -> dict[str, list[str]]:
        raw = self._persona.get("companion_templates") or {}
        templates: dict[str, list[str]] = {}
        for key in DEFAULT_TEMPLATES:
            value = raw.get(key)
            if isinstance(value, list) and value:
                templates[key] = [str(v) for v in value]
            else:
                templates[key] = DEFAULT_TEMPLATES[key]
        return templates

    def _load_status_phrases(self) -> dict[str, list[str]]:
        raw = self._persona.get("status_phrases") or {}
        phrases: dict[str, list[str]] = {}
        for key in DEFAULT_STATUS_PHRASES:
            value = raw.get(key)
            if isinstance(value, list) and value:
                phrases[key] = [str(v) for v in value]
            else:
                phrases[key] = DEFAULT_STATUS_PHRASES[key]
        return phrases

    def _pick(self, key: str) -> str:
        candidates = self._templates.get(key, [])
        if not candidates:
            candidates = DEFAULT_TEMPLATES.get(key, ["…"])
        return random.choice(candidates)

    def _pick_status(self, status: str) -> str:
        candidates = self._status_phrases.get(status, [])
        if not candidates:
            candidates = DEFAULT_STATUS_PHRASES.get(status, ["…"])
        return random.choice(candidates)

    def _apply_tone(self, text: str) -> str:
        """Apply light persona tone rules: prefix or suffix, not both."""
        tone = self._persona.get("tone_rules") or {}
        prefixes = tone.get("prefix_templates") or []
        suffixes = tone.get("suffix_templates") or []
        choice = random.random()
        if choice < 0.33 and prefixes:
            text = f"{random.choice(prefixes)} {text}"
        elif choice < 0.66 and suffixes:
            text = f"{text} {random.choice(suffixes)}"
        return text.strip()

    def _cooldown_ok(self) -> bool:
        now = time.time()
        if self._last_status_at is None:
            self._last_status_at = now
            return True
        if now - self._last_status_at >= _STATUS_COOLDOWN_SECONDS:
            self._last_status_at = now
            return True
        return False

    def _resolve_emotion(self, status: str | None) -> str:
        return self._status_to_emotion.get(status or "idle", "neutral")

    def _resolve_expression(self, emotion: str) -> str:
        return self._expressions.get(emotion, self._default_expression)

    def _resolve_motion(self, emotion: str | None) -> str:
        return self._motions.get(emotion or "idle") or self._motions.get(
            "idle", "Idle"
        )

    def _reaction(self, text: str, status: str | None = None) -> CompanionReaction:
        emotion = self._resolve_emotion(status)
        return CompanionReaction(
            text=self._apply_tone(text),
            emotion=emotion,
            live2d_expression=self._resolve_expression(emotion),
            live2d_motion=self._resolve_motion(emotion),
            sticker_id=None,
        )

    def on_event(self, event: dict[str, Any]) -> CompanionReaction | None:
        """Inspect an adapter event and optionally return a companion reaction."""
        event_type = event.get("type")
        payload = event.get("payload") or {}

        if event_type == "status_update":
            status = payload.get("status")
            self._status_count += 1

            if self._last_trigger != "work_start" and status in {
                "thinking",
                "reading_file",
                "executing",
            }:
                self._last_trigger = "work_start"
                return self._reaction(self._pick("work_start"), status)

            # Emit a status-specific phrase on status changes, with cooldown.
            if status in self._status_phrases and self._cooldown_ok():
                return self._reaction(self._pick_status(status), status)

            elapsed = time.time() - self._start_time
            if (
                self._last_trigger != "long_workflow"
                and elapsed > 12
                and self._status_count > 1
            ):
                self._last_trigger = "long_workflow"
                return self._reaction(self._pick("long_workflow"), "long_workflow")

        elif event_type == "agent_complete":
            status = payload.get("status")
            if status == "error" and self._last_trigger != "error":
                self._last_trigger = "error"
                return self._reaction(self._pick("error"), "error")
            if status == "success" and self._last_trigger != "success":
                self._last_trigger = "success"
                return self._reaction(self._pick("success"), "success")

        return None

    def get_touch_reaction(self, zone: str) -> CompanionReaction:
        """Return a reaction for a touch zone (e.g. 'head' or 'body')."""
        zone_cfg = self._touch_zones.get(zone) or {}
        lines = zone_cfg.get("lines") or [""]
        expression = zone_cfg.get("expression", self._default_expression)
        text = random.choice(lines) if isinstance(lines, list) and lines else ""
        emotion = self._status_to_emotion.get("idle", "bored")
        return CompanionReaction(
            text=self._apply_tone(text),
            emotion=emotion,
            live2d_expression=expression,
            live2d_motion=self._resolve_motion(emotion),
            sticker_id=None,
        )
