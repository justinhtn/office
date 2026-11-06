"""Timelines the office's pages send from each device: when things loaded, drew and failed, and runs that ended in a crash.

They're kept as JSON lines, one file per device a day, so scripts/client-log.py can show them on the Mac. Only what the page
measured is kept: names of steps, times, sizes and counts. Anything else is cut down to plain short values, links lose their
query, and text that looks like a secret is hidden before it's written.
"""
import json
import os
import re
import threading
from datetime import datetime, timezone

MAX_BODY = 64_000
MAX_EVENTS = 200
MAX_FILE = 2_000_000
MAX_TEXT = 300
MAX_ITEMS = 30
MAX_KEYS = 24
# Deep enough for a crash report's last events, each with its own few fields.
MAX_DEPTH = 3
KIND = re.compile(r"^[a-z][A-Za-z0-9.-]{0,47}$")
KEY = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,31}$")
RUN = re.compile(r"^[a-z0-9-]{6,40}$")
DEVICE = re.compile(r"^[a-z0-9]{1,16}$")
SECRET_KEY = re.compile(r"(?i)token|secret|passw|cookie|auth|sig$|signature|key$")
# A link's query and fragment, where signatures and ids would be, go, and its path stays.
LINK_QUERY = re.compile(r"""([^\s'"?#]*)[?#][^\s'"]*""")
# Set by the server line itself, so a page can't claim another device or time.
OWN_FIELDS = ("at", "device", "deviceName", "run")


class Rejected(ValueError):
    pass


def hide(text, secrets):
    for secret in secrets:
        text = text.replace(secret, "[secret hidden]")

    return text


def plain_text(text, redact):
    return redact(LINK_QUERY.sub(r"\1", text))[:MAX_TEXT]


def cleaned(value, redact, depth=0):
    """A copy with only short plain values, or None when there's nothing worth keeping."""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value if value == value and abs(value) < 1e15 else None
    if isinstance(value, str):
        return plain_text(value, redact)
    if depth >= MAX_DEPTH:
        return None
    if isinstance(value, list):
        return [cleaned(item, redact, depth + 1) for item in value[:MAX_ITEMS]]
    if isinstance(value, dict):
        kept = {}
        for key, item in list(value.items())[:MAX_KEYS]:
            if isinstance(key, str) and KEY.match(key) and not SECRET_KEY.search(key):
                kept[key] = cleaned(item, redact, depth + 1)
        return kept

    return None


def event_line(event, redact):
    if not isinstance(event, dict) or not isinstance(event.get("kind"), str) or not KIND.match(event["kind"]):
        return None
    t = event.get("t")
    if isinstance(t, bool) or not isinstance(t, (int, float)) or not 0 <= t < 1e10:
        return None
    line = cleaned({key: item for key, item in event.items() if key not in OWN_FIELDS and key != "kind"}, redact)
    line["kind"] = event["kind"]

    return line


class ClientLog:
    def __init__(self, folder, redact=lambda text: text, max_file=MAX_FILE):
        self.folder = folder
        self.redact = redact
        self.max_file = max_file
        self.lock = threading.Lock()

    def path_for(self, device, day):
        return self.folder / f"{device}-{day}.jsonl"

    def write(self, device, device_name, body, hidden=()):
        """Keeps a batch from one page. Returns how many events were kept. Any text in hidden, such as the page's own token, never is."""
        if not DEVICE.match(device or ""):
            raise Rejected("Unknown device.")
        if not isinstance(body, dict):
            raise Rejected("Not an object.")
        run = body.get("run")
        if not isinstance(run, str) or not RUN.match(run):
            raise Rejected("Bad run.")
        events = body.get("events")
        if not isinstance(events, list) or len(events) > MAX_EVENTS:
            raise Rejected("Bad events.")
        hidden = [secret for secret in hidden if isinstance(secret, str) and len(secret) >= 8]
        redact = lambda text: self.redact(hide(text, hidden))
        now = datetime.now(timezone.utc)
        own = {"at": now.isoformat(timespec="milliseconds"), "device": device, "deviceName": plain_text(str(device_name or device), redact)[:40], "run": run}
        lines = [{**own, **line} for line in (event_line(event, redact) for event in events) if line]
        dropped = body.get("dropped")
        if isinstance(dropped, int) and not isinstance(dropped, bool) and dropped > 0:
            lines.append({**own, "t": lines[-1]["t"] if lines else 0, "kind": "log.dropped", "count": min(dropped, 10**6)})
        if not lines:
            return 0
        data = "".join(json.dumps(line, separators=(",", ":")) + "\n" for line in lines).encode()
        with self.lock:
            self.folder.mkdir(mode=0o700, parents=True, exist_ok=True)
            path = self.path_for(device, now.date().isoformat())
            self.rotate(path, len(data))
            with open(path, "ab") as handle:
                handle.write(data)

        return len(lines)

    def rotate(self, path, adding):
        """A file about to pass the limit moves aside to .1, replacing the one before it, so a device keeps at most two a day."""
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return
        if size + adding > self.max_file:
            os.replace(path, path.with_name(path.name.removesuffix(".jsonl") + ".1.jsonl"))
