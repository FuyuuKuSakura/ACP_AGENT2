"""FastAPI application entry point for the Dionysus backend."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import qrcode
import structlog
import yaml
from fastapi import FastAPI, File, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from dionysus_server.config import get_config_dir, load_config
from dionysus_server.models import HandshakeMessage, HandshakePayload
from dionysus_server.persona.loader import list_personas, load_persona
from dionysus_server.session.manager import SessionManager
from dionysus_server.theme_manager import delete_theme, get_theme, list_themes, save_theme
from dionysus_server.websocket.connection import WSConnection
from dionysus_server.websocket.handler import MessageHandler

logger = structlog.get_logger()


def _server_settings_path() -> Path:
    return Path(__file__).parent.parent / "data" / "server_settings.json"


def _agent_settings_path() -> Path:
    return Path(__file__).parent.parent / "data" / "agent_settings.json"


def _load_server_settings(config: Any) -> None:
    path = _server_settings_path()
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if "history_limit" in data:
            config.sessions.history_limit = int(data["history_limit"])
    except Exception as exc:
        logger.warning("failed_to_load_server_settings", error=str(exc))


def _load_agent_settings(config: Any) -> None:
    path = _agent_settings_path()
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        for adapter_id, overrides in data.items():
            cfg = config.agent_adapter.adapters.get(adapter_id)
            if cfg is not None:
                cfg.update(overrides)
    except Exception as exc:
        logger.warning("failed_to_load_agent_settings", error=str(exc))


def _save_server_settings(data: dict[str, Any]) -> None:
    path = _server_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _save_agent_settings(data: dict[str, Any]) -> None:
    path = _agent_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def configure_logging() -> None:
    """Set up structlog with a development-friendly console renderer."""
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.dev.ConsoleRenderer(colors=True),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(10),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    configure_logging()
    config = load_config()
    _load_server_settings(config)
    _load_agent_settings(config)

    app = FastAPI(title="Dionysus Server", version="0.1.0")
    theme_dir = get_config_dir() / "themes"

    @app.get("/api/themes")
    async def get_themes() -> JSONResponse:
        """List all available themes with full configuration."""
        return JSONResponse(content=list_themes())

    @app.get("/api/themes/{theme_id}.json")
    async def get_theme_json(theme_id: str) -> JSONResponse:
        """Serve a single theme YAML file as JSON."""
        data = get_theme(theme_id)
        if data is None:
            return JSONResponse(status_code=404, content={"error": "theme_not_found"})
        return JSONResponse(content=data)

    @app.post("/api/themes/{theme_id}")
    async def save_theme_endpoint(theme_id: str, request: Request) -> JSONResponse:
        """Save a custom theme from JSON payload."""
        body = await request.json()
        ok, error = save_theme(theme_id, body)
        if not ok:
            return JSONResponse(status_code=400, content={"error": error})
        return JSONResponse(content={"ok": True, "id": theme_id})

    @app.delete("/api/themes/{theme_id}")
    async def delete_theme_endpoint(theme_id: str) -> JSONResponse:
        """Delete a custom theme."""
        ok, error = delete_theme(theme_id)
        if not ok:
            return JSONResponse(status_code=400, content={"error": error})
        return JSONResponse(content={"ok": True})

    @app.get("/api/personas")
    async def get_personas() -> JSONResponse:
        """List all persona configuration files."""
        return JSONResponse(content=list_personas())

    @app.get("/api/personas/{persona_id}")
    async def get_persona(persona_id: str) -> JSONResponse:
        """Return a persona YAML file as raw text."""
        persona_path = get_config_dir() / "personas" / f"{persona_id}.yaml"
        if not persona_path.exists():
            return JSONResponse(status_code=404, content={"error": "persona_not_found"})
        return JSONResponse(
            content={
                "id": persona_id,
                "yaml": persona_path.read_text(encoding="utf-8"),
            }
        )

    @app.get("/api/personas/{persona_id}/companion")
    async def get_persona_companion(persona_id: str) -> JSONResponse:
        """Return the parsed companion configuration for a persona."""
        persona = load_persona(persona_id)
        if not persona:
            return JSONResponse(status_code=404, content={"error": "persona_not_found"})
        return JSONResponse(content=persona.get("companion", {}))

    @app.post("/api/personas/{persona_id}")
    async def save_persona(persona_id: str, request: Request) -> JSONResponse:
        """Save persona YAML file contents."""
        persona_path = get_config_dir() / "personas" / f"{persona_id}.yaml"
        persona_path.parent.mkdir(parents=True, exist_ok=True)
        body = await request.json()
        yaml_text = body.get("yaml", "")
        # Basic safety: ensure the text is valid YAML before writing.
        try:
            parsed = yaml.safe_load(yaml_text)
        except yaml.YAMLError as exc:
            return JSONResponse(
                status_code=400,
                content={"error": "invalid_yaml", "detail": str(exc)},
            )
        if not isinstance(parsed, dict):
            return JSONResponse(
                status_code=400,
                content={"error": "invalid_yaml", "detail": "top level must be a mapping"},
            )
        persona_path.write_text(yaml_text, encoding="utf-8")
        return JSONResponse(content={"ok": True, "id": persona_id})

    @app.post("/api/personas/{persona_id}/corpus")
    async def upload_persona_corpus(
        persona_id: str, file: UploadFile = File(...)
    ) -> JSONResponse:
        """Upload a corpus file for a persona."""
        if not file.filename:
            return JSONResponse(
                status_code=400, content={"error": "missing_filename"}
            )
        if not file.filename.endswith(".txt"):
            return JSONResponse(
                status_code=400, content={"error": "only_txt_files_allowed"}
            )
        corpus_dir = get_config_dir() / "personas" / "corpus"
        corpus_dir.mkdir(parents=True, exist_ok=True)
        target = corpus_dir / f"{persona_id}.txt"
        content = await file.read()
        if len(content) > 5 * 1024 * 1024:
            return JSONResponse(
                status_code=400, content={"error": "file_too_large"}
            )
        target.write_bytes(content)
        return JSONResponse(
            content={"ok": True, "path": str(target), "size": len(content)}
        )

    @app.get("/api/settings/agent")
    async def get_agent_settings() -> JSONResponse:
        """Return current agent adapter configuration."""
        return JSONResponse(
            content={
                "default": config.agent_adapter.default,
                "adapters": config.agent_adapter.adapters,
            }
        )

    @app.get("/api/adapters")
    async def get_adapters() -> JSONResponse:
        """Return metadata for all configured agent adapters."""
        return JSONResponse(content=manager.adapters.list_adapters())

    @app.post("/api/settings/agent")
    async def update_agent_settings(request: Request) -> JSONResponse:
        """Update agent adapter configuration and restart affected adapters."""
        body = await request.json()

        # Legacy single-adapter update.
        adapter_id = body.get("adapter_id")
        updates = body.get("updates", {})
        if adapter_id and updates:
            ok = await manager.update_adapter_config(adapter_id, updates)
            if not ok:
                return JSONResponse(
                    status_code=400, content={"error": "unknown_adapter"}
                )

        # Batch adapter updates (used by the multi-agent settings UI).
        adapters = body.get("adapters", {})
        for aid, cfg_updates in adapters.items():
            ok = await manager.update_adapter_config(aid, cfg_updates)
            if not ok:
                return JSONResponse(
                    status_code=400, content={"error": f"unknown_adapter: {aid}"}
                )

        new_default = body.get("default")
        if new_default:
            config.agent_adapter.default = new_default

        # Persist overrides so they survive restart.
        override: dict[str, Any] = {}
        for aid, cfg in config.agent_adapter.adapters.items():
            override[aid] = {
                k: v
                for k, v in cfg.items()
                if k in ("command", "model", "enabled", "working_dir")
            }
        _save_agent_settings(override)

        return JSONResponse(
            content={"ok": True, "default": config.agent_adapter.default}
        )

    @app.get("/api/settings/server")
    async def get_server_settings() -> JSONResponse:
        """Return mutable server-level settings."""
        return JSONResponse(
            content={
                "history_limit": config.sessions.history_limit,
            }
        )

    @app.post("/api/settings/server")
    async def update_server_settings(request: Request) -> JSONResponse:
        """Update server-level settings and persist override."""
        body = await request.json()
        if "history_limit" in body:
            try:
                config.sessions.history_limit = max(1, int(body["history_limit"]))
            except (ValueError, TypeError):
                return JSONResponse(
                    status_code=400, content={"error": "invalid_history_limit"}
                )
        _save_server_settings({"history_limit": config.sessions.history_limit})
        return JSONResponse(
            content={"ok": True, "history_limit": config.sessions.history_limit}
        )

    @app.get("/api/server/info")
    async def server_info(request: Request) -> JSONResponse:
        """Return the URL clients can use to reach this server."""
        host = request.headers.get("host", f"{config.server.host}:{config.server.port}")
        scheme = request.headers.get("x-forwarded-proto", "http")
        return JSONResponse(content={"url": f"{scheme}://{host}"})

    @app.get("/api/server/qr")
    async def server_qr(url: str) -> StreamingResponse:
        """Generate a PNG QR code for the given URL."""
        img = qrcode.make(url, box_size=6, border=2)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/png")

    manager = SessionManager(config)

    @app.on_event("startup")
    async def startup() -> None:
        await manager.init()

    @app.websocket(config.server.ws_path)
    async def websocket_endpoint(websocket: WebSocket) -> None:
        """Main WebSocket loop: accept, identify session, dispatch messages."""
        query_params = dict(websocket.query_params)
        session_id = query_params.get("session_id")
        persona_id = query_params.get("persona_id", "exusiai")

        if session_id:
            session = await manager.get_session(session_id)
            if session is None:
                session = await manager.create_session(persona_id)
        else:
            session = await manager.create_session(persona_id)

        connection = WSConnection(websocket)

        async def on_new_session(new_session: Any) -> None:
            await manager.close_adapter(session.id)
            connection.session_id = new_session.id
            handshake = HandshakeMessage(
                session_id=new_session.id,
                payload=HandshakePayload(
                    server_version="0.1.0",
                    session_id=new_session.id,
                    persona_id=getattr(new_session, "persona_id", None),
                    supported_features=["streaming", "options", "interrupt"],
                ),
            )
            await connection.send_message(handshake)

        handler = MessageHandler(manager, connection, on_new_session=on_new_session)

        await connection.accept(session)

        try:
            while True:
                client_message = await connection.receive_message()
                if client_message is None:
                    break
                await handler.handle(client_message)
        except WebSocketDisconnect:
            logger.info("websocket_disconnected", session_id=connection.session_id)
        finally:
            await manager.close_adapter(connection.session_id or session.id)
            await connection.close()

    # Mount static files last so API/WebSocket routes take precedence.
    static_dir = Path(config.server.static_dir)
    if not static_dir.is_absolute():
        project_root = Path(__file__).parent.parent
        static_dir = project_root / static_dir
    static_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app


app = create_app()
