"""Load persona YAML files from the configured personas directory."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import structlog
import yaml

from dionysus_server.config import get_config_dir

logger = structlog.get_logger()

_PERSONA_DIR = get_config_dir() / "personas"
_BUILTIN_DIR = _PERSONA_DIR / "builtin"


def _load_yaml_file(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _persona_path(persona_id: str) -> Path | None:
    """Return the path to a persona YAML, preferring runtime over builtin."""
    for directory in (_PERSONA_DIR, _BUILTIN_DIR):
        for ext in (".yaml", ".yml"):
            path = directory / f"{persona_id}{ext}"
            if path.exists():
                return path
    return None


def load_persona(persona_id: str) -> dict[str, Any]:
    """Load a single persona by id, runtime files take precedence over builtin."""
    path = _persona_path(persona_id)
    if path is None:
        logger.warning("persona_not_found", persona_id=persona_id)
        return {}
    return _load_yaml_file(path)


def list_personas() -> list[dict[str, Any]]:
    """List all personas; runtime overrides builtin for duplicate ids."""
    personas: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for directory in (_PERSONA_DIR, _BUILTIN_DIR):
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.yaml")):
            data = _load_yaml_file(path)
            persona_id = data.get("id")
            if persona_id and persona_id not in seen_ids:
                personas.append(data)
                seen_ids.add(persona_id)
        for path in sorted(directory.glob("*.yml")):
            data = _load_yaml_file(path)
            persona_id = data.get("id")
            if persona_id and persona_id not in seen_ids:
                personas.append(data)
                seen_ids.add(persona_id)

    return personas


def persona_exists(persona_id: str) -> bool:
    """Check whether a persona file exists (runtime or builtin)."""
    return _persona_path(persona_id) is not None
