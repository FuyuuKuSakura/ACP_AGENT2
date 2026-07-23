"""Entry point for bundling the Dionysus backend inside the Electron app.

PyInstaller uses this script to produce a standalone executable.  The Electron
main process sets Dionysus_CONFIG_DIR / Dionysus_DATA_DIR / Dionysus_server__*
environment variables before spawning the executable.
"""

from __future__ import annotations

import os

import uvicorn

from dionysus_server.main import app

HOST = os.environ.get("Dionysus_server__host", "127.0.0.1")
PORT = int(os.environ.get("Dionysus_server__port", "8765"))

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
