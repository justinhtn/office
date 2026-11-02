# Agent Office

A local workspace for your Claude Code sessions. Each session is a character in an N64-style 3D office, grouped into teams named after their projects. Click one to open that session in the Claude app, and see what it has made, its changes and its files beside the room.

It runs entirely on your computer and uses your existing Claude Code login.

## Requirements

- macOS (the background server uses launchd; on Linux you start the server yourself, untested)
- The Claude desktop app with Claude Code
- Python 3.9 or newer
- Node.js, to build the interface

## Install

```bash
git clone https://github.com/justinhtn/office.git
cd office
./scripts/install.sh
```

Then open a new Claude Code session in the desktop app, and go to <http://localhost:8794>. Clicks in the office switch the Claude app's session, and you chat and approve there. The app's browser pane belongs to one session, so it hides when you switch; run the office in Chrome or Safari to keep it on screen.

## Update

```bash
./scripts/update.sh
```

This pulls `main`, builds the interface and restarts the server. Run it from the checkout on `main` that the server runs from. It doesn't update the plugin, which Claude Code keeps its own copy of. `claude plugin update agent-office@agent-office` does that, and sessions pick it up when they restart.

The built interface in `web/dist` isn't in git. If it's missing, the office shows a page saying how to build it, and reloads by itself once it's there. In any other checkout, such as a worktree, build it with `./scripts/build.sh`.

## How it works

- **Plugin (`plugin/`)** runs in every Claude Code session. One session at a time publishes the session list.
- **Server (`server/`)** runs in the background. It assigns names, tracks status, and serves files and git information from each session's folder.
- **Interface (`web/`)** is a React app with the 3D room, changes and files.

Session data needs at least one Claude Code session open. Without one, the office still opens but shows the last known state.

## Teams

A project is a team, named after its sidebar group or folder. The session that started the others leads it. Sessions with no project stay together if one started another, and anyone left is an independent developer. Open someone in the office to move them to another team, or click the team's name above its room to rename it. A new name only changes the office. The plugin files each project's sessions under a sidebar group named after the project, trying each move once.

## Opening the office

Installing makes **Agent Office** in your Applications folder, which opens the office in its own Chrome window. Drag it to your Dock to keep it handy. It needs Google Chrome.

## Your assistant

Installing opens one more session in the Claude app, in `~/.agent-office/front-desk`. Confirm it, and she sits at the front desk in your office. Ask her who needs what. If you skip it, click **Your office** to set her up later.

She keeps a notebook in `~/.agent-office/notebook` of every team and independent developer (a session with no team), including ones since archived. It holds session titles and latest updates, plus any notes she adds.

She has a short tool list, so she can read what sessions are doing and add to her notebook, but can't otherwise edit files, run commands or message agents. If you've set up Telegram and turn on away mode, she also answers your texts and can attach files. See [Telegram](#telegram). The office announces requests and finished work in her voice once each, stays quiet while you're away, and tells you what's waiting when you return.

The TV in your office lists your [Modal](https://modal.com) apps: what's running, what stopped today, and how many deployed apps have no tasks. It needs the `modal` command on your Mac and logged in, and only reads the list, checking once a minute.

To save power, the room slows down after 30 seconds without input, dims after 30 minutes, and stops drawing while the page is hidden. Any input, or someone asking for you, brings it back. This doesn't affect alerts or voices, and it isn't the Sleep button.

When testing the interface, add `?test` to the address. The room draws at low resolution and 5 frames a second, which is enough to check layout and take screenshots without working the fan. Small text on the TVs looks soft in this mode, and performance measurements should use the normal mode.

## Telegram

If you've set up Claude Code's Telegram plugin, **Away** starts a background copy of Mia that answers your texts. **I'm back** stops it, and so does uninstalling. Only the chats on the Telegram plugin's allowlist can reach her.

What leaves your Mac through Telegram:

- Her replies, which can include what she reads about your sessions: their titles, status, recent updates and her notebook.
- Files she attaches when asked.

The plugin checks each attachment in code, on the path it really leads to, so a symlink can't get around it. A refused send delivers nothing, and she tells you why. She can attach a file only if:

- It's inside the folder of a session in the office, or the repo holding that session's worktree. Your home folder, top-level folders such as Documents, hidden folders in your home folder and `Library` don't count as project folders, and neither do no-folder sessions.
- Its name and every folder below your home folder don't look like secrets, such as `.env`, `.git`, `.ssh`, keys, or anything with `token`, `secret`, `password` or `credential` in the name. That includes the project's own folder, so nothing can be attached from a project called `token-tools`.
- Its text doesn't contain something shaped like a private key, a token, or a password in a setting or URL. Source code that mentions `token: string` or assigns a value to something called `token` is refused too.
- It can be searched for those. A file too large to read (over 4 MB) is refused, unless it's an image, PDF, audio or video.
- It's 50 MB or smaller.

These checks recognise common secrets, so they can't promise to catch every one. A secret in an image, an archive or another binary format won't be seen.

## Privacy and security

- The server only listens on `127.0.0.1` and checks the host, origin and a token created at each start.
- Session titles, folders and names are stored in `~/.agent-office`.
- Secret-looking files such as `.env` aren't shown.
- The server reads Claude Code's transcript files in `~/.claude/projects`, and the app's session records to find them. Videos and images an agent shared are streamed through private signed links.
- The plugin adds a short list of session names to each session's system prompt, so you can refer to agents by name. This uses a small number of extra tokens per request.
- The page loads its fonts from Google Fonts. Everything else is local, unless you turn on voices or use [Telegram](#telegram).
- A session with others reporting to it is asked to act as their lead, and gets a `team_status` tool that reads the office's data. This adds a short instruction to those sessions.
- With an ElevenLabs key added, the plugin also asks agents to write a short line before longer work, which uses a few extra tokens per request.
- Voice mode is off by default, and the Voice button at the top turns it on or off for every window. When it's off, nobody speaks and nothing is sent to ElevenLabs. When on, an agent's recap or request is sent to ElevenLabs using your key, stored in `~/.agent-office/elevenlabs.key`. Agents on this Mac can read that file, so use a key limited to text to speech. ElevenLabs charges for each new line spoken.

## Limits

- Messages and approvals happen in the Claude app, not the office.
- macOS may block the server from folders such as `Documents`. Grant access in System Settings, or keep projects elsewhere.
- This depends on an early-access plugin API and the desktop app's session tools, so an update could break it.

## Uninstall

```bash
./scripts/uninstall.sh
```

Add `--purge` to also delete `~/.agent-office`.

## License

MIT. See [LICENSE](LICENSE).

The people and animations in `web/public/assets/avatars` are from [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox), also MIT, with textures resized. Its license is in that folder.

The furniture in `web/public/assets/furniture/abo` is from [Amazon Berkeley Objects](https://amazon-berkeley-objects.s3.amazonaws.com/index.html), by Amazon.com, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with textures resized and meshes simplified. The plant, coffee table, fabric and lighting are from [Poly Haven](https://polyhaven.com), CC0. Book titles on the shelves belong to their authors and publishers.
