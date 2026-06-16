#!/usr/bin/env python3
"""Launcher: start Dionysus backend + frontend and print the LAN URL."""

from __future__ import annotations

import argparse
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen


def get_project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def get_lan_ip() -> str:
    """Return the most likely LAN IPv4 address."""
    # Try macOS primary interface first.
    for iface in ("en0", "en1", "en2", "wlan0", "eth0"):
        try:
            result = subprocess.run(
                ["ipconfig", "getifaddr", iface],
                capture_output=True,
                text=True,
                check=False,
                timeout=2,
            )
            addr = result.stdout.strip()
            if addr and not addr.startswith("127."):
                return addr
        except Exception:
            pass

    # Fallback: UDP socket trick.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            addr = s.getsockname()[0]
            if addr and not addr.startswith("127."):
                return addr
    except Exception:
        pass

    return "127.0.0.1"


def wait_for_url(url: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=1):
                return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Launch Dionysus services")
    parser.add_argument("--backend-port", type=int, default=8765)
    parser.add_argument("--frontend-port", type=int, default=5173)
    parser.add_argument("--no-frontend", action="store_true", help="Only start backend")
    parser.add_argument("--host", default="0.0.0.0", help="Backend bind host")
    args = parser.parse_args()

    root = get_project_root()
    backend_dir = root / "backend"
    frontend_dir = root / "frontend"
    venv_python = backend_dir / ".venv" / "bin" / "python"

    env = os.environ.copy()
    env["DIONYSUS_SERVER__HOST"] = args.host
    env["DIONYSUS_SERVER__PORT"] = str(args.backend_port)

    backend_cmd = [
        str(venv_python),
        "-m",
        "uvicorn",
        "dionysus_server.main:app",
        "--host",
        args.host,
        "--port",
        str(args.backend_port),
        "--log-level",
        "info",
    ]

    print(f"[launcher] starting backend on {args.host}:{args.backend_port}")
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=backend_dir,
        env=env,
    )

    if not wait_for_url(f"http://127.0.0.1:{args.backend_port}/api/server/info"):
        print("[launcher] backend failed to start", file=sys.stderr)
        backend_proc.terminate()
        return 1

    lan_ip = get_lan_ip()
    url = f"http://{lan_ip}:{args.frontend_port}"
    print(f"[launcher] backend ready")
    print(f"[launcher] LAN URL: {url}")

    frontend_proc = None
    if not args.no_frontend:
        frontend_cmd = [
            "npm",
            "run",
            "dev",
            "--",
            "--host",
            "0.0.0.0",
            "--port",
            str(args.frontend_port),
        ]
        print(f"[launcher] starting frontend dev server on port {args.frontend_port}")
        frontend_proc = subprocess.Popen(
            frontend_cmd,
            cwd=frontend_dir,
        )

    def shutdown(signum, frame):
        print("\n[launcher] shutting down...")
        backend_proc.terminate()
        if frontend_proc is not None:
            frontend_proc.terminate()
        try:
            backend_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend_proc.kill()
        if frontend_proc is not None:
            try:
                frontend_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                frontend_proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            backend_status = backend_proc.poll()
            frontend_status = frontend_proc.poll() if frontend_proc else None
            if backend_status is not None:
                print(f"[launcher] backend exited with {backend_status}, restarting...", file=sys.stderr)
                if frontend_proc:
                    frontend_proc.terminate()
                    try:
                        frontend_proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        frontend_proc.kill()
                backend_proc = subprocess.Popen(
                    backend_cmd,
                    cwd=backend_dir,
                    env=env,
                )
                if not wait_for_url(f"http://127.0.0.1:{args.backend_port}/api/server/info"):
                    print("[launcher] backend failed to restart", file=sys.stderr)
                    backend_proc.terminate()
                    return 1
                print("[launcher] backend restarted")
                continue
            if frontend_status is not None:
                print(f"[launcher] frontend exited with {frontend_status}, restarting...", file=sys.stderr)
                frontend_proc = subprocess.Popen(
                    frontend_cmd,
                    cwd=frontend_dir,
                )
                continue
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown(None, None)

    return 0


if __name__ == "__main__":
    sys.exit(main())
