# Captura

Capture human web workflows as evidence packages. A Chrome/Edge extension that observes and records — no automation, no replay, just evidence.

## What it does

Captura lets you annotate and record real browser workflows on any web page, then export everything as a self-contained ZIP evidence package: screenshots, DOM snapshots, selectors, raw events, and AI-ready summaries.

**Static Annotation** — click and annotate page elements, define fields, export structured evidence with screenshots and DOM context.

**Dynamic Recording** — record live user actions (clicks, inputs, navigation) as a timeline of action + transition nodes with automatic screenshots.

## Quick Start

### Load the extension

1. Open Chrome or Edge extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. Enable Developer mode.
3. Load unpacked:
   - Dev: `dist/recorder-dev/`
   - Prod: `dist/recorder-prod/`
4. Open any web page you want to capture.

### Build

```powershell
npm run build:recorder:dev
npm run build:recorder:prod
npm run build:recorder
```

### Dev with hot reload

```powershell
npm run dev:recorder
```

Watches `src/` and `extension/`, auto-rebuilds `dist/recorder-dev/`, and serves a hot-reload manifest at `http://127.0.0.1:8792/captura-dev-manifest.json`.

## Usage

### Static Annotation

- Click the Captura icon in the top-right corner to start.
- `Ctrl+M` toggles annotation mode.
- Click page elements to annotate them; drag to annotate regions.
- Type `@` to insert field references in annotation text.
- `Ctrl+Enter` saves the annotation.
- Annotations sync across iframes and sub-frames on the same page.
- Export as ZIP, import to restore previous sessions.

### Dynamic Recording

- Click **Dynamic Record** from the toolbar.
- A mini recording capsule appears — interact with the page normally.
- Records every action (click, input, navigation) and DOM transition.
- Click **Stop** to download the Dynamic ZIP with full timeline.

### Export structure

**Static ZIP:**

```
StaticSummary.md
AnnotationIndex.json
FieldReferenceIndex.json
PageIndex.json
ReferenceMap.json
pages/page-001/{page.json, dom.html, screenshot.png}
Annotation1/{annotation.json, target.html, context.html, screenshot.png}
```

**Dynamic ZIP:**

```
DynamicSummary.md
TimelineIndex.json
ActionTargetIndex.json
ObjectIndex.json
ReferenceMap.json
001-action/{action.json, target.html, screenshot-before.png, ...}
002-transition/{transition.json, delta.json, screenshot.png, ...}
raw/{events.ndjson, mutations.ndjson, session-meta.json}
```

## Reading Evidence Packages

The `dynamic-raw-reader` skill provides a Python parser for Dynamic ZIP files:

```powershell
python skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode summary
python skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode timeline
python skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode sop --out <dir>
python skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode debug
```

## Architecture

Content runtime is aspect-split under `src/content/aspects/`:

| File | Responsibility |
|------|---------------|
| `00-bootstrap-ui.ts` | Bootstrap, shared state, toolbar UI, page events |
| `10-dynamic-lifecycle.ts` | Dynamic recording lifecycle, persistence, screenshots |
| `20-dynamic-digest.ts` | Object profiles, frame deltas, transition grading |
| `30-static-workspace.ts` | Static annotation workspace, fields, import/export |
| `40-static-export.ts` | Static ZIP export, summary, indexes |
| `50-dynamic-export.ts` | Dynamic ZIP export, timeline, object indexes |
| `60-common-dom-zip.ts` | DOM, selectors, ZIP, download utilities |
| `95-dev-hot-reload.ts` | Dev hot-reload probe |
| `99-footer.ts` | Footer module |

## Privacy

Captura only captures visible page screenshots, current DOM, and user annotations. It does not read cookies, localStorage, sessionStorage, request headers, tokens, passwords, or browser profiles.

## License

MIT