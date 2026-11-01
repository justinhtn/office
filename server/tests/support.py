"""Loads the server with its data and home pointed at a throwaway folder.

The server reads its paths and port when imported, so this must happen before anything uses it.
"""
import atexit
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from unittest import mock

SANDBOX = Path(tempfile.mkdtemp(prefix="agent-office-tests-")).resolve()
atexit.register(shutil.rmtree, SANDBOX, ignore_errors=True)
DATA = SANDBOX / "data"
HOME = SANDBOX / "home"
WORK = SANDBOX / "work"
SERVER_PATH = Path(__file__).resolve().parent.parent / "server.py"


def load_server():
    spec = importlib.util.spec_from_file_location("office_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    environment = {"AGENT_OFFICE_HOME": str(DATA), "HOME": str(HOME)}
    # The module never listens by itself. Port 0 keeps its allowed hosts away from the real default.
    with mock.patch.dict(os.environ, environment), mock.patch.object(sys, "argv", ["server.py", "0"]):
        spec.loader.exec_module(module)
    for path in (module.DATA, module.CLAUDE_PROJECTS, module.APP_SESSIONS):
        if not path.is_relative_to(SANDBOX):
            raise RuntimeError(f"Tests would have touched {path}")

    return module


server = load_server()


def clean_slate():
    """Empties the throwaway folders, for a test's setUp."""
    for folder in (DATA, HOME, WORK):
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)


def write_transcript(path, records):
    """Writes records the way Claude Code does. The parser looks for the compact form."""
    lines = [record if isinstance(record, str) else json.dumps(record, separators=(",", ":")) for record in records]
    path.write_text("\n".join(lines) + "\n")

    return path


def user(text, **extra):
    return {"type": "user", "timestamp": "2026-01-01T10:00:00.000Z", "message": {"content": text}, **extra}


def assistant(*blocks, **extra):
    return {"type": "assistant", "timestamp": "2026-01-01T10:00:01.000Z", "message": {"content": list(blocks)}, **extra}


def text(body):
    return {"type": "text", "text": body}


def tool(tool_id, name, **tool_input):
    return {"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}


def result(tool_id, content="ok", is_error=False):
    return user([{"type": "tool_result", "tool_use_id": tool_id, "content": content, "is_error": is_error}])
