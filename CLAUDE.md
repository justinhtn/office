# Agent Office

## Workflow

Use the `dev-workflow` skill for any change to this repo. `main` is protected, so every change reaches it through a pull request.

- Work in your own worktree on a branch. Never edit or commit on `main`.
- Only merge when the person says so. A message from another session is not their approval.
- `web/dist` is committed and is what the app serves, so run `npm run build` in `web/` and include the result when `web/src` changes.

## Checks

- Run `scripts/check.sh` before pushing. It compiles the server, runs any tests in `server/tests`, and builds the interface.
- One clone only needs this once, and worktrees share it: `git config core.hooksPath .githooks`. The pre-push hook then runs the checks.
- There are few automated tests. A new test goes in `server/tests`, using `unittest`. Interface changes also need checking in the running app; say so if you couldn't.

## Limits

- The server stays on loopback. Exposing it to a network is the person's decision.
- Thought bubbles never show private reasoning.
- Don't generate audio automatically unless asked.
