import shutil
import subprocess
import sys
import unittest
from unittest import mock

from support import WORK, clean_slate, server


class CommandTests(unittest.TestCase):
    def test_the_shell_runs_the_list_without_parsing_it(self):
        with mock.patch.dict(server.os.environ, {"SHELL": "/bin/sh"}):
            command = server.telegram_command("a b'; touch /tmp/no")
        self.assertEqual(command[:4], ["/bin/sh", "-lic", 'exec "$@"', "telegram-mia"])
        self.assertIn("a b'; touch /tmp/no", command)
        self.assertEqual(command[command.index("--resume") + 1], "a b'; touch /tmp/no")

    def test_a_shell_without_sh_syntax_gets_zsh(self):
        with mock.patch.dict(server.os.environ, {"SHELL": "/opt/homebrew/bin/fish"}):
            self.assertEqual(server.telegram_command("x")[0], "/bin/zsh")

    def test_a_shell_passes_arguments_through_unchanged(self):
        printer = [sys.executable, "-c", "import sys; print(sys.argv[1])", "a b'; $(x)"]
        output = subprocess.run(["/bin/sh", "-c", 'exec "$@"', "telegram-mia", *printer], capture_output=True, text=True, check=True).stdout
        self.assertEqual(output.strip(), "a b'; $(x)")


class FakeProcess:
    def __init__(self, write_fails=False):
        self.stdin = mock.Mock()
        if write_fails:
            self.stdin.write.side_effect = BrokenPipeError()
        self.wait = mock.Mock()
        self.poll = mock.Mock(return_value=None)
        self.pid = 1


class SyncTests(unittest.TestCase):
    def setUp(self):
        clean_slate()
        server.FRONT_DESK.mkdir(parents=True)
        self.addCleanup(server.telegram_mia.update, {"process": None})
        server.telegram_mia["process"] = None
        self.state = WORK / "telegram"
        self.state.mkdir()
        (self.state / "access.json").write_text("{}")
        (self.state / "bot.pid").write_text("1")
        self.transcript = WORK / "mia.jsonl"
        self.transcript.write_text("")
        server.os.utime(self.transcript, (1, 1))
        for name, value in (("TELEGRAM_STATE", self.state), ("TELEGRAM_CONNECT_S", 0), ("TELEGRAM_QUIET_S", 0)):
            patcher = mock.patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for name, value in (("mia_session", mock.Mock(return_value=self.transcript)), ("signal_copy", mock.Mock())):
            patcher = mock.patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def away(self, is_on):
        server.write_json(server.AWAY_MODE, {"isOn": is_on})

    def test_back_stops_the_copy_it_holds_even_when_it_cant_look_for_others(self):
        self.away(False)
        held = FakeProcess()
        server.telegram_mia["process"] = held
        with mock.patch.object(server, "mia_copies", side_effect=subprocess.TimeoutExpired("ps", 5)):
            server.sync_telegram_mia()
        server.signal_copy.assert_any_call(1, server.signal.SIGTERM)
        self.assertIsNone(server.telegram_mia["process"])

    def test_back_stops_a_copy_this_server_never_started(self):
        self.away(False)
        with mock.patch.object(server, "stop_mia_copies") as stop:
            server.sync_telegram_mia()
        stop.assert_called()

    def test_back_stops_copies_even_with_no_transcript(self):
        self.away(False)
        server.mia_session.return_value = None
        with mock.patch.object(server, "stop_mia_copies") as stop:
            server.sync_telegram_mia()
        stop.assert_called()

    def test_going_away_replaces_any_old_copy_first(self):
        self.away(True)
        calls = mock.Mock()
        with mock.patch.object(server, "stop_mia_copies", calls.stop), mock.patch.object(server.subprocess, "Popen", calls.popen):
            calls.popen.return_value = FakeProcess()
            server.sync_telegram_mia()
        self.assertEqual([call[0] for call in calls.mock_calls[:2]], ["stop", "popen"])

    def test_a_failed_write_stops_her_and_is_survived(self):
        self.away(True)
        with mock.patch.object(server, "stop_mia_copies") as stop, mock.patch.object(server.subprocess, "Popen", return_value=FakeProcess(write_fails=True)):
            server.sync_telegram_mia()
        self.assertIsNone(server.telegram_mia["process"])
        self.assertEqual(stop.call_count, 2)

    def test_a_shell_that_wont_start_is_survived(self):
        self.away(True)
        with mock.patch.object(server, "stop_mia_copies"), mock.patch.object(server.subprocess, "Popen", side_effect=FileNotFoundError()), mock.patch.object(server.traceback, "print_exc") as report:
            server.sync_telegram_mia()
        report.assert_called()
        self.assertIsNone(server.telegram_mia["process"])

    def test_turning_back_during_startup_stops_her(self):
        self.away(True)
        (self.state / "bot.pid").unlink()

        def come_back(*_args, **_kwargs):
            self.away(False)

            return FakeProcess()

        with mock.patch.object(server, "stop_mia_copies") as stop, mock.patch.object(server.subprocess, "Popen", side_effect=come_back):
            server.sync_telegram_mia()
        self.assertIsNone(server.telegram_mia["process"])
        self.assertEqual(stop.call_count, 2)


@unittest.skipUnless(shutil.which("lsof"), "Needs lsof")
class RealProcessTests(unittest.TestCase):
    """Real processes that only look like Mia, in the test's throwaway folders."""

    def setUp(self):
        clean_slate()
        server.FRONT_DESK.mkdir(parents=True)
        self.other = WORK / "elsewhere"
        self.other.mkdir()

    def lookalike(self, folder, *extra):
        process = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(60)", "--resume", "some-old-session", "--channels", server.TELEGRAM_CHANNEL, *extra],
            cwd=folder.resolve(), start_new_session=True,
        )
        self.addCleanup(process.wait)
        self.addCleanup(process.kill)

        return process

    def test_stops_every_copy_in_her_folder_and_nothing_else(self):
        old, older = self.lookalike(server.FRONT_DESK), self.lookalike(server.FRONT_DESK, "other")
        elsewhere = self.lookalike(self.other)
        self.assertEqual(sorted(server.mia_copies()), sorted([old.pid, older.pid]))
        server.stop_mia_copies()
        self.assertEqual(server.mia_copies(), [])
        self.assertIsNotNone(old.wait(timeout=5))
        self.assertIsNotNone(older.wait(timeout=5))
        self.assertIsNone(elsewhere.poll())

    def test_a_failed_folder_lookup_leaves_the_rest_to_be_found(self):
        wanted = self.lookalike(server.FRONT_DESK)
        other = self.lookalike(server.FRONT_DESK, "other")
        real_run = subprocess.run

        def flaky(command, **kwargs):
            if command[0] == "lsof" and command[3] == str(wanted.pid):
                raise subprocess.TimeoutExpired("lsof", 5)

            return real_run(command, **kwargs)

        with mock.patch.object(server.subprocess, "run", flaky):
            self.assertEqual(server.mia_copies(), [other.pid])

    def test_a_copy_that_ignores_the_request_is_killed(self):
        code = "import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('up', flush=True); time.sleep(60)"
        process = subprocess.Popen([sys.executable, "-c", code, "--resume", "x", "--channels", server.TELEGRAM_CHANNEL], cwd=server.FRONT_DESK.resolve(), stdout=subprocess.PIPE, start_new_session=True)
        self.addCleanup(process.stdout.close)
        self.addCleanup(process.wait)
        self.addCleanup(process.kill)
        process.stdout.readline()
        with mock.patch.object(server, "TELEGRAM_STOP_S", 1):
            server.stop_mia_copies()
        self.assertEqual(process.wait(timeout=5), -9)


if __name__ == "__main__":
    unittest.main()
