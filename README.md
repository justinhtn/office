# Agent Office

A local workspace for your Claude Code sessions. Each session is a character in an N64-style 3D office, grouped into project rooms and teams. Click one to read its conversation, see its changes, browse its files and send it a message.

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

Then open a new Claude Code session in the desktop app, and go to <http://localhost:8794>.

## How it works

- **Plugin (`plugin/`)** runs in every Claude Code session. One session at a time publishes the session list, and any session can answer a request for a transcript or a message.
- **Server (`server/`)** runs in the background. It assigns names, tracks status, and serves files and git information from each session's folder.
- **Interface (`web/`)** is a React app with the 3D room, chat, changes and files.

Session data needs at least one Claude Code session open. Without one, the office still opens but shows the last known state.

## Privacy and security

- The server only listens on `127.0.0.1` and checks the host, origin and a token created at each start.
- Session titles, folders and names are stored in `~/.agent-office`.
- Secret-looking files such as `.env` aren't shown.
- The server reads Claude Code's transcript files in `~/.claude/projects`, and the app's session records to find them. Videos and images an agent shared are streamed through private signed links.
- The plugin adds a short list of session names to each session's system prompt, so you can refer to agents by name. This uses a small number of extra tokens per request.
- The page loads its fonts from Google Fonts. Everything else is local.

## Limits

- Agents' approval requests must still be answered in the Claude app.
- macOS may block the server from folders such as `Documents`. Grant access in System Settings, or keep projects elsewhere.
- This depends on an early-access plugin API and the desktop app's session tools, so an update could break it.

## Uninstall

```bash
./scripts/uninstall.sh
```

Add `--purge` to also delete `~/.agent-office`.
