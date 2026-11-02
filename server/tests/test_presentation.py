import json
import unittest

from support import server

ROWS = [
    {"tool": "A", "visualLevel": "1", "form": "Sidebar"},
    {"tool": "B", "visualLevel": "1–2", "form": "Panes"},
    {"tool": "C", "visualLevel": "1?", "form": "Layout not confirmed", "stars": "2.0k"},
    {"tool": "D", "visualLevel": "3", "form": "Board"},
]


def document(*claims):
    return {"id": "x", "title": "t", "origin": "o", "sourceName": "the table", "source": ROWS, "paragraphs": [],
            "claims": [{"id": str(i), "text": "t", "line": "Plain line.", "check": check} for i, check in enumerate(claims)]}


def marks(*claims):
    return [claim["mark"] for claim in server.presentation(document(*claims))["claims"]]


class CheckClaimTest(unittest.TestCase):
    def test_a_share_of_the_table(self):
        self.assertEqual(marks({"type": "most_at_most", "level": 2}, {"type": "most_at_most", "level": 0}), ["checked", "flagged"])

    def test_rarer_than_lists(self):
        self.assertEqual(marks({"type": "rarer_than_lists", "level": 3}, {"type": "rarer_than_lists", "level": 5}), ["checked", "flagged"])

    def test_a_row_can_pass_fail_or_be_missing(self):
        self.assertEqual(marks({"type": "row_level", "tools": ["D"], "level": 3}, {"type": "row_level", "tools": ["D"], "level": 4}, {"type": "row_level", "tools": ["Z"], "level": 3}), ["checked", "flagged", "unconfirmed"])

    def test_rows_must_support_the_claim_and_not_doubt_themselves(self):
        check = {"type": "rows_confirmed", "phrase": "not confirmed", "terms": ["sidebar", "panes"]}
        self.assertEqual(marks({**check, "tools": ["A", "C"]}, {**check, "tools": ["A", "B"]}, {**check, "tools": ["A", "D"]}), ["flagged", "checked", "flagged"])

    def test_an_uncertain_level_isnt_checked(self):
        self.assertEqual(marks({"type": "row_level", "tools": ["C"], "level": 1}), ["unconfirmed"])
        self.assertIn("1 of them uncertain", server.presentation(document({"type": "most_at_most", "level": 2}))["claims"][0]["checked"])

    def test_stars_match_differ_or_are_missing(self):
        self.assertEqual(marks({"type": "row_stars", "tool": "C", "stars": "2.0k"}, {"type": "row_stars", "tool": "C", "stars": "9k"}, {"type": "row_stars", "tool": "A", "stars": "1k"}), ["checked", "flagged", "unconfirmed"])

    def test_anything_without_a_working_check_is_unconfirmed(self):
        self.assertEqual(marks({"type": "none", "why": "no source"}, {"type": "new"}, {}, {"type": "row_level"}, {"type": "row_level", "tools": [], "level": 1}, {"type": "rows_confirmed", "tools": [], "phrase": "x", "terms": ["y"]}, {"type": "rows_confirmed", "tools": ["A"], "phrase": "x", "terms": []}, "broken"), ["unconfirmed"] * 8)

    def test_a_broken_source_row_cant_pass(self):
        broken = document({"type": "most_at_most", "level": 2})
        broken["source"] = [{"tool": "A", "visualLevel": "none"}]
        self.assertEqual(server.presentation(broken)["claims"][0]["mark"], "unconfirmed")


class PresentationTest(unittest.TestCase):
    def test_only_a_checked_claim_keeps_its_plain_line(self):
        claims = server.presentation(document({"type": "row_level", "tools": ["D"], "level": 3}, {"type": "row_level", "tools": ["D"], "level": 4}, {"type": "none", "why": "no source"}))["claims"]
        self.assertEqual(claims[0]["line"], "Plain line.")
        self.assertIn("needs a look", claims[1]["line"])
        self.assertIn("couldn't confirm", claims[2]["line"])
        self.assertTrue(all(claim["checked"] for claim in claims))

    def test_the_demo_fixture(self):
        claims = server.presentation(json.loads(server.PRESENTATION_DEMO.read_text()))["claims"]
        self.assertEqual({claim["id"]: claim["mark"] for claim in claims}, {
            "list": "checked", "vendors": "flagged", "boards": "checked", "canvas": "checked", "characters": "checked", "emdash": "unconfirmed", "unknown": "unconfirmed",
        })


if __name__ == "__main__":
    unittest.main()
