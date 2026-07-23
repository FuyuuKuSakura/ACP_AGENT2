"""Central path resolution for the Dionysus server runtime.

All mutable/runtime data should be written under ``Dionysus_DATA_DIR``.
Static configuration lives under ``Dionysus_CONFIG_DIR``.
When the environment variables are not set, sensible development defaults are
used so the server can still be started directly from the source tree.
"""

from __future__ import annotations

import os
import platform
from pathlib import Path

_SOURCE_ROOT = Path(__file__).resolve().parent.parent


def get_open_command(path: Path) -> list[str]:
    """Return a platform-appropriate command to open a directory/file."""
    system = platform.system()
    if system == "Windows":
        return ["explorer", str(path)]
    if system == "Darwin":
        return ["open", str(path)]
    return ["xdg-open", str(path)]


def get_source_root() -> Path:
    """Return the backend source root (``backend/``)."""
    return _SOURCE_ROOT


def get_config_dir() -> Path:
    """Return the active configuration directory.

    Defaults to ``backend/config`` in the source tree. Electron builds should
    set ``Dionysus_CONFIG_DIR`` to a writable location (e.g. ``userData/config``).
    """
    env = os.environ.get("Dionysus_CONFIG_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return _SOURCE_ROOT / "config"


def get_data_dir() -> Path:
    """Return the active runtime data directory.

    Defaults to ``<config_dir>/../data`` for development. Packaged builds should
    set ``Dionysus_DATA_DIR`` to a writable user-data location.
    """
    env = os.environ.get("Dionysus_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return get_config_dir().parent / "data"


def resolve_config_path(path: str | Path, base: Path | None = None) -> Path:
    """Resolve a configured path against ``Dionysus_CONFIG_DIR``.

    Absolute paths are preserved. Relative paths are resolved relative to the
    given base (defaulting to the config directory) so that ``server.yaml`` can
    use stable relative paths regardless of the process working directory.
    """
    p = Path(path)
    if p.is_absolute():
        return p.resolve()
    base = base or get_config_dir()
    return (base / p).resolve()


def resolve_data_path(path: str | Path, base: Path | None = None) -> Path:
    """Resolve a configured path against ``Dionysus_DATA_DIR``.

    Use this for runtime files such as the SQLite database, uploaded assets,
    or persisted JSON settings.
    """
    p = Path(path)
    if p.is_absolute():
        return p.resolve()
    base = base or get_data_dir()
    return (base / p).resolve()
