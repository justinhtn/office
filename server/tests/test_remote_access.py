import http.client
import json
import os
import stat
import subprocess
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

from support import DATA, clean_slate, server

HOST = "my-mac.tail1234.ts.net"
ORIGIN = f"https://{HOST}"
SESSION = "local_00000000-0000-0000-0000-000000000001"


def serve(handler):
    http_server = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=http_server.serve_forever, daemon=True).start()

    return http_server


class Case(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.remote = serve(server.RemoteHandler)
        cls.local = serve(server.Handler)
        for one in (cls.remote, cls.local):
            cls.addClassCleanup(one.server_close)
            cls.addClassCleanup(one.shutdown)

    def setUp(self):
        clean_slate()
        server.REMOTE.turn_on(HOST)
        dist = server.DATA / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text("<meta content=__OFFICE_TOKEN__>")
        (dist / "assets" / "app.js").write_text("APP")
        patcher = mock.patch.object(server, "DIST", dist)
        patcher.start()
        self.addCleanup(patcher.stop)

    def request(self, method, path, port=None, host=HOST, cookie=None, token=None, origin=None, body=None, headers=None):
        all_headers = {"Host": host, **(headers or {})}
        if cookie:
            all_headers["Cookie"] = f"{server.COOKIE}={cookie}"
        if token:
            all_headers["X-Office-Token"] = token
        if origin:
            all_headers["Origin"] = origin
        connection = http.client.HTTPConnection("127.0.0.1", port or self.remote.server_address[1], timeout=10)
        self.addCleanup(connection.close)
        connection.request(method, path, body=None if body is None else json.dumps(body), headers=all_headers)
        response = connection.getresponse()

        return response.status, response.read(), response

    def sign_in(self, code, origin=ORIGIN):
        return self.request("POST", "/api/sign-in", origin=origin, body={"code": code, "name": "iPad"})

    def signed_in(self):
        status, _, response = self.sign_in(server.REMOTE.new_code())
        self.assertEqual(status, 200)

        return response.getheader("Set-Cookie").split(";")[0].split("=", 1)[1]

    def page_token(self, cookie):
        _, page, _ = self.request("GET", "/", cookie=cookie)

        return page.decode().split("content=")[1].split(">")[0]


class NoSignInTests(Case):
    def test_the_page_is_the_form_and_holds_no_token(self):
        status, page, _ = self.request("GET", "/")
        self.assertEqual(status, 401)
        self.assertIn(b"Sign in", page)
        self.assertNotIn(server.TOKEN.encode(), page)
        self.assertNotIn(b"office-token", page)

    def test_everything_else_is_refused(self):
        signature = server.media_signature(SESSION, "a.png")
        for path in ("/assets/app.js", "/api/sessions", f"/media?id={SESSION}&path=a.png&sig={signature}"):
            with self.subTest(path):
                self.assertEqual(self.request("GET", path)[0], 403)
        self.assertEqual(self.request("POST", "/api/shut-down", body={"isOn": True})[0], 403)

    def test_the_offices_own_token_doesnt_sign_in(self):
        self.assertEqual(self.request("GET", "/api/sessions", token=server.TOKEN)[0], 403)

    def test_proxy_identity_headers_dont_sign_in(self):
        headers = {"Tailscale-User-Login": "me@example.com", "X-Forwarded-For": "127.0.0.1"}
        self.assertEqual(self.request("GET", "/api/sessions", token=server.TOKEN, headers=headers)[0], 403)


class WrongPlaceTests(Case):
    def test_a_wrong_host_is_refused_even_when_signed_in(self):
        cookie = self.signed_in()
        for host in ("evil.example", f"{HOST}.evil.example", "localhost", "127.0.0.1", f"localhost:{self.remote.server_address[1]}"):
            with self.subTest(host):
                self.assertEqual(self.request("GET", "/", host=host, cookie=cookie)[0], 403)

    def test_a_wrong_origin_is_refused(self):
        cookie = self.signed_in()
        for origin in ("https://evil.example", f"http://{HOST}"):
            with self.subTest(origin):
                self.assertEqual(self.request("GET", "/", cookie=cookie, origin=origin)[0], 403)

    def test_signing_in_needs_the_right_origin(self):
        code = server.REMOTE.new_code()
        for origin in (None, "https://evil.example"):
            with self.subTest(origin):
                self.assertEqual(self.sign_in(code, origin=origin)[0], 403)
        self.assertEqual(self.sign_in(code)[0], 200)

    def test_off_by_default_refuses_everything(self):
        server.REMOTE.turn_off()
        self.assertEqual(self.request("GET", "/")[0], 403)


class SignedInTests(Case):
    def test_the_cookie_is_locked_down(self):
        status, _, response = self.sign_in(server.REMOTE.new_code())
        self.assertEqual(status, 200)
        cookie = response.getheader("Set-Cookie")
        self.assertTrue(cookie.startswith(f"{server.COOKIE}="))
        for part in ("Path=/", "Secure", "HttpOnly", "SameSite=Strict", f"Max-Age={server.DEVICE_S}"):
            self.assertIn(part, cookie)
        self.assertNotIn("Domain", cookie)

    def test_a_device_gets_the_office_with_its_own_token(self):
        cookie = self.signed_in()
        status, page, _ = self.request("GET", "/", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertNotIn(server.TOKEN.encode(), page)
        self.assertEqual(self.request("GET", "/assets/app.js", cookie=cookie)[0], 200)
        self.assertEqual(self.request("GET", "/api/sessions", cookie=cookie, token=self.page_token(cookie))[0], 200)

    def test_the_cookie_alone_or_the_offices_token_isnt_enough_for_the_api(self):
        cookie = self.signed_in()
        self.assertEqual(self.request("GET", "/api/sessions", cookie=cookie)[0], 403)
        self.assertEqual(self.request("GET", "/api/sessions", cookie=cookie, token=server.TOKEN)[0], 403)

    def test_a_devices_token_doesnt_work_on_the_macs_own_port(self):
        token = self.page_token(self.signed_in())
        status, _, _ = self.request("GET", "/api/sessions", port=self.local.server_address[1], host=f"127.0.0.1:{server.PORT}", token=token)
        self.assertEqual(status, 403)

    def test_a_cookie_cant_use_another_devices_token(self):
        first, second = self.signed_in(), self.signed_in()
        self.assertEqual(self.request("GET", "/api/sessions", cookie=second, token=self.page_token(first))[0], 403)


class OldCookieTests(Case):
    def test_an_expired_cookie_is_refused(self):
        cookie = self.signed_in()
        later = server.time.time() + server.DEVICE_S + 1
        with mock.patch("remote_access.time.time", return_value=later):
            status, page, _ = self.request("GET", "/", cookie=cookie)
            self.assertEqual(status, 401)
            self.assertIn(b"Sign in", page)
            self.assertEqual(self.request("GET", "/api/sessions", cookie=cookie)[0], 403)

    def test_a_revoked_device_is_refused_and_others_stay(self):
        first, second = self.signed_in(), self.signed_in()
        self.assertTrue(server.REMOTE.revoke(first.split(".")[0]))
        self.assertEqual(self.request("GET", "/", cookie=first)[0], 401)
        self.assertEqual(self.request("GET", "/", cookie=second)[0], 200)

    def test_revoking_all_refuses_everyone(self):
        cookie = self.signed_in()
        server.REMOTE.revoke_all()
        self.assertEqual(self.request("GET", "/", cookie=cookie)[0], 401)

    def test_turning_off_refuses_at_once_and_forgets_devices(self):
        cookie = self.signed_in()
        server.REMOTE.turn_off()
        self.assertEqual(self.request("GET", "/", cookie=cookie)[0], 403)
        server.REMOTE.turn_on(HOST)
        self.assertEqual(self.request("GET", "/", cookie=cookie)[0], 401)

    def test_a_forged_or_malformed_cookie_is_refused(self):
        cookie = self.signed_in()
        for bad in (cookie.split(".")[0] + ".wrong", "nope", ".", "a.b.c", cookie + "x"):
            with self.subTest(bad):
                self.assertEqual(self.request("GET", "/", cookie=bad)[0], 401)
        status, _, _ = self.request("GET", "/", headers={"Cookie": "a=b; ;;; =\x7f"})
        self.assertEqual(status, 401)


class CodeTests(Case):
    def test_a_code_works_once(self):
        code = server.REMOTE.new_code()
        self.assertEqual(self.sign_in(code)[0], 200)
        self.assertEqual(self.sign_in(code)[0], 403)

    def test_an_expired_code_is_refused(self):
        code = server.REMOTE.new_code()
        with mock.patch("remote_access.time.time", return_value=server.time.time() + 601):
            self.assertEqual(self.sign_in(code)[0], 403)

    def test_too_many_tries_lock_out_even_the_right_code(self):
        code = server.REMOTE.new_code()
        for _ in range(5):
            self.assertEqual(self.sign_in("wrong")[0], 403)
        self.assertEqual(self.sign_in(code)[0], 429)

    def test_a_new_code_made_on_the_mac_clears_the_lockout(self):
        server.REMOTE.new_code()
        for _ in range(5):
            self.sign_in("wrong")
        self.assertEqual(self.sign_in(server.REMOTE.new_code())[0], 200)

    def test_tries_with_no_code_count_too(self):
        for _ in range(5):
            self.assertEqual(self.sign_in("wrong")[0], 403)
        self.assertEqual(self.sign_in("wrong")[0], 429)

    def test_bad_bodies_are_refused(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.remote.server_address[1], timeout=10)
        self.addCleanup(connection.close)
        connection.request("POST", "/api/sign-in", body="not json", headers={"Host": HOST, "Origin": ORIGIN})
        self.assertEqual(connection.getresponse().status, 400)

    def test_a_negative_length_is_refused(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.remote.server_address[1], timeout=10)
        self.addCleanup(connection.close)
        connection.putrequest("POST", "/api/sign-in", skip_host=True)
        for name, value in (("Host", HOST), ("Origin", ORIGIN), ("Content-Length", "-1")):
            connection.putheader(name, value)
        connection.endheaders()
        self.assertEqual(connection.getresponse().status, 413)

    def test_only_hashes_reach_the_disk_in_a_private_file(self):
        code = server.REMOTE.new_code()
        stored = server.REMOTE.path.read_text()
        self.assertNotIn(code.replace("-", ""), stored)
        self.assertEqual(self.sign_in(code)[0], 200)
        cookie_secret = self.signed_in().split(".")[1]
        self.assertNotIn(cookie_secret, server.REMOTE.path.read_text())
        self.assertEqual(stat.S_IMODE(server.REMOTE.path.stat().st_mode), 0o600)


class MacsOwnPortTests(Case):
    def local_get(self, path, **kwargs):
        return self.request("GET", path, port=self.local.server_address[1], host=f"127.0.0.1:{server.PORT}", **kwargs)

    def test_it_works_as_before_with_no_sign_in(self):
        status, page, _ = self.local_get("/")
        self.assertEqual(status, 200)
        self.assertIn(server.TOKEN.encode(), page)
        self.assertEqual(self.local_get("/api/sessions", token=server.TOKEN)[0], 200)

    def test_it_refuses_a_proxy_pointed_at_it_by_mistake(self):
        for name in server.PROXY_HEADERS:
            with self.subTest(name):
                self.assertEqual(self.local_get("/", headers={name: "x"})[0], 403)

    def test_it_refuses_the_tailscale_host(self):
        self.assertEqual(self.request("GET", "/", port=self.local.server_address[1])[0], 403)


class HostTests(unittest.TestCase):
    def setUp(self):
        clean_slate()

    def test_only_a_tailscale_name_is_accepted(self):
        for host in ("example.com", "0.0.0.0", "localhost", "*.ts.net", "a.ts.net.evil.com", "A.TS.NET", "a b.ts.net", "ts.net", ""):
            with self.subTest(host), self.assertRaises(ValueError):
                server.REMOTE.turn_on(host)
        self.assertIsNone(server.REMOTE.host())

    def test_a_code_cant_be_made_while_off(self):
        with self.assertRaises(ValueError):
            server.REMOTE.new_code()


class CommandTests(unittest.TestCase):
    def setUp(self):
        clean_slate()

    def run_command(self, *arguments):
        script = Path(server.ROOT) / "scripts" / "ipad-access.py"

        return subprocess.run([sys.executable, str(script), *arguments], capture_output=True, text=True, env={**os.environ, "AGENT_OFFICE_HOME": str(DATA)})

    def test_on_code_devices_and_off(self):
        self.assertIn("Off", self.run_command("status").stdout)
        self.assertEqual(self.run_command("code").returncode, 1)
        on = self.run_command("on", HOST)
        self.assertEqual(on.returncode, 0)
        self.assertIn("serve", on.stdout)
        code = self.run_command("code").stdout.split()[0]
        cookie, problem = server.REMOTE.sign_in(code, "iPad")
        self.assertIsNone(problem)
        self.assertIn("iPad", self.run_command("devices").stdout)
        self.assertEqual(self.run_command("revoke", "nope").returncode, 1)
        self.assertEqual(self.run_command("revoke", cookie.split(".")[0]).returncode, 0)
        self.assertIn("No devices", self.run_command("devices").stdout)
        self.assertEqual(self.run_command("off").returncode, 0)
        self.assertIn("Off", self.run_command("status").stdout)

    def test_a_bad_host_is_refused(self):
        result = self.run_command("on", "example.com")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Tailscale", result.stderr)


if __name__ == "__main__":
    unittest.main()
