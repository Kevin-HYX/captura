// Dynamic raw-first ZIP package.
    const rawExport = await buildDynamicRawExport();
    files.push({
      path: DYNAMIC_RAW_PACKAGE_RECORDING_PATH,
      data: encodeText(JSON.stringify(buildDynamicRawRecordingManifest(rawExport.stats, options.metadata || {}), null, 2))
    });
    files.push({
      path: DYNAMIC_RAW_PACKAGE_EVENTS_PATH,
      data: rawExport.eventChunks
    });
    await addDynamicRawArtifactFiles(files, rawExport.screenFrameArtifactRefs);
  }

  async function downloadDynamicRecordingZip(options = {}) {
    await waitForDynamicCaptures();
    await flushDynamicRawScreenFramesForExport();
    await refreshDynamicRawBusPackageCount();
    const rawBusPackageCount = state.dynamic.rawBusPackageCount || 0;
    if (!rawBusPackageCount) {
      return {
        downloaded: false,
        nodeCount: 0,
        rawBusPackageCount: 0
      };
    }
    const files = [];
    await addDynamicExportFiles(files, options);
    const filename = options.filename || `${DYNAMIC_RAW_DOWNLOAD_FILENAME_PREFIX}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    const zipBlob = createZip(files);
    if (options.uploadUrl) {
      const upload = await uploadDynamicRecordingZip(zipBlob, options.uploadUrl, filename);
      return {
        downloaded: false,
        uploaded: true,
        upload,
        filename,
        nodeCount: 0,
        rawBusPackageCount
      };
    }
    await downloadBlob(zipBlob, filename, { saveAs: false, forcePageDownload: true });
    return {
      downloaded: true,
      uploaded: false,
      filename,
      nodeCount: 0,
      rawBusPackageCount
    };
  }

  async function uploadDynamicRecordingZip(zipBlob, uploadUrl, filename) {
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "content-type": "application/zip",
        "x-ligentia-artifact-filename": filename
      },
      body: zipBlob
    });
    if (!response.ok) {
      throw new Error(`Dynamic raw upload failed: HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      return { ok: true };
    }
  }

  async function flushDynamicRawScreenFramesForExport() {
    try {
      await storeMessage("LWR_RAW_SCREEN_FRAMES_FLUSH");
    } catch (error) {
      console.warn("LWR screen frame flush failed", error);
    }
  }

  async function loadRawDynamicEventsForExport() {
    if (!state.dynamic.sessionId) {
      return [];
    }
    try {
      const response = await storeMessage("LWR_RAW_EVENTS_GET", { sessionId: state.dynamic.sessionId, generation: state.dynamic.generation });
      return Array.isArray(response.events) ? response.events : [];
    } catch (error) {
      console.warn("LWR raw bus export load failed", error);
      throw error;
    }
  }

  async function buildDynamicRawExport() {
    const stats = createDynamicRawExportStats();
    const eventChunks = [];
    if (!state.dynamic.sessionId) {
      return { eventChunks, stats, screenFrameArtifactRefs: [] };
    }
    let cursor = null;
    let done = false;
    while (!done) {
      const response = await storeMessage("LWR_RAW_EVENTS_EXPORT_BATCH", {
        sessionId: state.dynamic.sessionId,
        generation: state.dynamic.generation,
        cursor,
        limit: DYNAMIC_RAW_EXPORT_BATCH_LIMIT
      });
      const events = Array.isArray(response.events) ? response.events : [];
      if (events.length) {
        eventChunks.push(encodeText(toNdjson(events)));
        events.forEach((event) => updateDynamicRawExportStats(stats, event));
      }
      cursor = response.cursor || null;
      done = Boolean(response.done) || events.length === 0;
    }
    if (!stats.rawEvents && state.dynamic.rawBusPackageCount) {
      return buildDynamicRawExportFromLegacyEvents(await loadRawDynamicEventsForExport());
    }
    return {
      eventChunks,
      stats,
      screenFrameArtifactRefs: stats.screenFrameArtifactRefs
    };
  }

  function buildDynamicRawExportFromLegacyEvents(events) {
    const stats = createDynamicRawExportStats();
    const rawBusEvents = Array.isArray(events) ? events : [];
    rawBusEvents.forEach((event) => updateDynamicRawExportStats(stats, event));
    return {
      eventChunks: rawBusEvents.length ? [encodeText(toNdjson(rawBusEvents))] : [],
      stats,
      screenFrameArtifactRefs: stats.screenFrameArtifactRefs
    };
  }

  function createDynamicRawExportStats() {
    return {
      rawEvents: 0,
      lineCounts: {},
      eventTypeCounts: {},
      screenFrameArtifactRefs: [],
      screenFrameArtifactRefSet: new Set(),
      firstTimelineEpochMs: 0,
      lastTimelineEpochMs: 0
    };
  }

  function updateDynamicRawExportStats(stats, event) {
    const line = String(event && event.line ? event.line : DYNAMIC_RAW_LINE_UNKNOWN);
    const eventType = String(event && event.eventType ? event.eventType : DYNAMIC_RAW_LINE_UNKNOWN);
    stats.rawEvents += 1;
    stats.lineCounts[line] = (stats.lineCounts[line] || 0) + 1;
    stats.eventTypeCounts[eventType] = (stats.eventTypeCounts[eventType] || 0) + 1;
    const timelineEpochMs = dynamicRawEventTimelineEpochMs(event);
    if (timelineEpochMs > 0) {
      stats.firstTimelineEpochMs = stats.firstTimelineEpochMs ? Math.min(stats.firstTimelineEpochMs, timelineEpochMs) : timelineEpochMs;
      stats.lastTimelineEpochMs = Math.max(stats.lastTimelineEpochMs, timelineEpochMs);
    }
    if (eventType === DYNAMIC_RAW_EVENT_TYPE_SCREEN_FRAME) {
      const artifactRef = String(event && event.payload && event.payload.artifactRef ? event.payload.artifactRef : "").trim();
      if (artifactRef && !stats.screenFrameArtifactRefSet.has(artifactRef)) {
        stats.screenFrameArtifactRefSet.add(artifactRef);
        stats.screenFrameArtifactRefs.push(artifactRef);
      }
    }
  }

  function buildDynamicRawRecordingManifest(stats, metadata = {}) {
    const exportStats = stats || createDynamicRawExportStats();
    return {
      schema: DYNAMIC_RAW_RECORDING_SCHEMA,
      version: DYNAMIC_RAW_RECORDING_VERSION,
      exportedAt: new Date().toISOString(),
      session: {
        sessionId: state.dynamic.sessionId || "",
        generation: state.dynamic.generation || 0,
        startedAt: state.dynamic.startedAt || "",
        stoppedAt: state.dynamic.stoppedAt || "",
        durationMs: computeDynamicRawRecordingDurationMs(exportStats)
      },
      settings: {
        includeStyleChanges: Boolean(state.settings && state.settings.includeStyleChanges)
      },
      devLoop: metadata,
      package: {
        eventsPath: DYNAMIC_RAW_PACKAGE_EVENTS_PATH,
        artifactDirectory: DYNAMIC_RAW_PACKAGE_ARTIFACTS_DIR
      },
      counts: {
        rawEvents: exportStats.rawEvents,
        screenFrames: exportStats.screenFrameArtifactRefs.length,
        lines: exportStats.lineCounts,
        eventTypes: exportStats.eventTypeCounts
      }
    };
  }

  async function addDynamicRawArtifactFiles(files, artifactRefs) {
    for (const artifactRef of artifactRefs || []) {
      const artifact = await loadDynamicArtifactForExport(artifactRef);
      if (!artifact || !artifact.data) {
        continue;
      }
      files.push({
        path: dynamicRawArtifactPath(artifactRef),
        data: dataUrlToBytes(artifact.data)
      });
    }
  }

  function collectDynamicScreenFrameArtifactRefs(rawBusEvents) {
    const seen = new Set();
    const refs = [];
    (Array.isArray(rawBusEvents) ? rawBusEvents : []).forEach((event) => {
      if (!event || event.eventType !== DYNAMIC_RAW_EVENT_TYPE_SCREEN_FRAME) {
        return;
      }
      const artifactRef = String(event.payload && event.payload.artifactRef ? event.payload.artifactRef : "").trim();
      if (!artifactRef || seen.has(artifactRef)) {
        return;
      }
      seen.add(artifactRef);
      refs.push(artifactRef);
    });
    return refs;
  }

  function dynamicRawArtifactPath(artifactRef) {
    return `${DYNAMIC_RAW_PACKAGE_ARTIFACTS_DIR}/${sanitizeDynamicRawArtifactRef(artifactRef)}${DYNAMIC_RAW_ARTIFACT_EXTENSION_PNG}`;
  }

  function sanitizeDynamicRawArtifactRef(artifactRef) {
    const safe = String(artifactRef || "").replace(/[^a-zA-Z0-9._-]/g, "_");
    return safe || DYNAMIC_RAW_ARTIFACT_FALLBACK_NAME;
  }

  function computeDynamicRawRecordingDurationMs(stats) {
    const startedAtEpochMs = Date.parse(state.dynamic.startedAt || "");
    const stoppedAtEpochMs = Date.parse(state.dynamic.stoppedAt || "");
    if (Number.isFinite(startedAtEpochMs) && Number.isFinite(stoppedAtEpochMs) && stoppedAtEpochMs >= startedAtEpochMs) {
      return Math.max(0, Math.round(stoppedAtEpochMs - startedAtEpochMs));
    }
    const firstTimelineEpochMs = Math.max(0, Number(stats && stats.firstTimelineEpochMs) || 0);
    const lastTimelineEpochMs = Math.max(0, Number(stats && stats.lastTimelineEpochMs) || 0);
    if (!firstTimelineEpochMs || !lastTimelineEpochMs || lastTimelineEpochMs < firstTimelineEpochMs) {
      return 0;
    }
    return Math.max(0, Math.round(lastTimelineEpochMs - firstTimelineEpochMs));
  }

  function dynamicRawEventTimelineEpochMs(event) {
    if (!event) {
      return 0;
    }
    if (Number(event.timelineEpochMs) > 0) {
      return Number(event.timelineEpochMs) || 0;
    }
    if (event.eventType === DYNAMIC_RAW_EVENT_TYPE_SCREEN_FRAME && event.payload) {
      return Number(event.payload.capturedAtEpochMs) || Number(event.sentAtEpochMs) || 0;
    }
    return Number(event.sentAtEpochMs) || 0;
  }

  async function addDynamicScreenshotExportFile(files, node, role, path, fallbackDataUrl = "") {
    const descriptor = getDynamicScreenshotArtifactDescriptor(node, role);
    if (descriptor && descriptor.artifactRef) {
      const artifact = await loadDynamicArtifactForExport(descriptor.artifactRef);
      if (artifact && artifact.data) {
        files.push({
          path,
          data: dataUrlToBytes(artifact.data)
        });
        return;
      }
    }
    if (fallbackDataUrl) {
      files.push({
        path,
        data: dataUrlToBytes(fallbackDataUrl)
      });
    }
  }

  function getDynamicScreenshotArtifactDescriptor(node, role) {
    if (!node || !node.screenshotArtifacts) {
      return null;
    }
    const descriptor = node.screenshotArtifacts[role];
    return descriptor && descriptor.artifactRef ? descriptor : null;
  }

  async function loadDynamicArtifactForExport(artifactRef) {
    try {
      const response = await storeMessage("LWR_RAW_ARTIFACT_GET", { artifactRef });
      return response && response.artifact ? response.artifact : null;
    } catch (error) {
      console.warn("LWR dynamic artifact export load failed", error);
      return null;
    }
  }

  function buildDynamicArtifactsIndex() {
    const artifacts = [];
    state.dynamic.nodes.forEach((node) => {
      Object.values(node.screenshotArtifacts || {}).forEach((descriptor) => {
        if (descriptor && descriptor.artifactRef) {
          artifacts.push(descriptor);
        }
      });
    });
    return {
      schema: "captura.dynamic.artifacts-index",
      version: 1,
      artifacts
    };
  }

  function collectDynamicScreenshotArtifacts(rawBusEvents) {
    const artifactsByNode = new Map();
    (Array.isArray(rawBusEvents) ? rawBusEvents : []).forEach((event) => {
      if (!event || event.eventType !== "artifact.ready") {
        return;
      }
      const payload = event.payload || {};
      if (payload.kind !== DYNAMIC_ARTIFACT_KIND_SCREENSHOT || !payload.role || !payload.artifactRef || (!payload.nodeUid && !payload.nodeId)) {
        return;
      }
      const key = dynamicArtifactNodeKey(event.unitRef || "document", payload.nodeId || "", payload.nodeUid || "");
      const byRole = artifactsByNode.get(key) || {};
      byRole[payload.role] = {
        artifactRef: payload.artifactRef,
        kind: payload.kind,
        role: payload.role,
        nodeUid: payload.nodeUid || "",
        nodeId: payload.nodeId,
        originalNodeId: payload.originalNodeId || payload.nodeId || "",
        nodeType: payload.nodeType || "",
        documentLifecycleId: payload.documentLifecycleId || "",
        mimeType: payload.mimeType || DYNAMIC_ARTIFACT_MIME_PNG,
        byteLength: Math.max(0, Number(payload.byteLength) || 0),
        fileName: payload.fileName || "",
        capturedAtMs: Math.max(0, Number(payload.capturedAtMs) || 0),
        capturedAtIso: payload.capturedAtIso || "",
        captureTiming: payload.captureTiming || ""
      };
      artifactsByNode.set(key, byRole);
    });
    return artifactsByNode;
  }

  function dynamicArtifactNodeKey(unitRef, nodeId, nodeUid = "") {
    return nodeUid ? `uid:${nodeUid}` : `legacy:${unitRef || "document"}:${nodeId || ""}`;
  }

  function dynamicExportNodeKey(node) {
    return node && node.nodeUid ? `uid:${node.nodeUid}` : `legacy:${node && node.unitRef ? node.unitRef : "document"}:${node && node.id ? node.id : ""}:${node && node.type ? node.type : ""}`;
  }

  function mergeDynamicScreenshotArtifacts(existing, incoming) {
    return {
      ...(existing && typeof existing === "object" ? existing : {}),
      ...(incoming && typeof incoming === "object" ? incoming : {})
    };
  }

  function buildExportNodesFromRawBus(rawBusEvents, fallbackNodes) {
    const screenshotArtifacts = collectDynamicScreenshotArtifacts(rawBusEvents);
    const candidates = [];
    (Array.isArray(fallbackNodes) ? fallbackNodes : []).forEach((node) => {
      candidates.push({
        node: {
          ...node,
          unitRef: node.unitRef || "document",
          documentUrl: node.documentUrl || node.pageUrl || location.href,
          rawEventRefs: node.rawEventRefs || []
        },
        sort: {
          observedAtMs: Number(node.offsetMs) || 0,
          receivedAtMs: 0,
          globalSequence: Number(node.sequence) || 0
        }
      });
    });

    (Array.isArray(rawBusEvents) ? rawBusEvents : []).forEach((event) => {
      const node = event && event.payload && event.payload.node;
      if (!node || (node.type !== "action" && node.type !== "transition")) {
        return;
      }
      const unitRef = event.unitRef || node.unitRef || "document";
      const nodeUid = node.nodeUid || event.payload.nodeUid || "";
      const screenshotArtifactsForNode = screenshotArtifacts.get(dynamicArtifactNodeKey(unitRef, node.id || "", nodeUid));
      candidates.push({
        node: {
          ...node,
          nodeUid,
          originalNodeId: node.originalNodeId || event.payload.originalNodeId || node.id || "",
          localNodeId: node.localNodeId || node.id || "",
          documentLifecycleId: node.documentLifecycleId || event.payload.documentLifecycleId || "",
          unitRef,
          documentUrl: event.unit && event.unit.url ? event.unit.url : node.pageUrl || "",
          rawEventRefs: [event.eventId || event.id].filter(Boolean),
          localSequenceRange: {
            from: Number(event.localSequence) || 0,
            to: Number(event.localSequence) || 0
          },
          screenshotArtifacts: mergeDynamicScreenshotArtifacts(node.screenshotArtifacts, screenshotArtifactsForNode)
        },
        sort: {
          observedAtMs: Number(event.observedAtMs) || Number(node.offsetMs) || 0,
          receivedAtMs: Number(event.receivedAtMs) || 0,
          globalSequence: Number(event.globalSequence) || 0
        }
      });
    });

    const seen = new Map();
    const deduped = [];
    candidates
      .sort(compareDynamicExportCandidates)
      .forEach((candidate) => {
        const key = dynamicExportNodeKey(candidate.node);
        if (seen.has(key)) {
          const existingIndex = seen.get(key);
          if (dynamicNodeEvidenceScore(candidate.node) > dynamicNodeEvidenceScore(deduped[existingIndex])) {
            deduped[existingIndex] = candidate.node;
          }
          return;
        }
        seen.set(key, deduped.length);
        deduped.push(candidate.node);
      });

    let actionOrder = 0;
    return deduped.map((node, index) => {
      const sequence = index + 1;
      const type = node.type === "action" ? "action" : "transition";
      const id = `${String(sequence).padStart(3, "0")}-${type}`;
      const normalized = {
        ...node,
        originalNodeId: node.originalNodeId || node.id || "",
        localNodeId: node.localNodeId || node.originalNodeId || node.id || "",
        id,
        folder: id,
        sequence,
        unitRef: node.unitRef || "document",
        documentUrl: node.documentUrl || node.pageUrl || "",
        referenceRefs: []
      };
      if (type === "action") {
        actionOrder += 1;
        normalized.targetOrderIndex = actionOrder;
        normalized.referenceRefs = buildDynamicActionReferenceRefs(normalized);
      } else {
        normalized.previousNodeId = sequence > 1 ? `${String(sequence - 1).padStart(3, "0")}-${deduped[index - 1].type === "action" ? "action" : "transition"}` : "";
        normalized.referenceRefs = buildDynamicTransitionReferenceRefs(normalized);
      }
      return normalized;
    });
  }

  function compareDynamicExportCandidates(left, right) {
    if (left.sort.observedAtMs !== right.sort.observedAtMs) {
      return left.sort.observedAtMs - right.sort.observedAtMs;
    }
    if (left.sort.receivedAtMs !== right.sort.receivedAtMs) {
      return left.sort.receivedAtMs - right.sort.receivedAtMs;
    }
    return left.sort.globalSequence - right.sort.globalSequence;
  }

  function dynamicNodeEvidenceScore(node) {
    const screenshots = node && node.screenshots ? node.screenshots : {};
    const screenshotArtifacts = node && node.screenshotArtifacts ? Object.values(node.screenshotArtifacts) : [];
    const rawEventRefs = node && Array.isArray(node.rawEventRefs) ? node.rawEventRefs : [];
    return [
      screenshots.beforeDataUrl,
      screenshots.afterImmediateDataUrl,
      screenshots.currentDataUrl,
      ...screenshotArtifacts.map((descriptor) => descriptor && descriptor.artifactRef),
      ...rawEventRefs,
      node && node.targetHtml,
      node && node.contextHtml
    ].filter(Boolean).length;
  }

  function buildDocumentIndex() {
    const byUnit = new Map();
    const events = Array.isArray(state.dynamic.rawBusEvents) ? state.dynamic.rawBusEvents : [];
    events.forEach((event) => {
      const unitRef = event.unitRef || "document";
      const unit = event.unit || {};
      const existing = byUnit.get(unitRef) || {
        unitRef,
        kind: unitRef === "document" ? "document" : "iframe",
        url: unit.url || unit.senderUrl || "",
        title: unit.title || "",
        chromeFrameId: unit.chromeFrameId,
        parentFrameId: event.parentFrameId || null,
        injectionStatus: "active",
        joinedAtOffsetMs: null,
        leftAtOffsetMs: null,
        eventCount: 0
      };
      existing.eventCount += 1;
      existing.url = existing.url || unit.url || unit.senderUrl || "";
      existing.title = existing.title || unit.title || "";
      if (event.eventType === "document.joined" && existing.joinedAtOffsetMs === null) {
        existing.joinedAtOffsetMs = Number(event.observedAtMs) || 0;
      }
      if (event.eventType === "document.left") {
        existing.leftAtOffsetMs = Number(event.observedAtMs) || 0;
      }
      byUnit.set(unitRef, existing);
    });
    if (!byUnit.has("document")) {
      byUnit.set("document", {
        unitRef: "document",
        kind: "document",
        url: state.dynamic.pageUrl || location.href,
        title: state.dynamic.pageTitle || document.title,
        chromeFrameId: 0,
        parentFrameId: null,
        injectionStatus: "active",
        joinedAtOffsetMs: 0,
        leftAtOffsetMs: null,
        eventCount: 0
      });
    }
    return {
      schema: "captura.dynamic.document-index",
      version: 1,
      documents: Array.from(byUnit.values()).sort((left, right) => {
        if (left.unitRef === "document") return -1;
        if (right.unitRef === "document") return 1;
        return String(left.unitRef).localeCompare(String(right.unitRef));
      })
    };
  }

  function buildDynamicRecorderStateExport() {
    return {
      schema: "captura.dynamic-state",
      version: 1,
      exportedAt: new Date().toISOString(),
      sessionId: state.dynamic.sessionId || "",
      generation: state.dynamic.generation || 0,
      startedAt: state.dynamic.startedAt || "",
      stoppedAt: state.dynamic.stoppedAt || "",
      active: state.dynamic.enabled,
      source: {
        pageUrl: state.dynamic.pageUrl || location.href,
        pageTitle: state.dynamic.pageTitle || document.title
      },
      frameIntervalMs: DYNAMIC_FRAME_INTERVAL_MS,
      rawBusPackageCount: Array.isArray(state.dynamic.rawBusEvents) ? state.dynamic.rawBusEvents.length : 0,
      nodeCount: state.dynamic.nodes.length,
      actionCount: countDynamicActions(state.dynamic.nodes),
      transitionCount: state.dynamic.nodes.filter((node) => node.type === "transition").length,
      targetOrder: state.dynamic.targetOrder || countDynamicActions(state.dynamic.nodes),
      noChangeFrameCount: state.dynamic.noChangeFrameCount || 0,
      nodes: state.dynamic.nodes.map((node) => ({
        id: node.id,
        nodeUid: node.nodeUid || "",
        originalNodeId: node.originalNodeId || "",
        localNodeId: node.localNodeId || "",
        type: node.type,
        folder: node.folder,
        offsetMs: node.offsetMs,
        pageUrl: node.pageUrl,
        pageTitle: node.pageTitle,
        unitRef: node.unitRef || "document",
        documentUrl: node.documentUrl || node.pageUrl || "",
        rawEventRefs: node.rawEventRefs || [],
        summaryPriority: node.type === "transition" ? node.summaryPriority || "medium" : undefined,
        referenceRefs: node.referenceRefs || []
      }))
    };
  }

  function buildDynamicActionJson(action) {
    return {
      id: action.id,
      folder: action.folder,
      nodeUid: action.nodeUid || "",
      originalNodeId: action.originalNodeId || "",
      localNodeId: action.localNodeId || "",
      agentInstanceId: action.agentInstanceId || "",
      documentLifecycleId: action.documentLifecycleId || "",
      nodeType: "action",
      targetOrderIndex: action.targetOrderIndex,
      offsetMs: action.offsetMs,
      startedAt: action.startedAt,
      endedAt: action.endedAt || "",
      durationMs: action.durationMs || 0,
      pageUrl: action.pageUrl,
      pageTitle: action.pageTitle,
      unitRef: action.unitRef || "document",
      documentUrl: action.documentUrl || action.pageUrl || "",
      localSequenceRange: action.localSequenceRange || null,
      rawEventRefs: action.rawEventRefs || [],
      pageContext: action.pageContext,
      operation: action.operation,
      target: action.target,
      rawTarget: action.rawTarget || null,
      canonicalTarget: action.canonicalTarget || null,
      targetNormalization: action.targetNormalization || null,
      screenshotArtifacts: action.screenshotArtifacts || {},
      referenceRefs: action.referenceRefs || []
    };
  }

  function buildDynamicTransitionJson(transition) {
    return {
      id: transition.id,
      folder: transition.folder,
      nodeUid: transition.nodeUid || "",
      originalNodeId: transition.originalNodeId || "",
      localNodeId: transition.localNodeId || "",
      agentInstanceId: transition.agentInstanceId || "",
      documentLifecycleId: transition.documentLifecycleId || "",
      nodeType: "transition",
      offsetMs: transition.offsetMs,
      sampledAt: transition.sampledAt,
      reason: transition.reason,
      pageUrl: transition.pageUrl,
      pageTitle: transition.pageTitle,
      unitRef: transition.unitRef || "document",
      documentUrl: transition.documentUrl || transition.pageUrl || "",
      localSequenceRange: transition.localSequenceRange || null,
      rawEventRefs: transition.rawEventRefs || [],
      previousNodeId: transition.previousNodeId || "",
      noChangeFrameCountBefore: transition.noChangeFrameCountBefore || 0,
      summaryPriority: transition.summaryPriority || "medium",
      changeSignals: transition.changeSignals || [],
      suppressedSignals: transition.suppressedSignals || [],
      reasonCodes: transition.reasonCodes || [],
      summaryBudgetUsed: transition.summaryBudgetUsed || null,
      lowValueReason: transition.lowValueReason || "",
      deltaSummary: transition.deltaSummary,
      changedObjects: transition.changedObjects || [],
      changedRegions: (transition.changedRegions || []).map(({ appendix, ...region }) => region),
      screenshotArtifacts: transition.screenshotArtifacts || {},
      referenceRefs: transition.referenceRefs || []
    };
  }

  function buildTimelineIndex() {
    return {
      schema: "captura.dynamic.timeline-index",
      version: 1,
      frameIntervalMs: DYNAMIC_FRAME_INTERVAL_MS,
      nodeCount: state.dynamic.nodes.length,
      noChangeFrameCount: state.dynamic.noChangeFrameCount || 0,
      lowValueGroups: buildLowValueTransitionGroups(state.dynamic.nodes),
      nodes: state.dynamic.nodes.map((node, index) => ({
        id: node.id,
        type: node.type,
        folder: node.folder,
        offsetMs: node.offsetMs,
        unitRef: node.unitRef || "document",
        documentUrl: node.documentUrl || node.pageUrl || "",
        localSequenceRange: node.localSequenceRange || null,
        rawEventRefs: node.rawEventRefs || [],
        summaryPriority: node.type === "transition" ? node.summaryPriority || "medium" : undefined,
        previousNodeId: index > 0 ? state.dynamic.nodes[index - 1].id : "",
        nextNodeId: index < state.dynamic.nodes.length - 1 ? state.dynamic.nodes[index + 1].id : "",
        targetOrderIndex: node.type === "action" ? node.targetOrderIndex : undefined,
        referenceRefs: node.referenceRefs || []
      }))
    };
  }

  function buildLowValueTransitionGroups(nodes) {
    const groups = [];
    let index = 0;
    while (index < nodes.length) {
      const node = nodes[index];
      if (!isLowValueTransition(node)) {
        index += 1;
        continue;
      }
      const start = index;
      const reasonCodes = [];
      while (index < nodes.length && isLowValueTransition(nodes[index])) {
        reasonCodes.push(...(nodes[index].reasonCodes || []), nodes[index].lowValueReason || "");
        index += 1;
      }
      const end = index - 1;
      groups.push({
        fromNodeId: nodes[start].id,
        toNodeId: nodes[end].id,
        count: end - start + 1,
        reasonCodes: uniqueStrings(reasonCodes).filter(Boolean).slice(0, DYNAMIC_SUMMARY_MAX_SIGNAL_ITEMS)
      });
    }
    return groups;
  }

  function isLowValueTransition(node) {
    return Boolean(node && node.type === "transition" && (node.summaryPriority || "medium") === "low");
  }

  function buildActionTargetIndex() {
    const possiblySameByActionId = buildPossiblySameActionTargetIndex(state.dynamic.nodes);
    const targets = state.dynamic.nodes
      .filter((node) => node.type === "action")
      .map((action) => ({
        targetOrderIndex: action.targetOrderIndex,
        actionId: action.id,
        nodeUid: action.nodeUid || "",
        originalNodeId: action.originalNodeId || "",
        localNodeId: action.localNodeId || "",
        kind: action.canonicalTarget && action.canonicalTarget.kind ? action.canonicalTarget.kind : action.target && action.target.kind ? action.target.kind : "",
        identitySummary: summarizeTargetIdentity(action.canonicalTarget && action.canonicalTarget.identity ? action.canonicalTarget.identity : action.target && action.target.identity ? action.target.identity : {}),
        matchedSignals: action.canonicalTarget && action.canonicalTarget.matchedSignals ? action.canonicalTarget.matchedSignals : action.target && action.target.matchedSignals ? action.target.matchedSignals : [],
        missingSignals: action.canonicalTarget && action.canonicalTarget.missingSignals ? action.canonicalTarget.missingSignals : action.target && action.target.missingSignals ? action.target.missingSignals : [],
        canonicalSelector: action.canonicalTarget && action.canonicalTarget.selector ? action.canonicalTarget.selector : "",
        rawSelector: action.rawTarget && action.rawTarget.selector ? action.rawTarget.selector : "",
        targetNormalization: action.targetNormalization || null,
        possiblySameAs: possiblySameByActionId.get(action.id) || [],
        folder: action.folder
      }));
    return {
      schema: "captura.dynamic.action-target-index",
      version: 1,
      targets
    };
  }

  function buildPossiblySameActionTargetIndex(nodes) {
    const signalIndex = new Map();
    const byActionId = new Map();
    (Array.isArray(nodes) ? nodes : []).forEach((node) => {
      if (!node || node.type !== "action") {
        return;
      }
      const signals = dynamicActionIdentitySignals(node);
      const matchesByActionId = new Map();
      signals.forEach((signal) => {
        const previousEntries = signalIndex.get(signal.key) || [];
        previousEntries.forEach((entry) => {
          addPossiblySameCandidate(matchesByActionId, entry, signal.matchedSignal);
        });
      });
      const matches = Array.from(matchesByActionId.values())
        .filter((match) => match.matchedSignals.length >= DYNAMIC_POSSIBLY_SAME_TARGET_MIN_SIGNALS)
        .sort((left, right) => left.targetOrderIndex - right.targetOrderIndex);
      byActionId.set(node.id, matches);
      signals.forEach((signal) => {
        const entries = signalIndex.get(signal.key) || [];
        entries.push({
          actionId: node.id,
          targetOrderIndex: node.targetOrderIndex,
          matchedSignal: signal.matchedSignal
        });
        signalIndex.set(signal.key, entries);
      });
    });
    return byActionId;
  }

  function dynamicActionIdentitySignals(action) {
    const identity = action && action.target && action.target.identity ? action.target.identity : {};
    return [
      identity.text ? { key: `text:${identity.text}`, matchedSignal: "same-text" } : null,
      identity.label ? { key: `label:${identity.label}`, matchedSignal: "same-label" } : null,
      identity.role ? { key: `role:${identity.role}`, matchedSignal: "same-role" } : null
    ].filter(Boolean);
  }

  function addPossiblySameCandidate(matchesByActionId, entry, matchedSignal) {
    if (!entry || !entry.actionId) {
      return;
    }
    const match = matchesByActionId.get(entry.actionId) || {
      targetOrderIndex: entry.targetOrderIndex,
      matchedSignals: []
    };
    if (!match.matchedSignals.includes(matchedSignal)) {
      match.matchedSignals.push(matchedSignal);
    }
    matchesByActionId.set(entry.actionId, match);
  }

  function buildObjectIndex() {
    const objects = [];
    state.dynamic.nodes.forEach((node) => {
      if (node.type === "action" && node.target) {
        objects.push({
          nodeId: node.id,
          nodeUid: node.nodeUid || "",
          originalNodeId: node.originalNodeId || "",
          folder: node.folder,
          source: "action.target",
          kind: node.target.kind,
          matchedSignals: node.target.matchedSignals || [],
          missingSignals: node.target.missingSignals || []
        });
      }
      if (node.type === "transition") {
        (node.changedObjects || []).forEach((candidate) => {
          objects.push({
            nodeId: node.id,
            nodeUid: node.nodeUid || "",
            originalNodeId: node.originalNodeId || "",
            folder: node.folder,
            source: "transition.changedObjects",
            kind: candidate.kind,
            matchedSignals: candidate.matchedSignals || [],
            missingSignals: candidate.missingSignals || []
          });
        });
      }
    });
    return {
      schema: "captura.dynamic.object-index",
      version: 1,
      objects
    };
  }

  function buildReferenceMap() {
    const map = {};
    state.dynamic.nodes.forEach((node) => {
      const folder = node.folder || node.id;
      if (node.type === "action") {
        const target = node.canonicalTarget || node.target || {};
        map[`${node.id}.target`] = {
          summary: `${node.id} user ${node.operation && node.operation.type ? node.operation.type : "action"} ${target.kind || ""}`.trim(),
          files: [`${folder}/action.json`, `${folder}/target.html`, `${folder}/context.html`, `${folder}/appendix.json`, `${folder}/raw-events.ndjson`],
          screenshots: dynamicScreenshotPaths(node)
        };
        return;
      }
      map[`${node.id}.delta`] = {
        summary: `${node.id} transition frame delta (${node.summaryPriority || "medium"})`,
        files: [`${folder}/transition.json`, `${folder}/delta.json`, `${folder}/region-digest.json`, `${folder}/mutations.ndjson`],
        screenshots: dynamicScreenshotPaths(node)
      };
    });
    return map;
  }

  function dynamicScreenshotPaths(node) {
    const folder = node.folder || node.id;
    if (node.type === "action") {
      const paths = [];
      if (hasDynamicScreenshotEvidence(node, DYNAMIC_SCREENSHOT_ROLE_BEFORE, "beforeDataUrl")) paths.push(`${folder}/${DYNAMIC_SCREENSHOT_FILE_BEFORE}`);
      if (hasDynamicScreenshotEvidence(node, DYNAMIC_SCREENSHOT_ROLE_AFTER_IMMEDIATE, "afterImmediateDataUrl")) paths.push(`${folder}/${DYNAMIC_SCREENSHOT_FILE_AFTER_IMMEDIATE}`);
      return paths;
    }
    return hasDynamicScreenshotEvidence(node, DYNAMIC_SCREENSHOT_ROLE_TRANSITION, "currentDataUrl") ? [`${folder}/${DYNAMIC_SCREENSHOT_FILE_TRANSITION}`] : [];
  }

  function hasDynamicScreenshotEvidence(node, role, legacyField) {
    return Boolean(
      getDynamicScreenshotArtifactDescriptor(node, role)
      || (node && node.screenshots && node.screenshots[legacyField])
    );
  }

  function buildDynamicSessionMeta() {
    return {
      schema: "captura.dynamic.session-meta",
      version: 1,
      sessionId: state.dynamic.sessionId || "",
      startedAt: state.dynamic.startedAt || "",
      stoppedAt: state.dynamic.stoppedAt || "",
      exportedAt: new Date().toISOString(),
      pageUrl: state.dynamic.pageUrl || location.href,
      pageTitle: state.dynamic.pageTitle || document.title,
      frameIntervalMs: DYNAMIC_FRAME_INTERVAL_MS,
      documentCount: buildDocumentIndex().documents.length
    };
  }

  function buildDynamicSummary() {
    const lines = [
      "# Dynamic Motion Summary",
      "",
      `Generated at: ${formatShanghaiTime(new Date())}`,
      `Session id: ${state.dynamic.sessionId || ""}`,
      `Generation: ${state.dynamic.generation || 0}`,
      `Node total: ${state.dynamic.nodes.length}`,
      `Action total: ${countDynamicActions(state.dynamic.nodes)}`,
      `Transition total: ${state.dynamic.nodes.filter((node) => node.type === "transition").length}`,
      `Raw bus package total: ${Array.isArray(state.dynamic.rawBusEvents) ? state.dynamic.rawBusEvents.length : 0}`,
      `Document total: ${buildDocumentIndex().documents.length}`,
      `Frame interval: ${DYNAMIC_FRAME_INTERVAL_MS}ms`,
      "",
      "## Timeline",
      ""
    ];

    if (state.dynamic.nodes.length === 0 && Array.isArray(state.dynamic.rawBusEvents) && state.dynamic.rawBusEvents.length > 0) {
      lines.push("No action/transition timeline nodes were formed from the raw bus packages.");
      lines.push("Raw evidence is preserved in `raw/bus-events.ndjson`, `DocumentIndex.json`, and `DynamicRecorderState.json`.");
      lines.push("");
    }

    for (let index = 0; index < state.dynamic.nodes.length; index += 1) {
      const node = state.dynamic.nodes[index];
      if (isLowValueTransition(node)) {
        const group = collectLowValueSummaryGroup(state.dynamic.nodes, index);
        appendLowValueTransitionGroupSummary(lines, group);
        index = group.endIndex;
        continue;
      }
      lines.push(`### ${node.id} +${Math.round(node.offsetMs || 0)}ms`);
      lines.push(`- document: ${node.unitRef || "document"} ${node.documentUrl ? `\`${truncateSummaryText(node.documentUrl, 120)}\`` : ""}`.trim());
      if (node.type === "action") {
        const target = node.canonicalTarget || node.target || {};
        const identity = target.identity || {};
        const operation = node.operation || {};
        const stateBefore = node.target && node.target.stateBefore ? node.target.stateBefore : target.state || {};
        lines.push(`User ${operation.type || "acted"} on targetOrderIndex ${node.targetOrderIndex}.`);
        lines.push(`- target: ${target.kind || ""}${formatIdentitySummary(identity)}`);
        lines.push(`- before: visible ${booleanText(stateBefore.visible)}, enabled ${booleanText(stateBefore.enabled)}, editable ${booleanText(stateBefore.editable)}`);
        if (operation.key) lines.push(`- key: ${operation.key}`);
        if (operation.method) lines.push(`- method: ${operation.method}`);
        if (operation.editKind) lines.push(`- edit kind: ${operation.editKind}`);
        if (operation.commitSignal) lines.push(`- commit signal: ${operation.commitSignal}`);
        if (operation.valueAfter && !operation.redacted) lines.push(`- value after: ${truncateSummaryText(operation.valueAfter)}`);
        if (operation.redacted) lines.push("- value: redacted");
        if (target.matchedSignals && target.matchedSignals.length) {
          lines.push(`- matched signals: ${formatSummarySignals(target.matchedSignals)}`);
        }
        if (target.missingSignals && target.missingSignals.length) {
          lines.push(`- missing signals: ${formatSummarySignals(target.missingSignals)}`);
        }
        if (node.targetNormalization && node.targetNormalization.rawSelector && node.targetNormalization.canonicalSelector && node.targetNormalization.rawSelector !== node.targetNormalization.canonicalSelector) {
          lines.push(`- normalized target: raw \`${truncateSummaryText(node.targetNormalization.rawSelector, 90)}\` -> canonical \`${truncateSummaryText(node.targetNormalization.canonicalSelector, 90)}\``);
        }
        lines.push(`- reference: \`${node.folder}/action.json\``);
        appendSummaryImages(lines, node);
        lines.push("");
        continue;
      }

      appendTransitionSummary(lines, node);
      lines.push(`- reference: \`${node.folder}/transition.json\``);
      lines.push("");
    }

    return `${lines.join("\n")}\n`;
  }

  function appendTransitionSummary(lines, node) {
    const summary = node.deltaSummary || {};
    const priority = node.summaryPriority || "medium";
    lines.push(`- priority: ${priority}`);
    if (node.changeSignals && node.changeSignals.length) lines.push(`- change signals: ${formatSummarySignals(node.changeSignals)}`);
    if (node.suppressedSignals && node.suppressedSignals.length) lines.push(`- suppressed signals: ${formatSummarySignals(node.suppressedSignals)}`);
    if (priority === "medium") {
      const compact = compactTransitionSummaryText(node);
      if (compact) lines.push(`- summary: ${compact}`);
      if (node.noChangeFrameCountBefore) lines.push(`- previous no-change frames: ${node.noChangeFrameCountBefore}`);
      return;
    }
    if (summary.urlChanged) lines.push(`- URL changed: ${truncateSummaryText(summary.urlChanged.from || "", 90)} -> ${truncateSummaryText(summary.urlChanged.to || "", 90)}`);
    if (summary.titleChanged) lines.push(`- title changed: ${truncateSummaryText(summary.titleChanged.from || "")} -> ${truncateSummaryText(summary.titleChanged.to || "")}`);
    appendSummaryList(lines, "visible text added", summary.visibleTextAdded, node.folder, "delta.json");
    appendSummaryList(lines, "visible text removed", summary.visibleTextRemoved, node.folder, "delta.json");
    appendSummaryList(lines, "interactive added", summary.interactiveAdded, node.folder, "delta.json");
    appendSummaryList(lines, "interactive removed", summary.interactiveRemoved, node.folder, "delta.json");
    if (node.changedObjects && node.changedObjects.length) {
      lines.push(`- changed objects: ${node.changedObjects.slice(0, DYNAMIC_SUMMARY_MAX_ITEMS).map(formatChangedObjectSummary).join("; ")}${node.changedObjects.length > DYNAMIC_SUMMARY_MAX_ITEMS ? `; ${node.changedObjects.length - DYNAMIC_SUMMARY_MAX_ITEMS} more in \`${node.folder}/transition.json\`` : ""}`);
    }
    if (node.changedRegions && node.changedRegions.length) {
      lines.push(`- changed regions: ${node.changedRegions.slice(0, DYNAMIC_SUMMARY_MAX_ITEMS).map(formatChangedRegionSummary).join("; ")}${node.changedRegions.length > DYNAMIC_SUMMARY_MAX_ITEMS ? `; ${node.changedRegions.length - DYNAMIC_SUMMARY_MAX_ITEMS} more in \`${node.folder}/region-digest.json\`` : ""}`);
    }
    if (node.noChangeFrameCountBefore) lines.push(`- previous no-change frames: ${node.noChangeFrameCountBefore}`);
    appendSummaryImages(lines, node);
  }

  function appendSummaryImages(lines, node) {
    const paths = dynamicSummaryImagePaths(node);
    paths.forEach((item) => {
      lines.push(`- image: ![${item.alt}](${item.path})`);
    });
  }

  function dynamicSummaryImagePaths(node) {
    const folder = node.folder || node.id;
    if (node.type === "action") {
      const paths = [];
      if (hasDynamicScreenshotEvidence(node, DYNAMIC_SCREENSHOT_ROLE_BEFORE, "beforeDataUrl")) {
        paths.push({ alt: `${node.id} before screenshot`, path: `${folder}/${DYNAMIC_SCREENSHOT_FILE_BEFORE}` });
      }
      if (hasDynamicScreenshotEvidence(node, DYNAMIC_SCREENSHOT_ROLE_AFTER_IMMEDIATE, "afterImmediateDataUrl")) {
        paths.push({ alt: `${node.id} after immediate screenshot`, path: `${folder}/${DYNAMIC_SCREENSHOT_FILE_AFTER_IMMEDIATE}` });
      }
      return paths;
    }
    if ((node.summaryPriority || "medium") === "high" && hasDynamicScreenshotEvidence(node, DYNAMIC_SCREENSHOT_ROLE_TRANSITION, "currentDataUrl")) {
      return [{ alt: `${node.id} transition screenshot`, path: `${folder}/${DYNAMIC_SCREENSHOT_FILE_TRANSITION}` }];
    }
    return [];
  }

  function compactTransitionSummaryText(node) {
    const summary = node.deltaSummary || {};
    const parts = [];
    if (summary.urlChanged) parts.push("URL changed");
    if (summary.titleChanged) parts.push("title changed");
    if (summary.visibleTextAdded && summary.visibleTextAdded.length) parts.push(`${summary.visibleTextAdded.length} text added`);
    if (summary.visibleTextRemoved && summary.visibleTextRemoved.length) parts.push(`${summary.visibleTextRemoved.length} text removed`);
    if (summary.interactiveAdded && summary.interactiveAdded.length) parts.push(`${summary.interactiveAdded.length} interactive added`);
    if (summary.interactiveRemoved && summary.interactiveRemoved.length) parts.push(`${summary.interactiveRemoved.length} interactive removed`);
    if (node.changedObjects && node.changedObjects.length) parts.push(`objects ${node.changedObjects.map((item) => item.kind).slice(0, DYNAMIC_SUMMARY_MAX_ITEMS).join(", ")}`);
    if (node.changedRegions && node.changedRegions.length) parts.push(`${node.changedRegions.length} changed regions`);
    return parts.join("; ");
  }

  function collectLowValueSummaryGroup(nodes, startIndex) {
    let endIndex = startIndex;
    const reasonCodes = [];
    const suppressedSignals = [];
    while (endIndex + 1 < nodes.length && isLowValueTransition(nodes[endIndex + 1])) {
      endIndex += 1;
    }
    for (let index = startIndex; index <= endIndex; index += 1) {
      reasonCodes.push(...(nodes[index].reasonCodes || []), nodes[index].lowValueReason || "");
      suppressedSignals.push(...(nodes[index].suppressedSignals || []));
    }
    return {
      startIndex,
      endIndex,
      first: nodes[startIndex],
      last: nodes[endIndex],
      reasonCodes: uniqueStrings(reasonCodes).filter(Boolean),
      suppressedSignals: uniqueStrings(suppressedSignals).filter(Boolean)
    };
  }

  function appendLowValueTransitionGroupSummary(lines, group) {
    const first = group.first;
    const last = group.last;
    const count = group.endIndex - group.startIndex + 1;
    const heading = count === 1
      ? `### ${first.id} +${Math.round(first.offsetMs || 0)}ms`
      : `### ${first.id}..${last.id} +${Math.round(first.offsetMs || 0)}ms..+${Math.round(last.offsetMs || 0)}ms`;
    lines.push(heading);
    lines.push(`- priority: low`);
    lines.push(`- low-value transition frames: ${count}`);
    if (group.reasonCodes.length) lines.push(`- reason codes: ${formatSummarySignals(group.reasonCodes)}`);
    if (group.suppressedSignals.length) lines.push(`- suppressed signals: ${formatSummarySignals(group.suppressedSignals)}`);
    if (count === 1) {
      lines.push(`- reference: \`${first.folder}/transition.json\``);
    } else {
      lines.push(`- references: \`${first.folder}/transition.json\` .. \`${last.folder}/transition.json\``);
    }
    lines.push("");
  }

  function appendSummaryList(lines, label, values, folder, referenceFile) {
    const list = Array.isArray(values) ? values : [];
    if (!list.length) return;
    const shown = list.slice(0, DYNAMIC_SUMMARY_MAX_ITEMS).map((text) => `\`${truncateSummaryText(text)}\``);
    const omitted = Math.max(0, list.length - DYNAMIC_SUMMARY_MAX_ITEMS);
    const truncated = list.slice(0, DYNAMIC_SUMMARY_MAX_ITEMS).filter((text) => String(text || "").length > DYNAMIC_SUMMARY_MAX_TEXT_LENGTH).length;
    const suffix = omitted || truncated ? ` (${omitted ? `${omitted} more` : ""}${omitted && truncated ? ", " : ""}${truncated ? `${truncated} truncated` : ""} in \`${folder}/${referenceFile}\`)` : "";
    lines.push(`- ${label}: ${shown.join(", ")}${suffix}`);
  }

  function truncateSummaryText(value, maxLength = DYNAMIC_SUMMARY_MAX_TEXT_LENGTH) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
  }

  function formatSummarySignals(signals) {
    const normalized = uniqueStrings(signals || []).slice(0, DYNAMIC_SUMMARY_MAX_SIGNAL_ITEMS);
    const omitted = Math.max(0, (signals || []).length - normalized.length);
    return `${normalized.map((signal) => `\`${truncateSummaryText(signal, 80)}\``).join(", ")}${omitted ? `, ${omitted} more` : ""}`;
  }

  function formatChangedObjectSummary(candidate) {
    const signals = candidate.matchedSignals && candidate.matchedSignals.length ? `: ${(candidate.matchedSignals || []).slice(0, 2).join(", ")}` : "";
    return `${candidate.kind}${signals}`;
  }

  function formatChangedRegionSummary(region) {
    return `${region.regionId} ${region.changePattern || "change"} at ${truncateSummaryText(region.selectorCandidate || "", 90)}`.trim();
  }

  function summarizeTargetIdentity(identity) {
    return [identity.role, identity.label, identity.text, identity.name].filter(Boolean).join(" ").trim();
  }

  function formatIdentitySummary(identity) {
    const parts = [];
    if (identity.role) parts.push(`role \`${identity.role}\``);
    if (identity.label) parts.push(`label \`${identity.label}\``);
    if (identity.text) parts.push(`text \`${identity.text}\``);
    if (identity.locatorHint) parts.push(`locator \`${identity.locatorHint}\``);
    return parts.length ? `, ${parts.join(", ")}` : "";
  }

  function toNdjson(items) {
    if (!items || !items.length) {
      return "";
    }
    let output = "";
    items.forEach((item) => {
      output += `${JSON.stringify(item)}\n`;
    });
    return output;
  }

  function booleanText(value) {
