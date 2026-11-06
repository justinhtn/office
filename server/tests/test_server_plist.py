import plistlib
import subprocess
import sys
import unittest

from support import SANDBOX, clean_slate, server

SCRIPT = server.ROOT / "scripts" / "server-plist.py"
SERVER = "/Users/me/office/server/server.py"
VENV = "/Users/me/.agent-office/python/bin/python3"
OLD = "/usr/bin/python3"


class ServerPlistTests(unittest.TestCase):
    def setUp(self):
        clean_slate()
        self.plist = SANDBOX / "work" / "com.agentoffice.server.plist"

    def write(self, arguments):
        with open(self.plist, "wb") as handle:
            plistlib.dump({"Label": "com.agentoffice.server", "ProgramArguments": arguments, "KeepAlive": True}, handle)

    def read(self):
        with open(self.plist, "rb") as handle:
            return plistlib.load(handle)

    def run_script(self, *arguments):
        return subprocess.run([sys.executable, str(SCRIPT), *arguments], capture_output=True, text=True)

    def test_the_python_is_swapped_and_the_rest_kept(self):
        self.write([OLD, SERVER, "8794"])
        result = self.run_script("use-python", str(self.plist), VENV, SERVER)
        self.assertEqual((result.returncode, result.stdout.strip()), (0, "changed"))
        job = self.read()
        self.assertEqual(job["ProgramArguments"], [VENV, SERVER, "8794"])
        self.assertEqual((job["Label"], job["KeepAlive"]), ("com.agentoffice.server", True))

    def test_a_stray_item_before_the_server_is_dropped(self):
        # What an earlier update.sh left: plutil inserted the new Python instead of replacing the old one.
        self.write([VENV, OLD, SERVER, "8794"])
        self.assertEqual(self.run_script("runs-from", str(self.plist), SERVER).returncode, 0)
        result = self.run_script("use-python", str(self.plist), VENV, SERVER)
        self.assertEqual(result.stdout.strip(), "changed")
        self.assertEqual(self.read()["ProgramArguments"], [VENV, SERVER, "8794"])

    def test_nothing_is_written_when_it_already_matches(self):
        self.write([VENV, SERVER, "8794"])
        before = self.plist.stat().st_mtime_ns
        result = self.run_script("use-python", str(self.plist), VENV, SERVER)
        self.assertEqual((result.returncode, result.stdout), (0, ""))
        self.assertEqual(self.plist.stat().st_mtime_ns, before)

    def test_a_job_for_another_checkout_is_left_alone(self):
        self.write([OLD, "/elsewhere/server/server.py", "8794"])
        self.assertEqual(self.run_script("runs-from", str(self.plist), SERVER).returncode, 1)
        self.assertEqual(self.run_script("use-python", str(self.plist), VENV, SERVER).returncode, 1)
        self.assertEqual(self.read()["ProgramArguments"], [OLD, "/elsewhere/server/server.py", "8794"])

    def test_a_missing_or_broken_plist_fails_cleanly(self):
        self.assertEqual(self.run_script("runs-from", str(self.plist), SERVER).returncode, 1)
        self.plist.write_text("not a plist")
        self.assertEqual(self.run_script("use-python", str(self.plist), VENV, SERVER).returncode, 1)
        self.assertEqual(self.run_script("nonsense").returncode, 2)


if __name__ == "__main__":
    unittest.main()
