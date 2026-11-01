import json
import threading
import unittest
from datetime import datetime
from pathlib import Path
from subprocess import TimeoutExpired
from unittest import mock

import support
from support import server

NOW = datetime.fromisoformat("2026-11-01 12:30:00-08:00").timestamp()
APPS = [
    {"app_id": "ap-secretone", "description": "suit", "state": "stopped", "tasks": "0", "created_at": "2026-11-01 12:04:22-08:00", "stopped_at": "2026-11-01 12:24:10-08:00"},
    {"app_id": "ap-secrettwo", "description": "old", "state": "stopped", "tasks": "0", "created_at": "2026-10-01 12:04:22-08:00", "stopped_at": "2026-10-01 12:24:10-08:00"},
    {"app_id": "ap-secretthree", "description": "edit", "state": "deployed", "tasks": "0", "created_at": "2026-10-29 09:27:08-08:00", "stopped_at": None},
    {"app_id": "ap-secretfour", "description": "train", "state": "deployed", "tasks": "2", "created_at": "2026-11-01 12:00:00-08:00", "stopped_at": None},
    {"app_id": "ap-secretfive", "description": "run", "state": "ephemeral", "tasks": "1", "created_at": "2026-11-01 12:10:00-08:00", "stopped_at": None},
]

# Modal 1.3 used the table's headings, with the same values.
HEADINGS = [
    {"App ID": app["app_id"], "Description": app["description"], "State": app["state"], "Tasks": app["tasks"], "Created at": app["created_at"], "Stopped at": app["stopped_at"]}
    for app in APPS
]


def finished(stdout="[]", returncode=0):
    return mock.Mock(stdout=stdout, returncode=returncode)


class ModalSummaryTest(unittest.TestCase):
    def test_sorts_apps_into_running_stopped_and_idle(self):
        summary = server.modal_summary(APPS, NOW)
        self.assertEqual([(app["name"], app["tasks"]) for app in summary["apps"]], [("run", 1), ("train", 2)])
        self.assertEqual(summary["count"], 2)
        self.assertEqual(summary["running"], ["run", "train"])
        self.assertEqual([app["name"] for app in summary["stopped"]], ["suit"])
        self.assertEqual(summary["idle"], 1)

    def test_never_includes_app_ids(self):
        self.assertNotIn("ap-secret", json.dumps(server.modal_summary(APPS, NOW)))
        self.assertNotIn("ap-secret", json.dumps(server.modal_summary(HEADINGS, NOW)))

    def test_reads_both_formats_the_same(self):
        self.assertEqual(server.modal_summary(HEADINGS, NOW), server.modal_summary(APPS, NOW))

    def test_an_unrecognized_format_is_flagged_without_listing_apps(self):
        for apps in ([{"id": "ap-secret", "status": "running"}], ["nope"], [{"app_id": "ap-secret", "state": "ephemeral", "tasks": "1"}]):
            summary = server.modal_summary(apps, NOW)
            self.assertTrue(summary["isUnknownFormat"], apps)
            self.assertEqual((summary["apps"], summary["count"]), ([], 0))
            self.assertNotIn("ap-secret", json.dumps(summary))
        self.assertNotIn("isUnknownFormat", server.modal_summary([], NOW))

    def test_a_blank_name_stays_listed(self):
        for blank in ("", None):
            summary = server.modal_summary([{"description": blank, "state": "ephemeral", "tasks": "1", "app_id": "ap-secret"}], NOW)
            self.assertEqual(summary["apps"][0]["name"], "Unnamed app")
            self.assertNotIn("ap-secret", json.dumps(summary))

    def test_anything_with_tasks_is_running_whatever_its_state(self):
        apps = [{"description": name, "state": state, "tasks": "2", "stopped_at": None} for name, state in (("a", "stopping"), ("b", "stopped"), ("c", "deployed"), ("d", ""))]
        summary = server.modal_summary(apps, NOW)
        self.assertEqual(sorted(app["name"] for app in summary["apps"]), ["a", "b", "c", "d"])
        self.assertEqual((summary["stopped"], summary["idle"]), ([], 0))

    def test_stopping_with_no_tasks_isnt_running(self):
        summary = server.modal_summary([{"description": "a", "state": "stopping", "tasks": "0", "stopped_at": "2026-11-01 12:29:00-08:00"}], NOW)
        self.assertEqual(summary["apps"], [])
        self.assertEqual(summary["stoppedCount"], 1)

    def test_odd_values_dont_break_it(self):
        summary = server.modal_summary(["nope", {"description": "a", "state": "ephemeral", "tasks": "many", "created_at": "soon"}, {"description": "b", "state": "stopped", "stopped_at": None}], NOW)
        self.assertEqual(summary["apps"], [{"name": "a", "tasks": 0, "startedAt": None}])
        self.assertEqual(summary["stopped"], [])

    def test_absurd_timestamps_dont_break_it(self):
        summary = server.modal_summary([{"description": "a", "state": "ephemeral", "tasks": "1", "created_at": "0001-01-01 00:00:00+14:00"}, {"description": "b", "state": "stopped", "stopped_at": "9999-12-31 23:59:59-14:00"}], NOW)
        self.assertEqual(summary["apps"][0]["name"], "a")


class ModalCheckTest(unittest.TestCase):
    def setUp(self):
        self.addCleanup(server.modal_state.update, dict(server.modal_state))
        server.modal_state.update(at=0, value={"count": 9}, isChecked=False, isChecking=True)
        patcher = mock.patch.object(server.shutil, "which", return_value="/fake/modal")
        patcher.start()
        self.addCleanup(patcher.stop)

    def check(self, **behaviour):
        with mock.patch.object(server.subprocess, "run", **behaviour) as run:
            server.check_modal()

        return run

    def test_good_answer_is_summarized_and_time_limited(self):
        run = self.check(return_value=finished(json.dumps(APPS)))
        self.assertEqual(server.modal_state["value"]["idle"], 1)
        self.assertTrue(server.modal_state["isChecked"])
        self.assertFalse(server.modal_state["isChecking"])
        self.assertEqual(run.call_args.args[0], ["/fake/modal", "app", "list", "--json"])
        self.assertEqual(run.call_args.kwargs["timeout"], 20)

    def test_an_unexpected_answer_is_flagged(self):
        for stdout in ("not json", "{}"):
            self.check(return_value=finished(stdout))
            self.assertTrue(server.modal_state["value"]["isUnknownFormat"], stdout)

    def test_an_unexpected_error_cant_leave_the_check_stuck(self):
        server.modal_state.update(value={"count": 9}, isChecking=True)
        with mock.patch.object(server, "read_modal", side_effect=OverflowError), self.assertRaises(OverflowError):
            server.check_modal()
        self.assertIsNone(server.modal_state["value"])
        self.assertFalse(server.modal_state["isChecking"])

    def test_failures_read_as_not_connected(self):
        for behaviour in ({"side_effect": TimeoutExpired("modal", 20)}, {"side_effect": OSError()}, {"return_value": finished("", 1)}):
            server.modal_state.update(value={"count": 9}, isChecking=True)
            self.check(**behaviour)
            self.assertIsNone(server.modal_state["value"], behaviour)
            self.assertFalse(server.modal_state["isChecking"])

    def test_missing_command_reads_as_not_connected(self):
        with mock.patch.object(server.shutil, "which", return_value=None), mock.patch.object(Path, "exists", return_value=False):
            server.check_modal()
        self.assertIsNone(server.modal_state["value"])
        self.assertTrue(server.modal_state["isChecked"])

    def test_a_slow_command_doesnt_hold_up_requests(self):
        release, started = threading.Event(), threading.Event()

        def slow(*_, **__):
            started.set()
            release.wait(5)
            return finished("[]")

        server.modal_state.update(at=0, value=None, isChecking=False)
        with mock.patch.object(server.subprocess, "run", side_effect=slow) as run:
            self.assertIsNone(server.modal_apps())
            self.assertTrue(started.wait(5))
            self.assertIsNone(server.modal_apps())
            self.assertEqual(run.call_count, 1)
            release.set()
            for thread in threading.enumerate():
                if thread is not threading.current_thread() and thread.daemon:
                    thread.join(1)


if __name__ == "__main__":
    unittest.main()
