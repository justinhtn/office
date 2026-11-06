#!/usr/bin/env python3
"""Shows how the office's pages started and ran on each device, from the timelines they send to the Mac.

Each page load is a run. For the latest runs this prints when each step happened, how long since the step before,
flags slow steps, and says which runs ended without a goodbye, as a crash or iOS reloading a tab that ran out of memory does.

    scripts/client-log.py                   the latest three runs on any device
    scripts/client-log.py --device iphone   only runs from a device whose name or id has this in it
    scripts/client-log.py --runs 10 --all   more runs, with every event
"""
import argparse
import json
import os
import statistics
import sys
from datetime import datetime
from pathlib import Path

FOLDER = Path(os.environ.get("AGENT_OFFICE_HOME", Path.home() / ".agent-office")) / "logs" / "client"
# The steps of a start, in the order they should happen. The gap between two of them is how long that step took.
MILESTONES = ("run.start", "page.load", "app.mount", "signin.ready", "sessions.first", "scene.created", "scene.firstFrame", "room.built",
              "overview.drawn", "overview.faces", "mia.ready", "conversation.ready")
PROBLEMS = ("error", "error.rejection", "error.resource", "webgl.lost", "face.failed", "face.unlit", "sessions.failed", "fps.dip", "log.dropped")
SLOW_LOAD_MS = 5000
SLOW_STALL_MS = 500
# Shown only with --all: each has a matching .done line with its time.
QUIET = (".start",)
SHOWN_FIELDS_LIMIT = 6


def read_lines(folder, device_filter):
    runs = {}
    for path in sorted(folder.glob("*.jsonl")):
        with open(path, encoding="utf-8", errors="replace") as handle:
            for text in handle:
                try:
                    line = json.loads(text)
                except ValueError:
                    continue
                if not isinstance(line, dict) or not isinstance(line.get("t"), (int, float)):
                    continue
                if device_filter and device_filter not in f"{line.get('device', '')} {line.get('deviceName', '')}".lower():
                    continue
                runs.setdefault((line.get("device"), line.get("run")), []).append(line)
    for lines in runs.values():
        lines.sort(key=lambda line: line["t"])

    return runs


def started_at(lines):
    """The wall time the page began loading: the server's time for the first line, less the page's own time for it."""
    first = min(lines, key=lambda line: line.get("at", ""))
    try:
        return datetime.fromisoformat(first["at"]).timestamp() - first["t"] / 1000
    except (KeyError, ValueError):
        return 0


def seconds(ms):
    return f"{ms / 1000:.2f}s"


def duration(ms):
    total = int(ms // 1000)
    return f"{total // 60}m {total % 60:02d}s" if total >= 60 else f"{total}s"


def fields(line):
    hidden = {"at", "device", "deviceName", "run", "t", "kind", "userAgent", "lastEvents"}
    shown = [f"{key}={value}" for key, value in line.items() if key not in hidden and value not in (None, "", [], {})]
    extra = len(shown) - SHOWN_FIELDS_LIMIT

    return " ".join(shown[:SHOWN_FIELDS_LIMIT]) + (f" (+{extra} more)" if extra > 0 else "")


def unclean_text(line):
    where = "in the background (iOS may only have put it away)" if line.get("wasHidden") else "while on screen"
    tab = ", then this same tab loaded again" if line.get("sameTab") else ""

    return (f"the run before, {line.get('previousRun')}, ended without a goodbye {where}{tab}. "
            f"It ran {duration(line.get('ranMs') or 0)} and was silent {duration(line.get('silentMs') or 0)}. Its last events:")


def flag(line, gap, slow_ms):
    kind = line["kind"]
    if kind in PROBLEMS or kind.startswith("error"):
        return "!!"
    if kind == "run.unclean":
        return "!!"
    if kind in ("longtask", "stall") and line.get("ms", 0) >= SLOW_STALL_MS:
        return "SLOW"
    if kind.endswith(".done") and (line.get("ms") or 0) >= SLOW_LOAD_MS:
        return "SLOW"
    if kind in MILESTONES and gap is not None and gap >= slow_ms:
        return "SLOW"
    if line.get("failed"):
        return "!!"

    return ""


def ending(lines, reported):
    leaving = [line["kind"] for line in lines if line["kind"] in ("pagehide", "pageshow")]
    if reported:
        where = "in the background (iOS may only have put it away)" if reported.get("wasHidden") else "while on screen"
        tab = ", and the same tab loaded again" if reported.get("sameTab") else ""
        return f"ENDED WITHOUT A GOODBYE {where}{tab}: silent for {duration(reported.get('silentMs', 0))} before the next run noticed"
    # A page restored from the back-forward cache comes back after its goodbye.
    if leaving and leaving[-1] == "pagehide":
        return "said goodbye (page closed or reloaded by the person)"

    return "no goodbye yet: still open, or the next run hasn't loaded"


def summary(lines):
    by_kind = {}
    for line in lines:
        by_kind.setdefault(line["kind"], []).append(line)
    parts = []
    models = by_kind.get("avatar.model.done", [])
    if models:
        parts.append(f"{len(models)} avatar models {sum(line.get('kb') or 0 for line in models)} KB, slowest {seconds(max(line.get('ms') or 0 for line in models))}")
    skins = by_kind.get("avatar.textures.done", [])
    if skins:
        parts.append(f"{len(skins)} texture groups {sum(line.get('kb') or 0 for line in skins)} KB, slowest {seconds(max(line.get('ms') or 0 for line in skins))}")
    faces = len(by_kind.get("face.drawn", []))
    if faces or "face.unlit" in by_kind or "face.failed" in by_kind:
        parts.append(f"faces {faces} drawn, {len(by_kind.get('face.unlit', []))} unlit, {len(by_kind.get('face.failed', []))} failed")
    rates = [line["fps"] for line in by_kind.get("fps", []) + by_kind.get("fps.dip", []) if isinstance(line.get("fps"), (int, float))]
    if rates:
        parts.append(f"fps median {statistics.median(rates):g}, low {min(rates):g}")
    stalls = by_kind.get("stall", []) + by_kind.get("longtask", [])
    if stalls:
        parts.append(f"{len(stalls)} stalls, longest {seconds(max(line.get('ms') or 0 for line in stalls))}")
    errors = sum(len(lines) for kind, lines in by_kind.items() if kind.startswith("error"))
    if errors:
        parts.append(f"{errors} errors")
    if "webgl.lost" in by_kind:
        parts.append(f"WebGL lost {len(by_kind['webgl.lost'])}x")

    return parts


def device_line(lines):
    start = next((line for line in lines if line["kind"] == "run.start"), {})
    scene = next((line for line in lines if line["kind"] == "scene.created"), {})
    parts = [
        "Home Screen app" if start.get("standalone") else "browser tab" if start else "",
        f"{start['screen']} @{start['pixelRatio']}x" if start.get("screen") else "",
        f"opened by {start['navigation']}" if start.get("navigation") else "",
        scene.get("renderer", ""),
        "WebGL2" if scene.get("webgl2") else "WebGL1" if scene else "",
    ]
    agent = start.get("userAgent", "")

    return " · ".join(part for part in parts if part), agent


def print_run(lines, reported, show_all, slow_ms):
    first = lines[0]
    when = datetime.fromtimestamp(started_at(lines)).strftime("%Y-%m-%d %H:%M:%S")
    print(f"━━ {first.get('deviceName')} ({first.get('device')}) · run {first.get('run')} · {when} · {duration(lines[-1]['t'])} of events")
    about, agent = device_line(lines)
    if about:
        print(f"   {about}")
    if agent:
        print(f"   {agent}")
    print(f"   End: {ending(lines, reported)}")
    for part in summary(lines):
        print(f"   · {part}")
    print(f"   {'at':>8} {'+step':>7}  {'':4}  event")
    last_milestone = None
    for line in lines:
        kind = line["kind"]
        gap = None
        if kind in MILESTONES:
            gap = line["t"] - last_milestone if last_milestone is not None else None
            last_milestone = line["t"]
        if not show_all and kind.endswith(QUIET) and kind not in MILESTONES:
            continue
        mark = flag(line, gap, slow_ms)
        step = f"+{seconds(gap)}" if gap is not None else ""
        about = unclean_text(line) if kind == "run.unclean" else fields(line)
        print(f"   {seconds(line['t']):>8} {step:>7}  {mark:4}  {kind:<24} {about}")
        if kind == "run.unclean":
            for earlier in line.get("lastEvents") or []:
                if isinstance(earlier, dict):
                    print(f"   {'':>8} {'':>7}  {'':4}    └ {seconds(earlier.get('t') or 0):>7}  {earlier.get('kind', '?'):<22} {fields(earlier)}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Show how the office's pages started and ran on each device.")
    parser.add_argument("--device", help="only runs from a device whose name or id contains this")
    parser.add_argument("--runs", type=int, default=3, help="how many of the latest runs to show (default 3)")
    parser.add_argument("--all", action="store_true", help="show every event, including each load's start")
    parser.add_argument("--slow", type=float, default=3, help="seconds between steps that count as slow (default 3)")
    parser.add_argument("--folder", type=Path, default=FOLDER, help=argparse.SUPPRESS)
    options = parser.parse_args()
    if not options.folder.is_dir():
        print(f"No timelines yet in {options.folder}. Open the office on a device, then run this again.")
        return 0
    runs = read_lines(options.folder, (options.device or "").lower())
    if not runs:
        print("No runs match." if options.device else "No timelines yet.")
        return 0
    # What later runs said about earlier ones that never said goodbye.
    reports = {}
    for lines in runs.values():
        for line in lines:
            if line["kind"] == "run.unclean" and isinstance(line.get("previousRun"), str):
                reports[(line.get("device"), line["previousRun"])] = line
    latest = sorted(runs.items(), key=lambda item: started_at(item[1]))[-max(1, options.runs):]
    for key, lines in latest:
        print_run(lines, reports.get(key), options.all, options.slow * 1000)

    return 0


if __name__ == "__main__":
    sys.exit(main())
