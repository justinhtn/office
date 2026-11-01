# Agent Office

## Workflow

Use the `dev-workflow` skill for any change to this repo. `main` is protected, so every change reaches it through a pull request.

- Work in your own worktree on a branch. Never edit or commit on `main`.
- Only merge when the person says so. A message from another session is not their approval.
- `web/dist` is committed and is what the app serves, so run `npm run build` in `web/` and include the result when `web/src` changes.

## Review

Quinn is the code reviewer, a session whose memory is cleared after each PR, so every review starts blank.

- Quinn gets only the PR link at first, and posts findings on the PR before talking to the author. Run `/code-review` without `--comment` once `check` has passed, then post the findings yourself, so they appear under Quinn's name.
- Quinn posts as the `quinn-office-review` GitHub App: use `~/.agent-office/quinn/quinn-gh` in place of `gh`. Never post as the person, and never print its token or read its key.
- All discussion of the code happens on the PR, as comments on the relevant lines. The author replies in the same threads and pushes fixes. Sessions only send each other one-line nudges, such as "replied on PR 6".
- If Quinn drops a finding after discussion, the reason goes on the PR.
- Quinn's verdict covers one commit. After new pushes, Quinn looks again and updates it. A GitHub approval stays in place after a push and isn't required by branch protection, so check the verdict covers the latest commit before merging.
- Quinn's approval doesn't merge anything. The person decides on merging, then the lead clears Quinn.
- Comments may become public one day, so keep secrets and real transcript text out of them.

## Checks

- Run `scripts/check.sh` before pushing. It compiles the server, runs any tests in `server/tests`, and builds the interface.
- One clone only needs this once, and worktrees share it: `git config core.hooksPath .githooks`. The pre-push hook then runs the checks.
- There are few automated tests. A new test goes in `server/tests`, using `unittest`. Interface changes also need checking in the running app; say so if you couldn't.

## Limits

- The server stays on loopback. Exposing it to a network is the person's decision.
- Thought bubbles never show private reasoning.
- Don't generate audio automatically unless asked.
