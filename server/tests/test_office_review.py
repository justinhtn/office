import importlib.machinery
import importlib.util
import json
import unittest
from pathlib import Path

from support import HOME, WORK, clean_slate

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "office-review"
loader = importlib.machinery.SourceFileLoader("office_review", str(SCRIPT))
spec = importlib.util.spec_from_loader("office_review", loader)
office_review = importlib.util.module_from_spec(spec)
loader.exec_module(office_review)

HEAD = "a" * 40
OLD = "b" * 40


class FakeGitHub:
    """Stands in for quinn-gh: answers reads from a table and records each post."""

    def __init__(self):
        self.posts = []
        self.reads = {
            "repos/justinhtn/office/pulls/50": {"title": "Delete guard", "state": "open", "merged": False, "mergeable": True, "mergeable_state": "clean", "head": {"sha": HEAD}},
            f"repos/justinhtn/office/commits/{HEAD}/check-runs?per_page=100": {"check_runs": [{"name": "lint", "status": "completed", "conclusion": "failure"}, {"name": "check", "status": "completed", "conclusion": "success"}]},
            "repos/justinhtn/office/pulls/50/reviews?per_page=100": [{"id": 7, "user": {"login": "asha-review[bot]"}, "state": "COMMENTED", "commit_id": OLD, "body": "Round 1\nmore"}],
            "repos/justinhtn/office/pulls/50/comments?per_page=100": [{"id": 11, "user": {"login": "asha-review[bot]"}, "path": "a.ts", "line": 3, "body": "Blocking: x"}, {"id": 12, "user": {"login": "justinhtn"}, "path": "a.ts", "line": None, "original_line": 3, "in_reply_to_id": 11, "body": "Fixed"}],
            "repos/justinhtn/office/issues/50/comments?per_page=100": [{"id": 21, "user": {"login": "justinhtn"}, "body": "Ready again"}],
        }

    def __call__(self, command, payload=None):
        if command[:3] == ["api", "-X", "POST"]:
            self.posts.append((command[3], json.loads(payload)))
            return json.dumps({"html_url": "https://github.com/justinhtn/office/pull/50#posted"})

        return json.dumps(self.reads[command[1]])


class OfficeReviewTests(unittest.TestCase):
    def setUp(self):
        clean_slate()
        self.worktree = WORK / "reviewer"
        self.worktree.mkdir()
        (HOME / ".agent-office").mkdir()
        (HOME / ".agent-office" / "reviewers.json").write_text(json.dumps({"worktrees": [str(self.worktree)]}))
        self.github = FakeGitHub()

    def run_review(self, *argv, cwd=None):
        return office_review.main(list(argv), cwd or self.worktree, HOME, self.github)

    def body(self, text, name="body.md"):
        path = self.worktree / name
        path.write_text(text)

        return str(path)

    def test_status_shows_the_head_check_and_what_has_been_said(self):
        text = self.run_review("status", "50")
        self.assertIn(f"head {HEAD}", text)
        self.assertIn("check: success", text)
        self.assertIn("mergeable: True (clean)", text)
        self.assertIn("7 asha-review[bot] COMMENTED at bbbbbbb: Round 1", text)
        self.assertIn("12 justinhtn a.ts:3 reply to 11: Fixed", text)
        self.assertIn("21 justinhtn: Ready again", text)
        self.assertEqual(self.github.posts, [])

    def test_reply_posts_the_file_in_its_thread(self):
        self.run_review("reply", "50", "11", "--file", self.body("Confirmed fixed. Grace"))
        self.assertEqual(self.github.posts, [("repos/justinhtn/office/pulls/50/comments/11/replies", {"body": "Confirmed fixed. Grace"})])

    def test_comment_posts_the_file_on_the_pr(self):
        self.run_review("comment", "50", "--file", self.body("It still runs rm -rf \"$D\"; delete by literal path. Asha"))
        self.assertEqual(self.github.posts, [("repos/justinhtn/office/issues/50/comments", {"body": "It still runs rm -rf \"$D\"; delete by literal path. Asha"})])

    def test_a_review_is_always_a_comment_on_the_current_head(self):
        review = {"body": "Round 2", "comments": [{"path": "a.ts", "line": 3, "side": "RIGHT", "body": "Blocking: y"}]}
        self.run_review("review", "50", "--file", self.body(json.dumps(review), "review.json"))
        self.assertEqual(self.github.posts, [("repos/justinhtn/office/pulls/50/reviews", {"commit_id": HEAD, "event": "COMMENT", **review})])

    def test_a_review_never_approves_or_requests_changes(self):
        for event in ("APPROVE", "REQUEST_CHANGES"):
            with self.subTest(event), self.assertRaisesRegex(office_review.Refused, "never approve"):
                self.run_review("review", "50", "--file", self.body(json.dumps({"body": "x", "event": event}), "review.json"))
        self.assertEqual(self.github.posts, [])

    def test_a_review_of_an_old_commit_is_refused(self):
        with self.assertRaisesRegex(office_review.Refused, "head is now"):
            self.run_review("review", "50", "--file", self.body(json.dumps({"body": "x", "commit_id": OLD}), "review.json"))

    def test_a_review_with_unknown_fields_is_refused(self):
        for review in ({"body": "x", "extra": 1}, {"body": "x", "comments": [{"path": "a.ts", "line": 3}]}, {"body": "x", "comments": [{"path": "a.ts", "line": "3", "body": "y"}]}, ["x"]):
            with self.subTest(review), self.assertRaises(office_review.Refused):
                self.run_review("review", "50", "--file", self.body(json.dumps(review), "review.json"))

    def test_a_verdict_names_the_head_it_covers(self):
        self.run_review("verdict", "50", "--ready", "--sha", HEAD, "--file", self.body("All findings fixed. Grace\n"))
        self.run_review("verdict", "50", "--not-ready", "--sha", HEAD, "--file", self.body("One blocking finding. Grace"))
        bodies = [fields["body"] for _, fields in self.github.posts]
        self.assertEqual(bodies, [f"All findings fixed. Grace\n\nVerdict: ready for {HEAD}", f"One blocking finding. Grace\n\nVerdict: not ready at {HEAD}"])

    def test_a_verdict_for_any_commit_but_the_head_is_refused(self):
        for sha in (OLD, HEAD[:7]):
            with self.subTest(sha), self.assertRaises(office_review.Refused):
                self.run_review("verdict", "50", "--ready", "--sha", sha, "--file", self.body("Ready. Grace"))
        self.assertEqual(self.github.posts, [])

    def test_a_verdict_body_with_its_own_verdict_line_is_refused(self):
        with self.assertRaisesRegex(office_review.Refused, "already has a Verdict"):
            self.run_review("verdict", "50", "--ready", "--sha", HEAD, "--file", self.body(f"Done.\nVerdict: ready for {OLD}"))

    def test_a_verdict_needs_ready_or_not_ready(self):
        with self.assertRaises(SystemExit):
            self.run_review("verdict", "50", "--sha", HEAD, "--file", self.body("x"))

    def test_runs_only_from_a_listed_worktree(self):
        elsewhere = WORK / "elsewhere"
        elsewhere.mkdir()
        with self.assertRaisesRegex(office_review.Refused, "isn't a reviewer's worktree"):
            self.run_review("status", "50", cwd=elsewhere)
        inside = self.worktree / "plugin" / "hooks"
        inside.mkdir(parents=True)
        self.assertIn("head", self.run_review("status", "50", cwd=inside))

    def test_a_worktree_named_like_a_listed_one_is_refused(self):
        lookalike = WORK / "reviewer-other"
        lookalike.mkdir()
        with self.assertRaises(office_review.Refused):
            self.run_review("status", "50", cwd=lookalike)

    def test_without_a_reviewers_file_nothing_runs(self):
        (HOME / ".agent-office" / "reviewers.json").unlink()
        with self.assertRaisesRegex(office_review.Refused, "doesn't list any reviewer worktrees"):
            self.run_review("status", "50")
        (HOME / ".agent-office" / "reviewers.json").write_text(json.dumps({"worktrees": ["relative/path"]}))
        with self.assertRaisesRegex(office_review.Refused, "full paths"):
            self.run_review("status", "50")

    def test_bodies_that_look_like_secrets_are_refused(self):
        secrets = [
            "-----BEGIN OPENSSH PRIVATE KEY-----\nabc",
            "The token is ghp_" + "x" * 36,
            "github_pat_" + "a1" * 20,
            "sk-ant-api03-" + "z" * 30,
            "AKIA" + "ABCDEFGHIJKLMNOP",
            "API_KEY=" + "q" * 24,
            'client_secret: "' + "w" * 20 + '"',
            "Authorization: Bearer " + "t" * 30,
            "https://user:hunter22@example.com/x",
        ]
        for text in secrets:
            with self.subTest(text[:20]), self.assertRaisesRegex(office_review.Refused, "secret"):
                self.run_review("comment", "50", "--file", self.body(text))
        self.assertEqual(self.github.posts, [])

    def test_review_text_about_secrets_is_allowed(self):
        text = "Non-blocking: the token = headers.get(name) line never checks the password field, and secret files stay hidden. Grace"
        self.run_review("comment", "50", "--file", self.body(text))
        self.assertEqual(len(self.github.posts), 1)

    def test_a_secret_in_an_inline_comment_is_refused(self):
        review = {"body": "Round 1", "comments": [{"path": "a.ts", "line": 3, "body": "ghp_" + "x" * 36}]}
        with self.assertRaisesRegex(office_review.Refused, "looks like it holds a secret"):
            self.run_review("review", "50", "--file", self.body(json.dumps(review), "review.json"))
        self.assertEqual(self.github.posts, [])

    def test_bodies_that_are_too_large_empty_or_missing_are_refused(self):
        cases = [(self.body("x" * (office_review.MAX_FILE + 1), "large.md"), "larger than"), (self.body("  \n", "empty.md"), "empty"), (str(self.worktree / "missing.md"), "isn't a file")]
        for path, reason in cases:
            with self.subTest(reason), self.assertRaisesRegex(office_review.Refused, reason):
                self.run_review("comment", "50", "--file", path)
        self.assertEqual(self.github.posts, [])

    def test_numbers_must_be_plain(self):
        for argv in (["status", "50;rm"], ["status", "-1"], ["reply", "50", "11x", "--file", "f"], ["status", "0x32"]):
            with self.subTest(argv), self.assertRaises(SystemExit):
                self.run_review(*argv)

    def test_there_is_no_way_to_give_a_body_on_the_command_line(self):
        for argv in (["comment", "50", "--body", "x"], ["comment", "50", "-b", "x"], ["comment", "50"]):
            with self.subTest(argv), self.assertRaises(SystemExit):
                self.run_review(*argv)

    def test_github_refusing_a_post_is_reported(self):
        def failing(command, payload=None):
            raise office_review.Refused("GitHub refused it: 422")
        with self.assertRaisesRegex(office_review.Refused, "422"):
            office_review.main(["comment", "50", "--file", self.body("x")], self.worktree, HOME, failing)

    def test_quinn_gh_must_exist(self):
        with self.assertRaisesRegex(office_review.Refused, "quinn-gh is missing"):
            office_review.run_quinn_gh(HOME, ["api", "repos/justinhtn/office/pulls/50"])


if __name__ == "__main__":
    unittest.main()
