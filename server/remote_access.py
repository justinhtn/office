"""Sign-in for the office's own devices, reached through a proxy such as Tailscale Serve.

Pairing codes and device cookies are long random secrets, so a plain hash is enough to store them.
"""
import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from pathlib import Path

CODE_S = 600
DEVICE_S = 30 * 86400
MAX_TRIES = 5
TRIES_WINDOW_S = 900
DEFAULT_PORT = 8795
LAST_SEEN_EVERY_S = 3600
HOST = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.ts\.net$")
CODE_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"
COOKIE = "__Host-office-device"


def hashed(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


class RemoteAccess:
    def __init__(self, data):
        self.path = Path(data) / "remote_access.json"
        self.lock_path = Path(data) / "remote_access.lock"

    def read(self):
        try:
            state = json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

        return state if isinstance(state, dict) else {}

    def write(self, state):
        temporary = self.path.with_name(f"{self.path.name}.{secrets.token_hex(8)}.tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump(state, handle)
        temporary.replace(self.path)

    def changing(self, change):
        """The server and the command line both change this file, so each holds the lock while it does."""
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(self.lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        with os.fdopen(descriptor) as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = self.read()
            answer = change(state)
            self.write(state)

        return answer

    def host(self):
        return self.read().get("host")

    def port(self):
        return self.read().get("port")

    def turn_on(self, host, port=DEFAULT_PORT):
        if not HOST.fullmatch(host):
            raise ValueError("That isn't a Tailscale name. It should look like my-mac.tail1234.ts.net.")
        if not 1024 <= port <= 65535:
            raise ValueError("Use a port from 1024 to 65535.")
        self.changing(lambda state: state.update(host=host, port=port))

    def turn_off(self):
        """Also forgets every device and code, so turning it on later starts clean."""
        self.changing(lambda state: state.clear())

    def new_code(self):
        def change(state):
            if not state.get("host"):
                raise ValueError("iPad access is off.")
            letters = "".join(secrets.choice(CODE_LETTERS) for _ in range(20))
            state["code"] = {"hash": hashed(letters), "expires": time.time() + CODE_S}
            state["failures"] = []

            return "-".join(letters[start:start + 5] for start in range(0, 20, 5))

        return self.changing(change)

    def sign_in(self, code, name):
        """Returns (cookie value, None), or (None, why). A code works once, and too many wrong tries end it."""
        def change(state):
            now = time.time()
            state["devices"] = {key: one for key, one in state.get("devices", {}).items() if now < one.get("expires", 0)}
            failures = [at for at in state.get("failures", []) if now - at < TRIES_WINDOW_S]
            state["failures"] = failures
            if len(failures) >= MAX_TRIES:
                return None, "locked"
            current = state.get("code") or {}
            supplied = hashed(re.sub(r"[^a-z0-9]", "", str(code).lower()))
            if not hmac.compare_digest(supplied, current.get("hash", "")) or now >= current.get("expires", 0):
                failures.append(now)
                if len(failures) >= MAX_TRIES:
                    state.pop("code", None)

                return None, "wrong"
            state.pop("code", None)
            state["failures"] = []
            device_secret = secrets.token_urlsafe(32)
            device_id = secrets.token_hex(4)
            state.setdefault("devices", {})[device_id] = {
                "hash": hashed(device_secret),
                "name": re.sub(r"[^\w .'-]", "", str(name))[:40].strip() or "Device",
                "created": now,
                "expires": now + DEVICE_S,
            }

            return f"{device_id}.{device_secret}", None

        return self.changing(change)

    def device_for(self, cookie):
        """The device id for a cookie that is still good, otherwise None."""
        device_id, _, device_secret = (cookie or "").partition(".")
        state = self.read()
        if not state.get("host"):
            return None
        device = state.get("devices", {}).get(device_id)
        if not device or time.time() >= device.get("expires", 0):
            return None

        if not hmac.compare_digest(hashed(device_secret), device.get("hash", "")):
            return None
        if time.time() - device.get("lastSeen", 0) >= LAST_SEEN_EVERY_S:
            self.changing(lambda fresh: fresh.get("devices", {}).get(device_id, {}).update(lastSeen=time.time()) if device_id in fresh.get("devices", {}) else None)

        return device_id

    def devices(self):
        now = time.time()

        return {key: one for key, one in self.read().get("devices", {}).items() if now < one.get("expires", 0)}

    def revoke(self, device_id):
        return self.changing(lambda state: state.get("devices", {}).pop(device_id, None)) is not None

    def revoke_all(self):
        self.changing(lambda state: state.pop("devices", None))
