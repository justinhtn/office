#!/usr/bin/env python3
"""Turns on access to the office from your own devices over Tailscale, and manages them. Run it on the Mac."""
import datetime
import os
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
from remote_access import CODE_S, RemoteAccess  # noqa: E402

ACCESS = RemoteAccess(os.environ.get("AGENT_OFFICE_HOME", Path.home() / ".agent-office"))
RESTART = "launchctl kickstart -k gui/$(id -u)/com.agentoffice.server"
USAGE = """Usage: ipad-access.py COMMAND

  on HOST       Allow this Tailscale name, such as my-mac.tail1234.ts.net
  code          Make a one-time code to sign a device in
  devices       List signed-in devices and Face ID passkeys
  revoke ID     Sign out a device or forget a passkey, or use "all"
  status        Say whether it's on
  off           Turn it off and forget every device"""


def when(stamp):
    return datetime.datetime.fromtimestamp(stamp).strftime("%-d %b %Y")


def main(arguments):
    command = arguments[0] if arguments else ""
    if command == "on" and len(arguments) == 2:
        ACCESS.turn_on(arguments[1])
        print(f"Allowed {arguments[1]}. Next:\n\n  {RESTART}\n  tailscale serve --bg --https=443 http://127.0.0.1:{ACCESS.port()}\n\nUse serve, never funnel, which would make it public.")
    elif command == "code":
        print(f"{ACCESS.new_code()}\n\nEnter it at https://{ACCESS.host()} within {CODE_S // 60} minutes. It works once.")
    elif command == "devices":
        for device_id, device in ACCESS.devices().items():
            seen = f"last used {when(device['lastSeen'])}" if device.get("lastSeen") else "not used yet"
            face_id = f", with Face ID {device['passkey']}" if device.get("passkey") else ""
            print(f"{device_id}  {device['name']}  signed in {when(device['created'])}{face_id}, {seen}, ends {when(device['expires'])}")
        if not ACCESS.devices():
            print("No devices.")
        for passkey_id, passkey in ACCESS.passkeys().items():
            used = f"last used {when(passkey['lastUsed'])}" if passkey.get("lastUsed") else "not used yet"
            print(f"{passkey_id}  Face ID passkey from {passkey['name']}, added {when(passkey['created'])}, {used}")
    elif command == "revoke" and len(arguments) == 2:
        if arguments[1] == "all":
            ACCESS.revoke_all()
            print("Every device is signed out, and every Face ID passkey is forgotten.")
        elif ACCESS.revoke(arguments[1]):
            print("Done. Any Face ID passkey it had is forgotten, and devices that signed in with it are signed out too.")
        else:
            raise ValueError("There's no device or passkey with that ID. Run devices to list them.")
    elif command == "status":
        if ACCESS.host():
            with socket.socket() as probe:
                probe.settimeout(1)
                answering = probe.connect_ex(("127.0.0.1", ACCESS.port())) == 0
            print(f"Allowed for {ACCESS.host()}, on local port {ACCESS.port()}.")
            print("Something is answering on that port. Check the server log if a device can't connect." if answering else f"Nothing is answering on that port. Restart the server:\n\n  {RESTART}")
        else:
            print("Off. The office only answers on this Mac.")
    elif command == "off":
        port_note = "tailscale serve --https=443 off"
        ACCESS.turn_off()
        print(f"Off, and every device and Face ID passkey is forgotten. To remove the Tailscale route too:\n\n  {port_note}\n  {RESTART}")
    else:
        print(USAGE)
        return 2

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except ValueError as problem:
        print(problem, file=sys.stderr)
        sys.exit(1)
