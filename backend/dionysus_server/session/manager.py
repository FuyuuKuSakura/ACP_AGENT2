"""Session orchestration: adapters, state, and event forwarding."""

from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path
from typing import Any, AsyncIterator

import structlog

from dionysus_server.agent_adapters.base import AgentInput, IAgentAdapter
from dionysus_server.agent_adapters.registry import AdapterRegistry
from dionysus_server.config import DionysusConfig, load_config
from dionysus_server.models import (
    AgentCompleteMessage,
    AgentCompletePayload,
    AgentEvent,
    AgentStreamMessage,
    AgentStreamPayload,
    CompanionMessage,
    CompanionMessagePayload,
    EmotionUpdateMessage,
    TodoUpdateMessage,
    TodoUpdatePayload,
    EmotionUpdatePayload,
    Live2DActionMessage,
    Live2DActionPayload,
    Message,
    MessageRole,
    OptionItem,
    OptionRequestMessage,
    OptionRequestPayload,
    ServerMessage,
    Session,
    SessionStatus,
    StatusUpdateMessage,
    StatusUpdatePayload,
    StickerSendMessage,
    StickerSendPayload,
    SystemNoticeMessage,
    SystemNoticePayload,
)
from dionysus_server.persona.companion_engine import CompanionEngine, CompanionReaction
from dionysus_server.persona.companion_scheduler import CompanionScheduler
from dionysus_server.persona.loader import load_persona
from dionysus_server.persona.supervisor import (
    CompanionSupervisor,
    SupervisorConfig,
    load_supervisor_settings,
)
from dionysus_server.persona.todo_tracker import TodoTracker

from .store import SessionStore

logger = structlog.get_logger()


def _agent_event_to_server_message(session_id: str, event: AgentEvent) -> ServerMessage:
    """Map an adapter event to the frontend-facing ServerMessage union."""
    if event.type == "agent_stream":
        return AgentStreamMessage(
            session_id=session_id,
            trace_id=event.trace_id,
            payload=AgentStreamPayload(**event.payload),
        )
    if event.type == "status_update":
        return StatusUpdateMessage(
            session_id=session_id,
            trace_id=event.trace_id,
            payload=StatusUpdatePayload(**event.payload),
        )
    if event.type == "option_request":
        options = [OptionItem(**opt) for opt in event.payload.get("options", [])]
        return OptionRequestMessage(
            session_id=session_id,
            trace_id=event.trace_id,
            payload=OptionRequestPayload(
                question=event.payload.get("question", "请选择一个选项："),
                options=options,
                ui_type=event.payload.get("ui_type", "button_group"),
                timeout_seconds=event.payload.get("timeout_seconds", 60),
            ),
        )
    if event.type == "agent_complete":
        return AgentCompleteMessage(
            session_id=session_id,
            trace_id=event.trace_id,
            payload=AgentCompletePayload(**event.payload),
        )
    if event.type == "emotion_update":
        return EmotionUpdateMessage(
            session_id=session_id,
            trace_id=event.trace_id,
            payload=EmotionUpdatePayload(**event.payload),
        )
    if event.type == "sticker_send":
        return StickerSendMessage(
            session_id=session_id,
            trace_id=event.trace_id,
            payload=StickerSendPayload(**event.payload),
        )
    if event.type == "live2d_action":
        return Live2DActionMessage(
            session_id=session_id,
            trace_id=event.trace_id,
            payload=Live2DActionPayload(**event.payload),
        )
    raise ValueError(f"Unknown agent event type: {event.type}")


def _attachments_to_dicts(attachments: list[Any]) -> list[dict[str, Any]]:
    """Normalize attachments to plain dicts for AgentInput."""
    result: list[dict[str, Any]] = []
    for attachment in attachments:
        if hasattr(attachment, "model_dump"):
            result.append(attachment.model_dump())
        elif isinstance(attachment, dict):
            result.append(attachment)
        else:
            result.append({"data": str(attachment)})
    return result


class SessionManager:
    """Owns sessions, adapters, and the routing of agent events."""

    def __init__(self, config: DionysusConfig | None = None) -> None:
        self._config = config or load_config()
        self._store = SessionStore(self._config)
        self.adapters = AdapterRegistry()
        self.max_concurrent = self._config.sessions.max_concurrent
        self.active_sessions: dict[str, Session] = {}
        self._session_adapters: dict[str, IAgentAdapter] = {}
        self._session_adapter_ids: dict[str, str] = {}
        self._companion_scheduler = CompanionScheduler()
        self._supervisor: CompanionSupervisor | None = None
        self._supervisor_adapter: IAgentAdapter | None = None
        # Multiple WebSocket connections may be active (multi-tab).  Keep a
        # callback per connection so supervisor broadcasts reach every client.
        self._broadcast_callbacks: dict[str, Any] = {}
        self._logger = logger.bind(component="SessionManager")

    async def init(self) -> None:
        """Initialize the underlying store and start the companion supervisor."""
        await self._store.init()
        settings = load_supervisor_settings()
        config = SupervisorConfig.from_dict(settings)
        self._supervisor = CompanionSupervisor(
            config=config,
            session_provider=self.list_sessions,
            emit_callback=self._emit_supervisor_message,
        )
        self._supervisor.start()

    async def _emit_supervisor_message(
        self, session_id: str, message: ServerMessage
    ) -> None:
        """Forward supervisor messages to all active WebSocket connections."""
        for callback in list(self._broadcast_callbacks.values()):
            try:
                await callback(message)
            except Exception:
                self._logger.warning("supervisor_broadcast_failed", session_id=session_id)

    def register_broadcast_callback(
        self, connection_id: str, callback: Any
    ) -> None:
        """Register a connection-specific broadcast callback."""
        self._broadcast_callbacks[connection_id] = callback

    def unregister_broadcast_callback(self, connection_id: str) -> None:
        """Remove a connection-specific broadcast callback."""
        self._broadcast_callbacks.pop(connection_id, None)

    async def update_supervisor_config(self, config: SupervisorConfig) -> None:
        """Update the supervisor configuration and persist it."""
        from dionysus_server.persona.supervisor import save_supervisor_settings

        save_supervisor_settings(config.to_dict())
        if self._supervisor is None:
            self._supervisor = CompanionSupervisor(
                config=config,
                session_provider=self.list_sessions,
                emit_callback=self._emit_supervisor_message,
            )
            self._supervisor.start()
        else:
            self._supervisor.update_config(config)

    def get_supervisor_config(self) -> SupervisorConfig:
        """Return the currently configured supervisor settings."""
        if self._supervisor is not None:
            return self._supervisor.config
        return SupervisorConfig.from_dict(load_supervisor_settings())

    async def _get_or_create_supervisor_adapter(
        self, adapter_id: str | None
    ) -> IAgentAdapter:
        """Return a dedicated adapter for the agent_session supervisor mode."""
        if self._supervisor_adapter is None:
            self._supervisor_adapter = self.adapters.create_adapter(adapter_id)
            await self._supervisor_adapter.start()
        return self._supervisor_adapter

    async def create_session(self, persona_id: str) -> Session:
        """Create a new session and keep it in memory."""
        if len(self.active_sessions) >= self.max_concurrent:
            oldest_id = next(iter(self.active_sessions))
            self._logger.warning(
                "max_concurrent_reached", evicted_session_id=oldest_id
            )
            await self.delete_session(oldest_id)

        session = await self._store.create_session(persona_id)
        self.active_sessions[session.id] = session
        return session

    async def get_session(self, session_id: str) -> Session | None:
        """Fetch a session from memory or persistence."""
        if session_id in self.active_sessions:
            return self.active_sessions[session_id]
        session = await self._store.get_session(session_id)
        if session is not None:
            self.active_sessions[session_id] = session
        return session

    async def list_sessions(self) -> list[Session]:
        """Return all sessions, with active copies taking precedence."""
        stored = await self._store.list_sessions()
        by_id = {session.id: session for session in stored}
        by_id.update(self.active_sessions)
        return sorted(by_id.values(), key=lambda s: s.updated_at, reverse=True)

    async def delete_session(self, session_id: str) -> None:
        """Remove a session from memory, store, and close its adapter."""
        await self.close_adapter(session_id)
        await self._store.delete_session(session_id)
        self.active_sessions.pop(session_id, None)
        self._companion_scheduler.remove_session(session_id)

    async def get_or_create_adapter(self, session_id: str) -> IAgentAdapter:
        """Return the adapter for a session, creating and starting it if needed."""
        if session_id not in self._session_adapters:
            session = await self.get_session(session_id)
            adapter_id = self._config.agent_adapter.default
            working_dir: str | None = None
            if session is not None:
                adapter_id = session.adapter_id or adapter_id
                working_dir = session.working_dir
            adapter = self.adapters.create_adapter(adapter_id, working_dir)
            await adapter.start()
            self._session_adapters[session_id] = adapter
            self._session_adapter_ids[session_id] = adapter.agent_id
            self._logger.info(
                "adapter_started",
                session_id=session_id,
                agent_id=adapter.agent_id,
                working_dir=working_dir,
            )
        return self._session_adapters[session_id]

    async def close_adapter(self, session_id: str) -> None:
        """Shutdown and remove a session's adapter."""
        adapter = self._session_adapters.pop(session_id, None)
        if adapter is not None:
            try:
                await adapter.shutdown()
                self._logger.info(
                    "adapter_closed",
                    session_id=session_id,
                    agent_id=adapter.agent_id,
                )
            except Exception:
                self._logger.exception(
                    "adapter_shutdown_failed",
                    session_id=session_id,
                    agent_id=adapter.agent_id,
                )

    async def _inject_system_prompt_if_needed(self, session: Session) -> None:
        """Inject persona system prompt on the first user turn."""
        if session.messages:
            return
        try:
            persona = load_persona(session.persona_id)
            system_prompt = persona.get("system_prompt")
            if system_prompt:
                adapter = await self.get_or_create_adapter(session.id)
                await adapter.inject_system_prompt(
                    system_prompt,
                    context_vars={"session_id": session.id},
                )
        except Exception:
            self._logger.exception(
                "system_prompt_injection_failed", session_id=session.id
            )

    async def _yield_scheduler_reaction(
        self, session_id: str, status: str
    ) -> AsyncIterator[ServerMessage]:
        """Notify the global companion scheduler and yield its reaction."""
        reaction = self._companion_scheduler.on_session_status(session_id, status)
        if reaction is None:
            return
        yield CompanionMessage(
            session_id="global",
            payload=CompanionMessagePayload(
                text=reaction.text,
                emotion=reaction.emotion,
                sticker_id=reaction.sticker_id,
            ),
        )
        if reaction.live2d_expression or reaction.live2d_motion:
            yield EmotionUpdateMessage(
                session_id="global",
                payload=EmotionUpdatePayload(
                    emotion=reaction.emotion,
                    live2d_expression=reaction.live2d_expression,
                    live2d_motion=reaction.live2d_motion,
                    confidence=1.0,
                ),
            )

    async def _stream_agent_response(
        self,
        session_id: str,
        agent_input: AgentInput,
    ) -> AsyncIterator[ServerMessage]:
        """Send input to the adapter and yield converted server messages."""
        adapter = await self.get_or_create_adapter(session_id)
        try:
            async for event in adapter.send(agent_input):
                yield _agent_event_to_server_message(session_id, event)
        except Exception as exc:
            self._logger.exception("adapter_send_failed", session_id=session_id)
            yield AgentCompleteMessage(
                session_id=session_id,
                payload=AgentCompletePayload(status="error", error_message=str(exc)),
            )

    async def _finalize_agent_turn(
        self,
        session: Session,
        agent_content_parts: list[str],
        complete_status: str,
    ) -> None:
        """Persist the agent message and reset session status."""
        if agent_content_parts:
            agent_message = Message(
                role=MessageRole.AGENT,
                content="".join(agent_content_parts),
                metadata={"complete_status": complete_status},
            )
            session.messages.append(agent_message)
            await self._store.append_message(session.id, agent_message)

        session.status = (
            SessionStatus.INTERRUPTED
            if complete_status == "interrupted"
            else SessionStatus.IDLE
        )
        await self._store.update_session(session)

    async def handle_user_input(
        self,
        session_id: str,
        text: str,
        attachments: list[Any],
        mode: str = "normal",
    ) -> AsyncIterator[ServerMessage]:
        """Handle a user message: persist, run adapter, forward events."""
        session = await self.get_session(session_id)
        if session is None:
            raise ValueError(f"Session not found: {session_id}")

        user_message = Message(role=MessageRole.USER, content=text)
        session.messages.append(user_message)
        await self._store.append_message(session_id, user_message)

        session.status = SessionStatus.PROCESSING
        await self._store.update_session(session)

        async for scheduler_msg in self._yield_scheduler_reaction(session_id, "working"):
            yield scheduler_msg

        await self._inject_system_prompt_if_needed(session)

        agent_input = AgentInput(
            text=text,
            attachments=_attachments_to_dicts(attachments),
            mode=mode,
        )
        agent_content_parts: list[str] = []
        complete_status = "success"
        companion_engine = CompanionEngine(session.persona_id)
        todo_tracker = TodoTracker()

        adapter = await self.get_or_create_adapter(session_id)
        try:
            async for event in adapter.send(agent_input):
                event_dict = event.model_dump()
                companion_reaction = companion_engine.on_event(event_dict)
                if companion_reaction is not None:
                    yield CompanionMessage(
                        session_id=session_id,
                        payload=CompanionMessagePayload(
                            text=companion_reaction.text,
                            emotion=companion_reaction.emotion,
                            sticker_id=companion_reaction.sticker_id,
                        ),
                    )
                    if (
                        companion_reaction.live2d_expression
                        or companion_reaction.live2d_motion
                    ):
                        yield EmotionUpdateMessage(
                            session_id=session_id,
                            payload=EmotionUpdatePayload(
                                emotion=companion_reaction.emotion,
                                live2d_expression=companion_reaction.live2d_expression,
                                live2d_motion=companion_reaction.live2d_motion,
                                confidence=1.0,
                            ),
                        )

                todo_items = todo_tracker.on_event(event_dict)
                if todo_items is not None:
                    yield TodoUpdateMessage(
                        session_id=session_id,
                        payload=TodoUpdatePayload(items=todo_items),
                    )

                server_message = _agent_event_to_server_message(session_id, event)
                yield server_message

                if server_message.type.value == "agent_stream":
                    agent_content_parts.append(
                        server_message.payload.chunk  # type: ignore[attr-defined]
                    )
                elif server_message.type.value == "agent_complete":
                    complete_status = server_message.payload.status  # type: ignore[attr-defined]
                    break
        except Exception as exc:
            self._logger.exception("adapter_send_failed", session_id=session_id)
            complete_status = "error"
            yield AgentCompleteMessage(
                session_id=session_id,
                payload=AgentCompletePayload(status="error", error_message=str(exc)),
            )

        async for scheduler_msg in self._yield_scheduler_reaction(
            session_id, complete_status
        ):
            yield scheduler_msg

        await self._finalize_agent_turn(session, agent_content_parts, complete_status)

    async def handle_option_selected(
        self,
        session_id: str,
        selected_id: str,
        selected_label: str,
    ) -> AsyncIterator[ServerMessage]:
        """Handle a user option selection."""
        session = await self.get_session(session_id)
        if session is None:
            raise ValueError(f"Session not found: {session_id}")

        text = f"选择：{selected_label}（{selected_id}）"
        user_message = Message(role=MessageRole.USER, content=text)
        session.messages.append(user_message)
        await self._store.append_message(session_id, user_message)

        session.status = SessionStatus.PROCESSING
        await self._store.update_session(session)

        async for scheduler_msg in self._yield_scheduler_reaction(session_id, "working"):
            yield scheduler_msg

        agent_input = AgentInput(text=selected_label)
        agent_content_parts: list[str] = []
        complete_status = "success"

        async for server_message in self._stream_agent_response(
            session_id, agent_input
        ):
            yield server_message

            if server_message.type.value == "agent_stream":
                agent_content_parts.append(
                    server_message.payload.chunk  # type: ignore[attr-defined]
                )
            elif server_message.type.value == "agent_complete":
                complete_status = server_message.payload.status  # type: ignore[attr-defined]
                break

        async for scheduler_msg in self._yield_scheduler_reaction(
            session_id, complete_status
        ):
            yield scheduler_msg

        await self._finalize_agent_turn(session, agent_content_parts, complete_status)

    async def handle_interrupt(
        self,
        session_id: str,
        reason: str,
        insert_message: str | None,
    ) -> AsyncIterator[ServerMessage]:
        """Interrupt the adapter and mark the session as interrupted."""
        session = await self.get_session(session_id)
        if session is None:
            raise ValueError(f"Session not found: {session_id}")

        adapter = await self.get_or_create_adapter(session_id)
        try:
            await adapter.interrupt()
        except Exception:
            self._logger.exception("adapter_interrupt_failed", session_id=session_id)

        if insert_message:
            user_message = Message(role=MessageRole.USER, content=insert_message)
            session.messages.append(user_message)
            await self._store.append_message(session_id, user_message)

        yield AgentCompleteMessage(
            session_id=session_id,
            payload=AgentCompletePayload(status="interrupted"),
        )

        session.status = SessionStatus.INTERRUPTED
        await self._store.update_session(session)

        async for scheduler_msg in self._yield_scheduler_reaction(session_id, "error"):
            yield scheduler_msg

    async def handle_client_command(
        self,
        session_id: str,
        command: str,
        args: str | None,
        text: str | None,
    ) -> AsyncIterator[ServerMessage]:
        """Execute a local client command that should not reach the agent LLM."""
        session = await self.get_session(session_id)
        if session is None:
            raise ValueError(f"Session not found: {session_id}")

        args = (args or "").strip()
        text = (text or "").strip()

        if command == "change_working_dir":
            new_dir = args or text
            async for msg in self._cmd_change_working_dir(session_id, new_dir):
                yield msg
            return

        if command == "open_working_dir":
            async for msg in self._cmd_open_working_dir(session_id):
                yield msg
            return

        if command == "list_kimi_sessions":
            async for msg in self._cmd_list_kimi_sessions(session_id):
                yield msg
            return

        if command == "switch_kimi_session" or command == "resume_agent_session":
            target = args or text
            async for msg in self._cmd_resume_agent_session(session_id, target):
                yield msg
            return

        if command == "restart_adapter":
            async for msg in self._cmd_restart_adapter(session_id):
                yield msg
            return

        if command == "switch_adapter":
            target = args or text
            async for msg in self._cmd_switch_adapter(session_id, target):
                yield msg
            return

        if command == "switch_persona":
            target = args or text
            async for msg in self._cmd_switch_persona(session_id, target):
                yield msg
            return

        self._logger.warning("unknown_client_command", command=command)
        yield SystemNoticeMessage(
            session_id=session_id,
            payload=SystemNoticePayload(
                text=f"未知命令：{command}", level="warning"
            ),
        )

    async def _cmd_change_working_dir(
        self, session_id: str, new_dir: str | None
    ) -> AsyncIterator[ServerMessage]:
        if not new_dir:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text="请提供目录路径，例如 /cd /Users/fuyuuku/project",
                    level="warning",
                ),
            )
            return

        path = Path(new_dir).expanduser().resolve()
        if not path.exists():
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text=f"目录不存在：{path}", level="error"
                ),
            )
            return

        session = await self.get_session(session_id)
        if session is None:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(text="会话不存在", level="error"),
            )
            return

        session.working_dir = str(path)
        await self._store.update_session(session)
        await self.close_adapter(session_id)

        # Also open the folder in Finder on macOS.
        try:
            subprocess.Popen(["open", str(path)])
        except Exception as exc:
            self._logger.warning("open_folder_failed", error=str(exc))

        yield SystemNoticeMessage(
            session_id=session_id,
            payload=SystemNoticePayload(
                text=f"工作目录已切换并打开：{path}", level="info"
            ),
        )

    async def _cmd_open_working_dir(
        self, session_id: str
    ) -> AsyncIterator[ServerMessage]:
        session = await self.get_session(session_id)
        working_dir = session.working_dir if session is not None else None
        if working_dir is None:
            adapter_id = self._get_session_adapter_id(session_id)
            cfg = self._config.agent_adapter.adapters.get(adapter_id)
            working_dir = cfg.get("working_dir", ".") if cfg else "."
        path = Path(working_dir).expanduser().resolve()
        try:
            subprocess.Popen(["open", str(path)])
        except Exception as exc:
            self._logger.warning("open_folder_failed", error=str(exc))
        yield SystemNoticeMessage(
            session_id=session_id,
            payload=SystemNoticePayload(
                text=f"已打开工作目录：{path}", level="info"
            ),
        )

    async def _cmd_list_kimi_sessions(
        self, session_id: str
    ) -> AsyncIterator[ServerMessage]:
        index_path = Path.home() / ".kimi-code" / "session_index.jsonl"
        sessions: list[dict[str, str]] = []
        if index_path.exists():
            try:
                for line in index_path.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    sessions.append(
                        {
                            "id": data.get("sessionId", ""),
                            "dir": data.get("workDir", ""),
                        }
                    )
            except Exception as exc:
                self._logger.warning("list_kimi_sessions_failed", error=str(exc))

        if not sessions:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text="未找到 Kimi CLI 会话记录。", level="info"
                ),
            )
            return

        lines = [f"• {s['id']} — {s['dir']}" for s in sessions[:20]]
        yield SystemNoticeMessage(
            session_id=session_id,
            payload=SystemNoticePayload(
                text="Kimi CLI 会话列表（前 20 条）：\n" + "\n".join(lines)
                + "\n\n使用 /switch <session_id> 切换。",
                level="info",
            ),
        )

    async def _cmd_resume_agent_session(
        self, session_id: str, target: str | None
    ) -> AsyncIterator[ServerMessage]:
        if not target:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text="请提供 Agent session ID，例如 /switch ses_xxx",
                    level="warning",
                ),
            )
            return

        adapter = await self.get_or_create_adapter(session_id)
        if hasattr(adapter, "switch_session"):
            await adapter.switch_session(target)
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text=f"已恢复到 Agent session：`{target}`。后续发送的消息将在该 session 中继续。",
                    level="info",
                ),
            )
        else:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text="当前 Agent 适配器不支持恢复会话。",
                    level="warning",
                ),
            )

    async def _cmd_restart_adapter(
        self, session_id: str
    ) -> AsyncIterator[ServerMessage]:
        await self.close_adapter(session_id)
        yield SystemNoticeMessage(
            session_id=session_id,
            payload=SystemNoticePayload(
                text="Agent 适配器已重启。", level="info"
            ),
        )

    async def _cmd_switch_adapter(
        self, session_id: str, adapter_id: str | None
    ) -> AsyncIterator[ServerMessage]:
        if not adapter_id:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text="请提供 adapter ID，例如 /adapter kimi_cli",
                    level="warning",
                ),
            )
            return
        ok = await self.switch_adapter(session_id, adapter_id)
        if ok:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text=f"已切换到 Agent 适配器：{adapter_id}", level="info"
                ),
            )
        else:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text=f"切换失败：未知或未启用的 adapter `{adapter_id}`",
                    level="error",
                ),
            )

    async def _cmd_switch_persona(
        self, session_id: str, persona_id: str | None
    ) -> AsyncIterator[ServerMessage]:
        if not persona_id:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text="请提供 persona ID，例如 /persona exusiai",
                    level="warning",
                ),
            )
            return
        try:
            load_persona(persona_id)
        except Exception:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text=f"切换失败：找不到角色 `{persona_id}`",
                    level="error",
                ),
            )
            return
        session = await self.get_session(session_id)
        if session is None:
            yield SystemNoticeMessage(
                session_id=session_id,
                payload=SystemNoticePayload(
                    text="会话不存在", level="error"
                ),
            )
            return
        session.persona_id = persona_id
        await self._store.update_session(session)
        yield SystemNoticeMessage(
            session_id=session_id,
            payload=SystemNoticePayload(
                text=f"已切换到角色：{persona_id}", level="info"
            ),
        )

    def _get_session_adapter_id(self, session_id: str) -> str:
        adapter = self._session_adapters.get(session_id)
        if adapter is not None:
            return adapter.agent_id
        session = self.active_sessions.get(session_id)
        if session is not None and session.adapter_id is not None:
            return session.adapter_id
        return self._config.agent_adapter.default

    async def update_adapter_config(
        self, adapter_id: str, updates: dict[str, Any]
    ) -> bool:
        """Update the runtime config for an adapter and close active instances."""
        cfg = self._config.agent_adapter.adapters.get(adapter_id)
        if cfg is None:
            return False
        cfg.update(updates)
        # Close any active adapters so they restart with new config.
        for session_id, adapter in list(self._session_adapters.items()):
            if adapter.agent_id == adapter_id:
                await self.close_adapter(session_id)
        return True

    async def switch_adapter(self, session_id: str, adapter_id: str) -> bool:
        """Switch the active adapter for a session and persist it."""
        try:
            self.adapters.get_adapter(adapter_id)
        except ValueError:
            return False

        session = await self.get_session(session_id)
        if session is not None:
            session.adapter_id = adapter_id
            await self._store.update_session(session)

        await self.close_adapter(session_id)
        self._session_adapters.pop(session_id, None)
        self._session_adapter_ids[session_id] = adapter_id
        return True
