"""Tests for the pairing manager and endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from dionysus_server.main import create_app
from dionysus_server.pairing import PairingManager


@pytest.fixture
def pairing_manager(tmp_path):
    return PairingManager(tmp_path)


def test_pair_token_lifecycle(pairing_manager: PairingManager) -> None:
    token = pairing_manager.create_pair_token()
    assert isinstance(token, str)
    device = pairing_manager.verify_pair_token(token)
    assert isinstance(device, str)
    assert pairing_manager.is_device_valid(device)
    assert pairing_manager.verify_pair_token(token) is None


def test_expired_pair_token(pairing_manager: PairingManager, monkeypatch) -> None:
    token = pairing_manager.create_pair_token()
    monkeypatch.setattr("dionysus_server.pairing.time.time", lambda: 1_000_000_000_000)
    assert pairing_manager.verify_pair_token(token) is None


def test_revoke_device(pairing_manager: PairingManager) -> None:
    token = pairing_manager.create_pair_token()
    device = pairing_manager.verify_pair_token(token)
    assert pairing_manager.revoke_device(device)
    assert not pairing_manager.is_device_valid(device)
    assert not pairing_manager.revoke_device(device)


def test_pair_endpoints_json_validation(tmp_path, monkeypatch) -> None:
    app = create_app()
    client = TestClient(app)
    resp = client.post("/api/pair", json=[1, 2, 3])
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_json_object"

    resp = client.post("/api/pair/revoke", json="not-an-object")
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_json_object"
