// Dynamic recording lifecycle, persistence, event segmentation, screenshots, and mutation observer.
  function createEmptyDynamicState() {
    return {
      enabled: false,
      sessionId: "",
      generation: 0,
      agentInstanceId: dynamicAgentInstanceId,
      documentLifecycleId: dynamicDocumentLifecycleId,
      startedAt: "",
      stoppedAt: "",
      pageUrl: "",
      pageTitle: "",
      sequence: 0,
      nodes: [],
      currentInput: null,
      mutationObserver: null,
      frameTimer: null,
      pendingPaste: false,
      compositionActive: false,
      elapsedTimer: null,
      persistTimer: null,
      targetOrder: 0,
      pendingMutations: [],
      rawEvents: [],
      rawMutations: [],
      rawBusEvents: [],
      rawBusPackageCount: 0,
      rawBusPackageCountPending: false,
      lastFrameSnapshot: null,
      noChangeFrameCount: 0,
      pendingCaptures: []
    };
  }

  async function toggleDynamicRecording() {
    if (state.dynamic.enabled) {
      await stopDynamicRecording("manual-stop");
      return;
    }
    await startDynamicRecording();
  }

  async function startDynamicRecording(options = {}) {
    if (isTopDocument) {
      setAnnotationMode(false);
      state.toolbarExpanded = true;
      dockToolbarToNearestSide();
    }
    const response = isTopDocument ? await storeMessage("LWR_DYNAMIC_SESSION_START") : await storeMessage("LWR_DYNAMIC_SESSION_GET");
    const session = response.session;
    if (!session || !session.active) {
      return;
    }
    startDynamicAgentForSession(session, "dynamic-start");
    if (isTopDocument) {
      showInlineNotice("动态录入已开始。请正常操作页面。");
    }
    if (options && options.metadata) {
      state.dynamic.devLoopMetadata = options.metadata;
    }
  }

  function startDynamicAgentForSession(session, reason) {
    const now = new Date();
    const nextGeneration = Math.max(0, Number(session.generation) || 0);
    const isNewSession = state.dynamic.sessionId !== session.sessionId || Number(state.dynamic.generation) !== nextGeneration;
    if (isNewSession) {
      const currentTimers = {
        elapsedTimer: state.dynamic.elapsedTimer,
        persistTimer: state.dynamic.persistTimer
      };
      state.dynamic = createEmptyDynamicState();
      state.dynamic.elapsedTimer = currentTimers.elapsedTimer;
      state.dynamic.persistTimer = currentTimers.persistTimer;
    }
    state.dynamic.enabled = true;
    state.dynamic.sessionId = session.sessionId || state.dynamic.sessionId || `dynamic-${now.toISOString().replace(/[:.]/g, "-")}`;
    state.dynamic.generation = nextGeneration;
    state.dynamic.startedAt = session.startedAt || state.dynamic.startedAt || now.toISOString();
    state.dynamic.stoppedAt = "";
    state.dynamic.pageUrl = location.href;
    state.dynamic.pageTitle = document.title;
    state.dynamic.rawBusPackageCount = 0;
    state.dynamic.lastFrameSnapshot = buildDynamicFrameSnapshot();
    startDynamicMutationObserver();
    startDynamicFrameSampler();
    startDynamicElapsedTimer();
    emitRawRecorderEvent("document.joined", buildDynamicDocumentPayload({ reason }));
    scheduleDynamicPersist();
    updateToolbar();
  }

  async function stopDynamicRecording(reason = "manual-stop", options = {}) {
    const stoppedSession = state.dynamic.sessionId
      ? await storeMessage("LWR_DYNAMIC_SESSION_STOP", {
        sessionId: state.dynamic.sessionId,
        generation: state.dynamic.generation,
        reason
      })
      : null;
    finishDynamicInput(reason);
    captureDynamicTransitionFrame("stop");
    stopDynamicMutationObserver();
    stopDynamicFrameSampler();
    state.dynamic.enabled = false;
    state.dynamic.stoppedAt = stoppedSession && stoppedSession.session ? stoppedSession.session.stoppedAt || new Date().toISOString() : new Date().toISOString();
    emitRawRecorderEvent("document.left", buildDynamicDocumentPayload({ reason }));
    stopDynamicElapsedTimer();
    await waitForDynamicCaptures();
    await refreshDynamicRawBusPackageCount();
    updateToolbar();
    if (!isTopDocument) {
      await persistDynamicStateNow();
      return {
        stopped: true,
        exported: false,
        state: {
          sessionId: state.dynamic.sessionId,
          generation: state.dynamic.generation,
          rawBusPackageCount: state.dynamic.rawBusPackageCount || 0
        }
      };
    }
    if (options.exportMode === "none") {
      await persistDynamicStateNow();
      showInlineNotice("动态录入已停止，未导出。");
      return {
        stopped: true,
        exported: false,
        state: {
          sessionId: state.dynamic.sessionId,
          generation: state.dynamic.generation,
          rawBusPackageCount: state.dynamic.rawBusPackageCount || 0
        }
      };
    }
    if (state.dynamic.sessionId) {
      try {
        const result = await downloadDynamicRecordingZip({
          uploadUrl: options.uploadUrl,
          filename: options.filename,
          metadata: options.metadata || state.dynamic.devLoopMetadata || {},
          clearRawAfterUpload: options.clearRawAfterUpload !== false
        });
        if (result.downloaded || result.uploaded) {
          showInlineNotice(`动态录入已停止，已${result.uploaded ? "上传" : "下载"} ${result.rawBusPackageCount} 个 raw package。`);
          if (!result.uploaded || options.clearRawAfterUpload !== false) {
            await storeMessage("LWR_DYNAMIC_SESSION_CLEAR_RAW", {
              sessionId: state.dynamic.sessionId,
              generation: state.dynamic.generation
            });
          }
        } else {
          showInlineNotice("动态录入已停止，没有 raw package。");
        }
        await storeMessage("LWR_STORE_DYNAMIC_CLEAR");
        state.dynamic = createEmptyDynamicState();
        updateToolbar();
        return {
          stopped: true,
          exported: Boolean(result.downloaded || result.uploaded),
          export: result
        };
      } catch (error) {
        await persistDynamicStateNow();
        throw error;
      }
    } else {
      showInlineNotice("动态录入已停止，没有 raw package。");
    }
    await storeMessage("LWR_STORE_DYNAMIC_CLEAR");
    state.dynamic = createEmptyDynamicState();
    updateToolbar();
    return {
      stopped: true,
      exported: false,
      state: {
        sessionId: "",
        generation: 0,
        rawBusPackageCount: 0
      }
    };
  }

  function shouldExportDynamicRecording(rawBusPackageCount) {
    return Math.max(0, Number(rawBusPackageCount) || 0) > 0;
  }

  function startDynamicElapsedTimer() {
    stopDynamicElapsedTimer();
    state.dynamic.elapsedTimer = window.setInterval(() => {
      refreshDynamicRawBusPackageCount();
      updateToolbar();
    }, DYNAMIC_ELAPSED_INTERVAL_MS);
  }

  function stopDynamicElapsedTimer() {
    if (state.dynamic.elapsedTimer) {
      window.clearInterval(state.dynamic.elapsedTimer);
      state.dynamic.elapsedTimer = null;
    }
  }

  async function restoreDynamicRecordingState() {
    const sessionResponse = await storeMessage("LWR_DYNAMIC_SESSION_GET");
    const session = sessionResponse.session;
    const response = await storeMessage("LWR_STORE_DYNAMIC_GET");
    const persisted = response.dynamic;
    if (!session || !session.active) {
      state.dynamic.enabled = false;
      state.dynamic.stoppedAt = session && session.stoppedAt ? session.stoppedAt : state.dynamic.stoppedAt;
      updateToolbar();
      return;
    }
    if (!persisted || persisted.schema !== "captura.dynamic-state" || persisted.sessionId !== session.sessionId || Number(persisted.generation) !== Number(session.generation)) {
      startDynamicAgentForSession(session, "dynamic-restore");
      return;
    }

    const previousPageUrl = persisted.pageUrl || "";
    state.dynamic.sessionId = persisted.sessionId || "";
    state.dynamic.generation = Math.max(0, Number(persisted.generation) || Number(session.generation) || 0);
    state.dynamic.startedAt = persisted.startedAt || "";
    state.dynamic.stoppedAt = persisted.stoppedAt || "";
    state.dynamic.sequence = Math.max(Number(persisted.sequence) || 0, Array.isArray(persisted.nodes) ? persisted.nodes.length : 0);
    state.dynamic.nodes = Array.isArray(persisted.nodes) ? persisted.nodes : [];
    state.dynamic.rawEvents = Array.isArray(persisted.rawEvents) ? persisted.rawEvents : [];
    state.dynamic.rawMutations = Array.isArray(persisted.rawMutations) ? persisted.rawMutations : [];
    state.dynamic.rawBusPackageCount = Math.max(0, Number(persisted.rawBusPackageCount) || 0);
    state.dynamic.targetOrder = Math.max(Number(persisted.targetOrder) || 0, countDynamicActions(state.dynamic.nodes));
    state.dynamic.noChangeFrameCount = Math.max(0, Number(persisted.noChangeFrameCount) || 0);
    state.dynamic.pageUrl = location.href;
    state.dynamic.pageTitle = document.title;
    state.dynamic.lastFrameSnapshot = buildDynamicFrameSnapshot();

    if (session.active) {
      state.dynamic.enabled = true;
      state.dynamic.stoppedAt = "";
      state.toolbarExpanded = true;
      if (previousPageUrl && previousPageUrl !== location.href) {
        appendDynamicNavigationTransition(previousPageUrl, persisted.pageTitle || "", location.href, document.title);
      }
      startDynamicMutationObserver();
      startDynamicFrameSampler();
      startDynamicElapsedTimer();
      emitRawRecorderEvent("document.joined", buildDynamicDocumentPayload({ reason: "dynamic-restore" }));
      scheduleDynamicPersist();
    }

    await refreshDynamicRawBusPackageCount();
    updateToolbar();
  }

  function startDynamicSessionPoller() {
    if (isTopDocument || state.sessionPollTimer) {
      return;
    }
    state.sessionPollTimer = window.setInterval(() => {
      pollDynamicSessionState().catch((error) => console.warn("LWR dynamic session poll failed", error));
    }, DYNAMIC_SESSION_POLL_INTERVAL_MS);
  }

  async function pollDynamicSessionState() {
    const response = await storeMessage("LWR_DYNAMIC_SESSION_GET");
    const dynamic = response.session;
    if (!dynamic || dynamic.schema !== "captura.dynamic-session") {
      if (state.dynamic.enabled) {
        stopLocalDynamicAgent("dynamic-poll-empty");
      }
      return;
    }
    const sameSession = state.dynamic.sessionId === dynamic.sessionId && Number(state.dynamic.generation) === Number(dynamic.generation);
    if (dynamic.active && (!state.dynamic.enabled || !sameSession)) {
      if (state.dynamic.enabled && !sameSession) {
        stopLocalDynamicAgent("dynamic-poll-switch");
      }
      startDynamicAgentForSession(dynamic, "dynamic-poll-start");
    }
    if (!dynamic.active && state.dynamic.enabled && sameSession) {
      stopLocalDynamicAgent("dynamic-poll-stop", dynamic.stoppedAt || "");
    }
  }

  function stopLocalDynamicAgent(reason, stoppedAt = "") {
    finishDynamicInput(reason);
    captureDynamicTransitionFrame(reason);
    stopDynamicMutationObserver();
    stopDynamicFrameSampler();
    stopDynamicElapsedTimer();
    state.dynamic.enabled = false;
    state.dynamic.stoppedAt = stoppedAt || new Date().toISOString();
    emitRawRecorderEvent("document.left", buildDynamicDocumentPayload({ reason }));
    updateToolbar();
  }

  function appendDynamicNavigationTransition(fromUrl, fromTitle, toUrl, toTitle) {
    const snapshot = buildDynamicFrameSnapshot();
    const node = createDynamicTransitionNode({
      reason: "navigation",
      previousSnapshot: {
        offsetMs: 0,
        url: fromUrl,
        title: fromTitle,
        visibleText: [],
        interactive: [],
        mainHtml: ""
      },
      currentSnapshot: snapshot,
      mutations: [],
      deltaOverride: {
        urlChanged: { from: fromUrl, to: toUrl },
        titleChanged: fromTitle !== toTitle ? { from: fromTitle, to: toTitle } : null
      }
    });
    state.dynamic.nodes.push(node);
    emitRawRecorderEvent(DYNAMIC_RAW_EVENT_TYPE_DOM_SNAPSHOT, buildDynamicTransitionRawPayload(node, { previousSnapshot: null, currentSnapshot: snapshot, mutations: [] }));
    state.dynamic.lastFrameSnapshot = snapshot;
    scheduleDynamicPersist();
    updateToolbar();
  }

  function onDynamicPageHide() {
    if (!state.dynamic.enabled) {
      return;
    }
    finishDynamicInput("pagehide");
    captureDynamicTransitionFrame("pagehide");
    emitRawRecorderEvent("document.changed", buildDynamicDocumentPayload({ reason: "pagehide" }));
    state.dynamic.pageUrl = location.href;
    state.dynamic.pageTitle = document.title;
    persistDynamicStateNow().catch((error) => console.warn("LWR dynamic persist failed", error));
  }

  function scheduleDynamicPersist() {
    if (!isTopDocument) {
      return;
    }
    clearDynamicPersistTimer();
    state.dynamic.persistTimer = window.setTimeout(() => {
      state.dynamic.persistTimer = null;
      persistDynamicStateNow().catch((error) => console.warn("LWR dynamic persist failed", error));
    }, 250);
  }

  function clearDynamicPersistTimer() {
    if (state.dynamic.persistTimer) {
      window.clearTimeout(state.dynamic.persistTimer);
      state.dynamic.persistTimer = null;
    }
  }

  async function persistDynamicStateNow() {
    if (!isTopDocument) {
      return;
    }
    clearDynamicPersistTimer();
    await storeMessage("LWR_STORE_DYNAMIC_SAVE", { dynamic: buildPersistedDynamicState() });
  }

  function buildPersistedDynamicState() {
    return {
      schema: "captura.dynamic-state",
      version: 1,
      active: state.dynamic.enabled,
      sessionId: state.dynamic.sessionId || "",
      generation: state.dynamic.generation || 0,
      agentInstanceId: state.dynamic.agentInstanceId || dynamicAgentInstanceId,
      documentLifecycleId: state.dynamic.documentLifecycleId || dynamicDocumentLifecycleId,
      startedAt: state.dynamic.startedAt || "",
      stoppedAt: state.dynamic.stoppedAt || "",
      pageUrl: location.href,
      pageTitle: document.title,
      sequence: state.dynamic.sequence || state.dynamic.nodes.length,
      targetOrder: state.dynamic.targetOrder || countDynamicActions(state.dynamic.nodes),
      noChangeFrameCount: state.dynamic.noChangeFrameCount || 0,
      rawEvents: state.dynamic.rawEvents,
      rawMutations: state.dynamic.rawMutations,
      rawBusPackageCount: state.dynamic.rawBusPackageCount || 0,
      nodes: state.dynamic.nodes
    };
  }

  function emitRawRecorderEvent(eventType, payload = {}) {
    if (!state.dynamic.sessionId) {
      return Promise.resolve(null);
    }
    const sentAtEpochMs = Date.now();
    state.rawLocalSequence += 1;
    const normalizedEventType = normalizeDynamicRawEventType(eventType);
    const event = {
      protocol: DYNAMIC_RAW_EVENT_SCHEMA,
      version: DYNAMIC_RAW_EVENT_VERSION,
      sessionId: state.dynamic.sessionId,
      generation: state.dynamic.generation || 0,
      eventId: `raw-${state.dynamic.sessionId}-${state.rawLocalSequence}`,
      eventType: normalizedEventType,
      line: inferDynamicRawEventLine(normalizedEventType),
      sentAtEpochMs,
      localSequence: state.rawLocalSequence,
      unit: buildDocumentUnit(),
      payload
    };
    return chrome.runtime.sendMessage({ type: "LWR_RAW_EVENT_APPEND", event })
      .then((response) => {
        syncDynamicRawBusPackageCount(response);
        return response;
      })
      .catch((error) => {
        console.warn("LWR raw event append failed", error);
        return null;
      });
  }

  async function refreshDynamicRawBusPackageCount() {
    if (!isTopDocument || !state.dynamic.sessionId || state.dynamic.rawBusPackageCountPending) {
      return;
    }
    state.dynamic.rawBusPackageCountPending = true;
    try {
      const response = await storeMessage("LWR_RAW_EVENTS_COUNT", { sessionId: state.dynamic.sessionId, generation: state.dynamic.generation });
      syncDynamicRawBusPackageCount(response);
    } catch (error) {
      console.warn("LWR raw event count failed", error);
    } finally {
      state.dynamic.rawBusPackageCountPending = false;
    }
  }

  function syncDynamicRawBusPackageCount(response) {
    if (!response || response.ok === false || !Number.isFinite(Number(response.count))) {
      return;
    }
    state.dynamic.rawBusPackageCount = Math.max(0, Number(response.count) || 0);
    updateToolbar();
  }

  function buildDocumentUnit() {
    return {
      kind: isTopDocument ? "document" : "iframe",
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      scroll: {
        x: window.scrollX,
        y: window.scrollY
      }
    };
  }

  function normalizeDynamicRawEventType(eventType) {
    if (eventType === DYNAMIC_RAW_EVENT_TYPE_LEGACY_USER_EVENT) {
      return DYNAMIC_RAW_EVENT_TYPE_USER_OPERATION;
    }
    if (eventType === DYNAMIC_RAW_EVENT_TYPE_LEGACY_DOM_MUTATION) {
      return DYNAMIC_RAW_EVENT_TYPE_DOM_CHANGE;
    }
    if (eventType === DYNAMIC_RAW_EVENT_TYPE_LEGACY_DOCUMENT_SNAPSHOT) {
      return DYNAMIC_RAW_EVENT_TYPE_DOM_SNAPSHOT;
    }
    return String(eventType || DYNAMIC_RAW_LINE_UNKNOWN);
  }

  function inferDynamicRawEventLine(eventType) {
    if (eventType === DYNAMIC_RAW_EVENT_TYPE_USER_OPERATION) {
      return DYNAMIC_RAW_LINE_USER_OPERATION;
    }
    if (eventType === DYNAMIC_RAW_EVENT_TYPE_DOM_CHANGE || eventType === DYNAMIC_RAW_EVENT_TYPE_DOM_SNAPSHOT) {
      return DYNAMIC_RAW_LINE_DOM_CHANGE;
    }
    if (eventType === DYNAMIC_RAW_EVENT_TYPE_SCREEN_FRAME) {
      return DYNAMIC_RAW_LINE_SCREEN_FRAME;
    }
    if (eventType === DYNAMIC_RAW_EVENT_TYPE_DOCUMENT_JOINED || eventType === DYNAMIC_RAW_EVENT_TYPE_DOCUMENT_CHANGED || eventType === DYNAMIC_RAW_EVENT_TYPE_DOCUMENT_LEFT) {
      return DYNAMIC_RAW_LINE_UNIT;
    }
    return DYNAMIC_RAW_LINE_UNKNOWN;
  }

  function buildDynamicDocumentPayload(extra = {}) {
    return {
      ...extra,
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      doctype: document.doctype ? document.doctype.name : "",
      characterSet: document.characterSet || "",
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      scroll: {
        x: window.scrollX,
        y: window.scrollY
      }
    };
  }

  function buildDynamicActionRawPayload(action, rawEvent, event) {
    return {
      domEventType: event && event.type ? event.type : action.operation && action.operation.type ? action.operation.type : "",
      isTrusted: Boolean(event && event.isTrusted),
      actionNodeId: action.id,
      nodeUid: action.nodeUid || "",
      originalNodeId: action.originalNodeId || action.id || "",
      documentLifecycleId: action.documentLifecycleId || state.dynamic.documentLifecycleId || dynamicDocumentLifecycleId,
      rawEvent,
      target: {
        rawTarget: action.rawTarget || null,
        canonicalTarget: action.canonicalTarget || null,
        targetHtml: sanitizeDynamicDomPayloadHtml(action.targetHtml || ""),
        contextHtml: sanitizeDynamicDomPayloadHtml(action.contextHtml || ""),
        appendix: action.appendix || {}
      }
    };
  }

  function buildDynamicTransitionRawPayload(node, details) {
    return {
      transitionNodeId: node.id,
      nodeUid: node.nodeUid || "",
      originalNodeId: node.originalNodeId || node.id || "",
      documentLifecycleId: node.documentLifecycleId || state.dynamic.documentLifecycleId || dynamicDocumentLifecycleId,
      previousSnapshot: details.previousSnapshot || null,
      currentSnapshot: details.currentSnapshot || null,
      mutations: details.mutations || []
    };
  }

  function cloneDynamicNodeForRawBus(node) {
    const clone = JSON.parse(JSON.stringify(node || {}));
    if (clone.screenshots) {
      clone.screenshots = {};
    }
    return clone;
  }

  function trackDynamicCapture(promise) {
    const tracked = Promise.resolve(promise)
      .catch(() => null)
      .finally(() => {
        state.dynamic.pendingCaptures = state.dynamic.pendingCaptures.filter((item) => item !== tracked);
      });
    state.dynamic.pendingCaptures.push(tracked);
    return tracked;
  }

  async function waitForDynamicCaptures() {
    const pending = state.dynamic.pendingCaptures.slice();
    if (pending.length) {
      await Promise.allSettled(pending);
    }
  }

  function onDynamicClick(event) {
    if (!shouldRecordDynamicEvent(event)) {
      return;
    }
    const target = normalizeEventTarget(event.target);
    if (!target) {
      return;
    }
    if (state.dynamic.currentInput && !isSameDynamicTarget(target, state.dynamic.currentInput.target)) {
      finishDynamicInput("next-click");
    }
    appendDynamicAction("click", event, target);
  }

  function onDynamicChange(event) {
    if (!shouldRecordDynamicEvent(event)) {
      return;
    }
    const target = normalizeEventTarget(event.target);
    if (!target) {
      return;
    }
    if (isEditableElement(target) || target.tagName === "SELECT") {
      startOrUpdateDynamicInput(event, target, target.tagName === "SELECT" ? "select" : "change");
      finishDynamicInput("change");
      return;
    }
    appendDynamicAction("change", event, target);
  }

  function onDynamicInput(event) {
    if (!shouldRecordDynamicEvent(event)) {
      return;
    }
    const target = normalizeEventTarget(event.target);
    if (!target || !isEditableElement(target)) {
      return;
    }
    startOrUpdateDynamicInput(event, target, state.dynamic.pendingPaste ? "paste" : state.dynamic.compositionActive ? "composition" : "typing");
    state.dynamic.pendingPaste = false;
  }

  function onDynamicPaste(event) {
    if (!shouldRecordDynamicEvent(event)) {
      return;
    }
    state.dynamic.pendingPaste = true;
  }

  function onDynamicCompositionStart(event) {
    if (!shouldRecordDynamicEvent(event)) {
      return;
    }
    state.dynamic.compositionActive = true;
  }

  function onDynamicCompositionEnd(event) {
    if (!shouldRecordDynamicEvent(event)) {
      return;
    }
    state.dynamic.compositionActive = false;
    const target = normalizeEventTarget(event.target);
    if (target && isEditableElement(target)) {
      startOrUpdateDynamicInput(event, target, "composition");
    }
  }

  function onDynamicKeyDown(event) {
    if (!shouldRecordDynamicEvent(event)) {
      return;
    }
    const target = normalizeEventTarget(event.target);
    if (target && state.dynamic.currentInput && isSameDynamicTarget(target, state.dynamic.currentInput.target)) {
      if (event.key === "Enter" || event.key === "Tab") {
        finishDynamicInput(event.key === "Enter" ? "enter" : "tab");
      }
      return;
    }
    if (event.key === "Enter" || event.key === "Tab" || event.key === "Escape") {
      appendDynamicAction("keydown", event, target || document.body, { key: event.key });
    }
  }

  function onDynamicFocusOut(event) {
    if (!shouldRecordDynamicEvent(event)) {
      return;
    }
    const target = normalizeEventTarget(event.target);
    if (target && state.dynamic.currentInput && isSameDynamicTarget(target, state.dynamic.currentInput.target)) {
      finishDynamicInput("blur");
    }
  }

  function shouldRecordDynamicEvent(event) {
    if (!state.dynamic.enabled || state.annotationMode || !event || isRecorderNode(event.target)) {
      return false;
    }
    return true;
  }

  function startOrUpdateDynamicInput(event, target, method) {
    if (!state.dynamic.currentInput || !isSameDynamicTarget(target, state.dynamic.currentInput.target)) {
      finishDynamicInput("target-change");
      const action = reuseEditableClickActionAsInput(event, target, method) || appendDynamicAction("input", event, target, { inputMethod: method });
      const value = readElementValue(target);
      const hasRecordedValueBefore = Boolean(action && action.operation && Object.prototype.hasOwnProperty.call(action.operation, "valueBefore"));
      const valueBefore = hasRecordedValueBefore && !value.redacted
        ? action.operation.valueBefore
        : value.redacted ? "" : value.value;
      state.dynamic.currentInput = {
        target,
        actionId: action.id,
        actionUid: action.nodeUid || "",
        method,
        valueBefore,
        redacted: value.redacted,
        startedAtMs: performance.now()
      };
      action.operation = {
        ...(action.operation || {}),
        type: "input",
        method,
        inputMethod: method,
        valueBefore,
        valueAfter: value.redacted ? "" : value.value,
        redacted: value.redacted,
        commitSignal: "",
        editKind: inferEditKind(valueBefore, value.value, value.redacted)
      };
      return;
    }

    const input = state.dynamic.currentInput;
    input.method = input.method === "typing" ? method : input.method;
    const action = findDynamicNodeByUid(input.actionUid) || state.dynamic.nodes.find((item) => item.id === input.actionId);
    if (action) {
      const value = readElementValue(target);
      action.operation = {
        ...(action.operation || {}),
        method: input.method,
        valueAfter: value.redacted ? "" : value.value,
        redacted: value.redacted,
        editKind: inferEditKind(input.valueBefore, value.value, value.redacted)
      };
      scheduleDynamicPersist();
    }
  }

  function reuseEditableClickActionAsInput(event, target, method) {
    const normalized = canonicalActionTarget(target);
    if (!shouldMergeClickIntoInputAction(normalized.canonicalElement)) {
      return null;
    }
    const action = findReusableEditableClickAction(normalized);
    if (!action) {
      return null;
    }
    const rawEvent = buildDynamicRawEvent(event, "input", normalized.rawElement, normalized.canonicalElement);
    action.rawEvents = action.rawEvents || [];
    action.rawEvents.push(rawEvent);
    pushDynamicRawEvent(rawEvent);
    action.operation = {
      ...(action.operation || {}),
      type: "input",
      method,
      inputMethod: method,
      commitSignal: "",
      editKind: "unchanged"
    };
    action.referenceRefs = buildDynamicActionReferenceRefs(action);
    scheduleDynamicPersist();
    return action;
  }

  function shouldMergeClickIntoInputAction(element) {
    if (!element || !element.tagName) {
      return false;
    }
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") || "";
    const type = String(element.getAttribute("type") || "").toLowerCase();
    if (tag === "textarea" || element.isContentEditable || role === "textbox") {
      return true;
    }
    if (tag !== "input") {
      return false;
    }
    if (role === "combobox") {
      return false;
    }
    return !["button", "submit", "reset", "checkbox", "radio", "file", "range", "color"].includes(type);
  }

  function findReusableEditableClickAction(normalizedTarget) {
    const lastAction = [...state.dynamic.nodes].reverse().find((node) => node.type === "action");
    if (!lastAction || !lastAction.operation || lastAction.operation.type !== "click") {
      return null;
    }
    if (lastAction.endedAt) {
      return null;
    }
    if (lastAction.startedAtMs && performance.now() - lastAction.startedAtMs > 2000) {
      return null;
    }
    const rawSelector = lastAction.rawTarget && lastAction.rawTarget.selector;
    const canonicalSelector = lastAction.canonicalTarget && lastAction.canonicalTarget.selector;
    if (rawSelector === normalizedTarget.rawSelector || canonicalSelector === normalizedTarget.canonicalSelector) {
      return lastAction;
    }
    return null;
  }

  function finishDynamicInput(commitSignal) {
    const input = state.dynamic.currentInput;
    if (!input) {
      return;
    }
    const action = findDynamicNodeByUid(input.actionUid) || state.dynamic.nodes.find((item) => item.id === input.actionId);
    if (action) {
      const value = readElementValue(input.target);
      action.operation = {
        ...(action.operation || {}),
        method: input.method,
        valueAfter: value.redacted ? "" : value.value,
        redacted: value.redacted,
        commitSignal,
        editKind: inferEditKind(input.valueBefore, value.value, value.redacted)
      };
      action.endedAt = new Date().toISOString();
      action.durationMs = Math.max(0, Math.round(performance.now() - input.startedAtMs));
      scheduleDynamicPersist();
    }
    state.dynamic.currentInput = null;
  }

  function appendDynamicAction(type, event, target, extra = {}) {
    if (!state.dynamic.enabled) {
      return null;
    }
    captureDynamicTransitionFrame("before-action");
    const identity = createDynamicNodeIdentity("action");
    const pageContext = buildDynamicPageContext();
    const targetNormalization = canonicalActionTarget(target);
    const snapshot = buildDynamicTargetSnapshot(targetNormalization.canonicalElement);
    const rawTarget = buildDynamicTargetReference(targetNormalization.rawElement);
    const canonicalTarget = buildDynamicTargetReference(targetNormalization.canonicalElement, snapshot);
    const valueTarget = isEditableElement(targetNormalization.canonicalElement) ? targetNormalization.canonicalElement : targetNormalization.rawElement;
    const value = isEditableElement(valueTarget) ? readElementValue(valueTarget) : null;
    const rawEvent = buildDynamicRawEvent(event, type, targetNormalization.rawElement, targetNormalization.canonicalElement);
    const action = {
      id: identity.id,
      folder: identity.folder,
      nodeUid: identity.nodeUid,
      originalNodeId: identity.id,
      localNodeId: identity.id,
      agentInstanceId: identity.agentInstanceId,
      documentLifecycleId: identity.documentLifecycleId,
      nodeType: "action",
      type: "action",
      sequence: identity.sequence,
      targetOrderIndex: state.dynamic.targetOrder + 1,
      offsetMs: getDynamicOffsetMs(),
      startedAt: new Date().toISOString(),
      startedAtMs: performance.now(),
      endedAt: "",
      pageUrl: location.href,
      pageTitle: document.title,
      pageContext,
      operation: {
        type,
        key: extra.key || "",
        inputMethod: extra.inputMethod || "",
        method: extra.inputMethod || "",
        valueBefore: value && !value.redacted ? value.value : "",
        valueAfter: value && !value.redacted ? value.value : "",
        redacted: value ? value.redacted : false,
        editKind: value ? "unchanged" : "",
        commitSignal: ""
      },
      target: {
        kind: snapshot.primaryKind,
        identity: snapshot.identity,
        stateBefore: snapshot.state,
        matchedSignals: snapshot.matchedSignals,
        missingSignals: snapshot.missingSignals,
        objectCandidates: snapshot.objectCandidates
      },
      rawTarget,
      canonicalTarget,
      targetNormalization: {
        rawSelector: targetNormalization.rawSelector,
        canonicalSelector: targetNormalization.canonicalSelector,
        matchedSignals: targetNormalization.matchedSignals,
        suppressedSignals: targetNormalization.suppressedSignals
      },
      targetHtml: snapshot.html,
      contextHtml: snapshot.contextHtml,
      appendix: snapshot.appendix,
      rawEvents: [rawEvent],
      referenceRefs: [],
      screenshots: {
        beforeDataUrl: "",
        afterImmediateDataUrl: ""
      }
    };

    state.dynamic.targetOrder = action.targetOrderIndex;
    action.referenceRefs = buildDynamicActionReferenceRefs(action);
    state.dynamic.nodes.push(action);
    pushDynamicRawEvent(rawEvent);
    emitRawRecorderEvent(DYNAMIC_RAW_EVENT_TYPE_USER_OPERATION, buildDynamicActionRawPayload(action, rawEvent, event));
    scheduleDynamicPersist();
    updateToolbar();
    return action;
  }

  function createDynamicNodeIdentity(type) {
    const sequence = state.dynamic.sequence + 1;
    state.dynamic.sequence = sequence;
    const padded = String(sequence).padStart(3, "0");
    const id = `${padded}-${type}`;
    return {
      sequence,
      id,
      folder: id,
      nodeUid: buildDynamicNodeUid(id, sequence),
      agentInstanceId: state.dynamic.agentInstanceId || dynamicAgentInstanceId,
      documentLifecycleId: state.dynamic.documentLifecycleId || dynamicDocumentLifecycleId
    };
  }

  function buildDynamicNodeUid(localNodeId, sequence) {
    return [
      state.dynamic.sessionId || "dynamic-session",
      String(state.dynamic.generation || 0),
      state.dynamic.agentInstanceId || dynamicAgentInstanceId,
      state.dynamic.documentLifecycleId || dynamicDocumentLifecycleId,
      String(sequence || 0),
      localNodeId || ""
    ].join(":");
  }

  function createDynamicRuntimeId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return `${prefix}:${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}:${Date.now()}`;
  }

  function findDynamicNodeByUid(nodeUid) {
    if (!nodeUid) {
      return null;
    }
    return state.dynamic.nodes.find((item) => item && item.nodeUid === nodeUid) || null;
  }

  function startDynamicFrameSampler() {
    stopDynamicFrameSampler();
    state.dynamic.frameTimer = window.setInterval(() => {
      captureDynamicTransitionFrame("frame");
    }, DYNAMIC_FRAME_INTERVAL_MS);
  }

  function stopDynamicFrameSampler() {
    if (state.dynamic.frameTimer) {
      window.clearInterval(state.dynamic.frameTimer);
      state.dynamic.frameTimer = null;
    }
  }

  function captureDynamicTransitionFrame(reason) {
    if (!state.dynamic.enabled) {
      return null;
    }
    const previousSnapshot = state.dynamic.lastFrameSnapshot || buildDynamicFrameSnapshot();
    const currentSnapshot = buildDynamicFrameSnapshot();
    const mutations = state.dynamic.pendingMutations.splice(0, DYNAMIC_MAX_MUTATIONS_PER_FRAME);
    const delta = buildDynamicFrameDelta(previousSnapshot, currentSnapshot, mutations);
    if (!hasDynamicFrameChange(delta)) {
      state.dynamic.noChangeFrameCount += 1;
      state.dynamic.lastFrameSnapshot = currentSnapshot;
      return null;
    }
    const node = createDynamicTransitionNode({
      reason,
      previousSnapshot,
      currentSnapshot,
      mutations,
      deltaOverride: null
    });
    state.dynamic.nodes.push(node);
    emitRawRecorderEvent(DYNAMIC_RAW_EVENT_TYPE_DOM_SNAPSHOT, buildDynamicTransitionRawPayload(node, { previousSnapshot, currentSnapshot, mutations }));
    state.dynamic.lastFrameSnapshot = currentSnapshot;
    state.dynamic.noChangeFrameCount = 0;
    scheduleDynamicPersist();
    updateToolbar();
    return node;
  }

  function startDynamicMutationObserver() {
    if (state.dynamic.mutationObserver) {
      return;
    }
    state.dynamic.mutationObserver = new MutationObserver((mutations) => {
      if (!state.dynamic.enabled) {
        return;
      }
      mutations.forEach((mutation) => {
        if (isRecorderNode(mutation.target)) {
          return;
        }
        if (shouldSkipDynamicMutation(mutation)) {
          return;
        }
        const fact = buildMutationFact(mutation);
        if (!fact) {
          return;
        }
        if (state.dynamic.pendingMutations.length < DYNAMIC_MAX_MUTATIONS_PER_FRAME) {
          state.dynamic.pendingMutations.push(fact);
        }
        state.dynamic.rawMutations.push(fact);
        emitRawRecorderEvent(DYNAMIC_RAW_EVENT_TYPE_DOM_CHANGE, { mutation: fact });
        if (state.dynamic.rawMutations.length > DYNAMIC_MAX_RAW_MUTATIONS) {
          state.dynamic.rawMutations.shift();
        }
      });
    });
    state.dynamic.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
      attributeFilter: getDynamicMutationAttributeFilter()
    });
  }

  function getDynamicMutationAttributeFilter() {
    const attributes = DYNAMIC_MUTATION_ATTRIBUTE_FILTER_BASE.slice();
    if (state.settings.includeStyleChanges) {
      attributes.push(DYNAMIC_STYLE_ATTRIBUTE_NAME);
    }
    return attributes;
  }

  function stopDynamicMutationObserver() {
    if (state.dynamic.mutationObserver) {
      state.dynamic.mutationObserver.disconnect();
      state.dynamic.mutationObserver = null;
    }
  }
