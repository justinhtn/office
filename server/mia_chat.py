"""Ask Mia: a chat with an always-on, read-only copy of Mia, for the person's own signed-in devices.

The office starts one headless Claude Code session in Mia's folder and keeps it running. What the person types
goes to her as a user turn; her replies stream back as she writes them. Notes she drafts for a team lead wait
in her folder until the person taps Send, and the office plugin inside her process sends only the approved text.
"""
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

MAX_ASK = 4000
KEPT = 100
NOTES_SHOWN = 20
NOTE_ID = re.compile(r"^[0-9a-f-]{36}$")
CHECK_S = 5
STOP_S = 5
# Restarts wait longer each time she stops soon after starting, up to this.
MAX_BACKOFF_S = 600
QUICK_EXIT_S = 30
FRESH_AFTER = 2
# Every chat copy, and only a chat copy, names this tool on its command line, so leftovers can be found after a crash.
MARKER = "mcp__agent-office__pass_note"


def read_json(path, fallback):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value))
    temporary.replace(path)


def log(text):
    print(text, file=sys.stderr, flush=True)


def chat_copies(front_desk):
    """Every chat copy of Mia running in her folder, whichever server started it."""
    listing = subprocess.run(["ps", "-axww", "-o", "pid=,command="], capture_output=True, text=True, timeout=5).stdout
    copies = []
    for line in listing.splitlines():
        pid, _, command = line.strip().partition(" ")
        if MARKER not in command or int(pid) == os.getpid():
            continue
        try:
            folder = subprocess.run(["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"], capture_output=True, text=True, timeout=5).stdout
        except (OSError, subprocess.SubprocessError) as problem:
            log(f"Couldn't check process {pid} for chat Mia: {problem}")
            continue
        if f"n{Path(front_desk).resolve()}" in folder.splitlines():
            copies.append(int(pid))

    return copies


def signal_copy(pid, signal_number):
    try:
        # Each copy leads its own group, so the shell that started it and anything it started stop too.
        if os.getpgid(pid) == pid:
            os.killpg(pid, signal_number)
        else:
            os.kill(pid, signal_number)
    except OSError:
        pass


class MiaChat:
    def __init__(self, data, front_desk, command, is_wanted, find_copies=chat_copies):
        self.folder = Path(data) / "mia-chat"
        self.notes = self.folder / "notes"
        self.state_path = self.folder / "state.json"
        self.history_path = self.folder / "history.json"
        self.log_path = Path(data) / "logs" / "mia-chat.log"
        self.front_desk = Path(front_desk)
        self.command = command
        self.is_wanted = is_wanted
        self.find_copies = find_copies
        self.lock = threading.RLock()
        self.process = None
        self.started_at = 0
        self.quick_exits = 0
        self.next_start = 0
        self.reply = None
        self.message_id = "first"
        self.waiting = 0

    def session_id(self):
        return read_json(self.state_path, {}).get("sessionId")

    def history(self):
        kept = read_json(self.history_path, [])

        return kept if isinstance(kept, list) else []

    def add(self, role, text):
        with self.lock:
            kept = [*self.history(), {"id": uuid.uuid4().hex, "role": role, "text": text, "at": int(time.time() * 1000)}][-KEPT:]
            write_json(self.history_path, kept)

    def is_running(self):
        return self.process is not None and self.process.poll() is None

    def view(self):
        with self.lock:
            messages = self.history()
            if self.reply is not None:
                messages = [*messages, {"id": "reply", "role": "mia", "text": self.reply_text(), "at": self.reply["at"], "isWriting": True, "step": self.reply["step"]}]

            return {"isOn": self.is_wanted(), "isRunning": self.is_running(), "isAnswering": self.waiting > 0, "messages": messages, "notes": self.recent_notes()}

    def recent_notes(self):
        notes = []
        for path in self.notes.glob("*.json"):
            note = read_json(path, None)
            if isinstance(note, dict) and NOTE_ID.match(str(note.get("id", ""))) and path.stem == note["id"]:
                notes.append({key: note.get(key) for key in ("id", "leadName", "text", "status", "problem", "at")})

        return sorted(notes, key=lambda note: note.get("at") or 0)[-NOTES_SHOWN:]

    def ask(self, text):
        text = str(text).strip()
        if not text:
            raise ValueError("Type a message first.")
        if len(text) > MAX_ASK:
            raise ValueError("That message is too long.")
        with self.lock:
            if not self.is_running():
                raise RuntimeError("Mia isn't here right now. She'll be back in a moment.")
            try:
                self.process.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": text}}).encode() + b"\n")
                self.process.stdin.flush()
            except (OSError, ValueError) as problem:
                log(f"Couldn't reach chat Mia: {problem}")
                raise RuntimeError("Mia isn't here right now. She'll be back in a moment.") from None
            # Kept only once she has it, so the chat never shows a message she didn't get.
            self.add("person", text)
            self.waiting += 1
            if self.reply is None:
                self.reply = {"at": int(time.time() * 1000), "parts": {}, "order": [], "step": None}

    def decide(self, note_id, is_sent, lead_session):
        """The person's tap on a draft. Only this turns a draft into something the plugin will send."""
        if not NOTE_ID.match(str(note_id)):
            raise ValueError("Bad note.")
        path = self.notes / f"{note_id}.json"
        with self.lock:
            note = read_json(path, None)
            if not isinstance(note, dict) or note.get("id") != note_id:
                raise LookupError("That note is gone.")
            if note.get("status") != "draft":
                raise LookupError("That note has already been handled.")
            if not is_sent:
                write_json(path, {**note, "status": "cancelled"})
                return
            session = lead_session(note.get("leadId"))
            if not session:
                write_json(path, {**note, "status": "failed", "problem": "That lead isn't in the office any more."})
                return
            write_json(path, {**note, "status": "approved", "toSession": session, "approvedAt": int(time.time() * 1000)})

    def reply_text(self):
        return "\n\n".join(self.reply["parts"][key] for key in self.reply["order"] if self.reply["parts"][key].strip())

    def read(self, process):
        """Follows her output: text as it streams, and the end of each turn."""
        for line in process.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            with self.lock:
                if process is not self.process:
                    return
                self.follow(event)
        with self.lock:
            if process is self.process and self.reply is not None:
                self.finish_reply("Mia stopped before she finished. Ask again in a moment.")

    def follow(self, event):
        kind = event.get("type")
        if kind == "stream_event" and self.reply is not None:
            inner = event.get("event") or {}
            if inner.get("type") == "message_start":
                self.message_id = (inner.get("message") or {}).get("id") or uuid.uuid4().hex
            elif inner.get("type") == "content_block_start" and (inner.get("content_block") or {}).get("type") == "tool_use":
                self.reply["step"] = "Looking at the office"
            elif inner.get("type") == "content_block_delta" and (inner.get("delta") or {}).get("type") == "text_delta":
                key = self.message_id
                if key not in self.reply["parts"]:
                    self.reply["parts"][key] = ""
                    self.reply["order"].append(key)
                self.reply["parts"][key] += inner["delta"].get("text", "")
                self.reply["step"] = None
        elif kind == "assistant" and self.reply is not None:
            message = event.get("message") or {}
            key = message.get("id") or uuid.uuid4().hex
            written = "".join(block.get("text", "") for block in message.get("content") or [] if block.get("type") == "text")
            if written:
                if key not in self.reply["parts"]:
                    self.reply["order"].append(key)
                self.reply["parts"][key] = written
        elif kind == "result":
            self.waiting = max(0, self.waiting - 1)
            if self.reply is not None:
                fallback = "Mia couldn't answer that. Try again in a moment." if event.get("is_error") else ""
                self.finish_reply(fallback)

    def finish_reply(self, fallback):
        text = self.reply_text() or fallback
        if text:
            self.add("mia", text)
        self.reply = {"at": int(time.time() * 1000), "parts": {}, "order": [], "step": None} if self.waiting else None
        if not self.is_running():
            self.waiting = 0
            self.reply = None

    def start(self):
        self.folder.mkdir(mode=0o700, exist_ok=True)
        self.notes.mkdir(mode=0o700, exist_ok=True)
        self.log_path.parent.mkdir(mode=0o700, exist_ok=True)
        session = self.session_id()
        # A conversation that keeps failing to resume is left behind, once, for a fresh one.
        is_new = not session or self.quick_exits == FRESH_AFTER
        if is_new:
            session = str(uuid.uuid4())
            write_json(self.state_path, {"sessionId": session})
        self.stop_strays()
        with open(self.log_path, "ab") as output:
            process = subprocess.Popen(self.command(session, is_new), cwd=self.front_desk.resolve(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=output, start_new_session=True)
        self.process, self.started_at, self.waiting, self.reply = process, time.time(), 0, None
        threading.Thread(target=self.read, args=(process,), daemon=True).start()

    def stop_strays(self):
        try:
            for signal_number in (signal.SIGTERM, signal.SIGKILL):
                copies = self.find_copies(self.front_desk)
                for pid in copies:
                    signal_copy(pid, signal_number)
                deadline = time.time() + STOP_S
                while copies and time.time() < deadline:
                    time.sleep(0.2)
                    copies = self.find_copies(self.front_desk)
                if not copies:
                    return
            log(f"Couldn't stop chat Mia: {copies}")
        except (OSError, subprocess.SubprocessError) as problem:
            log(f"Couldn't look for chat Mia: {problem}")

    def stop(self):
        with self.lock:
            process, self.process, self.reply, self.waiting = self.process, None, None, 0
        # The copy this server holds stops even if looking for others fails.
        if process is not None:
            if process.poll() is None:
                signal_copy(process.pid, signal.SIGTERM)
            try:
                process.stdin.close()
            except OSError:
                pass
            try:
                process.wait(timeout=STOP_S)
            except subprocess.TimeoutExpired:
                signal_copy(process.pid, signal.SIGKILL)
                try:
                    process.wait(timeout=STOP_S)
                except subprocess.TimeoutExpired:
                    log(f"Couldn't stop chat Mia: {process.pid}")
        self.stop_strays()

    def check(self):
        """Starts her when she's wanted and not running, and stops her when she isn't wanted."""
        with self.lock:
            wanted, running, process = self.is_wanted(), self.is_running(), self.process
        if not wanted:
            if process is not None:
                self.stop()
            return
        if running:
            return
        now = time.time()
        if process is not None:
            # She stopped by herself: wait a little longer each time it happens soon after starting.
            lived = now - self.started_at
            self.quick_exits = self.quick_exits + 1 if lived < QUICK_EXIT_S else 0
            log(f"Chat Mia stopped (exit {process.poll()}) after {int(lived)} s")
            with self.lock:
                if self.process is process:
                    self.process, self.reply, self.waiting = None, None, 0
            self.next_start = now + min(MAX_BACKOFF_S, CHECK_S * 2 ** self.quick_exits)
        if now >= self.next_start:
            self.start()

    def keep_running(self):
        self.stop_strays()
        while True:
            try:
                self.check()
            except Exception as problem:
                # This runs on its own thread, where nothing else would report it.
                log(f"Chat Mia check failed: {problem!r}")
            time.sleep(CHECK_S)
