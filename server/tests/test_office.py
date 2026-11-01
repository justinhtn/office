import datetime
import unittest
from unittest import mock

from support import WORK, assistant, clean_slate, server, tool, user, write_transcript


def row(session_id, **extra):
    return {"id": session_id, "title": f"Title {session_id}", "project": "", **extra}


def ago(seconds):
    moment = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=seconds)

    return moment.isoformat().replace("+00:00", "Z")


class TeamTests(unittest.TestCase):
    def setUp(self):
        clean_slate()

    def place(self, *rows, names=None):
        return server.organize_teams(list(rows), names or {})

    def test_a_project_is_a_team_however_its_members_started(self):
        placed = self.place(row("a", project="Alpha"), row("b", project="Alpha"), row("c", project="Beta"))
        self.assertEqual(placed["a"]["teamId"], "project:Alpha")
        self.assertEqual(placed["b"]["teamId"], "project:Alpha")
        self.assertEqual(placed["c"]["teamId"], "project:Beta")
        self.assertEqual(placed["a"]["teamName"], "Alpha")
        self.assertFalse(placed["a"]["isIndependent"])

    def test_who_started_whom_decides_the_lead(self):
        placed = self.place(
            row("kid", project="Alpha", startedBy="top", lastActivityAt="2026-02-01"),
            row("top", project="Alpha", lastActivityAt="2026-01-01"),
        )
        self.assertEqual({p["teamLeadId"] for p in placed.values()}, {"top"})

    def test_failing_that_the_most_recently_active_leads(self):
        placed = self.place(row("old", project="Alpha", lastActivityAt="2026-01-01"), row("new", project="Alpha", lastActivityAt="2026-02-01"))
        self.assertEqual(placed["old"]["teamLeadId"], "new")

    def test_sessions_without_a_project_stay_with_whoever_started_them(self):
        placed = self.place(row("top", project="No folder"), row("mid", startedBy="top"), row("leaf", startedBy="mid"))
        self.assertEqual({p["teamId"] for p in placed.values()}, {"tree:top"})
        self.assertEqual(placed["leaf"]["teamName"], "Title top")

    def test_anyone_else_is_independent(self):
        placed = self.place(row("a", project="Other"), row("b", startedBy="gone"), names={"a": "Ana"})
        self.assertEqual((placed["a"]["teamId"], placed["a"]["teamName"], placed["a"]["isIndependent"]), ("solo:a", "Ana", True))
        self.assertEqual(placed["b"]["teamId"], "solo:b")

    def test_a_loop_of_starters_does_not_hang(self):
        placed = self.place(row("a", startedBy="b"), row("b", startedBy="a"))
        self.assertEqual(set(placed), {"a", "b"})

    def test_the_front_desk_is_on_no_team(self):
        self.assertEqual(self.place(row("mia", cwd=str(server.FRONT_DESK)), row("a")).keys(), {"a"})

    def test_newsroom_runs_form_their_own_team(self):
        placed = self.place(row("n", title="Nell · Newsroom morning", project="Alpha"))
        self.assertEqual(placed["n"]["teamId"], "project:Newsroom")

    def test_the_persons_choices_win(self):
        server.write_json(server.TEAMS, {"moved": {"a": "independent", "b": "Beta", "top": "Gamma"}, "names": {"project:Beta": "Renamed"}})
        placed = self.place(row("a", project="Alpha"), row("b", project="Alpha"), row("top"), row("kid", startedBy="top"))
        self.assertEqual(placed["a"]["teamId"], "solo:a")
        self.assertEqual((placed["b"]["teamId"], placed["b"]["teamName"]), ("project:Beta", "Renamed"))
        self.assertEqual(placed["kid"]["teamId"], "project:Gamma")


class StatusTests(unittest.TestCase):
    def setUp(self):
        clean_slate()
        self.office = server.Office()
        patcher = mock.patch.multiple(server.TRANSCRIPTS, paths={}, parsed={})
        patcher.start()
        self.addCleanup(patcher.stop)

    def ingest(self, *rows):
        server.write_json(server.RAW_SESSIONS, {"people": list(rows), "updatedAt": "now"})
        self.office.ingest()

        return {person["id"]: person for person in self.office.snapshot["people"]}

    def with_transcript(self, session_id, *records):
        server.TRANSCRIPTS.paths[session_id] = write_transcript(WORK / f"{session_id}.jsonl", records)

    def job(self, age):
        return assistant(tool("j1", "Bash", command="x", run_in_background=True, description="Train"), timestamp=ago(age))

    def test_a_running_session_is_acting(self):
        person = self.ingest(row("a", isRunning=True))["a"]
        self.assertTrue(person["isRunning"] and person["isActing"])
        self.assertFalse(person["isWaiting"])

    def test_an_idle_session_with_a_job_is_waiting_not_idle(self):
        self.with_transcript("a", self.job(10))
        person = self.ingest(row("a", isRunning=False))["a"]
        self.assertEqual(person["jobs"], ["Train"])
        self.assertTrue(person["isRunning"] and person["isWaiting"])
        self.assertFalse(person["isActing"] or person["isOnBreak"])

    def test_a_long_job_means_a_coffee_break(self):
        self.with_transcript("a", self.job(server.COFFEE_BREAK_S + 60))
        self.assertTrue(self.ingest(row("a", isRunning=False))["a"]["isOnBreak"])

    def test_a_job_too_old_to_be_real_is_forgotten(self):
        self.with_transcript("a", self.job(server.JOB_MAX_AGE_S + 60))
        person = self.ingest(row("a", isRunning=False))["a"]
        self.assertEqual(person["jobs"], [])
        self.assertFalse(person["isRunning"])

    def test_a_recent_peer_message_means_a_call_for_both(self):
        wrapped = '<cross-session-message from="local_b" from-name="B">Hi</cross-session-message>'
        self.with_transcript("a", user(wrapped, timestamp=ago(5)))
        people = self.ingest(row("a"), row("local_b"))
        self.assertEqual((people["a"]["talkingTo"], people["local_b"]["talkingTo"]), ("local_b", "a"))

    def test_finishing_marks_the_session_and_starts_a_meeting_with_its_starter(self):
        self.ingest(row("boss"), row("a", isRunning=True, startedBy="boss"))
        people = self.ingest(row("boss"), row("a", isRunning=False, startedBy="boss"))
        self.assertTrue(people["a"]["isFinished"])
        self.assertEqual((people["a"]["meetingWith"], people["boss"]["meetingWith"]), (["boss"], ["a"]))
        self.assertFalse(self.ingest(row("boss"), row("a", isRunning=True, startedBy="boss"))["a"]["isFinished"])

    def test_plan_progress_reaches_the_snapshot(self):
        plan = [{"content": "One", "status": "completed"}, {"content": "Two", "status": "in_progress"}]
        self.with_transcript("a", assistant(tool("p", "mcp__ccd_turn__update_plan", items=plan)))
        person = self.ingest(row("a"))["a"]
        self.assertEqual((person["step"], person["progress"]), ("Two", [1, 2]))

    def test_everyone_gets_a_different_name_that_lasts(self):
        people = self.ingest(row("a"), row("b"), row("c"))
        self.assertEqual(len({p["name"] for p in people.values()}), 3)
        self.assertEqual(server.Office().names, {key: p["name"] for key, p in people.items()})

    def test_the_name_prefix_comes_off_the_title(self):
        self.office.names["a"] = "Elsa"
        self.assertEqual(self.ingest(row("a", title="Elsa · Fix the tests"))["a"]["title"], "Fix the tests")

    def test_only_the_latest_newsroom_run_is_in_the_office(self):
        people = self.ingest(row("old", title="Newsroom morning", lastActivityAt="2026-01-01"), row("new", title="Newsroom morning", lastActivityAt="2026-01-02"))
        self.assertEqual(set(people), {"new"})
        self.assertEqual(people["new"]["name"], server.NEWSROOM_NAME)

    def test_a_name_can_only_be_taken_once(self):
        people = self.ingest(row("a"), row("b"))
        with self.assertRaises(server.Refused) as caught:
            self.office.rename("a", people["b"]["name"].upper())
        self.assertEqual(caught.exception.status, 409)

    def test_a_reply_clears_the_request_it_answers(self):
        server.REQUESTS.mkdir()
        server.write_json(server.REQUESTS / "r1.json", {"session": "a", "message": "Look", "at": "2026-01-01T10:00:00Z"})
        self.assertEqual(self.ingest(row("a"))["a"]["request"]["message"], "Look")
        self.with_transcript("a", user("Seen", timestamp="2026-01-01T11:00:00Z"))
        self.assertIsNone(self.ingest(row("a"))["a"]["request"])
        self.assertEqual(list(server.REQUESTS.glob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
