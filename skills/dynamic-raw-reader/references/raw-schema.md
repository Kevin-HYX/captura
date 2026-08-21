# Dynamic Raw-First Package Schema

## ZIP Layout

- `recording.json`: package/session metadata and raw counts.
- `raw/events.ndjson`: one JSON object per raw event, sorted by event time.
- `artifacts/<artifactRef>.png`: screenshot artifact bodies referenced by `screen.frame`.

The reader should not require derived files such as `DynamicSummary.md`, `TimelineIndex.json`, `DocumentIndex.json`, action folders, or transition folders.

## Raw Event

```ts
{
  protocol: "captura.raw-event",
  version: 3,
  sessionId: string,
  generation: number,
  eventId: string,
  eventType: string,
  line: "unit" | "user-operation" | "dom-change" | "screen-frame",
  unitRef: "document" | `iframe:${number}`,
  unit: {
    kind: "document" | "iframe",
    unitRef: string,
    chromeFrameId: number,
    tabId: number | null,
    readyState?: string,
    visibilityState?: string,
    viewport?: { width: number, height: number },
    scroll?: { x: number, y: number }
  },
  sentAtEpochMs: number,
  receivedAtEpochMs: number,
  localSequence: number,
  globalSequence: number,
  payload: object
}
```

`raw/events.ndjson` must be sorted by `sentAtEpochMs ASC, receivedAtEpochMs ASC, globalSequence ASC`. For `screen.frame`, use `payload.capturedAtEpochMs` instead of `sentAtEpochMs`.

`globalSequence` is the background bus receive/store sequence. It is retained for audit, delay debugging, and deterministic tie-breaking; it is not the primary timeline order.

## Lines

`unit` records lifecycle facts such as document/iframe join, leave, and navigation-like changes.

`user-operation` records user actions. Its payload should contain action type, trusted flag, target locator/reference data, target outer HTML, context HTML, value metadata, and the original DOM event summary when available.

`dom-change` records mutation and snapshot facts emitted by each document/iframe agent. It is high-volume evidence and should normally support analysis rather than become one SOP step per event.

`screen-frame` is created by the background screenshot line. It is not owned by any specific DOM event. Readers attach it to other events by nearest timestamp.

## Screen Frame Payload

```ts
{
  artifactRef: string,
  captureRequestedAtEpochMs: number,
  captureStartedAtEpochMs: number,
  capturedAtEpochMs: number,
  captureDurationMs: number,
  viewport: { width: number, height: number },
  mimeType: "image/png",
  byteLength: number
}
```

`screen.frame` payload must not include `page.url`, `data:image`, DOM snapshots, or element/node payloads.

## Screenshot Binding

To bind an image to another event:

1. Prefer events in the same session and generation.
2. Sort `screen-frame` events by `payload.capturedAtEpochMs`.
3. Select the frame with minimum absolute time distance from the target event time.
4. Report the time delta when presenting evidence.

Do not claim that a screenshot belongs to an action by id; the binding is temporal evidence only.
