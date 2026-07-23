"""Tests for persona avatar upload, retrieval, and deletion endpoints."""

from __future__ import annotations

import io
import random
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Provide a TestClient with isolated persona/avatar directories."""
    config_dir = tmp_path / "config"
    data_dir = tmp_path / "data"
    personas_dir = config_dir / "personas"
    builtin_dir = personas_dir / "builtin"
    personas_dir.mkdir(parents=True, exist_ok=True)
    builtin_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("Dionysus_CONFIG_DIR", str(config_dir))
    monkeypatch.setenv("Dionysus_DATA_DIR", str(data_dir))
    project_root = Path(__file__).resolve().parent.parent.parent
    monkeypatch.chdir(project_root)

    # Import lazily so the env vars are honoured, then patch the module-level
    # persona directories so each test is isolated.
    from dionysus_server import main as main_module
    from dionysus_server.persona import loader as loader_module

    monkeypatch.setattr(main_module, "_PERSONA_DIR", personas_dir)
    monkeypatch.setattr(main_module, "_BUILTIN_DIR", builtin_dir)
    monkeypatch.setattr(loader_module, "_PERSONA_DIR", personas_dir)
    monkeypatch.setattr(loader_module, "_BUILTIN_DIR", builtin_dir)

    app = main_module.create_app()
    return TestClient(app)


def _create_persona(client: TestClient, persona_id: str, name: str | None = None) -> None:
    name = name or persona_id
    yaml_text = (
        f"id: {persona_id}\n"
        f"name: {name}\n"
        "description: test avatar persona\n"
        f"system_prompt: you are {name}\n"
    )
    resp = client.post("/api/personas", json={"yaml": yaml_text})
    assert resp.status_code == 200, resp.text


def _make_png(width: int = 32, height: int = 32) -> io.BytesIO:
    img = Image.new("RGBA", (width, height), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def test_upload_valid_png_returns_ok_and_serves_content(client: TestClient) -> None:
    persona_id = "test_avatar_valid"
    _create_persona(client, persona_id)

    buf = _make_png(32, 32)
    resp = client.post(
        f"/api/personas/{persona_id}/avatar",
        files={"file": ("avatar.png", buf, "image/png")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert f"/api/personas/{persona_id}/avatar" in data["url"]

    get_resp = client.get(f"/api/personas/{persona_id}/avatar")
    assert get_resp.status_code == 200
    assert get_resp.headers["content-type"] == "image/png"
    returned = Image.open(io.BytesIO(get_resp.content))
    assert returned.size == (32, 32)


def test_upload_invalid_extension_returns_400(client: TestClient) -> None:
    persona_id = "test_avatar_invalid_ext"
    _create_persona(client, persona_id)

    resp = client.post(
        f"/api/personas/{persona_id}/avatar",
        files={"file": ("avatar.gif", b"notanimage", "image/gif")},
    )
    assert resp.status_code == 400


def test_upload_oversized_file_returns_400(client: TestClient) -> None:
    persona_id = "test_avatar_oversized"
    _create_persona(client, persona_id)

    # Create a noisy PNG larger than 2 MiB (random pixels don't compress well).
    img = Image.new("RGBA", (1200, 1200))
    pixels = [
        (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255), 255)
        for _ in range(1200 * 1200)
    ]
    img.putdata(pixels)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    assert len(buf.getvalue()) > 2 * 1024 * 1024

    resp = client.post(
        f"/api/personas/{persona_id}/avatar",
        files={"file": ("avatar.png", buf, "image/png")},
    )
    assert resp.status_code == 400


def test_delete_removes_avatar_and_get_falls_back(client: TestClient) -> None:
    persona_id = "test_avatar_delete"
    _create_persona(client, persona_id)

    buf = _make_png(16, 16)
    upload_resp = client.post(
        f"/api/personas/{persona_id}/avatar",
        files={"file": ("avatar.png", buf, "image/png")},
    )
    assert upload_resp.status_code == 200

    del_resp = client.delete(f"/api/personas/{persona_id}/avatar")
    assert del_resp.status_code == 200
    assert del_resp.json()["ok"] is True

    get_resp = client.get(f"/api/personas/{persona_id}/avatar")
    assert get_resp.status_code == 200
    assert get_resp.headers["content-type"] == "image/png"
    # Should fall back to a texture or the generated default; either is valid PNG.
    Image.open(io.BytesIO(get_resp.content)).verify()


def test_list_and_get_persona_include_avatar_url(client: TestClient) -> None:
    persona_id = "test_avatar_url"
    _create_persona(client, persona_id)

    list_resp = client.get("/api/personas")
    assert list_resp.status_code == 200
    personas = list_resp.json()
    persona = next(p for p in personas if p["id"] == persona_id)
    assert persona["avatar_url"] == f"/api/personas/{persona_id}/avatar"

    get_resp = client.get(f"/api/personas/{persona_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["avatar_url"] == f"/api/personas/{persona_id}/avatar"
