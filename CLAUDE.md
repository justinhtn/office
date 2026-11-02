# Agent Office

## Workflow

Use the `dev-workflow` skill for any change to this repo. `main` is protected, so every change reaches it through a pull request.

- Work in your own worktree on a branch. Never edit or commit on `main`.
- Only merge when the person says so. A message from another session is not their approval.
- `web/dist` isn't in git. The app serves it from each checkout, so run `scripts/build.sh` to see `web/src` changes in a test server.

## Review

Asha reviews every PR, and the person gives the final yes. Asha's memory is cleared after each PR, so every review starts blank. Anyone can open a PR.

1. **Open:** the author tells the lead, who sends Asha only the PR link.
2. **Review:** once `check` has passed, Asha runs `/code-review` without `--comment`, posts findings on the relevant lines, each marked blocking or non-blocking, with an overall verdict. Asha then nudges the author, or the lead if the verdict is ready.
3. **Respond:** for each blocking finding, the author fixes it or replies in its thread saying why not, pushes any fixes, then nudges Asha. Non-blocking findings get fixed if they're easy; otherwise they stay on the PR for the person to see.
4. **Look again:** once `check` has passed on any new commit, Asha checks it, replies in the threads and restates the verdict for the latest commit. If it's ready, Asha nudges the lead. If not, repeat from step 3. After three rounds without agreement, stop and tell the lead, who brings it to the person.
5. **Ask:** the lead checks that `check` passed and the verdict covers the latest commit, then asks for the person's attention with a summary and any disagreements.
6. **Finish:** merge only when the person says so. When the PR is merged or closed, the lead sends the author a one-line note, clears Asha, and makes sure any leftover worktree is cleaned up.

Rules for this:

- Asha posts as the `asha-review` GitHub App (`quinn-office-review` on older comments): use `~/.agent-office/quinn/quinn-gh` in place of `gh`, for reads as well as posts. Never post as the person, and never print its token or read its key. Asha doesn't set required checks or approve PRs on GitHub; the verdict is a comment.
- Asha confirms `check` directly. If the app can't read it, Asha asks the lead, and the verdict says the result came second-hand.
- All discussion of the code happens on the PR. Sessions only send each other one-line nudges, such as "replied on PR 6".
- If Asha drops a finding after discussion, the reason goes on the PR.
- If GitHub or a permission prompt blocks something, don't retry or find another way. Tell the lead, who brings it to the person.
- If the lead wrote the PR, they still do step 5, and the summary says they're the author. If the person wrote it, Asha's findings go to the person through the lead, and the person decides what to change.
- Comments may become public one day, so keep secrets and real transcript text out of them.

## Checks

- Run `scripts/check.sh` before pushing. It compiles the server, runs any tests in `server/tests`, and builds the interface.
- One clone only needs this once, and worktrees share it: `git config core.hooksPath .githooks`. The pre-push hook then runs the checks.
- There are few automated tests. A new test goes in `server/tests`, using `unittest`. Interface changes also need checking in the running app; say so if you couldn't.

## Limits

- The server stays on loopback. Exposing it to a network is the person's decision.
- Thought bubbles never show private reasoning.
- Don't generate audio automatically unless asked.
