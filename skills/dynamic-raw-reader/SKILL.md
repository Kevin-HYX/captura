---
name: dynamic-raw-reader
description: Use when reading Captura Dynamic raw-first ZIP packages that contain recording.json, raw/events.ndjson, and artifacts/*.png; produce timeline, SOP, iframe/unit, screenshot-nearest, and debug analyses from raw recorder data.
---

# Dynamic Raw Reader

## Overview

This skill reads Captura Dynamic raw-first ZIP files using the current v3 schema only. The package is evidence-first: export stores raw events and screenshot artifacts, while this skill performs interpretation at read time.

Use this skill when the user provides or mentions a Dynamic raw-first recording ZIP, asks whether a flow can be reconstructed, wants a Chinese SOP, or needs debugging of user-operation, dom-change, screen-frame, iframe/unit, or screenshot alignment.

## Quick Start

Run the bundled parser first:

```bash
python workflow-recorder/skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode summary
```

Useful modes:

- `summary`: package health, counts, sessions, units, lines, and event types.
- `timeline`: ordered user-operation, dom-change, and screen-frame events.
- `sop`: Markdown SOP draft from user-operation events; with `--out <dir>` it extracts nearest screenshots.
- `debug`: raw diagnostics, missing artifacts, stale timing, and screenshot gaps.

## Reading Rules

- Treat `raw/events.ndjson` as the source of truth; events must use schema `version: 3`.
- Treat `recording.json` as package metadata only, not derived analysis.
- Do not infer success after submit unless a later raw event or screenshot clearly proves success.
- Bind screenshots by nearest timestamp, not by node id or element id.
- Prefer `event.line` for high-level lanes:
  - `unit`: document and iframe lifecycle.
  - `user-operation`: click, input, change, keydown, and related user actions.
  - `dom-change`: mutation and snapshot facts.
  - `screen-frame`: background screenshot frames.
- Use `unitRef`, `chromeFrameId`, and `unit.kind` to distinguish top document from iframe agents.
- Mark unresolved selector, field value, submit result, or business outcome as unverified.

## Outputs

For an SOP, produce human-facing Chinese Markdown:

- Start with source ZIP, recording window, and page/system context.
- Use one step per meaningful `user-operation`.
- Include target description from locator, label, role, text, and outer HTML when available.
- Attach the nearest screenshot extracted by the script.
- Keep DOM mutations as supporting evidence, not as separate human steps unless they explain visible state changes.

For debugging, report:

- raw event total and line counts.
- unit/frame lifecycle and dynamically joined iframes.
- screen-frame cadence and nearest-image gaps.
- missing artifact bodies referenced by `screen.frame.payload.artifactRef`.
- any raw event that contains `data:image`, which should not happen in raw-first packages.

## Reference

Load `references/raw-schema.md` when the task needs field-level detail or when implementing code against the package format.
