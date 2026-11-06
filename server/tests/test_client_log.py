import http.client
import json
import threading
from datetime import date, timedelta
import unittest
from unittest import mock

from support import DATA, clean_slate, server

import client_log

RUN = "lq2x0c1-abc12345"
HOST = f"127.0.0.1:{server.PORT}"
REMOTE_HOST = "my-mac.tail1234.ts.net"


def event(kind="page.load", t=120, **data):
    return {"t": t, "kind": kind, **data}


def lines_in(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


class ClientLogTests(unittest.TestCase):
    def setUp(self):
        clean_slate()
        self.folder = DATA / "logs" / "client"
        self.log = client_log.ClientLog(self.folder, server.redacted)

    def only_file(self):
        files = sorted(self.folder.iterdir())
        self.assertEqual(len(files), 1)

        return files[0]

    def test_keeps_each_event_as_a_line_under_the_device_and_day(self):
        kept = self.log.write("a1b2c3d4", "iPhone", {"run": RUN, "events": [event(), event("scene.firstFrame", 900, people=4)]})
        self.assertEqual(kept, 2)
        path = self.only_file()
        self.assertRegex(path.name, r"^a1b2c3d4-\d{4}-\d{2}-\d{2}\.jsonl$")
        first, second = lines_in(path)
        self.assertEqual((first["device"], first["deviceName"], first["run"], first["kind"], first["t"]), ("a1b2c3d4", "iPhone", RUN, "page.load", 120))
        self.assertEqual(second["people"], 4)

    def test_a_page_cant_claim_another_device_run_or_time(self):
        self.log.write("mac", "Mac", {"run": RUN, "events": [event(device="other", deviceName="Fake", run="other-run1", at="1999")]})
        line = lines_in(self.only_file())[0]
        self.assertEqual((line["device"], line["deviceName"], line["run"]), ("mac", "Mac", RUN))
        self.assertNotEqual(line["at"], "1999")

    def test_refuses_a_bad_batch(self):
        for device, body in (
            ("../etc", {"run": RUN, "events": []}),
            ("mac", {"run": "../../x", "events": []}),
            ("mac", {"run": RUN, "events": "lots"}),
            ("mac", {"run": RUN, "events": [event()] * (client_log.MAX_EVENTS + 1)}),
            ("mac", ["not", "an", "object"]),
        ):
            with self.subTest(device=device, body=str(body)[:40]):
                with self.assertRaises(client_log.Rejected):
                    self.log.write(device, "Mac", body)
        self.assertFalse(self.folder.exists())

    def test_skips_events_without_a_good_kind_or_time(self):
        kept = self.log.write("mac", "Mac", {"run": RUN, "events": [event("Bad Kind"), event(t=-1), event(t="soon"), event(t=True), "text", event("ok")]})
        self.assertEqual(kept, 1)

    def test_values_are_cut_down_to_short_plain_ones(self):
        deep = {"a": {"b": {"c": {"d": 1}}}}
        self.log.write("mac", "Mac", {"run": RUN, "events": [event(message="x" * 5000, items=list(range(100)), deep=deep, **{"bad key": 1, "_private": 2}, fn=float("nan"))]})
        line = lines_in(self.only_file())[0]
        self.assertEqual(len(line["message"]), client_log.MAX_TEXT)
        self.assertEqual(len(line["items"]), client_log.MAX_ITEMS)
        self.assertEqual(line["deep"], {"a": {"b": None}})
        self.assertNotIn("bad key", line)
        self.assertNotIn("_private", line)
        self.assertIsNone(line["fn"])

    def test_never_keeps_secrets_or_link_queries(self):
        page_token = "f" * 64
        self.log.write("mac", "Mac", {"run": RUN, "token": page_token, "events": [event(
            "error",
            message=f"Failed to fetch https://my-mac.ts.net/media?id=local_1&sig=abcdef123456 with {page_token}",
            file="/assets/index-abc.js?v=2#frag",
            token="should-go", cookie="should-go", authHeader="should-go",
            note=f"office token {server.TOKEN}",
            lastEvents=[{"kind": "error", "message": "see /api/file?id=1&path=.env", "secret": "x"}],
        )]}, hidden=(page_token,))
        text = self.only_file().read_text()
        for leaked in (page_token, server.TOKEN, "sig=", "should-go", "?v=2", "#frag", "path=.env", '"secret"'):
            self.assertNotIn(leaked, text)
        line = lines_in(self.only_file())[0]
        self.assertEqual(line["file"], "/assets/index-abc.js")
        self.assertIn("https://my-mac.ts.net/media", line["message"])
        self.assertEqual(line["lastEvents"][0]["message"], "see /api/file")

    def test_notes_events_the_page_had_to_drop(self):
        self.log.write("mac", "Mac", {"run": RUN, "dropped": 12, "events": [event()]})
        self.assertEqual(lines_in(self.only_file())[-1]["kind"], "log.dropped")

    def test_a_line_keeps_its_time_however_many_keys_come_before_it(self):
        crowded = {f"k{index}": index for index in range(40)}
        self.log.write("mac", "Mac", {"run": RUN, "dropped": 3, "events": [{**crowded, "kind": "late", "t": 77}]})
        first, dropped = lines_in(self.only_file())
        self.assertEqual((first["t"], first["kind"]), (77, "late"))
        self.assertEqual((dropped["kind"], dropped["t"]), ("log.dropped", 77))

    def test_a_new_day_clears_only_this_logs_files_from_before_the_days_kept(self):
        self.folder.mkdir(parents=True)
        today = date.today()
        old = (today - timedelta(days=client_log.KEEP_DAYS)).isoformat()
        kept_day = (today - timedelta(days=client_log.KEEP_DAYS - 1)).isoformat()
        for name in (f"mac-{old}.jsonl", f"a1b2c3d4-{old}.1.jsonl", f"mac-{kept_day}.jsonl", f"notes-{old}.txt", "mac-not-a-date.jsonl"):
            (self.folder / name).write_text("{}\n")
        with mock.patch.object(client_log, "datetime", wraps=client_log.datetime) as clock:
            clock.now.return_value = client_log.datetime.combine(today, client_log.datetime.min.time(), client_log.timezone.utc)
            self.log.write("mac", "Mac", {"run": RUN, "events": [event()]})
        names = sorted(path.name for path in self.folder.iterdir())
        self.assertEqual(names, sorted([f"mac-{kept_day}.jsonl", f"notes-{old}.txt", "mac-not-a-date.jsonl", f"mac-{today.isoformat()}.jsonl"]))

    def test_a_full_file_moves_aside_and_only_one_older_file_is_kept(self):
        log = client_log.ClientLog(self.folder, server.redacted, max_file=600)
        for _ in range(12):
            log.write("mac", "Mac", {"run": RUN, "events": [event(message="y" * 100)]})
        names = sorted(path.name for path in self.folder.iterdir())
        self.assertEqual(len(names), 2)
        self.assertTrue(names[0].endswith(".1.jsonl"))
        for path in self.folder.iterdir():
            self.assertLessEqual(path.stat().st_size, 600)


class RequestTests(unittest.TestCase):
    """The endpoint on the Mac's own port, and on the port other devices reach."""

    @classmethod
    def setUpClass(cls):
        cls.local = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.remote = server.ThreadingHTTPServer(("127.0.0.1", 0), server.RemoteHandler)
        for one in (cls.local, cls.remote):
            threading.Thread(target=one.serve_forever, daemon=True).start()
            cls.addClassCleanup(one.server_close)
            cls.addClassCleanup(one.shutdown)

    def setUp(self):
        clean_slate()
        folder = DATA / "logs" / "client"
        patcher = mock.patch.object(server, "CLIENT_LOG", client_log.ClientLog(folder, server.redacted))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.folder = folder

    def post(self, body, http=None, host=HOST, cookie=None, origin=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        headers = {"Host": host, "Content-Type": "text/plain"}
        if cookie:
            headers["Cookie"] = f"{server.COOKIE}={cookie}"
        if origin:
            headers["Origin"] = origin
        connection = http_connection(http or self.local)
        self.addCleanup(connection.close)
        connection.request("POST", "/api/client-log", body=raw, headers=headers)
        response = connection.getresponse()

        return response.status, response.read()

    def test_the_mac_sends_with_the_token_in_the_body(self):
        status, reply = self.post({"token": server.TOKEN, "run": RUN, "events": [event()]})
        self.assertEqual((status, json.loads(reply)), (200, {"kept": 1}))
        path = next(self.folder.iterdir())
        self.assertTrue(path.name.startswith("mac-"))
        self.assertNotIn(server.TOKEN, path.read_text())

    def test_without_the_token_nothing_is_kept(self):
        for token in (None, "", "wrong", 12):
            with self.subTest(token=token):
                body = {"run": RUN, "events": [event()]}
                if token is not None:
                    body["token"] = token
                self.assertEqual(self.post(body)[0], 403)
        self.assertFalse(self.folder.exists())

    def test_another_site_cant_send(self):
        self.assertEqual(self.post({"token": server.TOKEN, "run": RUN, "events": [event()]}, origin="https://evil.example")[0], 403)

    def test_too_big_or_bad_is_refused(self):
        self.assertEqual(self.post(b"x" * (client_log.MAX_BODY + 1))[0], 413)
        self.assertEqual(self.post(b"not json")[0], 400)
        self.assertEqual(self.post(b"[" * 60000)[0], 400)
        self.assertEqual(self.post({"token": server.TOKEN, "run": "../x", "events": []})[0], 400)

    def test_a_signed_in_device_files_under_its_own_id_and_name(self):
        server.REMOTE.turn_on(REMOTE_HOST)
        cookie, problem = server.REMOTE.sign_in(server.REMOTE.new_code(), "Justin's iPhone")
        self.assertIsNone(problem)
        device = cookie.split(".")[0]
        token = hmac_token(device)
        status, _ = self.post({"token": token, "run": RUN, "events": [event()]}, http=self.remote, host=REMOTE_HOST, cookie=cookie, origin=f"https://{REMOTE_HOST}")
        self.assertEqual(status, 200)
        path = next(self.folder.iterdir())
        self.assertTrue(path.name.startswith(f"{device}-"))
        line = lines_in(path)[0]
        self.assertEqual(line["deviceName"], "Justin's iPhone")
        self.assertNotIn(token, path.read_text())

    def test_a_device_needs_its_cookie_and_its_own_token(self):
        server.REMOTE.turn_on(REMOTE_HOST)
        cookie, _ = server.REMOTE.sign_in(server.REMOTE.new_code(), "iPad")
        origin = f"https://{REMOTE_HOST}"
        self.assertEqual(self.post({"token": hmac_token(cookie.split(".")[0]), "run": RUN, "events": [event()]}, http=self.remote, host=REMOTE_HOST, origin=origin)[0], 403)
        self.assertEqual(self.post({"token": server.TOKEN, "run": RUN, "events": [event()]}, http=self.remote, host=REMOTE_HOST, cookie=cookie, origin=origin)[0], 403)
        self.assertFalse(self.folder.exists())


def http_connection(http_server):
    return http.client.HTTPConnection("127.0.0.1", http_server.server_address[1], timeout=10)


def hmac_token(device):
    handler = server.RemoteHandler.__new__(server.RemoteHandler)
    handler.device = device

    return handler.page_token()


if __name__ == "__main__":
    unittest.main()
