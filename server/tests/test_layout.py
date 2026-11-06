import json
from unittest import mock

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


PEOPLE = [{"id": "leo", "teamId": "project:Clancy"}, {"id": "priya", "teamId": "project:Clancy"}, {"id": "kofi", "teamId": "solo:kofi"}]


class ClosedRoomTests(Case):
    """A room the person closes is hidden on every device, and nothing happens to its sessions."""

    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(server.OFFICE, "snapshot", {"people": PEOPLE})
        patcher.start()
        self.addCleanup(patcher.stop)

    def mac(self, path, body=None):
        local = {"port": self.local.server_address[1], "host": f"127.0.0.1:{server.PORT}", "token": server.TOKEN, "origin": f"http://127.0.0.1:{server.PORT}"}
        status, answer, _ = self.request("POST" if body is not None else "GET", path, body=body, **local)
        return status, json.loads(answer)

    def closed(self):
        return self.mac("/api/sessions")[1]["closedRooms"]

    def test_closing_a_room_is_shared_and_reopening_brings_it_back(self):
        with mock.patch.object(server.subprocess, "run") as run, mock.patch.object(server.subprocess, "Popen") as popen:
            status, answer = self.mac("/api/room/close", {"teamId": "project:Clancy"})
            self.assertEqual(status, 200)
            self.assertEqual(list(answer["closedRooms"]), ["project:Clancy"])
            run.assert_not_called()
            popen.assert_not_called()
        self.assertEqual(list(self.closed()), ["project:Clancy"])
        cookie = self.signed_in()
        _, seen, _ = self.request("GET", "/api/sessions", cookie=cookie, token=self.page_token(cookie))
        self.assertEqual(list(json.loads(seen)["closedRooms"]), ["project:Clancy"])
        self.assertEqual(self.mac("/api/room/reopen", {"teamId": "project:Clancy"}), (200, {"closedRooms": {}}))
        self.assertEqual(self.closed(), {})

    def test_saving_the_layout_keeps_closed_rooms_and_closing_keeps_the_layout(self):
        self.mac("/api/room/close", {"teamId": "project:Clancy"})
        self.assertEqual(self.mac("/api/layout", {"layout": MAC_LAYOUT, "seed": True})[1], {"layout": MAC_LAYOUT})
        self.assertEqual(list(self.closed()), ["project:Clancy"])
        self.mac("/api/room/reopen", {"teamId": "project:Clancy"})
        self.assertEqual(self.mac("/api/sessions")[1]["layout"], MAC_LAYOUT)

    def test_only_a_team_in_the_office_can_be_closed(self):
        for team_id in ("solo:kofi", "project:Nowhere", "", "../people.json"):
            with self.subTest(team_id=team_id):
                self.assertEqual(self.mac("/api/room/close", {"teamId": team_id})[0], 400)
        self.assertEqual(self.closed(), {})

    def test_teams_that_have_left_the_office_leave_the_list(self):
        server.write_json(server.LAYOUT, {"closed": {"project:Archived": "2026-11-01T00:00:00Z"}})
        self.assertEqual(list(self.mac("/api/room/close", {"teamId": "project:Clancy"})[1]["closedRooms"]), ["project:Clancy"])
