import http.client
import json
import threading
import unittest
from unittest import mock
from urllib.parse import urlencode

from support import WORK, clean_slate, server

HOST = "127.0.0.1:0"
SESSION = "local_00000000-0000-0000-0000-000000000001"


class SecretFileTests(unittest.TestCase):
    def test_refuses_secret_names(self):
        for path in (".env", ".env.local", "app/.ENV", "server.pem", "a/b/tls.key", "cert.P12", "id_rsa", ".ssh/id_ed25519", "credentials", "aws/credentials.json", "x/../.env"):
            with self.subTest(path):
                self.assertTrue(server.SECRET_FILE.search(path))

    def test_allows_ordinary_names(self):
        for path in ("README.md", "env.py", ".environment", "keyboard.py", "key.txt", "credentials.py", "my_id_rsa", "pem/notes.txt", ".envs/notes.md"):
            with self.subTest(path):
                self.assertFalse(server.SECRET_FILE.search(path))


class SessionFileTests(unittest.TestCase):
    def setUp(self):
        clean_slate()
        self.cwd = WORK / "project"
        self.cwd.mkdir()
        (self.cwd / "notes.txt").write_text("plain")
        (self.cwd / ".env").write_text("SECRET-VALUE")
        (WORK / "outside.txt").write_text("OUTSIDE-VALUE")
        patcher = mock.patch.object(server.OFFICE, "snapshot", {"people": [{"id": SESSION, "cwd": str(self.cwd)}]})
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_refused(self, reader, path, status):
        with self.assertRaises(server.Refused) as caught:
            reader(SESSION, path)
        self.assertEqual(caught.exception.status, status)

    def test_reads_an_ordinary_file(self):
        self.assertEqual(server.file_text(SESSION, "notes.txt"), {"text": "plain", "truncated": False})

    def test_refuses_a_secret_file(self):
        self.assert_refused(server.file_text, ".env", 403)
        self.assert_refused(server.file_diff, ".env", 403)

    def test_refuses_a_secret_file_however_the_path_is_written(self):
        for path in ("./.env", "sub/../.env", ".env/", ".env/."):
            with self.subTest(path):
                self.assert_refused(server.file_text, path, 403)
                self.assert_refused(server.file_diff, path, 403)

    def test_refuses_a_secret_behind_a_link(self):
        (self.cwd / "harmless.txt").symlink_to(self.cwd / ".env")
        self.assert_refused(server.file_text, "harmless.txt", 403)
        self.assert_refused(server.file_diff, "harmless.txt", 403)

    def test_refuses_paths_outside_the_folder(self):
        (self.cwd / "escape.txt").symlink_to(WORK / "outside.txt")
        for path in ("../outside.txt", str(WORK / "outside.txt"), "escape.txt"):
            with self.subTest(path):
                self.assert_refused(server.file_text, path, 404)
                self.assert_refused(server.file_diff, path, 404)

    def test_an_unknown_session_gets_nothing(self):
        with self.assertRaises(server.Refused) as caught:
            server.file_text("local_other", "notes.txt")
        self.assertEqual(caught.exception.status, 404)

    def test_assets_stay_in_the_assets_folder(self):
        # These files exist and have a type that is served, so only the folder check can refuse them.
        dist = WORK / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "assets" / "app.js").write_text("APP")
        (dist / "beside.js").write_text("BESIDE")
        (WORK / "outside.js").write_text("OUTSIDE")
        with mock.patch.object(server, "DIST", dist):
            self.assertEqual(server.asset("assets/app.js")[0], b"APP")
            for path in ("beside.js", "assets/../beside.js", "assets/../../outside.js"):
                with self.subTest(path), self.assertRaises(server.Refused):
                    server.asset(path)


class RequestTests(unittest.TestCase):
    """Real requests to the real handler, on a free loopback port chosen for this test."""

    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.http.server_close)
        cls.addClassCleanup(cls.http.shutdown)

    def setUp(self):
        clean_slate()

    def send(self, method, path, token=None, host=HOST, origin=None, body=None, extra_headers=None):
        headers = {"Host": host, **(extra_headers or {})}
        if token is not None:
            headers["X-Office-Token"] = token
        if origin:
            headers["Origin"] = origin
        connection = http.client.HTTPConnection("127.0.0.1", self.http.server_address[1], timeout=10)
        self.addCleanup(connection.close)
        connection.request(method, path, body=None if body is None else json.dumps(body), headers=headers)
        response = connection.getresponse()

        return response.status, response.read()

    def test_the_right_token_is_let_in(self):
        status, body = self.send("GET", "/api/sessions", token=server.TOKEN)
        self.assertEqual(status, 200)
        self.assertIn("people", json.loads(body))

    def test_removed_routes_stay_gone(self):
        for path in ("/api/changes", "/api/transcript", "/api/messages", "/api/voice"):
            with self.subTest(path):
                self.assertEqual(self.send("GET", path, token=server.TOKEN)[0], 404)

    def test_data_needs_a_token(self):
        for token in (None, "", "wrong"):
            with self.subTest(token):
                self.assertEqual(self.send("GET", "/api/sessions", token=token)[0], 403)

    def test_a_token_that_is_not_ascii_is_refused(self):
        status, body = self.send("GET", "/api/sessions", token="caf\xe9")
        self.assertEqual(status, 403)
        self.assertNotIn(b"people", body)

    def test_changes_need_a_token_and_leave_nothing_behind(self):
        self.assertEqual(self.send("POST", "/api/voice-mode", body={"isOn": True})[0], 403)
        self.assertFalse(server.VOICE_MODE.exists())
        self.assertEqual(self.send("POST", "/api/voice-mode", token=server.TOKEN, body={"isOn": True})[0], 200)
        self.assertTrue(server.VOICE_MODE.exists())

    def test_a_foreign_host_never_sees_the_token(self):
        for path in ("/", "/api/sessions"):
            with self.subTest(path):
                status, body = self.send("GET", path, token=server.TOKEN, host="evil.example")
                self.assertEqual(status, 403)
                self.assertNotIn(server.TOKEN.encode(), body)

    def test_a_foreign_origin_is_refused(self):
        self.assertEqual(self.send("GET", "/api/sessions", token=server.TOKEN, origin="http://evil.example")[0], 403)
        self.assertEqual(self.send("POST", "/api/voice-mode", token=server.TOKEN, origin="http://evil.example", body={})[0], 403)

    def test_our_own_origin_is_allowed(self):
        self.assertEqual(self.send("GET", "/api/sessions", token=server.TOKEN, origin=f"http://{HOST}")[0], 200)

    def test_only_the_signature_for_that_file_opens_media(self):
        picture, other = WORK / "a.png", WORK / "b.png"
        picture.write_bytes(b"PICTURE")
        other.write_bytes(b"OTHER")
        address = lambda path, sig: "/media?" + urlencode({"id": SESSION, "path": str(path), "sig": sig})
        signature = server.media_signature(SESSION, str(picture))
        self.assertEqual(self.send("GET", address(picture, signature)), (200, b"PICTURE"))
        self.assertEqual(self.send("GET", address(other, signature))[0], 403)
        self.assertEqual(self.send("GET", address(picture, "0" * 64))[0], 403)

    def media_address(self, path):
        return "/media?" + urlencode({"id": SESSION, "path": str(path), "sig": server.media_signature(SESSION, str(path))})

    def test_a_signature_does_not_open_other_kinds_of_file(self):
        notes = WORK / "notes.txt"
        notes.write_text("PRIVATE")
        status, body = self.send("GET", self.media_address(notes))
        self.assertEqual(status, 404)
        self.assertNotIn(b"PRIVATE", body)

    def test_media_serves_the_range_asked_for(self):
        picture = WORK / "a.png"
        picture.write_bytes(b"0123456789")
        address = self.media_address(picture)
        self.assertEqual(self.send("GET", address, extra_headers={"Range": "bytes=2-4"}), (206, b"234"))
        self.assertEqual(self.send("GET", address, extra_headers={"Range": "bytes=-3"}), (206, b"789"))
        self.assertEqual(self.send("GET", address, extra_headers={"Range": "bytes=20-"})[0], 416)


if __name__ == "__main__":
    unittest.main()
