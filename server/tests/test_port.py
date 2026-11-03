import re
import unittest

from support import SERVER_PATH, server

ROOT = SERVER_PATH.parent.parent


class PortTests(unittest.TestCase):
    def test_every_copy_of_the_default_port_is_the_same(self):
        script = re.search(r"AGENT_OFFICE_PORT:-(\d+)", (ROOT / "scripts" / "port.sh").read_text()).group(1)
        plugin = re.search(r"const DEFAULT_PORT = '(\d+)'", (ROOT / "plugin" / "hooks" / "register.ts").read_text()).group(1)
        self.assertEqual({int(script), int(plugin)}, {server.DEFAULT_PORT})

    def test_nothing_else_hard_codes_it(self):
        for path in [ROOT / "scripts" / "install.sh", ROOT / "scripts" / "make-app.sh", ROOT / "plugin" / "hooks" / "register.ts"]:
            with self.subTest(path.name):
                self.assertNotIn(f":{server.DEFAULT_PORT}", path.read_text())
