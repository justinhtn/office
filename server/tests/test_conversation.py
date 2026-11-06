import json
from unittest import mock

from support import WORK, assistant, result, server, text, tool, user, write_transcript
from test_remote_access import SESSION, Case

PATH = f"/api/conversation?id={SESSION}"


class ConversationCase(Case):
    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(server.OFFICE, "snapshot", {"people": [{"id": SESSION, "name": "Ada"}]})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(server.TRANSCRIPTS.paths.pop, SESSION, None)
        self.addCleanup(server.TRANSCRIPTS.parsed.pop, SESSION, None)
        self.write(user("Hi"), assistant(text("Hello")))

    def write(self, *records):
        server.TRANSCRIPTS.paths[SESSION] = write_transcript(WORK / "transcript.jsonl", records)
        server.TRANSCRIPTS.parsed.pop(SESSION, None)

    def device(self):
        cookie = self.signed_in()

        return {"cookie": cookie, "token": self.page_token(cookie)}

    def read(self, path=PATH):
        status, body, _ = self.request("GET", path, **self.device())
        self.assertEqual(status, 200, body)

        return json.loads(body)

    def texts(self, path=PATH):
        return [(m["role"], m["text"]) for m in self.read(path)["messages"]]


class AccessTests(ConversationCase):
    def test_a_signed_in_device_reads_it(self):
        self.assertEqual(self.texts(), [("person", "Hi"), ("agent", "Hello")])

    def test_without_sign_in_it_is_refused(self):
        cookie = self.signed_in()
        for headers in ({}, {"cookie": cookie}, {"token": server.TOKEN}, {"cookie": cookie, "token": server.TOKEN}):
            with self.subTest(sorted(headers)):
                self.assertEqual(self.request("GET", PATH, **headers)[0], 403)

    def test_the_macs_own_port_is_refused_even_with_its_token(self):
        # Any program on the Mac can read that token from the page, agents included.
        local = {"port": self.local.server_address[1], "host": f"127.0.0.1:{server.PORT}"}
        for token in (None, server.TOKEN, self.device()["token"]):
            with self.subTest(token=bool(token)):
                self.assertEqual(self.request("GET", PATH, token=token, **local)[0], 403)

    def test_only_sessions_in_the_office(self):
        device = self.device()
        self.assertEqual(self.request("GET", "/api/conversation?id=local_00000000-0000-0000-0000-000000000009", **device)[0], 404)
        self.assertEqual(self.request("GET", "/api/conversation?id=../../etc", **device)[0], 400)

    def test_a_bad_position_is_refused(self):
        device = self.device()
        for before in ("-1", "x", "%C2%B2", "1e3"):
            with self.subTest(before):
                self.assertEqual(self.request("GET", f"{PATH}&before={before}", **device)[0], 400)

    def test_it_only_reads(self):
        status, _, _ = self.request("POST", "/api/conversation", origin=f"https://{server.REMOTE.host()}", body={"id": SESSION}, **self.device())
        self.assertEqual(status, 404)


class ContentTests(ConversationCase):
    def test_private_reasoning_never_appears(self):
        self.write(user("Go"), assistant({"type": "thinking", "thinking": "PRIVATE-REASONING", "signature": "s"}, {"type": "redacted_thinking", "data": "PRIVATE-DATA"}, text("Done")))
        status, body, _ = self.request("GET", PATH, **self.device())
        self.assertEqual(status, 200)
        self.assertNotIn(b"PRIVATE-", body)
        self.assertEqual([m["text"] for m in json.loads(body)["messages"]], ["Go", "Done"])

    def test_tool_calls_are_one_line_and_their_output_stays_behind(self):
        self.write(user("Check"), assistant(tool("t1", "Read", file_path="/x/notes.md")), result("t1", "TOOL-OUTPUT"), assistant(tool("t2", "Bash", command="ls", description="List files")))
        status, body, _ = self.request("GET", PATH, **self.device())
        self.assertNotIn(b"TOOL-OUTPUT", body)
        self.assertEqual([(m["role"], m["text"]) for m in json.loads(body)["messages"]], [("person", "Check"), ("step", "Read notes.md"), ("step", "List files")])

    def test_another_session_shows_who_it_is(self):
        self.write(user('<cross-session-message from="local_abc-1" from-name="Zoe">Status?</cross-session-message>'))
        message = self.read()["messages"][0]
        self.assertEqual((message["role"], message["from"], message["text"]), ("peer", "Zoe", "Status?"))

    def test_the_wrap_up_reads_as_the_agents_words(self):
        self.write(user("Go"), assistant(tool("w", "mcp__ccd_turn__wrap_up", recap="All done", ask="Merge?")))
        self.assertEqual(self.texts(), [("person", "Go"), ("agent", "All done\n\nMerge?")])

    def test_messages_carry_their_time(self):
        self.assertEqual(self.read()["messages"][0]["at"], "2026-01-01T10:00:00.000Z")

    def test_only_plain_fields_go_out(self):
        self.write(assistant(tool("a1", "Artifact", title="Report", file_path="/x/r.html")), result("a1", "https://claude.ai/artifact/abc"))
        for message in self.read()["messages"]:
            self.assertLessEqual(set(message), {"role", "text", "at", "from", "index"})
        self.assertNotIn("claude.ai", json.dumps(self.read()))


class RedactionTests(ConversationCase):
    SECRETS = {
        "anthropic": "key is sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv",
        "openai": "use sk-proj-AbCdEfGhIjKlMnOpQrStUvWx",
        "github": "token ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123",
        "github pat": "github_pat_11AbCdEfGhIjKlMnOpQrStUv",
        "slack": "xoxb-1234567890-AbCdEfGhIj",
        "aws": "AKIAABCDEFGHIJKLMNOP",
        "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM",
        "bearer": "Authorization: Bearer AbCdEfGhIjKlMnOpQrSt",
        "assignment": "export API_KEY=AbCdEf123456",
        "json": '{"client_secret": "AbCdEf123456"}',
        "password": "password: hunter2hunter2",
        "url": "https://me:hunter2pass@example.com/repo",
        "private key": "-----BEGIN OPENSSH PRIVATE KEY-----\nAbCdEfGh\n-----END OPENSSH PRIVATE KEY-----",
    }

    def test_secrets_are_hidden(self):
        for name, secret in self.SECRETS.items():
            with self.subTest(name):
                shown = server.redacted(f"Here: {secret} ok")
                self.assertIn("hidden]", shown)
                self.assertTrue(shown.startswith("Here: ") and shown.endswith(" ok"))
                for part in ("AbCdEf", "hunter2", "AKIAABCD", "SflKxw"):
                    self.assertNotIn(part, shown)

    def test_the_offices_own_token_is_hidden(self):
        self.assertNotIn(server.TOKEN, server.redacted(f"token was {server.TOKEN[:4]} {server.TOKEN}"))

    def test_ordinary_words_stay(self):
        for words in ("The token budget is fine", "Set the password field to required", "see https://example.com/a:b", "sk-learn is a library"):
            with self.subTest(words):
                self.assertEqual(server.redacted(words), words)

    def test_every_kind_of_message_is_redacted(self):
        secret = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123"
        self.write(
            user(f"mine {secret}"),
            assistant(text(f"yours {secret}"), tool("t1", "Bash", command=f"curl -H 'x: {secret}'")),
            user(f'<cross-session-message from="local_abc-1" from-name="Zoe">{secret}</cross-session-message>'),
            assistant(tool("w", "mcp__ccd_turn__wrap_up", recap=f"recap {secret}")),
        )
        status, body, _ = self.request("GET", PATH, **self.device())
        self.assertEqual(status, 200)
        self.assertNotIn(b"AbCdEfGh", body)
        self.assertEqual(len(json.loads(body)["messages"]), 5)


class SizeTests(ConversationCase):
    def test_a_long_message_is_cut(self):
        self.write(assistant(text("x" * 50_000)))
        message = self.read()["messages"][0]
        self.assertEqual(len(message["text"]), server.CONVERSATION_TEXT + 1)
        self.assertTrue(message["text"].endswith("…"))

    def test_pages_go_back_from_the_newest(self):
        self.write(*[user(f"m{i}") for i in range(150)])
        newest = self.read()
        self.assertEqual(len(newest["messages"]), server.CONVERSATION_PAGE)
        self.assertEqual((newest["messages"][-1]["text"], newest["total"], newest["hasOlder"]), ("m149", 150, True))
        older = self.read(f"{PATH}&before={newest['start']}")
        self.assertEqual(older["messages"][-1]["text"], "m89")
        oldest = self.read(f"{PATH}&before={older['start']}")
        self.assertEqual((oldest["messages"][0]["text"], oldest["start"], oldest["hasOlder"]), ("m0", 0, False))
        self.assertEqual(self.read(f"{PATH}&before=0")["messages"], [])

    def test_a_reply_stays_under_the_size_cap(self):
        self.write(*[assistant(text(f"{i} " + "y" * 9000)) for i in range(100)])
        status, body, _ = self.request("GET", PATH, **self.device())
        self.assertEqual(status, 200)
        self.assertLess(len(body), server.CONVERSATION_BYTES + 10_000)
        parsed = json.loads(body)
        self.assertTrue(parsed["hasOlder"])
        self.assertTrue(parsed["messages"][-1]["text"].startswith("99 "))
