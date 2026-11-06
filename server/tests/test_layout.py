import json

from support import server
from test_remote_access import ORIGIN, Case

MAC_LAYOUT = {"slots": ["project:SuperPup", "meeting", "project:Clancy", "project:agent-office", "lounge", "office"], "seats": {"project:Clancy": ["a", "b"]}}
PHONE_LAYOUT = {"slots": ["project:agent-office", "meeting", "lounge", "office"], "seats": {}}


class LayoutTests(Case):
    """Every device shares one room order, kept by the server."""

    def mac(self, method, path, body=None):
        status, answer, _ = self.request(method, path, port=self.local.server_address[1], host=f"127.0.0.1:{server.PORT}", token=server.TOKEN, origin=f"http://127.0.0.1:{server.PORT}", body=body)
        return status, json.loads(answer)

    def device(self, method, path, body=None):
        cookie = self.signed_in()
        status, answer, _ = self.request(method, path, cookie=cookie, token=self.page_token(cookie), origin=ORIGIN, body=body)
        return status, json.loads(answer)

    def shared(self):
        return self.mac("GET", "/api/sessions")[1]["layout"]

    def test_there_is_no_layout_until_a_device_saves_one(self):
        self.assertIsNone(self.shared())

    def test_a_layout_saved_on_the_mac_is_what_a_device_sees(self):
        self.assertEqual(self.mac("POST", "/api/layout", {"layout": MAC_LAYOUT, "seed": True}), (200, {"layout": MAC_LAYOUT}))
        self.assertEqual(self.device("GET", "/api/sessions")[1]["layout"], MAC_LAYOUT)

    def test_only_the_first_seed_is_kept(self):
        self.mac("POST", "/api/layout", {"layout": MAC_LAYOUT, "seed": True})
        self.assertEqual(self.mac("POST", "/api/layout", {"layout": PHONE_LAYOUT, "seed": True}), (200, {"layout": MAC_LAYOUT}))
        self.assertEqual(self.device("POST", "/api/layout", {"layout": PHONE_LAYOUT, "seed": True}), (200, {"layout": MAC_LAYOUT}))

    def test_the_macs_seed_replaces_one_a_phone_made_first(self):
        self.device("POST", "/api/layout", {"layout": PHONE_LAYOUT, "seed": True})
        self.assertEqual(self.shared(), PHONE_LAYOUT)
        self.assertEqual(self.mac("POST", "/api/layout", {"layout": MAC_LAYOUT, "seed": True})[1], {"layout": MAC_LAYOUT})
        # Once the Mac's is in, a phone can't seed over it.
        self.device("POST", "/api/layout", {"layout": PHONE_LAYOUT, "seed": True})
        self.assertEqual(self.shared(), MAC_LAYOUT)

    def test_a_change_from_any_device_replaces_the_layout(self):
        self.mac("POST", "/api/layout", {"layout": MAC_LAYOUT, "seed": True})
        self.assertEqual(self.device("POST", "/api/layout", {"layout": PHONE_LAYOUT}), (200, {"layout": PHONE_LAYOUT}))
        self.assertEqual(self.shared(), PHONE_LAYOUT)

    def test_odd_layouts_are_refused_and_change_nothing(self):
        self.mac("POST", "/api/layout", {"layout": MAC_LAYOUT})
        for layout in (None, [], {"slots": "meeting"}, {"slots": [""]}, {"slots": [7]}, {"slots": ["x" * 201]}, {"slots": [], "seats": {"a": "b"}}, {"slots": ["a"] * 301}):
            with self.subTest(layout=str(layout)[:40]):
                self.assertEqual(self.mac("POST", "/api/layout", {"layout": layout})[0], 400)
        self.assertEqual(self.shared(), MAC_LAYOUT)

    def test_saving_needs_the_token(self):
        status, _, _ = self.request("POST", "/api/layout", port=self.local.server_address[1], host=f"127.0.0.1:{server.PORT}", origin=f"http://127.0.0.1:{server.PORT}", body={"layout": MAC_LAYOUT})
        self.assertEqual(status, 403)
        self.assertIsNone(self.shared())
