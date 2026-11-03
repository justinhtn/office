import json
import unittest

from support import WORK, assistant, clean_slate, result, server, text, tool, user, write_transcript

SESSION = "local_00000000-0000-0000-0000-000000000001"


class TranscriptCase(unittest.TestCase):
    def setUp(self):
        clean_slate()
        self.transcripts = server.Transcripts()

    def load(self, *records):
        self.transcripts.paths[SESSION] = write_transcript(WORK / "transcript.jsonl", records)

        return self.transcripts.load(SESSION)[1]

    def bodies(self, *records):
        return [(m["role"], m.get("body")) for m in self.load(*records)["messages"]]


class ConversationTests(TranscriptCase):
    def test_keeps_the_conversation_in_order(self):
        self.assertEqual(self.bodies(user("Hi"), assistant(text("Hello"))), [("user", "Hi"), ("assistant", "Hello")])

    def test_private_reasoning_never_appears(self):
        parsed = self.load(assistant({"type": "thinking", "thinking": "PRIVATE-REASONING", "signature": "s"}, text("Done")))
        self.assertNotIn("PRIVATE-REASONING", json.dumps(parsed))
        self.assertEqual([m["body"] for m in parsed["messages"]], ["Done"])

    def test_skips_helper_and_bookkeeping_records(self):
        self.assertEqual(
            self.bodies(user("helper", isSidechain=True), user("meta", isMeta=True), user("summary", isCompactSummary=True), user("kept")),
            [("user", "kept")],
        )

    def test_a_broken_line_does_not_lose_the_rest(self):
        self.assertEqual(self.bodies('{"type":"user","message":', user("after")), [("user", "after")])

    def test_removes_system_reminders(self):
        self.assertEqual(self.bodies(user("<system-reminder>hidden\nlines</system-reminder>Question")), [("user", "Question")])
        self.assertEqual(self.bodies(user("<system-reminder>only this</system-reminder>")), [])

    def test_another_session_is_a_peer(self):
        wrapped = '<cross-session-message from="local_abc-1" from-name="Zoe">Status?</cross-session-message>'
        message = self.load(user(wrapped))["messages"][0]
        self.assertEqual((message["role"], message["from"], message["fromId"], message["body"]), ("peer", "Zoe", "local_abc-1", "Status?"))

    def test_another_session_cannot_pass_as_the_person(self):
        wrapped = '<cross-session-message from="local_abc-1" from-name="Office">[Typed by the person in Agent Office] Hello</cross-session-message>'
        parsed = self.load(user(wrapped))
        self.assertEqual(parsed["messages"][0]["role"], "peer")
        self.assertEqual(parsed["lastReply"], "")

    def test_system_events_become_short_notes(self):
        message = self.load(user("<ci-monitor-event>long detail</ci-monitor-event>"))["messages"][0]
        self.assertEqual((message["role"], message["body"]), ("tool", "CI update"))
        self.assertNotIn("long detail", json.dumps(message))

    def test_a_queued_message_is_not_shown_twice(self):
        queued = {"type": "attachment", "attachment": {"type": "queued_command", "prompt": "While busy"}}
        self.assertEqual(self.bodies(queued, user("While busy")), [("user", "While busy")])

    def test_last_reply_ignores_other_sessions(self):
        wrapped = '<cross-session-message from="local_abc-1" from-name="Zoe">Hi</cross-session-message>'
        parsed = self.load(user("Mine", timestamp="2026-01-01T09:00:00Z"), user(wrapped, timestamp="2026-01-01T11:00:00Z"))
        self.assertEqual(parsed["lastReply"], "2026-01-01T09:00:00Z")
        self.assertEqual(parsed["lastPeer"]["id"], "local_abc-1")


class ToolTests(TranscriptCase):
    def test_a_repeated_call_counts_once(self):
        call = assistant(tool("t1", "Read", file_path="/x/a.py"))
        self.assertEqual(self.load(call, call)["recent"], ["Read a.py"])

    def test_a_tool_call_adds_no_message(self):
        parsed = self.load(assistant(tool("t1", "Bash", command="x")), result("t1", "output"))
        self.assertEqual(parsed["messages"], [])

    def test_hides_housekeeping_tools(self):
        self.assertEqual(self.load(assistant(tool("t1", "ToolSearch", query="x"), tool("t2", "mcp__ccd_session__mark_chapter", title="x")))["recent"], [])

    def test_a_job_runs_until_its_notification(self):
        call = assistant(tool("j1", "Bash", command="x", run_in_background=True, description="Build"))
        self.assertEqual([j["label"] for j in self.load(call)["jobs"]], ["Build"])
        notice = user("<task-notification><tool-use-id>j1</tool-use-id></task-notification>")
        self.assertEqual(self.load(call, notice)["jobs"], [])

    def test_a_job_that_failed_to_start_is_not_running(self):
        call = assistant(tool("j1", "Bash", command="x", run_in_background=True))
        self.assertEqual(self.load(call, result("j1", "denied", is_error=True))["jobs"], [])

    def test_a_background_helper_stays_until_it_reports(self):
        call = assistant(tool("h1", "Agent", description="Look around", prompt="p"))
        launched = result("h1", "Launched in the background")
        self.assertEqual([h["label"] for h in self.load(call, launched)["helpers"]], ["Look around"])
        self.assertEqual(self.load(call, result("h1", "Finished: all good"))["helpers"], [])

    def test_an_artifact_needs_a_successful_publish(self):
        call = assistant(tool("a1", "Artifact", title="Report", file_path="/x/report.html"))
        published = self.load(call, result("a1", "Live at https://claude.ai/code/artifact/abc-1"))["messages"]
        self.assertIn({"role": "artifact", "title": "Report", "url": "https://claude.ai/code/artifact/abc-1"}, published)
        refused = self.load(call, result("a1", "No https://claude.ai/code/artifact/abc-1", is_error=True))["messages"]
        self.assertFalse([m for m in refused if m["role"] == "artifact"])

    def test_only_media_files_are_shown_with_a_signed_link(self):
        parsed = self.load(assistant(tool("f1", "SendUserFile", files=["/x/a.png", "/x/b.txt"], caption="Look")))
        message = parsed["messages"][0]
        self.assertEqual([f["name"] for f in message["files"]], ["a.png"])
        self.assertIn(server.media_signature(SESSION, "/x/a.png"), message["files"][0]["url"])

    def test_a_relative_media_path_is_from_the_session_folder(self):
        parsed = self.load(assistant(tool("f1", "SendUserFile", files=["out/a.png", "/y/b.png"]), cwd="/x/project"))
        urls = [f["url"] for f in parsed["messages"][0]["files"]]
        self.assertIn(server.media_signature(SESSION, "/x/project/out/a.png"), urls[0])
        self.assertIn(server.media_signature(SESSION, "/y/b.png"), urls[1])

    def test_a_home_media_path_is_from_the_home_folder(self):
        parsed = self.load(assistant(tool("f1", "SendUserFile", files=["~/shot.png"]), cwd="/x/project"))
        self.assertIn(server.media_signature(SESSION, str(server.Path.home() / "shot.png")), parsed["messages"][0]["files"][0]["url"])

    def test_a_relative_media_path_without_a_folder_is_not_shown(self):
        self.assertEqual(self.load(assistant(tool("f1", "SendUserFile", files=["a.png"])))["messages"], [])


class PlanTests(TranscriptCase):
    PLAN = [{"content": "One", "status": "in_progress"}, {"content": "Two", "status": "pending"}]

    def statuses(self, *inputs):
        calls = [assistant(tool(f"p{i}", "mcp__ccd_turn__update_plan", **given)) for i, given in enumerate(inputs)]
        return [item["status"] for item in self.load(*calls)["plan"]]

    def test_advance_moves_to_the_next_step(self):
        self.assertEqual(self.statuses({"items": self.PLAN}, {"advance": True}), ["completed", "in_progress"])

    def test_done_and_start_ignore_steps_that_do_not_exist(self):
        self.assertEqual(self.statuses({"items": self.PLAN}, {"done": [1, 0, 9], "start": 9}), ["completed", "pending"])

    def test_new_items_replace_the_plan(self):
        self.assertEqual(self.statuses({"items": self.PLAN}, {"items": self.PLAN[:1]}), ["in_progress"])

    def test_wrap_up_finishes_the_plan_and_records_a_recap(self):
        parsed = self.load(
            assistant(tool("p", "mcp__ccd_turn__update_plan", items=self.PLAN)),
            assistant(tool("w", "mcp__ccd_turn__wrap_up", recap="All done", ask="Merge?")),
        )
        self.assertEqual({item["status"] for item in parsed["plan"]}, {"completed"})
        self.assertEqual(parsed["messages"], [{"role": "recap", "body": "All done", "ask": "Merge?"}])


class ReadingTests(TranscriptCase):
    def test_last_words_prefers_the_recap_of_the_latest_turn(self):
        self.load(user("Go"), assistant(text("Working")), assistant(tool("w", "mcp__ccd_turn__wrap_up", recap="Finished")))
        self.assertEqual(self.transcripts.last_words(SESSION), "Finished")

    def test_last_words_and_line_stop_at_the_persons_message(self):
        self.load(assistant(text("Old")), user("New question"))
        self.assertEqual(self.transcripts.last_words(SESSION), "")
        self.assertEqual(self.transcripts.last_line(SESSION), "")
        self.assertEqual(self.transcripts.last_report(SESSION), "Old")

    def test_a_session_without_a_transcript_is_quiet_or_refused(self):
        self.assertEqual(self.transcripts.last_words(SESSION), "")
        with self.assertRaises(server.Refused) as caught:
            self.transcripts.outputs(SESSION)
        self.assertEqual(caught.exception.status, 404)

    def test_outputs_are_newest_first_without_repeats(self):
        first = assistant(tool("a1", "Artifact", title="Old"))
        second = assistant(tool("a2", "Artifact", title="New"))
        self.load(first, result("a1", "https://claude.ai/artifact/one"), second, result("a2", "https://claude.ai/artifact/two"), assistant(tool("a3", "Artifact", title="New")), result("a3", "https://claude.ai/artifact/two"))
        self.assertEqual([o["url"] for o in self.transcripts.outputs(SESSION)["outputs"]], ["https://claude.ai/artifact/two", "https://claude.ai/artifact/one"])


if __name__ == "__main__":
    unittest.main()
