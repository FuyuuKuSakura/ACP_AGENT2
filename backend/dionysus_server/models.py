"""Shared Pydantic models for the Dionysus WebSocket protocol and domain."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _new_trace_id() -> str:
    return str(uuid4())


class MessageType(str, Enum):
    # Client -> Server
    USER_INPUT = "user_input"
    OPTION_SELECTED = "option_selected"
    INTERRUPT = "interrupt"
    NEW_SESSION = "new_session"
    CLIENT_COMMAND = "client_command"
    PING = "ping"

    # Server -> Client
    HANDSHAKE = "handshake"
    AGENT_STREAM = "agent_stream"
    AGENT_COMPLETE = "agent_complete"
    OPTION_REQUEST = "option_request"
    STATUS_UPDATE = "status_update"
    EMOTION_UPDATE = "emotion_update"
    STICKER_SEND = "sticker_send"
    LIVE2D_ACTION = "live2d_action"
    COMPANION_MESSAGE = "companion_message"
    TODO_UPDATE = "todo_update"
    PONG = "pong"
    SYSTEM_NOTICE = "system_notice"


class StatusEnum(str, Enum):
    THINKING = "thinking"
    READING_FILE = "reading_file"
    EXECUTING = "executing"
    OUTPUTTING = "outputting"
    ERROR = "error"
    IDLE = "idle"


class Artifact(BaseModel):
    type: Literal["image", "file", "mermaid", "latex"]
    mime_type: str | None = None
    data: str | None = None  # base64 or URL
    caption: str | None = None


class Attachment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    filename: str
    mime_type: str
    size: int
    data: str  # base64 encoded content or URL


# ---------------------------------------------------------------------------
# Client messages
# ---------------------------------------------------------------------------


class UserInputPayload(BaseModel):
    text: str
    attachments: list[Attachment] = Field(default_factory=list)
    interrupt_before_send: bool = False
    mode: Literal["normal", "plan", "yolo", "plan_yolo"] = "normal"


class UserInputMessage(BaseModel):
    type: Literal[MessageType.USER_INPUT] = MessageType.USER_INPUT
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: UserInputPayload


class OptionSelectedPayload(BaseModel):
    selected_id: str
    selected_label: str


class OptionSelectedMessage(BaseModel):
    type: Literal[MessageType.OPTION_SELECTED] = MessageType.OPTION_SELECTED
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: OptionSelectedPayload


class InterruptPayload(BaseModel):
    reason: Literal["user_request", "timeout", "system"] = "user_request"
    insert_message: str | None = None


class InterruptMessage(BaseModel):
    type: Literal[MessageType.INTERRUPT] = MessageType.INTERRUPT
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: InterruptPayload


class ClientCommandPayload(BaseModel):
    command: str
    args: str | None = None
    text: str | None = None


class ClientCommandMessage(BaseModel):
    type: Literal[MessageType.CLIENT_COMMAND] = MessageType.CLIENT_COMMAND
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: ClientCommandPayload


class NewSessionPayload(BaseModel):
    persona_id: str | None = None


class NewSessionMessage(BaseModel):
    type: Literal[MessageType.NEW_SESSION] = MessageType.NEW_SESSION
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str | None = None
    payload: NewSessionPayload


class PingMessage(BaseModel):
    type: Literal[MessageType.PING] = MessageType.PING
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str | None = None


ClientMessage = (
    UserInputMessage
    | OptionSelectedMessage
    | InterruptMessage
    | ClientCommandMessage
    | NewSessionMessage
    | PingMessage
)


# ---------------------------------------------------------------------------
# Server messages
# ---------------------------------------------------------------------------


class HandshakePayload(BaseModel):
    server_version: str
    session_id: str
    persona_id: str | None = None
    supported_features: list[str]


class HandshakeMessage(BaseModel):
    type: Literal[MessageType.HANDSHAKE] = MessageType.HANDSHAKE
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: HandshakePayload


class AgentStreamPayload(BaseModel):
    chunk: str
    is_final: bool = False
    status: StatusEnum = StatusEnum.OUTPUTTING
    is_thinking: bool = False


class AgentStreamMessage(BaseModel):
    type: Literal[MessageType.AGENT_STREAM] = MessageType.AGENT_STREAM
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: AgentStreamPayload


class AgentCompletePayload(BaseModel):
    status: Literal["success", "error", "interrupted"]
    duration_ms: int | None = None
    artifacts: list[Artifact] = Field(default_factory=list)
    error_message: str | None = None


class AgentCompleteMessage(BaseModel):
    type: Literal[MessageType.AGENT_COMPLETE] = MessageType.AGENT_COMPLETE
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: AgentCompletePayload


class OptionItem(BaseModel):
    id: str
    label: str
    description: str | None = None
    icon: str | None = None


class OptionRequestPayload(BaseModel):
    question: str
    options: list[OptionItem]
    ui_type: Literal["button_group", "dropdown", "card_list", "input_confirm"] = "button_group"
    timeout_seconds: int | None = 60


class OptionRequestMessage(BaseModel):
    type: Literal[MessageType.OPTION_REQUEST] = MessageType.OPTION_REQUEST
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: OptionRequestPayload


class StatusUpdatePayload(BaseModel):
    status: StatusEnum
    detail: str
    progress: float | None = None


class StatusUpdateMessage(BaseModel):
    type: Literal[MessageType.STATUS_UPDATE] = MessageType.STATUS_UPDATE
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: StatusUpdatePayload


class EmotionUpdatePayload(BaseModel):
    emotion: str
    confidence: float
    live2d_expression: str | None = None
    live2d_motion: str | None = None


class EmotionUpdateMessage(BaseModel):
    type: Literal[MessageType.EMOTION_UPDATE] = MessageType.EMOTION_UPDATE
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: EmotionUpdatePayload


class StickerSendPayload(BaseModel):
    emotion: str
    sticker_url: str
    sticker_id: str


class StickerSendMessage(BaseModel):
    type: Literal[MessageType.STICKER_SEND] = MessageType.STICKER_SEND
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: StickerSendPayload


class Live2DActionPayload(BaseModel):
    action_type: Literal["expression", "motion", "look_at", "lip_sync"]
    name: str
    fade_duration: float | None = None
    params: dict[str, Any] | None = None


class Live2DActionMessage(BaseModel):
    type: Literal[MessageType.LIVE2D_ACTION] = MessageType.LIVE2D_ACTION
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: Live2DActionPayload


class CompanionMessagePayload(BaseModel):
    text: str
    emotion: str | None = None
    sticker_id: str | None = None


class CompanionMessage(BaseModel):
    type: Literal[MessageType.COMPANION_MESSAGE] = MessageType.COMPANION_MESSAGE
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: CompanionMessagePayload


class TodoItem(BaseModel):
    id: str
    text: str
    done: bool = False


class TodoUpdatePayload(BaseModel):
    items: list[TodoItem]


class TodoUpdateMessage(BaseModel):
    type: Literal[MessageType.TODO_UPDATE] = MessageType.TODO_UPDATE
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: TodoUpdatePayload


class PongMessage(BaseModel):
    type: Literal[MessageType.PONG] = MessageType.PONG
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str | None = None


class SystemNoticePayload(BaseModel):
    text: str
    level: Literal["info", "warning", "error"] = "info"


class SystemNoticeMessage(BaseModel):
    type: Literal[MessageType.SYSTEM_NOTICE] = MessageType.SYSTEM_NOTICE
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
    session_id: str
    payload: SystemNoticePayload


ServerMessage = (
    HandshakeMessage
    | AgentStreamMessage
    | AgentCompleteMessage
    | OptionRequestMessage
    | StatusUpdateMessage
    | EmotionUpdateMessage
    | StickerSendMessage
    | Live2DActionMessage
    | CompanionMessage
    | TodoUpdateMessage
    | PongMessage
    | SystemNoticeMessage
)


# ---------------------------------------------------------------------------
# Internal domain models
# ---------------------------------------------------------------------------


class MessageRole(str, Enum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    role: MessageRole
    content: str
    timestamp: datetime = Field(default_factory=_utc_now)
    trace_id: str = Field(default_factory=_new_trace_id)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SessionStatus(str, Enum):
    IDLE = "idle"
    PROCESSING = "processing"
    WAITING_OPTION = "waiting_option"
    STREAMING = "streaming"
    INTERRUPTED = "interrupted"


class Session(BaseModel):
    id: str
    title: str = "新会话"
    persona_id: str = "exusiai"
    adapter_id: str | None = None
    working_dir: str | None = None
    status: SessionStatus = SessionStatus.IDLE
    created_at: datetime = Field(default_factory=_utc_now)
    updated_at: datetime = Field(default_factory=_utc_now)
    messages: list[Message] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Adapter internal events
# ---------------------------------------------------------------------------


class AgentEvent(BaseModel):
    """Unified event emitted by any IAgentAdapter implementation."""

    type: Literal[
        "agent_stream",
        "status_update",
        "option_request",
        "agent_complete",
        "emotion_update",
        "sticker_send",
        "live2d_action",
        "todo_update",
    ]
    payload: dict[str, Any]
    trace_id: str = Field(default_factory=_new_trace_id)
    timestamp: datetime = Field(default_factory=_utc_now)
