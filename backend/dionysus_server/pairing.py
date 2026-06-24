"""Host-mobile pairing with short-lived pair tokens and long-lived device tokens."""

from __future__ import annotations

import json
import secrets
import time
from pathlib import Path
from typing import Any

import structlog

from dionysus_server.paths import get_data_dir

logger = structlog.get_logger()

PAIR_TOKEN_TTL_SECONDS = 300
DEVICE_TOKEN_BYTES = 32


class PairingManager:
    """Manages one-time pair tokens and persistent device tokens.

    Pair tokens live only in memory and expire after ``PAIR_TOKEN_TTL_SECONDS``.
    Verified pair tokens are exchanged for a long-lived device token that is
    stored in ``Dionysus_DATA_DIR/pairing/devices.json`` so the host can revoke
    devices later.
    """

    def __init__(self, data_dir: Path | None = None) -> None:
        self._data_dir = (data_dir or get_data_dir()) / "pairing"
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._devices_path = self._data_dir / "devices.json"
        self._pair_tokens: dict[str, float] = {}
        self._devices: dict[str, dict[str, Any]] = self._load_devices()
        self._logger = logger.bind(component="PairingManager")

    def _load_devices(self) -> dict[str, dict[str, Any]]:
        if not self._devices_path.exists():
            return {}
        try:
            data = json.loads(self._devices_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception as exc:
            self._logger.warning("load_devices_failed", error=str(exc))
        return {}

    def _save_devices(self) -> None:
        self._devices_path.write_text(
            json.dumps(self._devices, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _prune_pair_tokens(self) -> None:
        now = time.time()
        expired = [t for t, expiry in self._pair_tokens.items() if expiry < now]
        for t in expired:
            self._pair_tokens.pop(t, None)

    def create_pair_token(self) -> str:
        """Create a new short-lived pair token."""
        self._prune_pair_tokens()
        token = secrets.token_urlsafe(16)
        self._pair_tokens[token] = time.time() + PAIR_TOKEN_TTL_SECONDS
        return token

    def verify_pair_token(self, token: str) -> str | None:
        """Verify a pair token and return a new device token, or None if invalid."""
        self._prune_pair_tokens()
        expiry = self._pair_tokens.pop(token, None)
        if expiry is None:
            return None
        device_token = secrets.token_urlsafe(DEVICE_TOKEN_BYTES)
        self._devices[device_token] = {
            "created_at": time.time(),
            "last_seen": time.time(),
        }
        self._save_devices()
        return device_token

    def list_devices(self) -> dict[str, dict[str, Any]]:
        return dict(self._devices)

    def revoke_device(self, device_token: str) -> bool:
        if device_token not in self._devices:
            return False
        del self._devices[device_token]
        self._save_devices()
        return True

    def is_device_valid(self, device_token: str) -> bool:
        return device_token in self._devices
