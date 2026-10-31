#!/usr/bin/env python3
"""Local server for Agent Office. Binds to loopback and requires a per-start token.

Files, git, names and status are answered here. Transcripts and messages go through
a folder of request files that the agent-office plugin answers from any running
Claude Code session.
"""
import glob
import hashlib
import hmac
import datetime
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
from urllib.parse import parse_qs, urlencode, urlparse

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "web" / "dist"
DATA = Path(os.environ.get("AGENT_OFFICE_HOME", Path.home() / ".agent-office"))
BRIDGE = DATA / "bridge"
RAW_SESSIONS = DATA / "sessions.raw.json"
PEOPLE = DATA / "people.json"
NAMES = DATA / "names.json"
FINISHED = DATA / "finished.json"
LOOKS = DATA / "looks.json"
LABELS = DATA / "labels.json"
REQUESTS = DATA / "requests"
WATCH_S = 2
CALL_S = 60
MEETING_S = 45
HELPER_MAX_AGE_S = 3600
NAME_POOL = [
    "Greg", "Stephanie", "Maya", "Omar", "Priya", "Leo", "Nina", "Theo", "Ana", "Sam",
    "Iris", "Marcus", "Lena", "Felix", "Tara", "Hugo", "Rosa", "Ben", "Yuki", "Dev",
    "Clara", "Ravi", "Zoe", "Noah", "Elsa", "Kofi", "Mina", "Owen", "Sofia", "Jonah",
    "Asha", "Paul", "Vera", "Ivan", "Dana", "Eli", "Nora", "Tomas", "June", "Amir",
]
CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"
APP_SESSIONS = Path.home() / "Library" / "Application Support" / "Claude" / "claude-code-sessions"
MEDIA_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
}
PAGE_SIZE = 300
MAX_TOOL_OUTPUT = 6000
HIDDEN_TOOLS = re.compile(r"^(mcp__ccd_turn__|mcp__ccd_session__mark_chapter|ToolSearch$|mcp__visualize__read_me)")
ASSET_TYPES = {
    ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf",
    ".svg": "image/svg+xml", ".woff2": "font/woff2",
    ".fbx": "application/octet-stream", ".jpg": "image/jpeg", ".png": "image/png", ".md": "text/plain",
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
JOB_LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 '&/.+-]{0,31}$")
FILLER_WORDS = {"a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to", "with", "btw:", "her", "his", "their", "my", "our"}
AGENT_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9 '-]{0,23}$")
SECRET_FILE = re.compile(r"(^|/)(\.env(\..*)?|.*\.(pem|key|p12)|id_(rsa|ed25519)|credentials(\.json)?)$", re.I)


class Refused(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def short_label(title):
    """A few meaningful words from a session's title, for its name tag."""
    title = re.sub(r"\s*\(.*?\)", "", title)
    words = [word for word in title.split() if word.lower() not in FILLER_WORDS]
    label = ""
    for word in words:
        if len(label) + len(word) + 1 > 22:
            break
        label = f"{label} {word}".strip()

    return label or title[:22]


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
        self.looks = read_json(LOOKS, {})
        self.labels = read_json(LABELS, {})
        self.was_running = {}
        self.seen_raw = None
        self.requests = {}
        self.meetings = {}
        self.snapshot = {"people": [], "updatedAt": ""}

    def next_look(self):
        return max(self.looks.values(), default=-1) + 1

    def assign_looks(self, rows):
        changed = False
        for row in rows:
            if row["id"] not in self.looks:
                self.looks[row["id"]] = self.next_look()
                changed = True
        if changed:
            write_json(LOOKS, self.looks)

    def reroll(self, session_id):
        with self.lock:
            self.looks[session_id] = self.next_look()
            write_json(LOOKS, self.looks)
            if self.seen_raw:
                self.rebuild()

    def set_label(self, session_id, label):
        with self.lock:
            self.labels[session_id] = label
            write_json(LABELS, self.labels)
            if self.seen_raw:
                self.rebuild()

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
        self.assign_looks(rows)
        ids = {row["id"] for row in rows}
        now = time.time()
        self.meetings = {pair: until for pair, until in self.meetings.items() if until > now}
        meetings = {row["id"]: set() for row in rows}
        for (one, other) in self.meetings:
            if one in ids and other in ids:
                meetings[one].add(other)
                meetings[other].add(one)
        talking, helpers = {row["id"]: None for row in rows}, {}
        for row in rows:
            peer, running = TRANSCRIPTS.live_state(row["id"])
            # A session that stopped leaves unfinished helpers in its transcript.
            helpers[row["id"]] = running if row.get("isRunning") else []
            if peer in ids:
                talking[row["id"]] = peer
                talking[peer] = talking[peer] or row["id"]
        people = [
            {
                **row,
                "meetingWith": sorted(meetings[row["id"]]),
                "talkingTo": talking[row["id"]],
                "helpers": helpers[row["id"]],
                "name": self.names[row["id"]],
                "look": self.looks[row["id"]],
                "label": self.labels.get(row["id"]) or short_label(row.get("title", "")),
                "isFinished": row["id"] in self.finished,
                "request": self.requests.get(row["id"]),
            }
            for row in rows
        ]
        self.snapshot = {"updatedAt": self.seen_raw.get("updatedAt", ""), "people": people}
        write_json(PEOPLE, self.snapshot)

    def read_requests(self):
        """The newest request per session. The plugin writes one file per request."""
        latest = {}
        for path in sorted(REQUESTS.glob("*.json")):
            request = read_json(path, None)
            if not isinstance(request, dict) or not isinstance(request.get("session"), str):
                continue
            show = request.get("show")
            cleaned = {
                "id": path.stem,
                "message": str(request.get("message", ""))[:2000],
                "show": [str(item) for item in show][:10] if isinstance(show, list) else [],
                "at": str(request.get("at", "")),
            }
            current = latest.get(request["session"])
            if current is None or cleaned["at"] >= current["at"]:
                latest[request["session"]] = cleaned

        return latest

    def clear_requests(self, session_id):
        with self.lock:
            for path in REQUESTS.glob("*.json"):
                request = read_json(path, None)
                if isinstance(request, dict) and request.get("session") == session_id:
                    path.unlink(missing_ok=True)
            self.requests = self.read_requests()
            if self.seen_raw:
                self.rebuild()

    def ingest(self):
        raw = read_json(RAW_SESSIONS, None)
        requests = self.read_requests()
        with self.lock:
            if raw is None or (raw == self.seen_raw and requests == self.requests):
                return
            self.requests = requests
            for row in raw.get("people", []):
                if self.was_running.get(row["id"]) and not row.get("isRunning"):
                    self.finished.add(row["id"])
                    if row.get("startedBy"):
                        self.meetings[(row["id"], row["startedBy"])] = time.time() + MEETING_S
                if row.get("isRunning"):
                    self.finished.discard(row["id"])
                self.was_running[row["id"]] = bool(row.get("isRunning"))
            write_json(FINISHED, sorted(self.finished))
            self.seen_raw = raw
            self.rebuild()

    def rename(self, session_id, name):
        with self.lock:
            taken = {v.lower() for k, v in self.names.items() if k != session_id}
            if name.lower() in taken:
                raise Refused(409, f"{name} is already taken.")
            self.names[session_id] = name
            write_json(NAMES, self.names)
            if self.seen_raw:
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


def media_kind(path):
    kind = MEDIA_TYPES.get(Path(path).suffix.lower(), "")

    return kind.split("/")[0] or None


def media_signature(session_id, path):
    return hmac.new(TOKEN.encode(), f"{session_id}\0{path}".encode(), hashlib.sha256).hexdigest()


def media_item(session_id, path):
    """A player can't send the token header, so each file gets its own signed link."""
    query = urlencode({"id": session_id, "path": path, "sig": media_signature(session_id, path)})

    return {"name": Path(path).name, "kind": media_kind(path), "url": f"/media?{query}"}


class Transcripts:
    """Reads Claude Code's transcript files. The format is internal, so callers fall back."""

    SYSTEM = {
        "side-sessions-event": "Side sessions reported back",
        "task-notification": "Background task update",
        "ci-monitor-event": "CI update",
    }

    def __init__(self):
        self.lock = threading.Lock()
        self.paths = {}
        self.parsed = {}

    def path_for(self, session_id):
        if session_id in self.paths:
            return self.paths[session_id]
        pattern = str(APP_SESSIONS / "*" / "*" / f"{glob.escape(session_id)}.json")
        for match in glob.glob(pattern):
            cli_id = read_json(Path(match), {}).get("cliSessionId")
            if cli_id and re.match(r"^[0-9a-f-]{36}$", cli_id):
                found = glob.glob(str(CLAUDE_PROJECTS / "*" / f"{cli_id}.jsonl"))
                if found:
                    self.paths[session_id] = Path(found[0])
                    return self.paths[session_id]

        return None

    def clean_user_text(self, text):
        text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S)
        text = re.sub(r"^\[Image: [^\]]*\]\s*", "", text, flags=re.M).strip()
        peer = re.search(r'<cross-session-message[^>]*from-name="([^"]*)"[^>]*>(.*?)</cross-session-message>', text, re.S)
        if peer:
            source = re.search(r'<cross-session-message[^>]*\bfrom="(local_[0-9a-f-]+)"', text)
            return {"role": "peer", "from": peer.group(1), "fromId": source.group(1) if source else "", "body": peer.group(2).strip()}
        system = re.match(r"<([a-z-]+)\b", text)
        if system and system.group(1) in self.SYSTEM:
            return {"role": "tool", "isNote": True, "body": self.SYSTEM[system.group(1)]}

        return {"role": "user", "body": text} if text else None

    @staticmethod
    def describe_tool(tool, tool_input):
        """A plain label for a tool call, plus the detail behind it."""
        path = str(tool_input.get("file_path", ""))
        name = Path(path).name
        if tool == "Bash":
            command = str(tool_input.get("command", ""))
            return str(tool_input.get("description") or command[:80]), command
        if tool in ("Read", "Edit", "Write"):
            verb = {"Read": "Read", "Edit": "Edited", "Write": "Wrote"}[tool]
            return f"{verb} {name}", path
        if tool == "Agent":
            return f"Started a helper: {tool_input.get('description', '')}".strip(), str(tool_input.get("prompt", ""))[:MAX_TOOL_OUTPUT]
        if tool == "WebSearch":
            return f"Searched: {tool_input.get('query', '')}", ""
        if tool == "WebFetch":
            return f"Read a web page: {tool_input.get('url', '')}", ""
        if "Claude_Browser" in tool or "claude-in-chrome" in tool:
            return "Used the browser", json.dumps(tool_input)[:MAX_TOOL_OUTPUT]
        words = tool.split("__")[-1].replace("_", " ")
        return words[:1].upper() + words[1:], json.dumps(tool_input)[:MAX_TOOL_OUTPUT]

    @staticmethod
    def apply_plan(plan, tool_input):
        items = tool_input.get("items")
        if isinstance(items, list):
            return [{"content": str(i.get("content", "")), "status": str(i.get("status", "pending"))} for i in items if isinstance(i, dict)]
        plan = [dict(item) for item in plan]
        if tool_input.get("advance"):
            current = next((i for i in plan if i["status"] == "in_progress"), None)
            if current:
                current["status"] = "completed"
            upcoming = next((i for i in plan if i["status"] == "pending"), None)
            if upcoming:
                upcoming["status"] = "in_progress"
        for number in tool_input.get("done") or []:
            if isinstance(number, int) and 0 < number <= len(plan):
                plan[number - 1]["status"] = "completed"
        start = tool_input.get("start")
        if isinstance(start, int) and 0 < start <= len(plan):
            plan[start - 1]["status"] = "in_progress"

        return plan

    def parse(self, session_id, path):
        messages, seen_tools, activity = [], set(), {}
        plan, turn_started, last_peer = [], "", None
        helpers = {}
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line in handle:
                # A background helper's finish is queued as its own kind of record.
                if '"type":"queue-operation"' in line or '"type":"attachment"' in line:
                    for done_id in re.findall(r"<tool-use-id>([^<\\]+)</tool-use-id>", line):
                        helpers.pop(done_id, None)
                    continue
                if '"type":"user"' not in line and '"type":"assistant"' not in line:
                    continue
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if record.get("type") not in ("user", "assistant") or record.get("isSidechain"):
                    continue
                if record.get("isMeta") or record.get("isCompactSummary"):
                    continue
                content = (record.get("message") or {}).get("content")
                blocks = [{"type": "text", "text": content}] if isinstance(content, str) else content or []
                for block in blocks:
                    if not isinstance(block, dict):
                        continue
                    kind = block.get("type")
                    if kind == "text" and record["type"] == "user":
                        for done_id in re.findall(r"<tool-use-id>([^<]+)</tool-use-id>", block.get("text", "")):
                            helpers.pop(done_id, None)
                        cleaned = self.clean_user_text(block.get("text", ""))
                        if cleaned:
                            messages.append(cleaned)
                            turn_started = record.get("timestamp", turn_started)
                            if cleaned.get("fromId"):
                                last_peer = {"id": cleaned["fromId"], "at": record.get("timestamp", "")}
                    elif kind == "text" and block.get("text", "").strip():
                        messages.append({"role": "assistant", "body": block["text"].strip()})
                    elif kind == "tool_result":
                        helper = helpers.get(block.get("tool_use_id"))
                        if helper is not None:
                            # A background helper answers at once and reports later by notification.
                            text = json.dumps(block.get("content"))[:400]
                            if block.get("is_error") or not re.search(r"background|launched|async", text, re.I):
                                helpers.pop(block.get("tool_use_id"), None)
                        item = activity.get(block.get("tool_use_id"))
                        if item is not None:
                            result = block.get("content")
                            if isinstance(result, list):
                                result = "\n".join(str(r.get("text", "")) for r in result if isinstance(r, dict))
                            item["output"] = str(result or "")[:MAX_TOOL_OUTPUT]
                            item["isError"] = bool(block.get("is_error"))
                    elif kind == "tool_use":
                        if block.get("id") in seen_tools:
                            continue
                        seen_tools.add(block.get("id"))
                        tool = block.get("name", "tool")
                        tool_input = block.get("input") or {}
                        if tool == "mcp__ccd_turn__update_plan":
                            plan = self.apply_plan(plan, tool_input)
                        elif tool == "mcp__ccd_turn__wrap_up":
                            plan = [{**item, "status": "completed"} for item in plan]
                            if tool_input.get("recap"):
                                messages.append({"role": "recap", "body": str(tool_input["recap"]), "ask": str(tool_input.get("ask") or "")})
                        elif tool == "SendUserFile":
                            files = [f for f in tool_input.get("files", []) if isinstance(f, str)]
                            shown = [media_item(session_id, f) for f in files if media_kind(f)]
                            if shown:
                                messages.append({"role": "media", "caption": str(tool_input.get("caption", "")), "files": shown})
                        elif not HIDDEN_TOOLS.match(tool):
                            if tool == "Agent":
                                helpers[block.get("id")] = {"label": str(tool_input.get("description") or "Helper")[:60], "at": record.get("timestamp", "")}
                            label, detail = self.describe_tool(tool, tool_input)
                            item = {"role": "activity", "body": label, "detail": detail, "output": "", "isError": False}
                            activity[block.get("id")] = item
                            messages.append(item)

        return {"messages": messages, "plan": plan, "turnStartedAt": turn_started, "lastPeer": last_peer, "helpers": list(helpers.values())}

    def load(self, session_id):
        path = self.path_for(session_id)
        if path is None:
            raise Refused(404, "No transcript file for this session.")
        stat = path.stat()
        stamp = (stat.st_mtime_ns, stat.st_size)
        with self.lock:
            cached = self.parsed.get(session_id)
            if not cached or cached[0] != stamp:
                cached = (stamp, self.parse(session_id, path))
                self.parsed[session_id] = cached

        return cached

    @staticmethod
    def seconds_since(stamp):
        sent = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))

        return (datetime.datetime.now(datetime.timezone.utc) - sent).total_seconds()

    def live_state(self, session_id):
        """Who this session is on a call with, and which helpers it has running."""
        try:
            parsed = self.load(session_id)[1]
            peer = parsed["lastPeer"]
            talking = peer["id"] if peer and self.seconds_since(peer["at"]) < CALL_S else None
            helpers = [h["label"] for h in parsed["helpers"] if self.seconds_since(h["at"]) < HELPER_MAX_AGE_S]

            return talking, helpers
        except (Refused, OSError, ValueError, KeyError):
            return None, []

    def page(self, session_id, before):
        cached = self.load(session_id)
        messages = cached[1]["messages"]
        end = len(messages) if before is None else max(0, min(before, len(messages)))
        start = max(0, end - PAGE_SIZE)

        return {
            "messages": messages[start:end],
            "total": len(messages),
            "cursor": start if start > 0 else None,
            "plan": cached[1]["plan"],
            "turnStartedAt": cached[1]["turnStartedAt"],
        }


TRANSCRIPTS = Transcripts()


def media_link(session_id, relative):
    cwd = session_cwd(session_id).resolve()
    target = (cwd / relative).resolve()
    if not target.is_relative_to(cwd) or not media_kind(target) or not target.is_file():
        raise Refused(404, "Media file not found in this session's folder.")

    return media_item(session_id, str(target))


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

    def send_media(self, query):
        session_id, path = query.get("id", ""), query.get("path", "")
        if not hmac.compare_digest(query.get("sig", ""), media_signature(session_id, path)):
            raise Refused(403, "Bad link.")
        target = Path(path)
        kind = MEDIA_TYPES.get(target.suffix.lower())
        if not kind or not target.is_file():
            raise Refused(404, "This file no longer exists.")
        size = target.stat().st_size
        start, end, status = 0, size - 1, 200
        match = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", ""))
        if match and (match.group(1) or match.group(2)):
            if match.group(1):
                start = int(match.group(1))
                end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
            else:
                start = max(0, size - int(match.group(2)))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with target.open("rb") as handle:
            handle.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = handle.read(min(1 << 20, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

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
            if url.path == "/media":
                self.send_media({key: values[0] for key, values in parse_qs(url.query).items()})
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
            elif url.path == "/api/messages":
                known_session(session_id)
                before = query.get("before")
                self.reply(200, TRANSCRIPTS.page(session_id, int(before) if before else None))
            elif url.path == "/api/media-link":
                known_session(session_id)
                self.reply(200, media_link(session_id, query.get("path", "")))
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
        except (BrokenPipeError, ConnectionResetError):
            pass
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
            if route not in ("/api/send", "/api/seen", "/api/rename", "/api/dismiss", "/api/label", "/api/reroll"):
                raise Refused(404, "Not found.")
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_MESSAGE * 4:
                raise Refused(413, "That message is too long.")
            body = json.loads(self.rfile.read(length))
            session_id, message = body.get("id", ""), str(body.get("message", "")).strip()
            known_session(session_id)
            if route == "/api/rename":
                name = str(body.get("name", "")).strip()
                if not AGENT_NAME.match(name):
                    raise Refused(400, "Use letters, numbers and spaces, up to 24 characters.")
                OFFICE.rename(session_id, name)
                self.reply(200, {"status": "ok"})
                return
            if route == "/api/reroll":
                OFFICE.reroll(session_id)
                self.reply(200, {"status": "ok"})
                return
            if route == "/api/label":
                label = str(body.get("label", "")).strip()
                if not JOB_LABEL.match(label):
                    raise Refused(400, "Use letters and numbers, up to 32 characters.")
                OFFICE.set_label(session_id, label)
                self.reply(200, {"status": "ok"})
                return
            if route == "/api/dismiss":
                OFFICE.clear_requests(session_id)
                self.reply(200, {"status": "ok"})
                return
            if route == "/api/seen":
                OFFICE.mark_seen(session_id)
                self.reply(200, {"status": "ok"})
                return
            if not message or len(message) > MAX_MESSAGE:
                raise Refused(400, "Enter a message under 20,000 characters.")
            result = bridge_call({"action": "send", "session": session_id, "message": message})
            if result.get("status") == "ok":
                OFFICE.clear_requests(session_id)
            self.reply(200, result)
        except Refused as refused:
            self.reply(refused.status, {"error": str(refused)})
        except ValueError:
            self.reply(400, {"error": "Bad request."})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except PermissionError:
            self.reply(403, {"error": "macOS is blocking the office server from this folder. Grant access in System Settings > Privacy & Security > Files and Folders, or move the project out of Documents."})
        except Exception:
            traceback.print_exc()
            self.reply(500, {"error": "The office server hit an error."})


if __name__ == "__main__":
    os.umask(0o077)
    DATA.mkdir(mode=0o700, exist_ok=True)
    BRIDGE.mkdir(mode=0o700, exist_ok=True)
    REQUESTS.mkdir(mode=0o700, exist_ok=True)
    for stale in BRIDGE.iterdir():
        if stale.is_dir():
            stale.rmdir()
        else:
            stale.unlink(missing_ok=True)
    threading.Thread(target=OFFICE.watch, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
