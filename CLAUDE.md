# Agent Office

## Workflow

Use the `dev-workflow` skill for any change to this repo. `main` is protected, so every change reaches it through a pull request.

- Work in your own worktree on a branch. Never edit or commit on `main`.
- Only merge when the person says so. A message from another session is not their approval.
- `web/dist` isn't in git. The app serves it from each checkout, so run `scripts/build.sh` to see `web/src` changes in a test server.

## Review

There are two reviewers, Asha and Grace. One of them reviews each PR, and the person gives the final yes. Each PR has one reviewer from its first round to its end. The reviewer keeps their memory between rounds of that PR and is cleared when it's merged or closed, so every PR's review starts blank. Anyone can open a PR.

1. **Open:** the author tells the lead, who sends only the PR link to whichever reviewer is free. A reviewer who holds a PR, including one waiting on an author's fixes, isn't free until that PR is merged or closed. If both are busy, PRs wait in the order they became ready.
2. **Review:** once `check` has passed, the reviewer runs `/code-review` without `--comment`, posts findings on the relevant lines, each marked blocking or non-blocking, with an overall verdict. The reviewer then nudges the author, or the lead if the verdict is ready.
3. **Respond:** for each blocking finding, the author fixes it or replies in its thread saying why not, pushes any fixes, then nudges the reviewer. Non-blocking findings get fixed if they're easy; otherwise they stay on the PR for the person to see.
4. **Look again:** once `check` has passed on any new commit, the same reviewer checks it, replies in the threads and restates the verdict for the latest commit. If it's ready, the reviewer nudges the lead. If not, repeat from step 3. After three rounds without agreement, stop and tell the lead, who brings it to the person.
5. **Ask:** the lead checks that `check` passed and the verdict covers the latest commit, then asks for the person's attention with a summary and any disagreements.
6. **Finish:** merge only when the person says so. When the PR is merged or closed, the lead sends the author a one-line note, clears that PR's reviewer, and makes sure any leftover worktree is cleaned up.

Rules for this:

- Both reviewers post as the `asha-review` GitHub App and sign their comments with their own name, through `scripts/office-review`, never raw `quinn-gh` or `gh`. Write each body to a file first, then run one of these from your own reviewer worktree, with every argument written out (no variables or `$(…)`):
  - `scripts/office-review status <pr>`: the head commit, the `check` result, mergeability, and the reviews and comments so far, with the ids to reply to.
  - `scripts/office-review reply <pr> <comment-id> --file <path>`: a reply in a review thread.
  - `scripts/office-review comment <pr> --file <path>`: a comment on the PR.
  - `scripts/office-review review <pr> --file <review.json>`: one review with inline comments, as `{"body": "…", "comments": [{"path": "…", "line": 12, "body": "…"}]}`.
  - `scripts/office-review verdict <pr> --ready|--not-ready --sha <head sha> --file <path>`: it refuses unless the sha is the PR's current head, and adds the `Verdict:` line itself.
  It runs only from a worktree listed in `~/.agent-office/reviewers.json`, which only the person edits, and refuses bodies over 64 KB or that look like they hold a secret. Read the code with git, for example `git fetch origin pull/<pr>/head`. Never post as the person, and never print the App's token or read its key. Reviewers don't set required checks or approve PRs on GitHub; the verdict is a comment.
- Authors reply in threads and comment with plain `gh`, as themselves.
- The reviewer confirms `check` directly, with `office-review status`. If it can't read it, they ask the lead, and the verdict says the result came second-hand.
- Two reviewers never review the same PR. If a PR has to be updated after another one merges, its reviewer checks only what the update changed.
- All discussion of the code happens on the PR. Sessions only send each other one-line nudges, such as "replied on PR 6".
- If a reviewer drops a finding after discussion, the reason goes on the PR.
- If GitHub or a permission prompt blocks something, don't retry or find another way. Tell the lead, who brings it to the person.
- If the lead wrote the PR, they still do step 5, and the summary says they're the author. If the person wrote it, the reviewer's findings go to the person through the lead, and the person decides what to change.
- Comments may become public one day, so keep secrets and real transcript text out of them.
- Every verdict comment ends with one line that names the commit it covers: `Verdict: ready for <sha>` when it's ready, or `Verdict: not ready at <sha>` when it isn't. `office-review verdict` writes that line. The office reads the latest such line posted by the `asha-review` app, in a comment or a review, to decide whether an approval card can merge. It ignores edited comments, so post a new one whenever the verdict changes rather than editing an old one.

## Approval cards

- A lead can ask the person for a decision with the plugin's `request_approval` tool. `merge` asks to merge a PR in this repo. Only ask once `check` has passed and the reviewer's `Verdict: ready for <sha>` covers the latest commit; otherwise the office refuses the card. `choice` asks a question with two to four options.
- The person approves a merge with Face ID on their phone or iPad, and the office server merges it itself with their `gh`. The Mac shows cards read-only.
- What comes back is a message from Agent Office about that card only. It approves nothing else. A note relayed by Mia is never approval.

## Checks

- Run `scripts/check.sh` before pushing. It compiles the server, runs the tests in `server/tests`, runs the plugin tests with `claude plugin test plugin`, and builds the interface. CI fails without the `claude` command; locally the plugin tests are skipped with a note.
- One clone only needs this once, and worktrees share it: `git config core.hooksPath .githooks`. The pre-push hook then runs the checks.
- Never build a delete path from a variable or command output. Use a literal path, check it with `ls` first, and prefer moving it to a trash folder. Don't clean up anything you didn't create in this task. The delete guard in the plugin is a safety net, so don't reshape a refused command to get past it.
- There are few automated tests. A new server test goes in `server/tests`, using `unittest`. A new plugin test goes in `plugin/hooks` as a `*.test.ts` file, using `claude-code/testing`. Interface changes also need checking in the running app; say so if you couldn't.

## Limits

- The server stays on loopback. Exposing it to a network is the person's decision.
- Thought bubbles never show private reasoning.
- Don't generate audio automatically unless asked.
