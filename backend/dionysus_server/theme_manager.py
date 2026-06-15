"""Theme CRUD helpers for custom user themes."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

import structlog
import yaml

from dionysus_server.config import get_config_dir

logger = structlog.get_logger()

_BUILTIN_THEME_IDS = {"default_dark", "default_light"}
_THEME_SCHEMA_KEYS = {"id", "name", "mode", "fonts", "colors", "assets"}


def _themes_dir() -> Path:
    return get_config_dir() / "themes"


def _is_valid_theme_id(theme_id: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9_\-]+", theme_id))


def list_themes() -> list[dict[str, Any]]:
    """Return all theme YAML files as dicts, with a builtin flag."""
    themes: list[dict[str, Any]] = []
    theme_dir = _themes_dir()
    if not theme_dir.exists():
        return themes
    for path in sorted(theme_dir.glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            if data.get("id"):
                data["builtin"] = data["id"] in _BUILTIN_THEME_IDS
                themes.append(data)
        except Exception:
            logger.warning("failed_to_read_theme", path=str(path))
    return themes


def get_theme(theme_id: str) -> dict[str, Any] | None:
    """Return a single theme dict or None if missing."""
    path = _themes_dir() / f"{theme_id}.yaml"
    if not path.exists():
        return None
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        data["builtin"] = data.get("id") in _BUILTIN_THEME_IDS
        return data
    except Exception:
        return None


def validate_theme(data: dict[str, Any]) -> tuple[bool, str]:
    """Check that data roughly follows the Theme schema."""
    if not isinstance(data, dict):
        return False, "theme must be an object"
    missing = _THEME_SCHEMA_KEYS - set(data.keys())
    if missing:
        return False, f"missing keys: {sorted(missing)}"
    if data.get("mode") not in {"light", "dark", "auto"}:
        return False, "mode must be light/dark/auto"
    colors = data.get("colors") or {}
    required_colors = {
        "primary",
        "primaryHover",
        "accent",
        "background",
        "chatBackground",
        "userBubble",
        "agentBubbleLight",
        "agentBubbleDark",
        "textPrimaryLight",
        "textPrimaryDark",
        "textSecondary",
        "system",
        "danger",
        "success",
        "codeBackgroundLight",
        "codeBackgroundDark",
        "borderLight",
        "borderDark",
    }
    missing_colors = required_colors - set(colors.keys())
    if missing_colors:
        return False, f"missing colors: {sorted(missing_colors)}"
    return True, ""


def save_theme(theme_id: str, data: dict[str, Any]) -> tuple[bool, str]:
    """Save or overwrite a custom theme YAML file.

    Built-in themes are protected from overwrite.
    """
    if theme_id in _BUILTIN_THEME_IDS:
        return False, "cannot overwrite built-in theme"
    if not _is_valid_theme_id(theme_id):
        return False, "invalid theme id"

    data["id"] = theme_id
    ok, error = validate_theme(data)
    if not ok:
        return False, error

    theme_dir = _themes_dir()
    theme_dir.mkdir(parents=True, exist_ok=True)
    path = theme_dir / f"{theme_id}.yaml"

    # Backup existing custom theme.
    if path.exists():
        backup = path.with_suffix(".yaml.bak")
        shutil.copy2(path, backup)

    try:
        path.write_text(
            yaml.safe_dump(data, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
    except Exception as exc:
        return False, f"write failed: {exc}"

    return True, ""


def delete_theme(theme_id: str) -> tuple[bool, str]:
    """Delete a custom theme file."""
    if theme_id in _BUILTIN_THEME_IDS:
        return False, "cannot delete built-in theme"
    path = _themes_dir() / f"{theme_id}.yaml"
    if not path.exists():
        return False, "theme not found"
    try:
        path.unlink()
        return True, ""
    except Exception as exc:
        return False, str(exc)
