#!/usr/bin/env python3
"""Local server for Agent Office. Binds to loopback and requires a per-start token.

Files, git, names and status are answered here. Transcripts and messages go through
a folder of request files that the agent-office plugin answers from any running
Claude Code session.
"""
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "web" / "dist"
DATA = Path(os.environ.get("AGENT_OFFICE_HOME", Path.home() / ".agent-office"))
BRIDGE = DATA / "bridge"
RAW_SESSIONS = DATA / "sessions.raw.json"
PEOPLE = DATA / "people.json"
NAMES = DATA / "names.json"
FINISHED = DATA / "finished.json"
WATCH_S = 2
NAME_POOL = [
    "Greg", "Stephanie", "Maya", "Omar", "Priya", "Leo", "Nina", "Theo", "Ana", "Sam",
    "Iris", "Marcus", "Lena", "Felix", "Tara", "Hugo", "Rosa", "Ben", "Yuki", "Dev",
    "Clara", "Ravi", "Zoe", "Noah", "Elsa", "Kofi", "Mina", "Owen", "Sofia", "Jonah",
    "Asha", "Paul", "Vera", "Ivan", "Dana", "Eli", "Nora", "Tomas", "June", "Amir",
]
ASSET_TYPES = {
    ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf",
    ".svg": "image/svg+xml", ".woff2": "font/woff2",
}
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8794
TOKEN = secrets.token_urlsafe(32)
ALLOWED_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
ALLOWED_ORIGINS = {f"http://{host}" for host in ALLOWED_HOSTS}
MAX_OUTPUT = 200_000
MAX_MESSAGE = 20_000
BRIDGE_TIMEOUT_S = 30
SESSION_ID = re.compile(r"^local_[0-9a-f-]{36}$")
CURSOR = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
SECRET_FILE = re.compile(r"(^|/)(\.env(\..*)?|.*\.(pem|key|p12)|id_(rsa|ed25519)|credentials(\.json)?)$", re.I)


class Refused(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def read_json(path, fallback):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value))
    temporary.replace(path)


class Office:
    """Owns names and status, so they don't depend on which session is publishing."""

    def __init__(self):
        self.lock = threading.Lock()
        self.names = read_json(NAMES, {})
        self.finished = set(read_json(FINISHED, []))
        self.was_running = {}
        self.seen_raw = None
        self.snapshot = {"people": [], "updatedAt": ""}

    def assign_names(self, rows):
        taken = set(self.names.values())
        changed = False
        for row in rows:
            if row["id"] in self.names:
                continue
            name = next((n for n in NAME_POOL if n not in taken), f"Agent {len(taken) + 1}")
            self.names[row["id"]] = name
            taken.add(name)
            changed = True
        if changed:
            write_json(NAMES, self.names)

    def rebuild(self):
        rows = self.seen_raw.get("people", [])
        self.assign_names(rows)
        people = [
            {**row, "name": self.names[row["id"]], "isFinished": row["id"] in self.finished}
            for row in rows
        ]
        self.snapshot = {"updatedAt": self.seen_raw.get("updatedAt", ""), "people": people}
        write_json(PEOPLE, self.snapshot)

    def ingest(self):
        raw = read_json(RAW_SESSIONS, None)
        with self.lock:
            if raw is None or raw == self.seen_raw:
                return
            for row in raw.get("people", []):
                if self.was_running.get(row["id"]) and not row.get("isRunning"):
                    self.finished.add(row["id"])
                if row.get("isRunning"):
                    self.finished.discard(row["id"])
                self.was_running[row["id"]] = bool(row.get("isRunning"))
            write_json(FINISHED, sorted(self.finished))
            self.seen_raw = raw
            self.rebuild()

    def mark_seen(self, session_id):
        with self.lock:
            self.finished.discard(session_id)
            write_json(FINISHED, sorted(self.finished))
            if self.seen_raw:
                self.rebuild()

    def watch(self):
        while True:
            try:
                self.ingest()
            except Exception:
                traceback.print_exc()
            time.sleep(WATCH_S)


OFFICE = Office()


def sessions():
    with OFFICE.lock:
        return OFFICE.snapshot


def session_cwd(session_id):
    for person in sessions().get("people", []):
        if person.get("id") == session_id and person.get("cwd"):
            cwd = Path(person["cwd"])
            if not cwd.is_dir():
                raise Refused(404, "This session's folder no longer exists.")
            return cwd
    raise Refused(404, "Unknown session.")


def git(cwd, *args):
    done = subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        errors="replace",
        timeout=15,
    )
    return done.stdout[:MAX_OUTPUT], done.returncode


def changes(session_id):
    cwd = session_cwd(session_id)
    status, code = git(cwd, "status", "--short", "--branch")
    if code != 0:
        return {"status": "This folder isn't a git repository.", "diff": ""}
    diff, _ = git(cwd, "diff", "HEAD", "--no-color")

    return {"status": status, "diff": diff}


def file_list(session_id):
    cwd = session_cwd(session_id)
    listed, code = git(cwd, "ls-files")
    if code == 0:
        return {"files": listed.splitlines()[:2000]}
    names = [entry.name for entry in sorted(cwd.iterdir()) if entry.is_file()]

    return {"files": names[:2000]}


def file_text(session_id, relative):
    cwd = session_cwd(session_id).resolve()
    target = (cwd / relative).resolve()
    if not target.is_relative_to(cwd) or not target.is_file():
        raise Refused(404, "File not found in this session's folder.")
    if SECRET_FILE.search(relative):
        raise Refused(403, "Secret files aren't shown here.")
    with target.open("rb") as handle:
        raw = handle.read(MAX_OUTPUT + 1)
    if b"\0" in raw:
        return {"text": "This is a binary file.", "truncated": False}

    return {"text": raw[:MAX_OUTPUT].decode("utf-8", "replace"), "truncated": len(raw) > MAX_OUTPUT}


def changed_files(session_id):
    cwd = session_cwd(session_id)
    status, code = git(cwd, "status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all")
    if code != 0:
        raise Refused(400, "This folder isn't a git repository.")
    entries = status.split("\0")
    branch, files, index = "", [], 0
    while index < len(entries):
        entry = entries[index]
        index += 1
        if entry.startswith("## "):
            branch = entry[3:].split("...")[0]
        elif len(entry) > 3:
            files.append({"code": entry[:2].strip() or "M", "path": entry[3:]})
            if entry[0] in "RC":
                index += 1

    return {"branch": branch, "files": files[:500]}


def file_diff(session_id, relative):
    cwd = session_cwd(session_id).resolve()
    target = (cwd / relative).resolve()
    if not relative or not target.is_relative_to(cwd):
        raise Refused(404, "File not found in this session's folder.")
    if SECRET_FILE.search(relative):
        raise Refused(403, "Secret files aren't shown here.")
    original, code = git(cwd, "show", f"HEAD:{relative}")
    modified = target.read_bytes()[:MAX_OUTPUT] if target.is_file() else b""
    if "\0" in original or b"\0" in modified:
        return {"original": "", "modified": "This is a binary file."}

    return {"original": original if code == 0 else "", "modified": modified.decode("utf-8", "replace")}


def asset(relative):
    root = DIST.resolve()
    target = (root / relative).resolve()
    kind = ASSET_TYPES.get(target.suffix)
    if not target.is_relative_to(root / "assets") or not target.is_file() or not kind:
        raise Refused(404, "Not found.")

    return target.read_bytes(), kind


def known_session(session_id):
    if not SESSION_ID.match(session_id or ""):
        raise Refused(400, "Bad session id.")
    if not any(p.get("id") == session_id for p in sessions().get("people", [])):
        raise Refused(404, "Unknown session.")


def bridge_call(request):
    """Writes a request file and waits for the mod's answer."""
    request_id = uuid.uuid4().hex
    pending = BRIDGE / f"req-{request_id}.json"
    answer = BRIDGE / f"res-{request_id}.json"
    temporary = BRIDGE / f"tmp-{request_id}"
    temporary.write_text(json.dumps({"id": request_id, **request}))
    temporary.rename(pending)
    try:
        deadline = time.time() + BRIDGE_TIMEOUT_S
        while time.time() < deadline:
            time.sleep(0.25)
            try:
                result = json.loads(answer.read_text())
            except (OSError, ValueError):
                continue
            if result.get("status") != "working":
                return result
        raise Refused(504, "No Claude session answered. Open any Claude Code session and try again.")
    finally:
        pending.unlink(missing_ok=True)
        answer.unlink(missing_ok=True)
        try:
            (BRIDGE / f"claim-{request_id}").rmdir()
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "AgentOffice"
    sys_version = ""

    def log_message(self, *_):
        pass

    def reply(self, status, body, kind="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def guarded(self):
        # The host check stops DNS rebinding; the origin and token checks stop other sites.
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            raise Refused(403, "Bad host.")
        origin = self.headers.get("Origin")
        if origin and origin not in ALLOWED_ORIGINS:
            raise Refused(403, "Bad origin.")

    def authorized(self):
        supplied = self.headers.get("X-Office-Token", "")
        if not secrets.compare_digest(supplied, TOKEN):
            raise Refused(403, "Bad token.")

    def do_GET(self):
        try:
            self.guarded()
            url = urlparse(self.path)
            if url.path == "/":
                page = (DIST / "index.html").read_text().replace("__OFFICE_TOKEN__", TOKEN)
                self.reply(200, page.encode(), "text/html; charset=utf-8")
                return
            if url.path.startswith("/assets/"):
                data, kind = asset(url.path.lstrip("/"))
                self.reply(200, data, kind)
                return
            self.authorized()
            query = {key: values[0] for key, values in parse_qs(url.query).items()}
            session_id = query.get("id", "")
            if url.path == "/api/sessions":
                self.reply(200, sessions())
            elif url.path == "/api/transcript":
                known_session(session_id)
                before = query.get("before", "")
                if before and not CURSOR.match(before):
                    raise Refused(400, "Bad cursor.")
                self.reply(200, bridge_call({"action": "transcript", "session": session_id, "before": before}))
            elif url.path == "/api/changes":
                known_session(session_id)
                self.reply(200, changes(session_id))
            elif url.path == "/api/changed":
                known_session(session_id)
                self.reply(200, changed_files(session_id))
            elif url.path == "/api/filediff":
                known_session(session_id)
                self.reply(200, file_diff(session_id, query.get("path", "")))
            elif url.path == "/api/files":
                known_session(session_id)
                self.reply(200, file_list(session_id))
            elif url.path == "/api/file":
                known_session(session_id)
                self.reply(200, file_text(session_id, query.get("path", "")))
            else:
                raise Refused(404, "Not found.")
        except Refused as refused:
            self.reply(refused.status, {"error": str(refused)})
        except PermissionError:
            self.reply(403, {"error": "macOS is blocking the office server from this folder. Grant access in System Settings > Privacy & Security > Files and Folders, or move the project out of Documents."})
        except Exception:
            traceback.print_exc()
            self.reply(500, {"error": "The office server hit an error."})

    def do_POST(self):
        try:
            self.guarded()
            self.authorized()
            route = urlparse(self.path).path
            if route not in ("/api/send", "/api/seen"):
                raise Refused(404, "Not found.")
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_MESSAGE * 4:
                raise Refused(413, "That message is too long.")
            body = json.loads(self.rfile.read(length))
            session_id, message = body.get("id", ""), str(body.get("message", "")).strip()
            known_session(session_id)
            if route == "/api/seen":
                OFFICE.mark_seen(session_id)
                self.reply(200, {"status": "ok"})
                return
            if not message or len(message) > MAX_MESSAGE:
                raise Refused(400, "Enter a message under 20,000 characters.")
            self.reply(200, bridge_call({"action": "send", "session": session_id, "message": message}))
        except Refused as refused:
            self.reply(refused.status, {"error": str(refused)})
        except ValueError:
            self.reply(400, {"error": "Bad request."})
        except PermissionError:
            self.reply(403, {"error": "macOS is blocking the office server from this folder. Grant access in System Settings > Privacy & Security > Files and Folders, or move the project out of Documents."})
        except Exception:
            traceback.print_exc()
            self.reply(500, {"error": "The office server hit an error."})


if __name__ == "__main__":
    os.umask(0o077)
    DATA.mkdir(mode=0o700, exist_ok=True)
    BRIDGE.mkdir(mode=0o700, exist_ok=True)
    for stale in BRIDGE.iterdir():
        if stale.is_dir():
            stale.rmdir()
        else:
            stale.unlink(missing_ok=True)
    threading.Thread(target=OFFICE.watch, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
