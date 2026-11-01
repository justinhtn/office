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
        nameless = server.modal_summary([{"app_id": "ap-secret", "state": "ephemeral", "tasks": "1"}], NOW)
        self.assertEqual(nameless["apps"][0]["name"], "Modal app")
        self.assertNotIn("ap-secret", json.dumps(nameless))

    def test_reads_the_older_headings_too(self):
        summary = server.modal_summary([{"App ID": "ap-x", "Description": "train", "State": "ephemeral", "Tasks": 3, "Created at": "2026-11-01 12:00:00-08:00", "Stopped at": None}], NOW)
        self.assertEqual(summary["apps"][0]["name"], "train")
        self.assertEqual(summary["apps"][0]["tasks"], 3)

    def test_odd_values_dont_break_it(self):
        summary = server.modal_summary(["nope", {"description": "a", "state": "ephemeral", "tasks": "many", "created_at": "soon"}, {"state": "stopped", "stopped_at": None}], NOW)
        self.assertEqual(summary["apps"], [{"name": "a", "tasks": 0, "startedAt": None}])
        self.assertEqual(summary["stopped"], [])


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

    def test_failures_read_as_not_connected(self):
        for behaviour in ({"side_effect": TimeoutExpired("modal", 20)}, {"side_effect": OSError()}, {"return_value": finished("", 1)}, {"return_value": finished("not json")}, {"return_value": finished("{}")}):
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
