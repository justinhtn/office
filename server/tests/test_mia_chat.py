import io
import json
import threading
import time
import unittest
from unittest import mock

from support import DATA, WORK, clean_slate, server
from test_remote_access import Case
import mia_chat  # noqa: E402, after support, which puts the server's folder on the path

LEAD = "local_00000000-0000-0000-0000-000000000001"


class FakeProcess:
    """Stands in for her claude process: what the office writes to her, and lines she answers with."""

    def __init__(self, lines=()):
        self.stdin = io.BytesIO()
        self.stdin.close = lambda: None
        self.stdout = iter(json.dumps(line) + "\n" for line in lines)
        self.exit = None
        self.pid = 999_999

    def poll(self):
        return self.exit

    def wait(self, timeout=None):
        return self.exit

    def sent(self):
        return [json.loads(line) for line in self.stdin.getvalue().decode().splitlines()]


def delta(text):
    return {"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}}}


def start_message(message_id):
    return {"type": "stream_event", "event": {"type": "message_start", "message": {"id": message_id}}}


class Chat(unittest.TestCase):
    def setUp(self):
        clean_slate()
        self.wanted = True
        self.copies = []
        self.chat = mia_chat.MiaChat(DATA, WORK, mock.Mock(return_value=["true"]), lambda: self.wanted, find_copies=lambda _: list(self.copies))
        self.chat.folder.mkdir()
        self.chat.notes.mkdir()

    def running(self, process=None):
        self.chat.process = process or FakeProcess()
        return self.chat.process


class CommandTests(unittest.TestCase):
    def test_her_tools_are_limited_on_the_command_line(self):
        command = server.chat_command("abc", False)
        self.assertEqual(command[command.index("--tools") + 1], "")
        self.assertEqual(command[command.index("--permission-mode") + 1], "dontAsk")
        self.assertEqual(command[command.index("--allowedTools") + 1].split(","), server.CHAT_TOOLS)
        self.assertIn("--strict-mcp-config", command)
        self.assertIn("AGENT_OFFICE_MIA_CHAT=1", command)
        self.assertNotIn("--channels", command)
        self.assertEqual(command[command.index("--resume") + 1], "abc")
        for tool in ("Bash", "Edit", "Write", "Read", "SendMessage", "WebFetch"):
            self.assertNotIn(tool, " ".join(command[command.index("--allowedTools") + 1:command.index("--allowedTools") + 2]))

    def test_a_new_conversation_gets_its_own_id(self):
        command = server.chat_command("abc", True)
        self.assertEqual(command[command.index("--session-id") + 1], "abc")
        self.assertNotIn("--resume", command)

    def test_every_chat_copy_carries_the_marker_the_stop_looks_for(self):
        self.assertIn(mia_chat.MARKER, " ".join(server.chat_command("abc", True)))

    def test_away_mode_keeps_to_the_persons_own_conversation_with_her(self):
        clean_slate()
        folder = server.CLAUDE_PROJECTS / server.re.sub(r"[^A-Za-z0-9]", "-", str(server.FRONT_DESK.resolve()))
        folder.mkdir(parents=True)
        (folder / "desk.jsonl").write_text("")
        server.os.utime(folder / "desk.jsonl", (1, 1))
        (folder / "chat.jsonl").write_text("")
        server.MIA_CHAT.folder.mkdir()
        mia_chat.write_json(server.MIA_CHAT.state_path, {"sessionId": "chat"})
        self.assertEqual(server.mia_session().stem, "desk")


class AskTests(Chat):
    def test_her_reply_streams_and_is_kept(self):
        process = self.running()
        self.chat.ask("Who needs me?")
        self.assertEqual(process.sent(), [{"type": "user", "message": {"role": "user", "content": "Who needs me?"}}])
        self.assertTrue(self.chat.view()["isAnswering"])
        for event in (start_message("m1"), delta("Zoe "), delta("needs a yes.")):
            self.chat.follow(event)
        writing = self.chat.view()["messages"][-1]
        self.assertEqual((writing["role"], writing["text"], writing["isWriting"]), ("mia", "Zoe needs a yes.", True))
        self.chat.follow({"type": "result", "result": "Zoe needs a yes."})
        view = self.chat.view()
        self.assertFalse(view["isAnswering"])
        self.assertEqual([(one["role"], one["text"]) for one in view["messages"]], [("person", "Who needs me?"), ("mia", "Zoe needs a yes.")])
        self.assertEqual(len(self.chat.history()), 2)

    def test_text_on_both_sides_of_a_tool_call_is_one_reply(self):
        self.running()
        self.chat.ask("How's it going?")
        self.chat.follow(start_message("m1"))
        self.chat.follow(delta("Checking."))
        self.chat.follow({"type": "stream_event", "event": {"type": "content_block_start", "content_block": {"type": "tool_use"}}})
        self.assertEqual(self.chat.view()["messages"][-1]["step"], "Looking at the office")
        self.chat.follow(start_message("m2"))
        self.chat.follow(delta("All quiet."))
        self.chat.follow({"type": "result"})
        self.assertEqual(self.chat.history()[-1]["text"], "Checking.\n\nAll quiet.")

    def test_she_can_only_be_asked_while_running(self):
        with self.assertRaises(RuntimeError):
            self.chat.ask("Hello")
        self.assertEqual(self.chat.history(), [])

    def test_empty_and_overlong_messages_are_refused(self):
        self.running()
        for text in ("", "   ", "x" * (mia_chat.MAX_ASK + 1)):
            with self.subTest(len(text)), self.assertRaises(ValueError):
                self.chat.ask(text)

    def test_only_recent_history_is_kept(self):
        for index in range(mia_chat.KEPT + 5):
            self.chat.add("person", str(index))
        self.assertEqual(len(self.chat.history()), mia_chat.KEPT)
        self.assertEqual(self.chat.history()[-1]["text"], str(mia_chat.KEPT + 4))

    def test_a_reply_cut_off_by_her_stopping_says_so(self):
        process = self.running(FakeProcess([start_message("m1"), delta("Half")]))
        self.chat.ask("Hello")
        process.exit = 1
        self.chat.read(process)
        self.assertEqual(self.chat.history()[-1]["text"], "Half")
        self.assertFalse(self.chat.view()["isAnswering"])


class NoteTests(Chat):
    def draft(self, lead=LEAD, status="draft"):
        note_id = str(mia_chat.uuid.uuid4())
        mia_chat.write_json(self.chat.notes / f"{note_id}.json", {"id": note_id, "leadId": lead, "leadName": "Zoe", "text": "Hi", "status": status, "at": 1})
        return note_id

    def note(self, note_id):
        return mia_chat.read_json(self.chat.notes / f"{note_id}.json", None)

    def test_the_persons_tap_approves_it_for_the_leads_session(self):
        note_id = self.draft()
        self.chat.decide(note_id, True, lambda lead: "engine-zoe" if lead == LEAD else None)
        self.assertEqual((self.note(note_id)["status"], self.note(note_id)["toSession"]), ("approved", "engine-zoe"))
        self.assertEqual(self.chat.view()["notes"][0]["status"], "approved")

    def test_cancel_never_sends(self):
        note_id = self.draft()
        self.chat.decide(note_id, False, lambda lead: "engine-zoe")
        self.assertEqual(self.note(note_id)["status"], "cancelled")
        self.assertNotIn("toSession", self.note(note_id))

    def test_a_lead_who_left_fails_rather_than_going_elsewhere(self):
        note_id = self.draft()
        self.chat.decide(note_id, True, lambda lead: None)
        self.assertEqual(self.note(note_id)["status"], "failed")

    def test_a_note_is_decided_once(self):
        for status in ("approved", "sending", "sent", "cancelled"):
            with self.subTest(status), self.assertRaises(LookupError):
                self.chat.decide(self.draft(status=status), True, lambda lead: "engine-zoe")

    def test_odd_note_ids_are_refused(self):
        for note_id in ("../state", "", "x" * 36, None):
            with self.subTest(note_id), self.assertRaises(ValueError):
                self.chat.decide(note_id, True, lambda lead: "engine-zoe")

    def test_only_leads_in_the_office_get_a_session(self):
        people = [{"id": LEAD, "teamLeadId": LEAD}, {"id": "local_x", "teamLeadId": LEAD}]
        with mock.patch.object(server.OFFICE, "snapshot", {"people": people}), mock.patch.object(server.TRANSCRIPTS, "path_for", return_value=WORK / "engine-zoe.jsonl"):
            self.assertEqual(server.lead_session(LEAD), "engine-zoe")
            self.assertIsNone(server.lead_session("local_x"))
            self.assertIsNone(server.lead_session("local_nobody"))


class KeepRunningTests(Chat):
    def setUp(self):
        super().setUp()
        self.started = []
        patcher = mock.patch.object(mia_chat.subprocess, "Popen", side_effect=self.popen)
        patcher.start()
        self.addCleanup(patcher.stop)

    def popen(self, command, **options):
        self.assertTrue(options["start_new_session"])
        self.started.append(command)
        return FakeProcess()

    def test_she_starts_when_wanted_and_stops_when_not(self):
        self.chat.check()
        self.assertEqual(len(self.started), 1)
        self.assertTrue(self.chat.is_running())
        self.chat.check()
        self.assertEqual(len(self.started), 1)
        self.wanted = False
        with mock.patch.object(mia_chat, "signal_copy") as signalled:
            self.chat.check()
        self.assertFalse(self.chat.is_running())
        signalled.assert_called()

    def test_a_copy_left_by_an_earlier_server_is_stopped_first(self):
        self.copies = [4321]
        with mock.patch.object(mia_chat, "signal_copy", side_effect=lambda pid, number: self.copies.clear()) as signalled:
            self.chat.check()
        signalled.assert_called_with(4321, mia_chat.signal.SIGTERM)
        self.assertEqual(len(self.started), 1)

    def test_she_comes_back_after_stopping_and_waits_longer_each_quick_stop(self):
        self.chat.check()
        first = self.chat.session_id()
        self.chat.process.exit = 1
        self.chat.check()
        self.assertEqual(len(self.started), 1)
        self.assertGreater(self.chat.next_start, time.time())
        self.chat.next_start = 0
        self.chat.check()
        self.assertEqual(len(self.started), 2)
        self.chat.command.assert_called_with(first, False)

    def test_a_conversation_that_keeps_failing_is_left_for_a_fresh_one(self):
        self.chat.check()
        first = self.chat.session_id()
        for _ in range(mia_chat.FRESH_AFTER):
            self.chat.process.exit = 1
            self.chat.check()
            self.chat.next_start = 0
            self.chat.check()
        self.assertNotEqual(self.chat.session_id(), first)
        self.assertTrue(self.chat.command.call_args.args[1])


class RouteTests(Case):
    def setUp(self):
        super().setUp()
        self.process = FakeProcess()
        patcher = mock.patch.object(server.MIA_CHAT, "process", self.process)
        patcher.start()
        self.addCleanup(patcher.stop)
        server.MIA_CHAT.folder.mkdir(exist_ok=True)

    def test_a_signed_in_device_can_chat(self):
        cookie = self.signed_in()
        token = self.page_token(cookie)
        status, body, _ = self.request("POST", "/api/mia/ask", cookie=cookie, token=token, origin=f"https://{self.host()}", body={"text": "Hi"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["messages"][0]["text"], "Hi")
        status, body, _ = self.request("GET", "/api/mia", cookie=cookie, token=token)
        self.assertEqual((status, json.loads(body)["isOn"]), (200, True))

    def test_without_sign_in_nothing_reaches_her(self):
        cookie = self.signed_in()
        for headers in ({}, {"cookie": cookie}, {"token": server.TOKEN}, {"cookie": cookie, "token": server.TOKEN}):
            with self.subTest(sorted(headers)):
                self.assertEqual(self.request("POST", "/api/mia/ask", body={"text": "Hi"}, **headers)[0], 403)
                self.assertEqual(self.request("POST", "/api/mia/note", body={"id": "x", "send": True}, **headers)[0], 403)
                self.assertEqual(self.request("GET", "/api/mia", **headers)[0], 403)
        self.assertEqual(self.process.sent(), [])

    def test_the_macs_own_port_needs_its_own_token(self):
        local = {"port": self.local.server_address[1], "host": f"127.0.0.1:{server.PORT}"}
        self.assertEqual(self.request("POST", "/api/mia/ask", body={"text": "Hi"}, **local)[0], 403)
        self.assertEqual(self.request("POST", "/api/mia/ask", body={"text": "Hi"}, token=self.page_token(self.signed_in()), **local)[0], 403)
        self.assertEqual(self.process.sent(), [])

    def test_she_says_when_she_isnt_running(self):
        self.process.exit = 0
        cookie = self.signed_in()
        status, body, _ = self.request("POST", "/api/mia/ask", cookie=cookie, token=self.page_token(cookie), body={"text": "Hi"})
        self.assertEqual(status, 503)
        self.assertIn("isn't here", json.loads(body)["error"])

    def host(self):
        return server.REMOTE.host()


if __name__ == "__main__":
    unittest.main()
