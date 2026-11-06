import hashlib
import io
import json
import os
import subprocess
import sys
import time
import unittest
from unittest import mock

from support import DATA, server
from test_remote_access import HOST, ORIGIN, Case

import passkeys

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
except ImportError:
    ec = None


def to_cbor(value):
    def head(major, number):
        if number < 24:
            return bytes([major << 5 | number])
        size = next(size for size in (1, 2, 4, 8) if number < 1 << (8 * size))

        return bytes([major << 5 | (24 + (1, 2, 4, 8).index(size))]) + number.to_bytes(size, "big")

    if isinstance(value, int):
        return head(0, value) if value >= 0 else head(1, -1 - value)
    if isinstance(value, bytes):
        return head(2, len(value)) + value
    if isinstance(value, str):
        return head(3, len(value.encode())) + value.encode()

    return head(5, len(value)) + b"".join(to_cbor(key) + to_cbor(item) for key, item in value.items())


class Authenticator:
    """Plays the part of the iPad: makes a passkey and answers challenges the way Safari passes them on."""

    def __init__(self, rp_id=HOST):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential = os.urandom(20)
        self.rp_id = rp_id
        self.count = 0

    def cose(self, changes=None):
        """The public key as the authenticator writes it: EC2, ES256, P-256, then x and y."""
        numbers = self.key.public_key().public_numbers()

        return {1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32, "big"), -3: numbers.y.to_bytes(32, "big"), **(changes or {})}

    def data(self, flags, cose=None):
        data = hashlib.sha256(self.rp_id.encode()).digest() + bytes([flags | (0x40 if cose else 0)]) + self.count.to_bytes(4, "big")
        if cose:
            data += bytes(16) + len(self.credential).to_bytes(2, "big") + self.credential + to_cbor(cose)

        return data

    def client(self, kind, challenge, origin):
        return json.dumps({"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": False}).encode()

    def create(self, challenge, origin=ORIGIN, flags=0x05, cose=None):
        attestation = {"fmt": "none", "attStmt": {}, "authData": self.data(flags, cose or self.cose())}

        return {
            "id": passkeys.encoded(self.credential),
            "clientDataJSON": passkeys.encoded(self.client("webauthn.create", challenge, origin)),
            "attestationObject": passkeys.encoded(to_cbor(attestation)),
        }

    def get(self, challenge, origin=ORIGIN, flags=0x05, key=None):
        client = self.client("webauthn.get", challenge, origin)
        data = self.data(flags)
        signature = (key or self.key).sign(data + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))

        return {
            "id": passkeys.encoded(self.credential),
            "clientDataJSON": passkeys.encoded(client),
            "authenticatorData": passkeys.encoded(data),
            "signature": passkeys.encoded(signature),
        }


@unittest.skipUnless(ec, "cryptography isn't installed, so Face ID is off here. CI installs it.")
class PasskeyTests(Case):
    def post(self, path, body=None, cookie=None, origin=ORIGIN):
        status, answer, response = self.request("POST", path, cookie=cookie, origin=origin, body=body or {})

        return status, json.loads(answer), response

    def challenge(self, step, cookie=None):
        status, answer, _ = self.post(f"/api/passkey/{step}-options", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(answer["rpId"], HOST)

        return answer["challenge"]

    def registered(self, authenticator=None):
        authenticator = authenticator or Authenticator()
        cookie = self.signed_in()
        status, _, _ = self.post("/api/passkey/register", authenticator.create(self.challenge("register", cookie)), cookie=cookie)
        self.assertEqual(status, 200)

        return authenticator, cookie

    def face_id(self, authenticator, **changes):
        return self.post("/api/passkey/sign-in", authenticator.get(self.challenge("sign-in"), **changes))

    def cookie_from(self, response):
        return response.getheader("Set-Cookie").split(";")[0].split("=", 1)[1]

    def test_a_device_adds_face_id_then_signs_in_with_it(self):
        authenticator, _ = self.registered()
        status, _, response = self.face_id(authenticator)
        self.assertEqual(status, 200)
        cookie = self.cookie_from(response)
        for part in ("Secure", "HttpOnly", "SameSite=Lax", f"Max-Age={server.DEVICE_S}"):
            self.assertIn(part, response.getheader("Set-Cookie"))
        self.assertEqual(self.request("GET", "/api/sessions", cookie=cookie, token=self.page_token(cookie))[0], 200)
        self.assertEqual(server.REMOTE.devices()[cookie.split(".")[0]]["name"], "iPad")

    def test_the_page_offers_face_id_only_once_there_is_a_passkey(self):
        page = self.request("GET", "/")[1].decode()
        self.assertIn("passkeysOn = true, hasPasskeys = false", page)
        self.registered()
        page = self.request("GET", "/")[1].decode()
        self.assertIn("passkeysOn = true, hasPasskeys = true", page)
        self.assertNotIn(server.TOKEN, page)

    def test_adding_face_id_needs_a_signed_in_device_and_the_right_origin(self):
        cookie = self.signed_in()
        self.assertEqual(self.post("/api/passkey/register-options")[0], 403)
        self.assertEqual(self.post("/api/passkey/register-options", cookie=cookie, origin="https://evil.example")[0], 403)
        self.assertEqual(self.post("/api/passkey/register-options", cookie=cookie, origin=None)[0], 403)
        challenge = self.challenge("register", cookie)
        self.assertEqual(self.post("/api/passkey/register", Authenticator().create(challenge))[0], 403)
        self.assertEqual(server.REMOTE.passkeys(), {})

    def test_signing_in_with_face_id_needs_the_right_origin(self):
        authenticator, _ = self.registered()
        for origin in (None, "https://evil.example"):
            with self.subTest(origin):
                self.assertEqual(self.post("/api/passkey/sign-in", authenticator.get(self.challenge("sign-in")), origin=origin)[0], 403)

    def test_a_challenge_works_once_and_only_for_its_purpose(self):
        authenticator, _ = self.registered()
        challenge = self.challenge("sign-in")
        self.assertEqual(self.post("/api/passkey/sign-in", authenticator.get(challenge))[0], 200)
        self.assertEqual(self.post("/api/passkey/sign-in", authenticator.get(challenge))[0], 403)
        # One made for adding a passkey can't sign in, and one made for signing in can't add a passkey.
        cookie = self.signed_in()
        self.assertEqual(self.post("/api/passkey/sign-in", authenticator.get(self.challenge("register", cookie)))[0], 403)
        self.assertEqual(self.post("/api/passkey/register", Authenticator().create(self.challenge("sign-in")), cookie=cookie)[0], 403)
        # Nor can another device's.
        other = self.signed_in()
        self.assertEqual(self.post("/api/passkey/register", Authenticator().create(self.challenge("register", other)), cookie=cookie)[0], 403)
        self.assertEqual(self.post("/api/passkey/sign-in", authenticator.get("made-up"))[0], 403)

    def test_an_old_challenge_is_refused(self):
        authenticator, _ = self.registered()
        challenge = self.challenge("sign-in")
        later = time.time() + passkeys.CHALLENGE_S + 1
        with mock.patch.object(passkeys.time, "time", return_value=later):
            self.assertEqual(self.post("/api/passkey/sign-in", authenticator.get(challenge))[0], 403)

    def test_wrong_answers_are_refused(self):
        authenticator, _ = self.registered()
        cases = {
            "another site's origin": {"origin": "https://evil.example"},
            "no Face ID, just a tap": {"flags": 0x01},
            "another key": {"key": ec.generate_private_key(ec.SECP256R1())},
        }
        for name, changes in cases.items():
            with self.subTest(name):
                self.assertEqual(self.face_id(authenticator, **changes)[0], 403)
        elsewhere = Authenticator(rp_id="evil.example")
        elsewhere.credential, elsewhere.key = authenticator.credential, authenticator.key
        self.assertEqual(self.face_id(elsewhere)[0], 403)
        self.assertEqual(self.face_id(Authenticator())[0], 403)
        self.assertEqual(self.face_id(authenticator)[0], 200)

    def test_a_passkey_made_wrongly_isnt_added(self):
        cookie = self.signed_in()
        cases = {
            "another site's origin": lambda one, challenge: one.create(challenge, origin="https://evil.example"),
            "no Face ID": lambda one, challenge: one.create(challenge, flags=0x01),
            "another algorithm": lambda one, challenge: one.create(challenge, cose=one.cose({3: -257})),
            "another curve": lambda one, challenge: one.create(challenge, cose=one.cose({-1: 2})),
            "a short x": lambda one, challenge: one.create(challenge, cose=one.cose({-2: bytes(31)})),
            "a point off the curve": lambda one, challenge: one.create(challenge, cose=one.cose({-2: bytes(31) + b"\x01", -3: bytes(31) + b"\x01"})),
            "a different id": lambda one, challenge: {**one.create(challenge), "id": passkeys.encoded(b"other")},
            "broken CBOR": lambda one, challenge: {**one.create(challenge), "attestationObject": passkeys.encoded(b"\xa3\x63fmt")},
            "deep CBOR": lambda one, challenge: {**one.create(challenge), "attestationObject": passkeys.encoded(b"\xa1\x00" * 1000)},
            "not text": lambda one, challenge: {**one.create(challenge), "attestationObject": 5},
        }
        for name, make in cases.items():
            with self.subTest(name):
                self.assertEqual(self.post("/api/passkey/register", make(Authenticator(), self.challenge("register", cookie)), cookie=cookie)[0], 403)
        self.assertEqual(server.REMOTE.passkeys(), {})

    def test_a_sign_count_that_goes_backwards_is_refused(self):
        authenticator, _ = self.registered()
        # Synced passkeys always send 0, and that's fine.
        self.assertEqual(self.face_id(authenticator)[0], 200)
        self.assertEqual(self.face_id(authenticator)[0], 200)
        authenticator.count = 5
        self.assertEqual(self.face_id(authenticator)[0], 200)
        self.assertEqual(self.face_id(authenticator)[0], 403)
        authenticator.count = 6
        self.assertEqual(self.face_id(authenticator)[0], 200)

    def test_face_id_outlasts_the_devices_sign_in(self):
        authenticator, cookie = self.registered()
        device_id = cookie.split(".")[0]
        server.REMOTE.changing(lambda state: state["devices"][device_id].update(expires=time.time() - 1))
        self.signed_in()
        self.assertNotIn(device_id, server.REMOTE.devices())
        self.assertEqual(self.request("GET", "/api/sessions", cookie=cookie, token=self.page_token(cookie))[0], 403)
        self.assertEqual(self.face_id(authenticator)[0], 200)

    def test_revoking_a_device_forgets_its_passkey_and_who_used_it(self):
        authenticator, cookie = self.registered()
        _, _, response = self.face_id(authenticator)
        phone = self.cookie_from(response)
        keep = self.signed_in()
        self.assertTrue(server.REMOTE.revoke(cookie.split(".")[0]))
        self.assertEqual(server.REMOTE.passkeys(), {})
        self.assertEqual(set(server.REMOTE.devices()), {keep.split(".")[0]})
        self.assertEqual(self.request("GET", "/", cookie=phone)[0], 401)
        self.assertEqual(self.face_id(authenticator)[0], 403)

    def test_revoking_a_passkey_by_its_id(self):
        authenticator, cookie = self.registered()
        (passkey_id,) = server.REMOTE.passkeys()
        self.assertTrue(server.REMOTE.revoke(passkey_id))
        self.assertEqual(server.REMOTE.devices(), {})
        self.assertEqual(self.face_id(authenticator)[0], 403)
        self.assertFalse(server.REMOTE.revoke(passkey_id))

    def test_a_device_with_face_id_cant_add_another_passkey(self):
        first, cookie = self.registered()
        _, _, response = self.face_id(first)
        phone = self.cookie_from(response)
        for name, device in (("added it", cookie), ("signed in with it", phone)):
            with self.subTest(name):
                self.assertEqual(self.post("/api/passkey/register-options", cookie=device)[0], 409)
                self.assertFalse(server.REMOTE.add_passkey(device.split(".")[0], "credential", "key", 0))
        self.assertEqual(len(server.REMOTE.passkeys()), 1)
        self.assertEqual(len(server.REMOTE.devices()), 2)
        self.assertEqual(self.face_id(first)[0], 200)

    def test_every_passkey_gets_the_same_user_id_until_access_is_turned_off(self):
        first = self.post("/api/passkey/register-options", cookie=self.signed_in())[1]["userId"]
        self.assertEqual(self.post("/api/passkey/register-options", cookie=self.signed_in())[1]["userId"], first)
        server.REMOTE.turn_off()
        server.REMOTE.turn_on(HOST)
        self.assertNotEqual(self.post("/api/passkey/register-options", cookie=self.signed_in())[1]["userId"], first)

    def status(self, cookie, token=None):
        status, answer, _ = self.request("GET", "/api/passkey/status", cookie=cookie, token=token or self.page_token(cookie))

        return status, json.loads(answer)

    def test_the_office_offers_face_id_until_the_device_has_it(self):
        # For a device that skipped the offer after its code: the office asks, then uses the same steps.
        authenticator = Authenticator()
        cookie = self.signed_in()
        self.assertEqual(self.status(cookie), (200, {"canSetUp": True}))
        status, _, _ = self.request("POST", "/api/passkey/register", cookie=cookie, origin=ORIGIN, token=self.page_token(cookie), body=authenticator.create(self.challenge("register", cookie)))
        self.assertEqual(status, 200)
        self.assertEqual(self.status(cookie), (200, {"canSetUp": False}))
        _, _, response = self.face_id(authenticator)
        self.assertEqual(self.status(self.cookie_from(response)), (200, {"canSetUp": False}))

    def test_asking_needs_the_devices_token(self):
        cookie = self.signed_in()
        self.assertEqual(self.status(cookie, token="wrong")[0], 403)
        self.assertEqual(self.request("GET", "/api/passkey/status")[0], 403)

    def test_an_id_that_isnt_ascii_is_refused_cleanly(self):
        authenticator, _ = self.registered()
        answer = {**authenticator.get(self.challenge("sign-in")), "id": "café"}
        self.assertEqual(self.post("/api/passkey/sign-in", answer)[0], 403)

    def test_revoking_all_and_turning_off_forget_passkeys(self):
        for forget in (server.REMOTE.revoke_all, server.REMOTE.turn_off):
            with self.subTest(forget.__name__):
                server.REMOTE.turn_on(HOST)
                authenticator, _ = self.registered()
                forget()
                server.REMOTE.turn_on(HOST)
                self.assertEqual(server.REMOTE.passkeys(), {})
                self.assertEqual(self.face_id(authenticator)[0], 403)

    def test_only_the_public_key_is_stored_and_nothing_secret_is_logged(self):
        authenticator = Authenticator()
        with mock.patch.object(server.sys, "stderr", io.StringIO()) as log:
            _, cookie = self.registered(authenticator)
            _, _, response = self.face_id(authenticator)
            self.face_id(authenticator, origin="https://evil.example")
        (passkey,) = json.loads(server.REMOTE.path.read_text())["passkeys"].values()
        self.assertEqual(set(passkey), {"credential", "publicKey", "signCount", "name", "created", "lastUsed"})
        public_key = serialization.load_der_public_key(passkeys.decoded(passkey["publicKey"]))
        self.assertEqual(public_key.public_numbers(), authenticator.key.public_key().public_numbers())
        written = log.getvalue()
        self.assertIn("Face ID added for device", written)
        self.assertIn("Device signed in with Face ID", written)
        self.assertIn("Face ID sign-in refused", written)
        for secret in (cookie.split(".")[1], self.cookie_from(response).split(".")[1], passkey["credential"]):
            self.assertNotIn(secret, written)

    def test_challenges_dont_pile_up(self):
        for _ in range(passkeys.MAX_CHALLENGES * 2):
            self.challenge("sign-in")
        self.assertLessEqual(len(server.PASSKEY_CHALLENGES.open), passkeys.MAX_CHALLENGES)


class WithoutCryptographyTests(Case):
    def test_the_office_works_with_codes_and_no_face_id(self):
        with mock.patch.object(passkeys, "ec", None):
            page = self.request("GET", "/")[1].decode()
            self.assertIn("passkeysOn = false", page)
            cookie = self.signed_in()
            status, _, _ = self.request("POST", "/api/passkey/register-options", cookie=cookie, origin=ORIGIN, body={})
            self.assertEqual(status, 404)
            self.assertEqual(self.request("POST", "/api/passkey/sign-in-options", origin=ORIGIN, body={})[0], 404)
            status, answer, _ = self.request("GET", "/api/passkey/status", cookie=cookie, token=self.page_token(cookie))
            self.assertEqual((status, json.loads(answer)), (200, {"canSetUp": False}))
            self.assertEqual(self.request("GET", "/api/sessions", cookie=cookie, token=self.page_token(cookie))[0], 200)


class CommandTests(Case):
    def run_command(self, *arguments):
        script = server.ROOT / "scripts" / "ipad-access.py"

        return subprocess.run([sys.executable, str(script), *arguments], capture_output=True, text=True, env={**os.environ, "AGENT_OFFICE_HOME": str(DATA)})

    def test_devices_lists_passkeys_and_revoke_takes_their_ids(self):
        cookie = self.signed_in()
        self.assertTrue(server.REMOTE.add_passkey(cookie.split(".")[0], "credential", "key", 0))
        (passkey_id,) = server.REMOTE.passkeys()
        listing = self.run_command("devices").stdout
        self.assertIn(f"with Face ID {passkey_id}", listing)
        self.assertIn(f"{passkey_id}  Face ID passkey from iPad", listing)
        self.assertEqual(self.run_command("revoke", passkey_id).returncode, 0)
        self.assertEqual(server.REMOTE.passkeys(), {})
        self.assertIn("No devices", self.run_command("devices").stdout)
        self.assertEqual(self.run_command("revoke", passkey_id).returncode, 1)


if __name__ == "__main__":
    unittest.main()
