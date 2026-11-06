import json
import threading
import time
import unittest
from unittest import mock

from support import DATA, clean_slate, server
from test_remote_access import HOST, ORIGIN, Case
from test_passkeys import Authenticator, ec
import approvals  # noqa: E402, after support, which puts the server's folder on the path

LEAD = "local_00000000-0000-0000-0000-00000000000a"
SHA = "a" * 40
NEW_SHA = "b" * 40
# Some tests run merges straight away by patching threading.Thread, which is shared, so this keeps the real one.
REAL_THREAD = threading.Thread


def verdict(body, login="asha-review[bot]", kind="Bot", app="asha-review", at="2026-11-06T10:00:00Z", **changes):
    """A post as the REST API describes it, through GitHub.POST: who really posted it, and whether it was edited."""
    return {"login": login, "type": kind, "app": app, "body": body, "url": "https://github.com/x", "at": at, "isEdited": False, **changes}


def pull(**changes):
    return {
        "number": 39, "title": "Approval cards", "url": "https://github.com/justinhtn/office/pull/39", "state": "OPEN", "isDraft": False,
        "baseRefName": "main", "headRefOid": SHA, "statusCheckRollup": [{"name": "check", "status": "COMPLETED", "conclusion": "SUCCESS"}],
        "posts": [verdict(f"**Verdict at aaaaaaa: ready.**\n\nVerdict: ready for {SHA[:7]}")], "files": ["server/approvals.py"], **changes,
    }


class FakeGitHub:
    def __init__(self):
        self.pulls = {39: pull()}
        self.merged = []

    def pull(self, number):
        return self.pulls.get(number)

    def merge(self, number, sha):
        self.merged.append((number, sha))
        return True, f"Merged pull request {number}."


class VerdictTests(unittest.TestCase):
    def test_the_reviewers_latest_verdict_must_name_the_commit(self):
        self.assertTrue(approvals.ready_verdict([verdict(f"Verdict: ready for {SHA[:7]}")], SHA))
        self.assertTrue(approvals.ready_verdict([verdict(f"Verdict: ready for `{SHA}`")], SHA))
        self.assertFalse(approvals.ready_verdict([verdict(f"Verdict: ready for {NEW_SHA[:7]}")], SHA))
        self.assertFalse(approvals.ready_verdict([verdict("Looks good, ready.")], SHA))

    def test_a_later_not_ready_verdict_wins(self):
        comments = [verdict(f"Verdict: ready for {SHA[:7]}"), verdict(f"Verdict: not ready at {SHA[:7]}", at="2026-11-06T11:00:00Z")]
        self.assertFalse(approvals.ready_verdict(comments, SHA))

    def test_a_not_ready_review_after_a_ready_comment_wins(self):
        # Reviews have no app slug, only the bot account.
        posts = [verdict(f"Verdict: not ready at {SHA[:7]}", app=None, at="2026-11-06T11:00:00Z"), verdict(f"Verdict: ready for {SHA[:7]}")]
        self.assertFalse(approvals.ready_verdict(posts, SHA))

    def test_only_the_reviewers_app_counts(self):
        line = f"Verdict: ready for {SHA[:7]}"
        cases = {
            # The bare name is free to register, and gh pr view would show such a comment as "asha-review" too.
            "someone who registered asha-review": verdict(line, login="asha-review", kind="User", app=None),
            "a user claiming the bot's name": verdict(line, kind="User"),
            "another app": verdict(line, login="other[bot]", app="other"),
            "the person": verdict(line, login="justinhtn", kind="User", app=None),
            "an edited comment": verdict(line, isEdited=True),
        }
        for why, post in cases.items():
            with self.subTest(why):
                self.assertFalse(approvals.ready_verdict([post], SHA))
        self.assertTrue(approvals.ready_verdict([verdict(line)], SHA))

    def test_what_stops_a_merge(self):
        cases = {
            "It isn't an open pull request.": pull(state="MERGED"),
            "It's a draft.": pull(isDraft=True),
            "It doesn't merge into main.": pull(baseRefName="release"),
            "The check hasn't passed on its latest commit.": pull(statusCheckRollup=[{"name": "check", "conclusion": "FAILURE"}]),
            "No reviewer has said it's ready at its latest commit.": pull(posts=[]),
            "It changes the GitHub workflows, so its check can't be trusted here. Approve it in the Claude app.": pull(files=["README.md", ".github/workflows/check.yml"]),
        }
        for problem, facts in cases.items():
            with self.subTest(problem):
                self.assertEqual(approvals.merge_problem(facts), problem)
        self.assertEqual(approvals.merge_problem(pull(statusCheckRollup=[])), "The check hasn't passed on its latest commit.")
        self.assertEqual(approvals.merge_problem(pull(), NEW_SHA), "It has new commits since the card was made.")
        self.assertIsNone(approvals.merge_problem(pull(), SHA))
        self.assertEqual(approvals.merge_problem(None), "It isn't an open pull request.")


class Cards(unittest.TestCase):
    def setUp(self):
        clean_slate()
        self.github = FakeGitHub()
        self.told = []
        self.cards = approvals.Approvals(DATA, self.github, lambda session: "Zoe" if session == LEAD else None, lambda session, text: self.told.append((session, text)))
        self.cards.requests.mkdir(parents=True)
        # Merging runs on its own thread; here it runs straight away, so tests can look at what happened.
        patcher = mock.patch.object(approvals.threading, "Thread", side_effect=lambda target, args, daemon: mock.Mock(start=lambda: target(*args)))
        patcher.start()
        self.addCleanup(patcher.stop)

    def request(self, **body):
        request_id = str(approvals.uuid.uuid4())
        approvals.write_json(self.cards.requests / f"{request_id}.json", {"id": request_id, "session": LEAD, "kind": "merge", "pr": 39, "summary": "Ready to go.", **body})
        self.cards.take_requests()
        return approvals.read_json(self.cards.requests / f"{request_id}.json", {})

    def card(self):
        return self.cards.view()[-1]

    def log(self):
        return [json.loads(line) for line in self.cards.log_path.read_text().splitlines()]

    def test_a_leads_request_for_a_ready_pr_becomes_a_card_with_githubs_facts(self):
        self.assertEqual(self.request()["outcome"], "shown")
        card = self.card()
        self.assertEqual((card["kind"], card["repo"], card["pr"], card["sha"], card["status"]), ("merge", "justinhtn/office", 39, SHA, "open"))
        self.assertEqual(card["requestedBy"], {"id": LEAD, "name": "Zoe"})
        self.assertEqual(card["verdict"]["by"], "asha-review")
        self.assertAlmostEqual(card["expiresAt"] - card["createdAt"], 3600)

    def test_only_a_lead_can_ask(self):
        answer = self.request(session="local_someone_else")
        self.assertEqual((answer["outcome"], answer["problem"]), ("refused", "Only a team lead can ask for approval."))
        self.assertEqual(self.cards.view(), [])

    def test_a_pr_that_isnt_ready_gets_no_card(self):
        self.github.pulls[39] = pull(posts=[])
        self.assertIn("No reviewer has said", self.request()["problem"])
        self.assertIn("isn't an open pull request", self.request(pr=40)["problem"])
        self.assertIn("number", self.request(pr="x")["problem"])
        self.assertEqual(self.cards.view(), [])

    def test_a_second_card_for_the_same_commit_is_refused(self):
        self.request()
        self.assertIn("already a card", self.request()["problem"])

    def test_only_merges_and_questions_can_be_asked(self):
        self.assertIn("Only merging", self.request(kind="deploy")["problem"])
        self.assertIn("two to four", self.request(kind="choice", question="Which?", options=["A"])["problem"])
        self.assertIn("two to four", self.request(kind="choice", question="Which?", options=["A", "A"])["problem"])
        self.assertEqual(self.request(kind="choice", question="Which day?", options=["Friday", "Monday"])["outcome"], "shown")

    def test_each_request_is_looked_at_once(self):
        self.request()
        before = self.cards.view()
        self.cards.take_requests()
        self.assertEqual(self.cards.view(), before)

    def test_old_requests_never_come_back_however_many_there_are(self):
        self.github.pulls[39] = pull(posts=[])
        for _ in range(approvals.SEEN_KEPT + 5):
            request_id = str(approvals.uuid.uuid4())
            approvals.write_json(self.cards.requests / f"{request_id}.json", {"id": request_id, "session": LEAD, "kind": "choice", "question": "Which?", "options": ["A", "B"], "outcome": "refused"})
        self.request(kind="choice", question="Which?", options=["A", "B"])
        self.cards.take_requests()
        self.cards.take_requests()
        self.assertEqual(len(self.cards.view()), 1)

    def test_a_slow_github_doesnt_hold_up_the_office(self):
        asked, answer = threading.Event(), threading.Event()

        def slow(number):
            asked.set()
            answer.wait(5)
            return pull()

        self.github.pull = slow
        request_id = str(approvals.uuid.uuid4())
        approvals.write_json(self.cards.requests / f"{request_id}.json", {"id": request_id, "session": LEAD, "kind": "merge", "pr": 39})
        taking = REAL_THREAD(target=self.cards.take_requests)
        taking.start()
        self.assertTrue(asked.wait(5))
        started = time.time()
        self.assertEqual(self.cards.open_count(), 0)
        self.assertLess(time.time() - started, 1)
        answer.set()
        taking.join(5)
        self.assertEqual(self.cards.open_count(), 1)

    def test_a_request_file_with_an_odd_name_is_ignored(self):
        (self.cards.requests / "not-an-id.json").write_text(json.dumps({"id": "not-an-id", "session": LEAD, "kind": "merge", "pr": 39}))
        self.cards.take_requests()
        self.assertEqual(self.cards.view(), [])

    def test_approving_merges_exactly_the_commit_on_the_card_once_github_still_agrees(self):
        self.request()
        card = self.card()
        confirmed = mock.Mock()
        self.cards.approve(card["id"], "dev1", confirmed)
        confirmed.assert_called_once()
        self.assertEqual(self.github.merged, [(39, SHA)])
        self.assertEqual(self.card()["status"], "done")
        self.assertEqual([entry["decision"] for entry in self.log()], ["shown", "approved", "merged"])
        self.assertEqual(self.told[-1][0], LEAD)
        self.assertIn("approved merging pull request 39 at aaaaaaa with Face ID", self.told[-1][1])

    def test_new_commits_after_the_card_stop_the_merge(self):
        self.request()
        self.github.pulls[39] = pull(headRefOid=NEW_SHA, posts=[verdict(f"Verdict: ready for {NEW_SHA[:7]}")])
        self.cards.approve(self.card()["id"], "dev1", mock.Mock())
        self.assertEqual(self.github.merged, [])
        self.assertEqual((self.card()["status"], self.card()["result"]), ("failed", "It has new commits since the card was made."))
        self.assertIn("didn't merge it", self.told[-1][1])

    def test_a_failed_face_id_leaves_the_card_open(self):
        self.request()
        card = self.card()
        with self.assertRaises(approvals_rejected()):
            self.cards.approve(card["id"], "dev1", mock.Mock(side_effect=approvals_rejected()("no")))
        self.assertEqual(self.card()["status"], "open")
        self.assertEqual(self.github.merged, [])

    def test_a_card_works_once(self):
        self.request()
        card_id = self.card()["id"]
        self.cards.approve(card_id, "dev1", mock.Mock())
        for act in (lambda: self.cards.approve(card_id, "dev1", mock.Mock()), lambda: self.cards.decline(card_id, "dev1")):
            with self.assertRaises(LookupError):
                act()
        self.assertEqual(len(self.github.merged), 1)

    def test_a_card_runs_out_after_an_hour(self):
        self.request()
        card_id = self.card()["id"]
        with mock.patch.object(approvals.time, "time", return_value=time.time() + 3601):
            with self.assertRaises(LookupError):
                self.cards.approve(card_id, "dev1", mock.Mock())
            self.assertEqual(self.card()["status"], "expired")
        self.assertEqual(self.github.merged, [])

    def test_a_merge_cut_off_by_a_restart_isnt_tried_again(self):
        self.request()
        state = self.cards.state()
        state["cards"][0]["status"] = "approving"
        self.cards.save(state)
        self.cards.recover()
        self.assertEqual(self.card()["status"], "failed")
        self.assertIn("Check the pull request on GitHub", self.card()["result"])
        self.assertEqual(self.github.merged, [])

    def test_declining_tells_the_lead(self):
        self.request()
        self.cards.decline(self.card()["id"], "dev1")
        self.assertEqual(self.card()["status"], "declined")
        self.assertEqual(self.told, [(LEAD, "The person declined merging pull request 39 in the office.")])

    def test_an_answer_goes_back_to_the_lead_as_information(self):
        self.request(kind="choice", question="Which day?", options=["Friday", "Monday"])
        card_id = self.card()["id"]
        with self.assertRaises(ValueError):
            self.cards.answer(card_id, "Sunday", "dev1")
        self.cards.answer(card_id, "Monday", "dev1")
        self.assertEqual(self.card()["choice"], "Monday")
        self.assertIn('They chose: "Monday"', self.told[-1][1])

    def test_a_question_cant_be_approved_as_a_merge(self):
        self.request(kind="choice", question="Which day?", options=["Friday", "Monday"])
        with self.assertRaises(LookupError):
            self.cards.approve(self.card()["id"], "dev1", mock.Mock())

    def test_the_log_holds_no_secrets(self):
        self.request()
        self.cards.approve(self.card()["id"], "dev1", mock.Mock())
        text = self.cards.log_path.read_text()
        for word in ("challenge", "signature", "token", "clientData"):
            self.assertNotIn(word, text)
        self.assertEqual(set(self.log()[1]), {"at", "card", "kind", "requestedBy", "decision", "repo", "pr", "sha", "device"})


def approvals_rejected():
    return server.passkeys.Rejected


class GitHubTests(unittest.TestCase):
    def test_a_pull_request_comes_with_who_really_posted_and_its_files(self):
        listings = {
            "comments": '{"login":"asha-review[bot]","type":"Bot","app":"asha-review","body":"Verdict: ready for aaaaaaa","url":"u","at":"2026-11-06T10:00:00Z","isEdited":false}\n',
            "reviews": "",
            "files": '"README.md"\n".github/workflows/check.yml"\n',
        }

        def run(command, **_):
            arguments = command[command.index("gh") + 1:]
            if arguments[0] == "pr":
                return mock.Mock(returncode=0, stdout=json.dumps({"state": "OPEN", "headRefOid": SHA}), stderr="")
            return mock.Mock(returncode=0, stdout=listings[arguments[2].rsplit("/", 1)[1]], stderr="")

        with mock.patch.object(server.subprocess, "run", side_effect=run):
            found = server.GitHub().pull(39)
        self.assertEqual(found["files"], ["README.md", ".github/workflows/check.yml"])
        self.assertEqual(found["posts"][0]["login"], "asha-review[bot]")

    def test_if_any_listing_fails_there_are_no_facts(self):
        def run(command, **_):
            failed = "files" in " ".join(command)
            return mock.Mock(returncode=1 if failed else 0, stdout="" if failed else "{}", stderr="")

        with mock.patch.object(server.subprocess, "run", side_effect=run):
            self.assertIsNone(server.GitHub().pull(39))

    def test_gh_gets_the_exact_commit_and_never_deletes_the_branch(self):
        done = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(server.subprocess, "run", return_value=done) as run:
            self.assertEqual(server.GitHub().merge(39, SHA), (True, "Merged pull request 39."))
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("gh"):], ["gh", "pr", "merge", "39", "--repo", "justinhtn/office", "--squash", "--delete-branch=false", "--match-head-commit", SHA])
        self.assertEqual(run.call_args.kwargs["stdin"], server.subprocess.DEVNULL)

    def test_only_ghs_last_line_is_kept_when_it_fails(self):
        done = mock.Mock(returncode=1, stdout="", stderr="some detail\nHead branch was modified. Review and try the merge again.\n")
        with mock.patch.object(server.subprocess, "run", return_value=done):
            self.assertEqual(server.GitHub().merge(39, SHA), (False, "Head branch was modified. Review and try the merge again."))


@unittest.skipUnless(ec, "cryptography isn't installed, so Face ID is off here. CI installs it.")
class RouteTests(Case):
    def setUp(self):
        super().setUp()
        self.github = FakeGitHub()
        self.told = []
        cards = approvals.Approvals(DATA, self.github, lambda session: "Zoe" if session == LEAD else None, lambda session, text: self.told.append(text))
        for name, value in (("APPROVALS", cards),):
            patcher = mock.patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.merged = threading.Event()
        self.github.merge = lambda number, sha: (self.merged.set(), (True, "Merged pull request 39."))[1]
        cards.requests.mkdir(parents=True)
        approvals.write_json(cards.requests / "11111111-2222-3333-4444-555555555555.json", {"id": "11111111-2222-3333-4444-555555555555", "session": LEAD, "kind": "merge", "pr": 39})
        cards.take_requests()
        self.card_id = cards.view()[0]["id"]

    def post(self, path, body, cookie, origin=ORIGIN):
        status, answer, _ = self.request("POST", path, cookie=cookie, token=self.page_token(cookie), origin=origin, body=body)
        return status, json.loads(answer)

    def with_face_id(self):
        authenticator, cookie = Authenticator(), self.signed_in()
        status, answer = self.post("/api/passkey/register-options", {}, cookie)
        self.assertEqual(status, 200)
        self.assertEqual(self.post("/api/passkey/register", authenticator.create(answer["challenge"]), cookie)[0], 200)
        return authenticator, cookie

    def approve(self, authenticator, cookie, card_id=None, **changes):
        status, options = self.post("/api/approvals/options", {"id": card_id or self.card_id}, cookie)
        self.assertEqual(status, 200)
        return self.post("/api/approvals/approve", {"id": card_id or self.card_id, "answer": authenticator.get(options["challenge"], **changes)}, cookie)

    def test_face_id_on_the_devices_own_passkey_approves_and_the_office_merges(self):
        authenticator, cookie = self.with_face_id()
        status, answer = self.approve(authenticator, cookie)
        self.assertEqual(status, 200)
        self.assertTrue(self.merged.wait(5))
        self.assertEqual(server.APPROVALS.view()[0]["status"], "done")

    def test_face_id_must_verify_the_person_not_just_a_tap(self):
        authenticator, cookie = self.with_face_id()
        status, _ = self.approve(authenticator, cookie, flags=0x01)
        self.assertEqual(status, 403)
        self.assertEqual(server.APPROVALS.view()[0]["status"], "open")

    def test_a_challenge_for_one_card_cant_approve_another(self):
        authenticator, cookie = self.with_face_id()
        _, options = self.post("/api/approvals/options", {"id": self.card_id}, cookie)
        self.github.pulls[40] = pull(number=40, headRefOid=NEW_SHA, posts=[verdict(f"Verdict: ready for {NEW_SHA[:7]}")])
        approvals.write_json(server.APPROVALS.requests / "11111111-2222-3333-4444-666666666666.json", {"id": "11111111-2222-3333-4444-666666666666", "session": LEAD, "kind": "merge", "pr": 40})
        server.APPROVALS.take_requests()
        other = next(card["id"] for card in server.APPROVALS.view() if card["pr"] == 40)
        status, _ = self.post("/api/approvals/approve", {"id": other, "answer": authenticator.get(options["challenge"])}, cookie)
        self.assertEqual(status, 403)
        self.assertFalse(self.merged.is_set())

    def test_another_devices_passkey_cant_approve(self):
        first, _ = self.with_face_id()
        _, cookie = self.with_face_id()
        status, _ = self.approve(first, cookie)
        self.assertEqual(status, 403)

    def test_a_device_without_face_id_cant_approve(self):
        cookie = self.signed_in()
        self.assertEqual(self.post("/api/approvals/options", {"id": self.card_id}, cookie)[0], 409)
        status, view = self.request("GET", "/api/approvals", cookie=cookie, token=self.page_token(cookie))[:2]
        self.assertEqual((status, json.loads(view)["canApprove"]), (200, False))

    def test_the_mac_sees_cards_read_only(self):
        local = {"port": self.local.server_address[1], "host": f"127.0.0.1:{server.PORT}"}
        status, view, _ = self.request("GET", "/api/approvals", token=server.TOKEN, **local)
        self.assertEqual((status, json.loads(view)["canApprove"], len(json.loads(view)["cards"])), (200, False, 1))
        for route in server.APPROVAL_ROUTES:
            with self.subTest(route):
                self.assertEqual(self.request("POST", route, token=server.TOKEN, body={"id": self.card_id, "option": "x"}, **local)[0], 403)
        self.assertEqual(server.APPROVALS.view()[0]["status"], "open")

    def test_without_sign_in_nothing_answers_a_card(self):
        for route in server.APPROVAL_ROUTES:
            with self.subTest(route):
                self.assertEqual(self.request("POST", route, body={"id": self.card_id})[0], 403)

    def test_decline_needs_no_face_id_but_does_need_the_device(self):
        cookie = self.signed_in()
        self.assertEqual(self.post("/api/approvals/decline", {"id": self.card_id}, cookie)[0], 200)
        self.assertEqual(server.APPROVALS.view()[0]["status"], "declined")
        self.assertEqual(self.told, ["The person declined merging pull request 39 in the office."])


if __name__ == "__main__":
    unittest.main()
