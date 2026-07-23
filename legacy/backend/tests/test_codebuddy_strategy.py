"""Unit tests for the CodeBuddy Code CLI strategy."""

from __future__ import annotations

import json

import pytest

from dionysus_server.agent_adapters.strategies.codebuddy import CodeBuddyStrategy
from dionysus_server.models import StatusEnum


@pytest.fixture
def strategy() -> CodeBuddyStrategy:
    return CodeBuddyStrategy()


class TestBuildArgs:
    def test_normal_mode(self, strategy: CodeBuddyStrategy) -> None:
        args = strategy.build_args("hello", None, "normal", {})
        assert args == ["-p", "hello", "--output-format", "stream-json", "-y"]

    def test_plan_mode_prefix(self, strategy: CodeBuddyStrategy) -> None:
        args = strategy.build_args("hello", None, "plan", {})
        assert args[0] == "-p"
        assert "plan mode" in args[1].lower()
        assert "hello" in args[1]
        assert args[2:] == ["--output-format", "stream-json", "-y"]

    def test_resume_and_model(self, strategy: CodeBuddyStrategy) -> None:
        args = strategy.build_args("hi", "sess-1", "normal", {"model": "gpt-4o"})
        assert "--resume" in args
        assert "sess-1" in args
        assert "--model" in args
        assert "gpt-4o" in args


class TestSessionExtraction:
    def test_extract_session_id_from_init(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({"type": "system", "subtype": "init", "session_id": "abc"})
        holder: dict[str, str | None] = {"session_id": None}
        strategy.handle_line(line, holder)
        assert holder["session_id"] == "abc"


class TestEventParsing:
    def test_system_init_yields_no_events(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({"type": "system", "subtype": "init", "session_id": "abc"})
        events = strategy.handle_line(line, {})
        assert events == []

    def test_file_history_snapshot_ignored(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({"type": "file-history-snapshot", "files": []})
        events = strategy.handle_line(line, {})
        assert events == []

    def test_assistant_text(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "Hi"}]},
        })
        events = strategy.handle_line(line, {})
        assert len(events) == 2
        assert events[0].type == "status_update"
        assert events[1].type == "agent_stream"
        assert events[1].payload["chunk"] == "Hi"
        assert events[1].payload["status"] == StatusEnum.OUTPUTTING
        assert events[1].payload.get("is_thinking") is None

    def test_assistant_thinking(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({
            "type": "assistant",
            "message": {"content": [{"type": "thinking", "thinking": "step 1"}]},
        })
        events = strategy.handle_line(line, {})
        assert len(events) == 1
        assert events[0].type == "agent_stream"
        assert events[0].payload["chunk"] == "step 1"
        assert events[0].payload["status"] == StatusEnum.THINKING
        assert events[0].payload["is_thinking"] is True

    def test_assistant_tool_use(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({
            "type": "assistant",
            "message": {
                "content": [{"type": "tool_use", "name": "read", "input": {"path": "x"}}]
            },
        })
        events = strategy.handle_line(line, {})
        assert len(events) == 1
        assert events[0].type == "agent_stream"
        assert "read" in events[0].payload["chunk"]
        assert events[0].payload["status"] == StatusEnum.EXECUTING

    def test_assistant_tool_result(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({
            "type": "assistant",
            "message": {"content": [{"type": "tool_result", "content": "done"}]},
        })
        events = strategy.handle_line(line, {})
        assert len(events) == 1
        assert events[0].type == "agent_stream"
        assert "done" in events[0].payload["chunk"]

    def test_result_error(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({"type": "result", "is_error": True, "result": "boom"})
        events = strategy.handle_line(line, {})
        assert len(events) == 1
        assert events[0].type == "agent_complete"
        assert events[0].payload["status"] == "error"
        assert events[0].payload["error_message"] == "boom"

    def test_result_success_is_silent(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({"type": "result", "is_error": False, "result": "ok"})
        events = strategy.handle_line(line, {})
        assert events == []

    def test_unknown_shape_falls_back(self, strategy: CodeBuddyStrategy) -> None:
        line = json.dumps({"type": "weird", "data": 1})
        events = strategy.handle_line(line, {})
        assert len(events) == 1
        assert events[0].type == "agent_stream"
        assert "weird" in events[0].payload["chunk"]
