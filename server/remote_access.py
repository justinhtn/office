"""Sign-in for the office's own devices, reached through a proxy such as Tailscale Serve.

Pairing codes and device cookies are long random secrets, so a plain hash is enough to store them.
Passkeys are kept as public keys only: the private half never leaves the person's devices.
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

            return new_device(state, name, now), None

        return self.changing(change)

    def add_passkey(self, device_id, credential, public_key, sign_count):
        """Lets a signed-in device come back with this passkey. A device has one, so a new one replaces the old."""
        def change(state):
            device = state.get("devices", {}).get(device_id)
            if not state.get("host") or not device or time.time() >= device.get("expires", 0):
                return False
            forget_passkey(state, device.get("passkey"))
            passkey_id = secrets.token_hex(4)
            state.setdefault("passkeys", {})[passkey_id] = {
                "credential": credential,
                "publicKey": public_key,
                "signCount": sign_count,
                "name": device["name"],
                "created": time.time(),
            }
            device["passkey"] = passkey_id

            return True

        return self.changing(change)

    def has_passkeys(self):
        state = self.read()

        return bool(state.get("host") and state.get("passkeys"))

    def passkeys(self):
        return self.read().get("passkeys", {})

    def sign_in_with_passkey(self, credential, check):
        """Returns a cookie value, or None. check(passkey) raises if the answer is wrong, or returns the new sign count.

        It runs while the file is locked, so two sign-ins can't both use the same count.
        """
        def change(state):
            if not state.get("host"):
                return None
            found = [(key, one) for key, one in state.get("passkeys", {}).items() if hmac.compare_digest(one.get("credential", ""), str(credential))]
            if not found:
                return None
            passkey_id, passkey = found[0]
            passkey["signCount"] = check(passkey)
            now = time.time()
            passkey["lastUsed"] = now
            state["devices"] = {key: one for key, one in state.get("devices", {}).items() if now < one.get("expires", 0)}

            return new_device(state, passkey["name"], now, passkey_id)

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
            try:
                self.changing(lambda fresh: fresh.get("devices", {}).get(device_id, {}).update(lastSeen=time.time()) if device_id in fresh.get("devices", {}) else None)
            except OSError:
                # Only bookkeeping, so a full disk mustn't sign anyone out.
                pass

        return device_id

    def devices(self):
        now = time.time()

        return {key: one for key, one in self.read().get("devices", {}).items() if now < one.get("expires", 0)}

    def revoke(self, some_id):
        """Takes a device or a passkey. Its passkey goes too, and so does every device signed in with that passkey,
        since passkeys sync between someone's devices."""
        def change(state):
            device = state.get("devices", {}).pop(some_id, None)
            passkey_id = device.get("passkey") if device else some_id
            return forget_passkey(state, passkey_id) or device is not None

        return self.changing(change)

    def revoke_all(self):
        def change(state):
            state.pop("devices", None)
            state.pop("passkeys", None)

        self.changing(change)


def new_device(state, name, now, passkey_id=None):
    """Adds a device and returns its cookie value."""
    device_secret = secrets.token_urlsafe(32)
    device_id = secrets.token_hex(4)
    device = {
        "hash": hashed(device_secret),
        "name": re.sub(r"[^\w .'-]", "", str(name))[:40].strip() or "Device",
        "created": now,
        "expires": now + DEVICE_S,
    }
    if passkey_id:
        device["passkey"] = passkey_id
    state.setdefault("devices", {})[device_id] = device

    return f"{device_id}.{device_secret}"


def forget_passkey(state, passkey_id):
    """Removes a passkey and signs out every device that used it. Says whether there was one."""
    if not passkey_id or state.get("passkeys", {}).pop(passkey_id, None) is None:
        return False
    state["devices"] = {key: one for key, one in state.get("devices", {}).items() if one.get("passkey") != passkey_id}

    return True
