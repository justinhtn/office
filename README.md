# Agent Office

A local workspace for your Claude Code sessions. Each session is a character in an N64-style 3D office, grouped into project rooms and teams. Click one to open that session in the Claude app, and see what it has made, its changes and its files beside the room.

It runs entirely on your computer and uses your existing Claude Code login.

## Requirements

- macOS (the background server uses launchd; on Linux you start the server yourself, untested)
- The Claude desktop app with Claude Code
- Python 3.9 or newer
- Node.js, only if the interface has to be built

## Install

```bash
git clone https://github.com/justinhtn/office.git
cd office
./scripts/install.sh
```

Then open a new Claude Code session in the desktop app, and go to <http://localhost:8794>. Clicks in the office switch the Claude app's session, and you chat and approve there. The app's browser pane belongs to one session, so it hides when you switch; run the office in Chrome or Safari to keep it on screen.

## How it works

- **Plugin (`plugin/`)** runs in every Claude Code session. One session at a time publishes the session list, and any session can answer a request for a transcript.
- **Server (`server/`)** runs in the background. It assigns names, tracks status, and serves files and git information from each session's folder.
- **Interface (`web/`)** is a React app with the 3D room, chat, changes and files.

Session data needs at least one Claude Code session open. Without one, the office still opens but shows the last known state.

## Privacy and security

- The server only listens on `127.0.0.1` and checks the host, origin and a token created at each start.
- Session titles, folders and names are stored in `~/.agent-office`.
- Secret-looking files such as `.env` aren't shown.
- The server reads Claude Code's transcript files in `~/.claude/projects`, and the app's session records to find them. Videos and images an agent shared are streamed through private signed links.
- The plugin adds a short list of session names to each session's system prompt, so you can refer to agents by name. This uses a small number of extra tokens per request.
- The page loads its fonts from Google Fonts. Everything else is local, unless you turn on voices.
- A session with others reporting to it is asked to act as their lead, and gets a `team_status` tool that reads the office's data. This adds a short instruction to those sessions.
- With an ElevenLabs key added, the plugin also asks agents to write a short line before longer work, which uses a few extra tokens per request.
- Voices are off by default. When on, an agent's recap or request is sent to ElevenLabs using your key, stored in `~/.agent-office/elevenlabs.key`. Agents on this Mac can read that file, so use a key limited to text to speech. ElevenLabs charges for each new line spoken.

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
