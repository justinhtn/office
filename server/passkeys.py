"""Checks passkey (WebAuthn) answers, so a device that signed in once with a code can come back with Face ID.

Only ES256, the one algorithm Apple's passkeys use. The cryptography package checks the signatures. The office's own
Python environment adds it (scripts/python-env.sh), and without it passkeys are simply off.
"""
import base64
import hashlib
import hmac
import json
import secrets
import threading
import time

try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
except ImportError:
    ec = None

ES256 = -7
CHALLENGE_S = 300
MAX_CHALLENGES = 50
USER_PRESENT = 0x01
USER_VERIFIED = 0x04
HAS_CREDENTIAL = 0x40


class Rejected(Exception):
    pass


def available():
    return ec is not None


def encoded(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def decoded(text):
    if not isinstance(text, str):
        raise Rejected("Not text.")
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except ValueError:
        raise Rejected("Not base64.") from None


class Challenges:
    """Each one works once, for one purpose, for a few minutes. Kept in memory, so a restart only means asking again."""

    def __init__(self):
        self.lock = threading.Lock()
        self.open = {}

    def new(self, purpose):
        challenge = encoded(secrets.token_bytes(32))
        with self.lock:
            now = time.time()
            self.open = {key: one for key, one in self.open.items() if now < one[0]}
            # Anyone who reaches the sign-in page can ask for these, so the oldest go first.
            while len(self.open) >= MAX_CHALLENGES:
                self.open.pop(next(iter(self.open)))
            self.open[challenge] = (now + CHALLENGE_S, purpose)

        return challenge

    def take(self, challenge, purpose):
        with self.lock:
            expires, wanted = self.open.pop(challenge, (0, None))

        return wanted == purpose and time.time() < expires


def client_data(answer, kind, origin, challenges, purpose):
    raw = decoded(answer.get("clientDataJSON"))
    try:
        data = json.loads(raw)
    except ValueError:
        raise Rejected("Bad client data.") from None
    if not isinstance(data, dict) or not challenges.take(str(data.get("challenge")), purpose):
        raise Rejected("Unknown or used challenge.")
    if data.get("type") != kind or data.get("origin") != origin or data.get("crossOrigin"):
        raise Rejected("Wrong kind or origin.")

    return raw


def cbor(data, at=0, depth=0):
    """Reads one CBOR item and where it ends. Only what registration uses: whole numbers, byte and text strings, maps."""
    if at >= len(data) or depth > 3:
        raise Rejected("Bad CBOR.")
    major, info = data[at] >> 5, data[at] & 31
    at += 1
    if info < 24:
        value = info
    elif info <= 27:
        size = 1 << (info - 24)
        if at + size > len(data):
            raise Rejected("Bad CBOR.")
        value = int.from_bytes(data[at:at + size], "big")
        at += size
    else:
        raise Rejected("Unsupported CBOR.")
    if major == 0:
        return value, at
    if major == 1:
        return -1 - value, at
    if major in (2, 3):
        if at + value > len(data):
            raise Rejected("Bad CBOR.")
        chunk = data[at:at + value]
        try:
            return (chunk if major == 2 else chunk.decode()), at + value
        except UnicodeDecodeError:
            raise Rejected("Bad CBOR.") from None
    if major == 5 and value <= 16:
        items = {}
        for _ in range(value):
            key, at = cbor(data, at, depth + 1)
            if isinstance(key, dict):
                raise Rejected("Bad CBOR.")
            items[key], at = cbor(data, at, depth + 1)

        return items, at
    raise Rejected("Unsupported CBOR.")


def checked_authenticator_data(data, rp_id):
    if len(data) < 37 or not hmac.compare_digest(data[:32], hashlib.sha256(rp_id.encode()).digest()):
        raise Rejected("Wrong relying party.")
    if data[32] & (USER_PRESENT | USER_VERIFIED) != USER_PRESENT | USER_VERIFIED:
        raise Rejected("Face ID wasn't used.")

    return data


def registered(answer, rp_id, origin, challenges, purpose):
    """The new passkey's (credential id, public key, sign count), all checked, from what navigator.credentials.create gave.

    The key comes from the authenticator's own data, not a copy the browser makes of it.
    """
    client_data(answer, "webauthn.create", origin, challenges, purpose)
    attestation, _ = cbor(decoded(answer.get("attestationObject")))
    if not isinstance(attestation, dict) or not isinstance(attestation.get("authData"), bytes):
        raise Rejected("No authenticator data.")
    data = checked_authenticator_data(attestation["authData"], rp_id)
    if not data[32] & HAS_CREDENTIAL or len(data) < 55:
        raise Rejected("No credential.")
    length = int.from_bytes(data[53:55], "big")
    credential = data[55:55 + length]
    if len(credential) != length or not hmac.compare_digest(credential, decoded(answer.get("id"))):
        raise Rejected("Credential ids differ.")
    cose, _ = cbor(data, 55 + length)
    # An EC2 key on P-256 for ES256, then its x and y.
    if not isinstance(cose, dict) or (cose.get(1), cose.get(3), cose.get(-1)) != (2, ES256, 1):
        raise Rejected("Only ES256 on P-256.")
    x, y = cose.get(-2), cose.get(-3)
    if not (isinstance(x, bytes) and isinstance(y, bytes) and len(x) == len(y) == 32):
        raise Rejected("Bad key.")
    try:
        key = ec.EllipticCurvePublicNumbers(int.from_bytes(x, "big"), int.from_bytes(y, "big"), ec.SECP256R1()).public_key()
    except ValueError:
        raise Rejected("Bad key.") from None
    public_key = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

    return encoded(credential), encoded(public_key), int.from_bytes(data[33:37], "big")


def signed_in(answer, public_key, sign_count, rp_id, origin, challenges, purpose):
    """The new sign count once the signature is good, from what navigator.credentials.get gave."""
    raw = client_data(answer, "webauthn.get", origin, challenges, purpose)
    data = checked_authenticator_data(decoded(answer.get("authenticatorData")), rp_id)
    key = serialization.load_der_public_key(decoded(public_key))
    try:
        key.verify(decoded(answer.get("signature")), data + hashlib.sha256(raw).digest(), ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError):
        raise Rejected("Bad signature.") from None
    count = int.from_bytes(data[33:37], "big")
    # Synced passkeys always say 0. Any other count must go up, or the key has been copied.
    if (count or sign_count) and count <= sign_count:
        raise Rejected("Sign count went backwards.")

    return count
