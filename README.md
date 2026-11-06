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

To use another port, run it as `AGENT_OFFICE_PORT=9000 ./scripts/install.sh`. Running the install again keeps that port unless you set another. For `/office` in Claude Code to show that port too, set `AGENT_OFFICE_PORT` where Claude Code runs.

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

She has a short tool list, so she can read what sessions are doing and add to her notebook, but can't otherwise edit files, run commands or message agents. In [Ask Mia](#ask-mia) she can draft a note to a lead, which only goes out when you tap Send. If you've set up Telegram and turn on away mode, she also answers your texts and can attach files. See [Telegram](#telegram). The office announces requests and finished work in her voice once each, stays quiet while you're away, and tells you what's waiting when you return.

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
- Its text doesn't contain something shaped like a private key, a token, or a password in a setting or URL. Source code that declares or sets something named like a token is often refused too, even with no real secret in it.
- It can be searched for those. A file too large to read (over 4 MB) is refused, unless it's an image, PDF, audio or video.
- It's 50 MB or smaller.

These checks recognise common secrets, so they can't promise to catch every one. A secret in an image, an archive or another binary format won't be seen.

To move around the office, drag to rotate, scroll to zoom, and right-drag or Shift-drag to pan. The hand button makes a plain drag pan, and so does holding Space. Shift-scroll pans too, though on some systems only sideways. The buttons at the bottom left zoom, go back to the default view, and set the current view as your default in this browser. Your default stays the same as rooms are added; zooming all the way out still shows the whole office.

On an iPad, tap to open someone, drag with one finger to pan, pinch to zoom, and twist or drag with two fingers to rotate. Add the page to the Home Screen to open it full screen. Touch devices draw at a lower resolution and frame rate to save power. Add `?touch` to the address to try touch mode on a computer.

To see the presentation prototype, add `?present` to the address, or `?present=Name` to choose who presents. A teammate shows "ready for you" and walks you through a fixed excerpt of a report, with each claim marked by a small code check. Your choice is saved only in this browser.

## Your iPad

You can open the office from your own devices over [Tailscale](https://tailscale.com). It's off unless you turn it on. Until then, the office only answers on this Mac.

Install Tailscale on the Mac and the iPad and turn on HTTPS for your tailnet, then run these on the Mac, using your Mac's Tailscale name:

```bash
scripts/ipad-access.py on my-mac.tail1234.ts.net
```

```bash
launchctl kickstart -k gui/$(id -u)/com.agentoffice.server
```

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8795
```

```bash
scripts/ipad-access.py code
```

Open `https://my-mac.tail1234.ts.net` on the iPad and enter the code. It works once and lasts 10 minutes, and five wrong tries end it. A device stays signed in for 30 days. Use `serve`, never `funnel`, which would put the office on the public internet.

If you use the office from a Home Screen icon, sign in from the icon itself: it keeps its own cookies, separate from Safari.

### Face ID

After a code sign-in, the page offers "Use Face ID next time". That saves a passkey for your Mac's Tailscale name in your iCloud Keychain, so it works on your other Apple devices too. Next time, tap "Sign in with Face ID" instead of entering a code. The code always still works.

Face ID needs the office's own Python environment at `~/.agent-office/python`, which `scripts/install.sh` and `scripts/update.sh` set up with the pinned packages in `server/requirements.txt`. Without it, the office works as before with codes only. The Mac keeps only each passkey's public key.

A passkey lasts until you revoke it, unlike a device's 30-day sign-in. Only a device signed in with a code can add one, but a copied sign-in cookie could too, so check `devices` now and then and revoke passkeys you don't recognise.

A signed-in device can do what the office can do on the Mac: read sessions, see their files and media, send messages, and start or stop Telegram Mia. Some buttons, such as opening a session in the Claude app, act on the Mac rather than the iPad.

- See devices: `scripts/ipad-access.py devices`
- Sign one out: `scripts/ipad-access.py revoke ID`, or `revoke all`. Revoking a device also forgets its Face ID passkey and signs out every device that signed in with that passkey. `devices` lists passkeys too, and `revoke` takes a passkey's ID.
- Sign-ins and refused tries go in `~/.agent-office/server.log`, without codes or cookies.
- Turn it all off: `scripts/ipad-access.py off`, which also forgets every passkey, then `tailscale serve --https=443 off`. Sign-in stops working at once.

### Ask Mia

While device access is on, the office keeps a background copy of Mia running for **Ask Mia**: the chat button beside the team list on a phone, or **Ask Mia** in the team list elsewhere. She keeps her own conversation, separate from yours with her in the Claude app and from Telegram Mia, and the last 100 messages are kept in `~/.agent-office/mia-chat`. Her copy can only read the office and her notebook, and draft notes. It's stopped when the server stops, when device access is turned off, and by uninstalling.

When you ask her to pass something to a team lead, she drafts a note, and it appears in the chat with **Send** and **Cancel**. Nothing goes out until you tap Send. The office then sends your exact text, headed as a note from you passed on by Mia, which is information and not approval. Notes that read like approval, or mention merging, deploying, deleting or other risky steps, aren't drafted: approve those in the lead's session in the Claude app.

## Privacy and security

- The server only listens on `127.0.0.1` and checks the host, origin and a token created at each start. [Your iPad](#your-ipad) adds a second loopback port for a proxy, off by default, where every request needs a signed-in device.
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

This also moves `Agent Office.app` to the Trash, if it's still the one the install made. Add `--purge` to also delete `~/.agent-office`.

## License

MIT. See [LICENSE](LICENSE).

The people and animations in `web/public/assets/avatars` are from [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox), also MIT, with textures resized. Its license is in that folder.

The furniture in `web/public/assets/furniture/abo` is from [Amazon Berkeley Objects](https://amazon-berkeley-objects.s3.amazonaws.com/index.html), by Amazon.com, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with textures resized and meshes simplified. The plant, coffee table, fabric and lighting are from [Poly Haven](https://polyhaven.com), CC0. Book titles on the shelves belong to their authors and publishers.
