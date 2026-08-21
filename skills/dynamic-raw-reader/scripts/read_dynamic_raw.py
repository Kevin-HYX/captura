#!/usr/bin/env python3
"""Read Ligentia Dynamic raw-first ZIP packages."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


RECORDING_PATH = "recording.json"
EVENTS_PATH = "raw/events.ndjson"
ARTIFACTS_DIR = "artifacts"
PNG_EXTENSION = ".png"
MODE_SUMMARY = "summary"
MODE_TIMELINE = "timeline"
MODE_SOP = "sop"
MODE_DEBUG = "debug"
MODE_UNITS = "units"
MODE_SCREENS = "screens"
DEFAULT_MAX_STEPS = 40
DEFAULT_MAX_TIMELINE_EVENTS = 200
NEAREST_SCREEN_WARN_MS = 1500
SCREEN_TRIGGER_GAP_WARN_MS = 1000
GLOBAL_SEQUENCE_START = 1
SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")
DATA_IMAGE_MARKER = "data:image"
LINE_UNIT = "unit"
LINE_USER_OPERATION = "user-operation"
LINE_DOM_CHANGE = "dom-change"
LINE_SCREEN_FRAME = "screen-frame"
EVENT_TYPE_SCREEN_FRAME = "screen.frame"
UNKNOWN = "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(description="Read a Ligentia Dynamic raw-first ZIP package.")
    parser.add_argument("zip_path", type=Path)
    parser.add_argument("--mode", choices=[MODE_SUMMARY, MODE_TIMELINE, MODE_SOP, MODE_DEBUG, MODE_UNITS, MODE_SCREENS], default=MODE_SUMMARY)
    parser.add_argument("--out", type=Path, default=None, help="Output directory for SOP markdown and extracted screenshots.")
    parser.add_argument("--max-steps", type=int, default=DEFAULT_MAX_STEPS)
    parser.add_argument("--max-events", type=int, default=DEFAULT_MAX_TIMELINE_EVENTS)
    args = parser.parse_args()

    package = read_package(args.zip_path)
    if args.mode == MODE_SUMMARY:
        print(render_summary(package))
    elif args.mode == MODE_TIMELINE:
        print(render_timeline(package, args.max_events))
    elif args.mode == MODE_SOP:
        print(render_sop(package, args.out, args.max_steps))
    elif args.mode == MODE_DEBUG:
        print(render_debug(package))
    elif args.mode == MODE_UNITS:
        print(render_units(package))
    elif args.mode == MODE_SCREENS:
        print(render_screens(package))
    return 0


def read_package(zip_path: Path) -> dict[str, Any]:
    if not zip_path.exists():
        raise FileNotFoundError(zip_path)
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
        recording = read_json_member(archive, RECORDING_PATH) if RECORDING_PATH in names else {}
        raw_events = read_ndjson_member(archive, EVENTS_PATH) if EVENTS_PATH in names else []
        return {
            "zip_path": zip_path,
            "recording": recording,
            "raw_events": raw_events,
            "events": sorted(raw_events, key=event_sort_key),
            "artifact_names": names,
            "archive": archive.filename,
        }


def read_json_member(archive: zipfile.ZipFile, name: str) -> dict[str, Any]:
    return json.loads(archive.read(name).decode("utf-8"))


def read_ndjson_member(archive: zipfile.ZipFile, name: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in archive.read(name).decode("utf-8").splitlines():
        stripped = line.strip()
        if stripped:
            events.append(json.loads(stripped))
    return events


def event_sort_key(event: dict[str, Any]) -> tuple[float, float, float]:
    return (
        event_time_ms(event),
        numeric(event.get("receivedAtEpochMs")),
        numeric(event.get("globalSequence")),
    )


def render_summary(package: dict[str, Any]) -> str:
    events = package["events"]
    lines = Counter(line_of(event) for event in events)
    event_types = Counter(str(event.get("eventType") or UNKNOWN) for event in events)
    units = collect_units(events)
    screen_frames = collect_screen_frames(events)
    output = [
        "# Dynamic Raw Summary",
        "",
        f"Source: {package['zip_path']}",
        f"Raw events: {len(events)}",
        f"Screen frames: {len(screen_frames)}",
        f"Units: {len(units)}",
        "",
        "## Lines",
    ]
    output.extend(f"- {key}: {value}" for key, value in sorted(lines.items()))
    output.append("")
    output.append("## Event Types")
    output.extend(f"- {key}: {value}" for key, value in sorted(event_types.items()))
    output.append("")
    output.append("## Session")
    session = package.get("recording", {}).get("session", {})
    for key in ["sessionId", "generation", "startedAt", "stoppedAt", "durationMs"]:
        output.append(f"- {key}: {session.get(key, '')}")
    return "\n".join(output)


def render_timeline(package: dict[str, Any], max_events: int) -> str:
    rows = ["# Dynamic Raw Timeline", ""]
    for event in package["events"][:max_events]:
        rows.append(format_event_brief(event))
    return "\n".join(rows)


def render_units(package: dict[str, Any]) -> str:
    units = collect_units(package["events"])
    rows = ["# Dynamic Units", ""]
    for unit_ref, facts in sorted(units.items()):
        rows.append(f"## {unit_ref}")
        for fact in facts:
            rows.append(f"- {format_time(fact)} {fact.get('eventType', UNKNOWN)} {unit_kind(fact)}")
        rows.append("")
    return "\n".join(rows)


def render_screens(package: dict[str, Any]) -> str:
    rows = ["# Dynamic Screen Frames", ""]
    for frame in collect_screen_frames(package["events"]):
        payload = frame.get("payload") or {}
        rows.append(
            f"- {format_time(frame)} artifact={payload.get('artifactRef', '')} "
            f"bytes={payload.get('byteLength', '')} viewport={payload.get('viewport', '')}"
        )
    return "\n".join(rows)


def render_sop(package: dict[str, Any], out_dir: Path | None, max_steps: int) -> str:
    events = package["events"]
    actions = [event for event in events if line_of(event) == LINE_USER_OPERATION]
    screens = collect_screen_frames(events)
    image_dir = None
    if out_dir:
        image_dir = out_dir / "images"
        image_dir.mkdir(parents=True, exist_ok=True)
    rows = [
        "# 动态录入 SOP 草稿",
        "",
        f"来源 ZIP：`{package['zip_path']}`",
        "",
        "说明：本 SOP 由 raw-first 录制包在读取时生成；截图按时间最近原则匹配，业务成功状态未被明确证实时会标为未验证。",
        "",
    ]
    with zipfile.ZipFile(package["zip_path"]) as archive:
        for index, action in enumerate(actions[:max_steps], start=1):
            payload = action.get("payload") or {}
            target = payload.get("target") or {}
            nearest = nearest_screen(action, screens)
            rows.append(f"## 步骤 {index}: {operation_label(payload, action)}")
            rows.append("")
            rows.append(f"- 时间：{format_time(action)}")
            rows.append(f"- unitRef：`{action.get('unitRef', '')}`")
            rows.append(f"- 目标：{target_summary(target)}")
            rows.append(f"- locator：`{locator_summary(target)}`")
            rows.append(f"- actionId：`{payload.get('actionNodeId', action.get('eventId', ''))}`")
            if nearest:
                artifact_ref = str((nearest.get("payload") or {}).get("artifactRef") or "")
                image_name = f"step-{index:02d}-{safe_artifact_name(artifact_ref)}{PNG_EXTENSION}"
                archive_path = artifact_path(artifact_ref)
                if image_dir and archive_path in archive.namelist():
                    extract_member(archive, archive_path, image_dir / image_name)
                    rows.append(f"- 截图时间差：{nearest_delta_ms(action, nearest)}ms")
                    rows.append("")
                    rows.append(f"![步骤 {index}](images/{image_name})")
                else:
                    rows.append(f"- 截图：`{archive_path}`，时间差 {nearest_delta_ms(action, nearest)}ms")
            rows.append("")
    markdown = "\n".join(rows)
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "Dynamic-Raw-SOP.md").write_text(markdown, encoding="utf-8")
    return markdown


def render_debug(package: dict[str, Any]) -> str:
    raw_events = package.get("raw_events") or package["events"]
    events = package["events"]
    screen_frames = collect_screen_frames(events)
    artifact_names = package["artifact_names"]
    missing_artifacts = []
    for frame in screen_frames:
        artifact_ref = str((frame.get("payload") or {}).get("artifactRef") or "")
        path = artifact_path(artifact_ref)
        if path not in artifact_names:
            missing_artifacts.append(path)
    data_image_events = [
        str(event.get("eventId") or event.get("id") or UNKNOWN)
        for event in events
        if DATA_IMAGE_MARKER in json.dumps(event, ensure_ascii=False)
    ]
    gaps = screen_gaps(screen_frames)
    sequence_report = global_sequence_report(events)
    time_order_violations = count_time_order_violations(raw_events)
    trigger_gaps = screen_trigger_gaps(events, screen_frames)
    duration_issue = recording_duration_issue(package, events)
    rows = [
        "# Dynamic Raw Debug",
        "",
        f"Missing artifacts: {len(missing_artifacts)}",
        f"Events containing data:image: {len(data_image_events)}",
        f"Screen gaps over {NEAREST_SCREEN_WARN_MS}ms: {len(gaps)}",
        f"Raw file time-order violations: {time_order_violations}",
        f"Global sequence unique: {sequence_report['unique']}",
        f"Global sequence continuous: {sequence_report['continuous']}",
        f"Screen gaps with trigger events over {SCREEN_TRIGGER_GAP_WARN_MS}ms: {len(trigger_gaps)}",
        "",
    ]
    if duration_issue:
        rows.append(f"- duration issue: {duration_issue}")
    rows.extend(f"- missing: `{path}`" for path in missing_artifacts)
    rows.extend(f"- data-image event: `{event_id}`" for event_id in data_image_events)
    rows.extend(f"- screen gap: {gap}ms" for gap in gaps)
    rows.extend(
        f"- trigger screen gap: {gap['fromMs']:.0f}ms -> {gap['toMs']:.0f}ms, gap {gap['gapMs']:.0f}ms, triggers {gap['triggerCount']}"
        for gap in trigger_gaps
    )
    return "\n".join(rows)


def collect_units(events: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    units: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        if line_of(event) == LINE_UNIT:
            units[str(event.get("unitRef") or UNKNOWN)].append(event)
    return units


def collect_screen_frames(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [event for event in events if line_of(event) == LINE_SCREEN_FRAME or event.get("eventType") == EVENT_TYPE_SCREEN_FRAME]


def nearest_screen(event: dict[str, Any], screens: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not screens:
        return None
    event_time = event_time_ms(event)
    return min(screens, key=lambda screen: abs(event_time_ms(screen) - event_time))


def nearest_delta_ms(event: dict[str, Any], screen: dict[str, Any]) -> int:
    return round(abs(event_time_ms(screen) - event_time_ms(event)))


def screen_gaps(screens: list[dict[str, Any]]) -> list[int]:
    ordered = sorted((event_time_ms(screen) for screen in screens))
    return [
        round(right - left)
        for left, right in zip(ordered, ordered[1:])
        if right - left > NEAREST_SCREEN_WARN_MS
    ]


def line_of(event: dict[str, Any]) -> str:
    return str(event.get("line") or UNKNOWN)


def event_time_ms(event: dict[str, Any]) -> float:
    payload = event.get("payload") or {}
    if event.get("eventType") == EVENT_TYPE_SCREEN_FRAME:
        return numeric(payload.get("capturedAtEpochMs") or event.get("sentAtEpochMs"))
    return numeric(event.get("sentAtEpochMs"))


def count_time_order_violations(events: list[dict[str, Any]]) -> int:
    count = 0
    previous: tuple[float, float, float] | None = None
    for event in events:
        current = event_sort_key(event)
        if previous and current < previous:
            count += 1
        previous = current
    return count


def global_sequence_report(events: list[dict[str, Any]]) -> dict[str, bool]:
    sequences = [int(numeric(event.get("globalSequence"))) for event in events if numeric(event.get("globalSequence")) > 0]
    unique = len(set(sequences)) == len(sequences)
    if not sequences:
        return {"unique": unique, "continuous": False}
    expected = list(range(GLOBAL_SEQUENCE_START, max(sequences) + GLOBAL_SEQUENCE_START))
    return {"unique": unique, "continuous": sorted(sequences) == expected}


def screen_trigger_gaps(events: list[dict[str, Any]], screens: list[dict[str, Any]]) -> list[dict[str, float]]:
    screen_times = [event_time_ms(screen) for screen in screens]
    trigger_events = [event for event in events if line_of(event) in {LINE_USER_OPERATION, LINE_DOM_CHANGE}]
    gaps = []
    for left, right in zip(screen_times, screen_times[1:]):
        gap = right - left
        if gap <= SCREEN_TRIGGER_GAP_WARN_MS:
            continue
        trigger_count = sum(1 for event in trigger_events if left < event_time_ms(event) < right)
        if trigger_count:
            gaps.append({"fromMs": left, "toMs": right, "gapMs": gap, "triggerCount": trigger_count})
    return gaps


def recording_duration_issue(package: dict[str, Any], events: list[dict[str, Any]]) -> str:
    duration = numeric((package.get("recording") or {}).get("session", {}).get("durationMs"))
    if duration > 0 or not events:
        return ""
    times = [event_time_ms(event) for event in events if event_time_ms(event) > 0]
    if not times:
        return ""
    return f"manifest durationMs is 0 but raw event time range is {max(times) - min(times):.0f}ms"


def format_time(event: dict[str, Any]) -> str:
    return f"{event_time_ms(event):.0f}ms"


def format_event_brief(event: dict[str, Any]) -> str:
    return (
        f"- {format_time(event)} [{line_of(event)}] {event.get('eventType', UNKNOWN)} "
        f"unit={event.get('unitRef', '')} seq={event.get('globalSequence', '')}"
    )


def unit_kind(event: dict[str, Any]) -> str:
    unit = event.get("unit") or {}
    return str(unit.get("kind") or "")


def operation_label(payload: dict[str, Any], event: dict[str, Any]) -> str:
    return str(payload.get("domEventType") or event.get("eventType") or "用户操作")


def target_summary(target: dict[str, Any]) -> str:
    canonical = target.get("canonicalTarget") or {}
    raw = target.get("rawTarget") or {}
    parts = [
        canonical.get("role"),
        canonical.get("label"),
        canonical.get("text"),
        raw.get("selector"),
    ]
    return " / ".join(str(part) for part in parts if part) or "未识别"


def locator_summary(target: dict[str, Any]) -> str:
    canonical = target.get("canonicalTarget") or {}
    raw = target.get("rawTarget") or {}
    return str(canonical.get("locator") or canonical.get("selector") or raw.get("selector") or "")


def artifact_path(artifact_ref: str) -> str:
    return f"{ARTIFACTS_DIR}/{safe_artifact_name(artifact_ref)}{PNG_EXTENSION}"


def safe_artifact_name(value: str) -> str:
    safe = SAFE_NAME_RE.sub("_", value or "")
    return safe or "artifact"


def extract_member(archive: zipfile.ZipFile, member: str, target: Path) -> None:
    with archive.open(member) as source, target.open("wb") as dest:
        shutil.copyfileobj(source, dest)


def numeric(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"dynamic-raw-reader failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
