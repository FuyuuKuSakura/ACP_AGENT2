"""CLI entry point to run the Dionysus backend with uvicorn."""

from __future__ import annotations

import uvicorn

from dionysus_server.config import load_config

config = load_config()

if __name__ == "__main__":
    uvicorn.run(
        "dionysus_server.main:app",
        host=config.server.host,
        port=config.server.port,
        log_level=config.server.log_level,
    )
