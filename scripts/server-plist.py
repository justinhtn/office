#!/usr/bin/env python3
"""Reads and changes the launchd job that runs the office server. Used by update.sh.

  runs-from PLIST SERVER          Exits 0 if the job runs SERVER (a path to server.py)
  use-python PLIST PYTHON SERVER  Runs SERVER with PYTHON, keeping what follows it. Prints "changed" if it did

The whole argument list is rewritten, so a stray item from an earlier run can't end up as the script.
"""
import os
import plistlib
import sys
from pathlib import Path


def arguments(plist):
    with open(plist, "rb") as handle:
        return plistlib.load(handle).get("ProgramArguments", [])


def use_python(plist, python, server):
    with open(plist, "rb") as handle:
        job = plistlib.load(handle)
    old = job.get("ProgramArguments", [])
    if server not in old:
        raise ValueError(f"The job doesn't run {server}.")
    new = [python, *old[old.index(server):]]
    if new == old:
        return False
    job["ProgramArguments"] = new
    temporary = Path(f"{plist}.{os.getpid()}.tmp")
    with open(temporary, "wb") as handle:
        plistlib.dump(job, handle)
    temporary.replace(plist)

    return True


def main(command):
    if command[:1] == ["runs-from"] and len(command) == 3:
        return 0 if command[2] in arguments(command[1]) else 1
    if command[:1] == ["use-python"] and len(command) == 4:
        if use_python(*command[1:]):
            print("changed")
        return 0
    print(__doc__, file=sys.stderr)

    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, plistlib.InvalidFileException) as problem:
        print(problem, file=sys.stderr)
        sys.exit(1)
