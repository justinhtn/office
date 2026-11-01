import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("AGENT_OFFICE_HOME", tempfile.mkdtemp())
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
arguments, sys.argv = sys.argv, sys.argv[:1]  # The server reads its port from here on import.
import server  # noqa: E402
sys.argv = arguments


def row(session, project, started_by=None):
    return {"id": session, "project": project, "startedBy": started_by, "title": f"{session} work", "lastActivityAt": ""}


class TeamRenameTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        original = server.TEAMS
        self.addCleanup(setattr, server, "TEAMS", original)
        server.TEAMS = Path(folder.name) / "teams.json"

    def choose(self, **choices):
        server.TEAMS.write_text(json.dumps(choices))

    def organize(self, rows):
        return server.organize_teams(rows, {one["id"]: one["id"] for one in rows})

    def test_renaming_a_project_keeps_its_id_and_sidebar_group(self):
        self.choose(names={"project:SuperPup": "Kennel"})
        placed = self.organize([row("a", "SuperPup"), row("b", "SuperPup")])
        for person in placed.values():
            self.assertEqual(person["teamName"], "Kennel")
            self.assertEqual(person["teamId"], "project:SuperPup")
            self.assertEqual(person["teamGroup"], "SuperPup")

    def test_a_team_with_no_project_gets_no_sidebar_group(self):
        self.choose(names={"tree:a": "Kennel"})
        placed = self.organize([row("a", "No folder"), row("b", "No folder", "a")])
        self.assertEqual(placed["b"]["teamId"], "tree:a")
        self.assertEqual(placed["b"]["teamName"], "Kennel")
        self.assertEqual(placed["b"]["teamGroup"], "")

    def test_moving_someone_to_a_new_name_joins_that_team(self):
        self.choose(names={"project:SuperPup": "Kennel"}, moved={"c": "Kennel"})
        placed = self.organize([row("a", "SuperPup"), row("c", "Clancy")])
        self.assertEqual(placed["c"]["teamId"], "project:SuperPup")
        self.assertEqual(placed["c"]["teamGroup"], "SuperPup")

    def test_someone_moved_to_a_team_stays_through_another_rename(self):
        rows = [row("a", "SuperPup"), row("c", "Clancy")]
        self.choose(names={"project:SuperPup": "Kennel"}, moved={"c": "Kennel"})
        people = list(self.organize(rows).values())
        choices = server.with_team_name(server.read_json(server.TEAMS, {}), people, "project:SuperPup", "Den")
        self.choose(**choices)
        placed = self.organize(rows)
        self.assertEqual(placed["c"]["teamId"], "project:SuperPup")
        self.assertEqual(placed["c"]["teamName"], "Den")

    def test_names_must_be_valid_unused_and_for_a_team_in_the_office(self):
        people = [
            {"teamId": "project:A", "teamName": "A"},
            {"teamId": "project:B", "teamName": "B"},
            {"teamId": "solo:c", "teamName": "Cleo", "isIndependent": True},
        ]
        self.assertEqual(server.team_name_problem(people, "project:A", "Cleo"), "")
        self.assertEqual(server.team_name_problem(people, "project:A", "a"), "")
        self.assertIn("already", server.team_name_problem(people, "project:A", "b"))
        self.assertIn("isn't", server.team_name_problem(people, "solo:c", "Cleo2"))
        self.assertIn("isn't", server.team_name_problem(people, "project:Z", "Z"))
        self.assertIn("reserved", server.team_name_problem(people, "project:A", "Independent"))
        self.assertIn("letters", server.team_name_problem(people, "project:A", "<b>"))


if __name__ == "__main__":
    unittest.main()
