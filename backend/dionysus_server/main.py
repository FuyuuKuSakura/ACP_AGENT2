"""FastAPI application entry point for the Dionysus backend."""

from __future__ import annotations

import io
import json
import shutil
import subprocess
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


def _wallpaper_settings_path() -> Path:
    return Path(__file__).parent.parent / "data" / "wallpaper_settings.json"


_DEFAULT_WALLPAPER_OPACITY = 0.15
_DEFAULT_WALLPAPER_BLUR = 8
_DEFAULT_WALLPAPER_BRIGHTNESS = 0.7


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


def _load_wallpaper_settings() -> dict[str, Any] | None:
    path = _wallpaper_settings_path()
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("failed_to_load_wallpaper_settings", error=str(exc))
        return None


def _save_wallpaper_settings(data: dict[str, Any]) -> None:
    path = _wallpaper_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _default_wallpaper_response() -> dict[str, Any]:
    return {
        "url": None,
        "opacity": _DEFAULT_WALLPAPER_OPACITY,
        "blur": _DEFAULT_WALLPAPER_BLUR,
        "brightness": _DEFAULT_WALLPAPER_BRIGHTNESS,
    }


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

    @app.post("/api/personas")
    async def create_persona(request: Request) -> JSONResponse:
        """Create a new persona from a YAML payload."""
        try:
            body = await request.json()
        except Exception as exc:
            return JSONResponse(
                status_code=400, content={"error": "invalid_json", "detail": str(exc)}
            )
        yaml_text = body.get("yaml", "")
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
        persona_id = parsed.get("id")
        persona_name = parsed.get("name")
        if not persona_id or not persona_name:
            return JSONResponse(
                status_code=400,
                content={"error": "missing_id_or_name"},
            )
        persona_path = get_config_dir() / "personas" / f"{persona_id}.yaml"
        if persona_path.exists():
            return JSONResponse(
                status_code=409,
                content={"error": "persona_already_exists"},
            )
        persona_path.parent.mkdir(parents=True, exist_ok=True)
        persona_path.write_text(yaml_text, encoding="utf-8")
        return JSONResponse(content={"ok": True, "id": persona_id, "name": persona_name})

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

    @app.get("/api/personas/{persona_id}/corpus")
    async def get_persona_corpus(persona_id: str) -> JSONResponse:
        """Return the corpus text for a persona, if any."""
        corpus_path = get_config_dir() / "personas" / "corpus" / f"{persona_id}.txt"
        if not corpus_path.exists():
            return JSONResponse(content={"ok": True, "text": ""})
        try:
            text = corpus_path.read_text(encoding="utf-8")
            return JSONResponse(content={"ok": True, "text": text})
        except Exception as exc:
            logger.warning("get_persona_corpus_failed", error=str(exc))
            return JSONResponse(
                status_code=500, content={"error": "read_failed", "detail": str(exc)}
            )

    @app.post("/api/personas/{persona_id}/corpus")
    async def save_persona_corpus(
        persona_id: str, request: Request
    ) -> JSONResponse:
        """Save a corpus for a persona from JSON text or uploaded .txt file."""
        content_type = request.headers.get("content-type", "")
        corpus_dir = get_config_dir() / "personas" / "corpus"
        corpus_dir.mkdir(parents=True, exist_ok=True)
        target = corpus_dir / f"{persona_id}.txt"

        if "application/json" in content_type:
            try:
                body = await request.json()
            except Exception as exc:
                return JSONResponse(
                    status_code=400, content={"error": "invalid_json", "detail": str(exc)}
                )
            text = body.get("text", "")
            try:
                target.write_text(text, encoding="utf-8")
                return JSONResponse(
                    content={"ok": True, "path": str(target), "size": len(text)}
                )
            except Exception as exc:
                logger.warning("save_persona_corpus_failed", error=str(exc))
                return JSONResponse(
                    status_code=500, content={"error": "save_failed", "detail": str(exc)}
                )

        # Fallback to multipart file upload.
        form = await request.form()
        file = form.get("file")
        if file is None or not isinstance(file, UploadFile):
            return JSONResponse(
                status_code=400, content={"error": "missing_file"}
            )
        if not file.filename or not file.filename.endswith(".txt"):
            return JSONResponse(
                status_code=400, content={"error": "only_txt_files_allowed"}
            )
        content = await file.read()
        if len(content) > 5 * 1024 * 1024:
            return JSONResponse(
                status_code=400, content={"error": "file_too_large"}
            )
        target.write_bytes(content)
        return JSONResponse(
            content={"ok": True, "path": str(target), "size": len(content)}
        )

    _personas_live2d_dir = get_config_dir() / "personas" / "live2d"
    _personas_live2d_dir.mkdir(parents=True, exist_ok=True)

    @app.post("/api/personas/{persona_id}/live2d")
    async def upload_persona_live2d(
        persona_id: str, files: list[UploadFile] = File(...)
    ) -> JSONResponse:
        """Upload a Live2D model folder for a persona and update its YAML config."""
        if not files:
            return JSONResponse(
                status_code=400, content={"error": "no_files_uploaded"}
            )

        target_dir = _personas_live2d_dir / persona_id
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        entry_file: str | None = None
        total_size = 0
        for upload in files:
            if not upload.filename:
                continue
            # Skip macOS metadata files.
            if ".DS_Store" in upload.filename:
                await upload.read()
                continue
            rel_path = Path(upload.filename)
            # Strip the top-level directory name if the browser included it.
            if len(rel_path.parts) > 1:
                rel_path = Path(*rel_path.parts[1:])
            dest = target_dir / rel_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            content = await upload.read()
            total_size += len(content)
            dest.write_bytes(content)
            if entry_file is None and str(rel_path).lower().endswith(".model3.json"):
                entry_file = str(rel_path).replace("\\", "/")

        if entry_file is None:
            return JSONResponse(
                status_code=400,
                content={"error": "no_model3_json_found"},
            )

        # Update the persona YAML with the new model path.
        persona_path = get_config_dir() / "personas" / f"{persona_id}.yaml"
        if persona_path.exists():
            try:
                yaml_text = persona_path.read_text(encoding="utf-8")
                parsed = yaml.safe_load(yaml_text) or {}
                companion = parsed.setdefault("companion", {})
                live2d_cfg = companion.setdefault("live2d", {})
                live2d_cfg["model_path"] = f"/personas/live2d/{persona_id}/{entry_file}"
                persona_path.write_text(
                    yaml.dump(parsed, allow_unicode=True, sort_keys=False),
                    encoding="utf-8",
                )
            except Exception as exc:
                logger.warning("update_persona_live2d_failed", error=str(exc))
                return JSONResponse(
                    status_code=500,
                    content={"error": "update_persona_failed", "detail": str(exc)},
                )

        return JSONResponse(
            content={
                "ok": True,
                "model_path": f"/personas/live2d/{persona_id}/{entry_file}",
                "files_saved": len(files),
                "total_size": total_size,
            }
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

    @app.post("/api/open-cc-switch")
    async def open_cc_switch() -> JSONResponse:
        """Open the local CC Switch application (macOS)."""
        try:
            subprocess.run(
                ["open", "/Applications/CC Switch.app"],
                check=True,
                capture_output=True,
                text=True,
            )
            return JSONResponse({"success": True})
        except subprocess.CalledProcessError as exc:
            logger.warning("open_cc_switch_failed", stderr=exc.stderr)
            return JSONResponse(
                {"success": False, "error": exc.stderr or "无法打开 CC Switch"},
                status_code=500,
            )
        except FileNotFoundError:
            return JSONResponse(
                {"success": False, "error": "未找到 open 命令或 CC Switch.app"},
                status_code=500,
            )

    _wallpaper_dir = Path(__file__).parent.parent / "data" / "wallpapers"
    _wallpaper_dir.mkdir(parents=True, exist_ok=True)

    def _clear_wallpaper_dir() -> None:
        """Remove all files in the wallpapers directory."""
        for old in _wallpaper_dir.iterdir():
            if old.is_file():
                old.unlink()

    @app.post("/api/wallpaper")
    async def upload_wallpaper(file: UploadFile = File(...)) -> JSONResponse:
        """Upload a wallpaper image, replacing any existing one."""
        if not file.filename:
            return JSONResponse(
                status_code=400, content={"error": "missing_filename"}
            )
        ext = Path(file.filename).suffix.lower()
        if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
            return JSONResponse(
                status_code=400, content={"error": "unsupported_image_format"}
            )
        try:
            _clear_wallpaper_dir()
            target = _wallpaper_dir / f"wallpaper{ext}"
            content = await file.read()
            target.write_bytes(content)
            _save_wallpaper_settings({
                "url": f"/wallpapers/{target.name}",
                "opacity": _DEFAULT_WALLPAPER_OPACITY,
                "blur": _DEFAULT_WALLPAPER_BLUR,
                "brightness": _DEFAULT_WALLPAPER_BRIGHTNESS,
            })
            return JSONResponse(
                content={"ok": True, "url": f"/wallpapers/{target.name}"}
            )
        except Exception as exc:
            logger.warning("upload_wallpaper_failed", error=str(exc))
            return JSONResponse(
                status_code=500, content={"error": "save_failed", "detail": str(exc)}
            )

    @app.post("/api/wallpaper/config")
    async def save_wallpaper_config(request: Request) -> JSONResponse:
        """Persist wallpaper URL and effect parameters."""
        try:
            body = await request.json()
        except Exception:
            return JSONResponse(
                status_code=400, content={"error": "invalid_json"}
            )
        url = body.get("url")
        opacity = body.get("opacity", _DEFAULT_WALLPAPER_OPACITY)
        blur = body.get("blur", _DEFAULT_WALLPAPER_BLUR)
        brightness = body.get("brightness", _DEFAULT_WALLPAPER_BRIGHTNESS)
        try:
            settings = _load_wallpaper_settings() or _default_wallpaper_response()
            settings["url"] = url
            settings["opacity"] = float(opacity)
            settings["blur"] = int(blur)
            settings["brightness"] = float(brightness)
            _save_wallpaper_settings(settings)
        except Exception as exc:
            logger.warning("save_wallpaper_settings_failed", error=str(exc))
            return JSONResponse(
                status_code=500,
                content={"error": "save_failed", "detail": str(exc)},
            )
        return JSONResponse(content={"ok": True, "url": url})

    @app.get("/api/wallpaper")
    async def get_wallpaper() -> JSONResponse:
        """Return persisted wallpaper configuration, if any."""
        settings = _load_wallpaper_settings()
        if settings is not None:
            return JSONResponse(content=settings)
        return JSONResponse(
            status_code=404,
            content=_default_wallpaper_response(),
        )

    @app.delete("/api/wallpaper")
    async def delete_wallpaper() -> JSONResponse:
        """Remove persisted wallpaper settings and clear uploaded images."""
        try:
            settings_path = _wallpaper_settings_path()
            if settings_path.exists():
                settings_path.unlink()
            _clear_wallpaper_dir()
            return JSONResponse(content={"ok": True})
        except Exception as exc:
            logger.warning("delete_wallpaper_failed", error=str(exc))
            return JSONResponse(
                status_code=500, content={"error": "delete_failed", "detail": str(exc)}
            )

    # Mount static files last so API/WebSocket routes take precedence.
    static_dir = Path(config.server.static_dir)
    if not static_dir.is_absolute():
        project_root = Path(__file__).parent.parent
        static_dir = project_root / static_dir
    static_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/wallpapers", StaticFiles(directory=_wallpaper_dir), name="wallpapers")
    app.mount(
        "/personas/live2d",
        StaticFiles(directory=_personas_live2d_dir),
        name="personas_live2d",
    )
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app


app = create_app()
