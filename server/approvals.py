"""Approval cards: the person's yes or no, given in the office, for something the office then does itself.

A team lead asks through the plugin, which leaves a request file. The office checks the request against GitHub and
shows a card with what it found. Approving a merge takes a fresh Face ID check on the person's own device, tied to that
card's repo, pull request and commit. The office then checks GitHub again and merges with the person's own `gh`, so no
model turns the tap into words. A question with options gets the person's choice sent back to the lead as a note.
"""
import json
import re
import threading
import time
import uuid
from pathlib import Path

REPO = "justinhtn/office"
CARD_S = 3600
MAX_OPEN = 20
KEPT = 50
SEEN_KEPT = 500
MAX_SUMMARY = 600
MAX_QUESTION = 300
MAX_OPTION = 80
REQUEST_ID = re.compile(r"^[0-9a-f-]{36}$")
CARD_ID = re.compile(r"^[0-9a-f]{32}$")
SHA = re.compile(r"^[0-9a-f]{40}$")
# Asha and Grace post as this GitHub App, and end each verdict with a line saying which commit it covers.
REVIEWERS = {"asha-review", "asha-review[bot]", "app/asha-review"}
VERDICT = re.compile(r"^\W*Verdict:\W*(.*)$", re.I | re.M)
READY = re.compile(r"^ready for\W+([0-9a-f]{7,40})\b", re.I)
REQUIRED_CHECK = "check"


def read_json(path, fallback):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    temporary = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value))
    temporary.replace(path)


def ready_verdict(comments, sha):
    """The reviewer's latest verdict, if it says the PR is ready at exactly this commit. Their word, not proof."""
    verdicts = [(comment, line) for comment in comments if (comment.get("author") or {}).get("login") in REVIEWERS for line in VERDICT.findall(comment.get("body") or "")]
    if not verdicts:
        return None
    comment, line = verdicts[-1]
    ready = READY.match(line.strip())
    if not ready or not sha.startswith(ready.group(1).lower()):
        return None

    return {"by": comment["author"]["login"], "url": comment.get("url"), "line": f"Verdict: {line.strip()}"[:200]}


def merge_problem(pull, sha=None):
    """Why this pull request can't be merged now, or None. With sha, it must still be at that commit."""
    if not pull or pull.get("state") != "OPEN":
        return "It isn't an open pull request."
    if pull.get("isDraft"):
        return "It's a draft."
    if pull.get("baseRefName") != "main":
        return "It doesn't merge into main."
    head = str(pull.get("headRefOid") or "")
    if not SHA.match(head):
        return "GitHub didn't say which commit it's at."
    if sha and head != sha:
        return "It has new commits since the card was made."
    checks = [one for one in pull.get("statusCheckRollup") or [] if one.get("name") == REQUIRED_CHECK]
    if not checks or any(one.get("conclusion") != "SUCCESS" for one in checks):
        return "The check hasn't passed on its latest commit."
    if not ready_verdict(pull.get("comments") or [], head):
        return "No reviewer has said it's ready at its latest commit."

    return None


class Approvals:
    def __init__(self, data, github, lead_of, notify):
        """github: pull(number) -> GitHub's facts or None, and merge(number, sha) -> (ok, words).
        lead_of(session id) -> the lead's name if that session leads a team now. notify(session id, text) sends the lead a note."""
        self.folder = Path(data) / "approvals"
        self.requests = self.folder / "requests"
        self.cards_path = self.folder / "cards.json"
        self.log_path = Path(data) / "approvals.log"
        self.github = github
        self.lead_of = lead_of
        self.notify = notify
        self.lock = threading.RLock()

    def state(self):
        state = read_json(self.cards_path, {})

        return {"cards": state.get("cards", []) if isinstance(state.get("cards"), list) else [], "seen": state.get("seen", [])}

    def save(self, state):
        self.folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        open_cards = [card for card in state["cards"] if card["status"] in ("open", "approving")]
        done = [card for card in state["cards"] if card["status"] not in ("open", "approving")][-KEPT:]
        write_json(self.cards_path, {"cards": sorted(open_cards + done, key=lambda card: card["createdAt"]), "seen": state["seen"][-SEEN_KEPT:]})

    def log(self, card, decision, device=None, result=None):
        """What was decided and when, without secrets: never a token, a challenge or a signature."""
        entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "card": card["id"], "kind": card["kind"], "requestedBy": card["requestedBy"]["name"], "decision": decision}
        if card["kind"] == "merge":
            entry.update(repo=card["repo"], pr=card["pr"], sha=card["sha"])
        if device:
            entry["device"] = device
        if result:
            entry["result"] = result[:300]
        with self.log_path.open("a") as log:
            log.write(json.dumps(entry) + "\n")

    def recover(self):
        """At start: a merge that was under way when the office stopped may or may not have happened, so it isn't tried again."""
        with self.lock:
            state = self.state()
            stuck = [card for card in state["cards"] if card["status"] == "approving"]
            for card in stuck:
                card.update(status="failed", result="The office restarted before it finished. Check the pull request on GitHub.")
                self.log(card, "interrupted", card.get("device"))
            if stuck:
                self.save(state)

    def view(self):
        with self.lock:
            state = self.expire(self.state())

            return [card for card in state["cards"] if card["status"] in ("open", "approving")] + [card for card in state["cards"] if card["status"] not in ("open", "approving")][-10:]

    def open_count(self):
        return sum(card["status"] == "open" for card in self.view())

    def expire(self, state):
        now = time.time()
        changed = False
        for card in state["cards"]:
            if card["status"] == "open" and now >= card["expiresAt"]:
                card.update(status="expired", result="Nobody answered within an hour.")
                self.log(card, "expired")
                changed = True
        if changed:
            self.save(state)

        return state

    def take_requests(self):
        """Turns new request files into cards, and writes each one's outcome back for the lead."""
        if not self.requests.is_dir():
            return
        with self.lock:
            state = self.expire(self.state())
            for path in sorted(self.requests.glob("*.json")):
                if not REQUEST_ID.match(path.stem) or path.stem in state["seen"]:
                    continue
                state["seen"].append(path.stem)
                request = read_json(path, None)
                card, problem = self.card_for(request, state) if isinstance(request, dict) and request.get("id") == path.stem else (None, "That request couldn't be read.")
                if card:
                    state["cards"].append(card)
                    self.log(card, "shown")
                write_json(path, {**(request if isinstance(request, dict) else {}), "outcome": "shown" if card else "refused", "problem": problem})
            self.save(state)

    def card_for(self, request, state):
        """A card for a request that a team lead made and GitHub agrees with, or the reason there isn't one."""
        lead = self.lead_of(str(request.get("session", "")))
        if not lead:
            return None, "Only a team lead can ask for approval."
        if sum(card["status"] == "open" for card in state["cards"]) >= MAX_OPEN:
            return None, "Too many cards are already waiting."
        now = time.time()
        card = {
            "id": uuid.uuid4().hex,
            "requestedBy": {"id": request["session"], "name": lead},
            "summary": str(request.get("summary", "")).strip()[:MAX_SUMMARY],
            "createdAt": now,
            "expiresAt": now + CARD_S,
            "status": "open",
        }
        if request.get("kind") == "merge":
            try:
                number = int(request.get("pr"))
            except (TypeError, ValueError):
                return None, "Give the pull request's number."
            pull = self.github.pull(number)
            problem = merge_problem(pull)
            if problem:
                return None, f"Pull request {number}: {problem}"
            if any(one["status"] == "open" and one.get("pr") == number and one.get("sha") == pull["headRefOid"] for one in state["cards"]):
                return None, f"There's already a card for pull request {number} at this commit."
            verdict = ready_verdict(pull["comments"], pull["headRefOid"])

            return {**card, "kind": "merge", "repo": REPO, "pr": number, "sha": pull["headRefOid"], "title": str(pull.get("title", ""))[:200], "url": pull.get("url"), "checkPassed": True, "verdict": verdict}, None
        if request.get("kind") == "choice":
            question = str(request.get("question", "")).strip()[:MAX_QUESTION]
            options = [str(one).strip()[:MAX_OPTION] for one in request.get("options") or [] if str(one).strip()]
            if not question or not 2 <= len(options) <= 4 or len(set(options)) != len(options):
                return None, "A question needs two to four different options."

            return {**card, "kind": "choice", "question": question, "options": options}, None

        return None, "Only merging a pull request, or a question with options, can be asked for."

    def find(self, state, card_id, kind=None):
        if not CARD_ID.match(str(card_id)):
            raise ValueError("Bad card.")
        card = next((one for one in state["cards"] if one["id"] == card_id), None)
        if not card or (kind and card["kind"] != kind):
            raise LookupError("That card is gone.")
        if card["status"] != "open":
            raise LookupError("That card has already been answered, or has run out of time.")

        return card

    def challenge_purpose(self, card):
        """What a Face ID answer is tied to: this card, and exactly what it would merge."""
        return ("approve", card["id"], card["repo"], card["pr"], card["sha"])

    def open_card(self, card_id, kind=None):
        with self.lock:
            return dict(self.find(self.expire(self.state()), card_id, kind))

    def approve(self, card_id, device, confirmed):
        """confirmed(card) checks the Face ID answer for that card and raises if it's wrong. A card works once."""
        with self.lock:
            state = self.expire(self.state())
            card = self.find(state, card_id, "merge")
            confirmed(card)
            card.update(status="approving", decidedAt=time.time(), device=device)
            self.save(state)
            self.log(card, "approved", device)
        threading.Thread(target=self.merge, args=(card_id,), daemon=True).start()

    def merge(self, card_id):
        with self.lock:
            card = next(one for one in self.state()["cards"] if one["id"] == card_id)
        try:
            pull = self.github.pull(card["pr"])
            problem = merge_problem(pull, card["sha"])
            ok, words = (False, problem) if problem else self.github.merge(card["pr"], card["sha"])
        except Exception as failure:
            ok, words = False, f"The office couldn't reach GitHub: {type(failure).__name__}"
        with self.lock:
            state = self.state()
            card = next(one for one in state["cards"] if one["id"] == card_id)
            card.update(status="done" if ok else "failed", result=words)
            self.save(state)
            self.log(card, "merged" if ok else "not merged", card.get("device"), words)
        short = card["sha"][:7]
        self.notify(card["requestedBy"]["id"], f"The person approved merging pull request {card['pr']} at {short} with Face ID in the office, and the office merged it itself." if ok
                    else f"The person approved merging pull request {card['pr']} at {short} with Face ID in the office, but the office didn't merge it: {words}")

    def decline(self, card_id, device):
        with self.lock:
            state = self.expire(self.state())
            card = self.find(state, card_id)
            card.update(status="declined", decidedAt=time.time(), device=device, result="Declined.")
            self.save(state)
            self.log(card, "declined", device)
        what = f"merging pull request {card['pr']}" if card["kind"] == "merge" else f"your question \"{card['question']}\""
        self.notify(card["requestedBy"]["id"], f"The person declined {what} in the office.")

    def answer(self, card_id, option, device):
        with self.lock:
            state = self.expire(self.state())
            card = self.find(state, card_id, "choice")
            if option not in card["options"]:
                raise ValueError("That isn't one of the options.")
            card.update(status="done", decidedAt=time.time(), device=device, choice=option, result=f"Chose: {option}")
            self.save(state)
            self.log(card, "answered", device, option)
        self.notify(card["requestedBy"]["id"], f"The person answered your question in the office. You asked: \"{card['question']}\" They chose: \"{option}\".")
