"""CLI adapter strategies for different agent CLIs."""

from __future__ import annotations

from .claude import ClaudeStrategy
from .codebuddy import CodeBuddyStrategy
from .codex import CodexStrategy
from .kimi import KimiStrategy
from .opencode import OpenCodeStrategy

__all__ = ["ClaudeStrategy", "CodeBuddyStrategy", "CodexStrategy", "KimiStrategy", "OpenCodeStrategy"]
